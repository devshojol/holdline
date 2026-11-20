import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Color3, Color4, DirectionalLight, Engine, FreeCamera, HemisphericLight, Quaternion, Scene, TransformNode, Vector3 } from '../game/rendering/babylon';
import { loadContainer } from '../game/rendering/gltf';
import { getAgent } from '../game/agents';

/** World direction from `bone` to `child`. */
function boneDir(bone: TransformNode, child: TransformNode): Vector3 {
  bone.computeWorldMatrix(true);
  child.computeWorldMatrix(true);
  return child.getAbsolutePosition().subtract(bone.getAbsolutePosition()).normalize();
}

/**
 * Turn `bone` so the line from it to `child` points along `dir` (world space). The turn is worked out in the
 * parent's frame, then applied on whichever side of the bone's own rotation actually lands it on target:
 * measured, not assumed, so the rig's axis conventions don't matter.
 */
function aimBone(bone: TransformNode, child: TransformNode, dir: Vector3) {
  const want = dir.normalizeToNew();
  for (let pass = 0; pass < 3; pass++) {
    const cur = boneDir(bone, child);
    const axisWorld = Vector3.Cross(cur, want);
    if (axisWorld.length() < 1e-4) return;
    const angle = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(cur, want))));
    const parent = bone.parent as TransformNode | null;
    const inv = parent ? parent.getWorldMatrix().clone().invert() : null;
    const axis = inv ? Vector3.TransformNormal(axisWorld, inv).normalize() : axisWorld.normalize();
    const local = bone.rotationQuaternion ?? Quaternion.FromEulerVector(bone.rotation);
    let best = local;
    let bestErr = Infinity;
    for (const sign of [1, -1])
      for (const order of [0, 1]) {
        const delta = Quaternion.RotationAxis(axis, angle * sign);
        const q = order ? local.multiply(delta) : delta.multiply(local);
        bone.rotationQuaternion = q;
        const err = 1 - Vector3.Dot(boneDir(bone, child), want);
        if (err < bestErr) {
          bestErr = err;
          best = q;
        }
      }
    bone.rotationQuaternion = best;
    bone.computeWorldMatrix(true);
  }
}

/**
 * The player's soldier in 3D on the main menu: their own model from the waist up, arms at their sides, filling
 * the frame. Drag left and right to turn them round; left alone they ease back to face you. Shows `fallback`
 * while the model loads, and instead of it when the build has no models.
 */
export function SoldierViewer({ agentId, className, fallback }: { agentId: string; className?: string; fallback: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !__LOCAL_MODELS__) {
      setState('failed');
      return;
    }
    setState('loading');
    let disposed = false;
    const engine = new Engine(canvas, true, { alpha: true, premultipliedAlpha: false, stencil: false });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0, 0, 0, 0);
    scene.imageProcessingConfiguration.toneMappingEnabled = true;
    scene.imageProcessingConfiguration.toneMappingType = 1; // ACES, like the game
    // waist up: the camera at chest height, close in
    const camera = new FreeCamera('soldier-cam', new Vector3(0, 1.36, 1.75), scene);
    camera.setTarget(new Vector3(0, 1.3, 0));
    camera.fov = 0.62;
    camera.minZ = 0.05;
    camera.maxZ = 30;
    const sky = new HemisphericLight('soldier-sky', new Vector3(0.2, 1, 0.3), scene);
    sky.intensity = 0.9;
    sky.groundColor = new Color3(0.35, 0.28, 0.2);
    const sun = new DirectionalLight('soldier-sun', new Vector3(0.45, -0.6, -0.75), scene);
    sun.intensity = 2.3;
    sun.diffuse = new Color3(1, 0.93, 0.82);
    // a warm rim from behind, so the figure stands off the dark menu
    const rim = new DirectionalLight('soldier-rim', new Vector3(-0.5, -0.2, 1), scene);
    rim.intensity = 1.8;
    rim.diffuse = new Color3(1, 0.68, 0.3);

    let root: TransformNode | null = null;
    let spine: TransformNode | null = null;
    let spineRest: Quaternion | null = null;
    let release: (() => void) | null = null;

    const FACE = 0; // facing the camera (+Z)
    let yaw = FACE - 0.3; // turned a little to start with
    let spin = 0; // turn speed carried on after a flick
    let dragging = false;
    let idle = 0;
    let t = 0;
    let lastX = 0;

    // the soldier's own model in its own pose (no in-game posing, which holds a rifle), arms lowered to the sides
    loadContainer(scene, getAgent(agentId).model)
      .then((container) => {
        if (disposed) {
          container.dispose();
          return;
        }
        const entries = container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
        release = () => {
          entries.dispose();
          container.dispose();
        };
        const model = new TransformNode('soldier-model', scene);
        for (const r of entries.rootNodes) r.parent = model;
        const byName = new Map<string, TransformNode>();
        for (const n of model.getDescendants(false)) if (n instanceof TransformNode) byName.set(n.name.replace(/_\d+$/, ''), n);
        const node = (name: string) => byName.get(name);
        const eyeL = node('L_Eyeball');
        const eyeR = node('R_Eyeball');
        const head = node('Head');
        if (!eyeL || !eyeR || !head) throw new Error('soldier rig not found');
        model.computeWorldMatrix(true);
        for (const n of model.getDescendants(false)) (n as TransformNode).computeWorldMatrix?.(true);
        // face +Z and stand 1.63 m to the eyes, as in the game
        const eye = eyeL.getAbsolutePosition().add(eyeR.getAbsolutePosition()).scale(0.5);
        const fwd = eye.subtract(head.getAbsolutePosition());
        model.rotation.y = -Math.atan2(fwd.x, fwd.z);
        model.scaling.setAll(1.63 / Math.max(0.5, eye.y));
        root = new TransformNode('soldier-root', scene);
        model.parent = root;
        root.computeWorldMatrix(true);
        for (const n of root.getDescendants(false)) (n as TransformNode).computeWorldMatrix?.(true);
        for (const m of root.getChildMeshes(false)) {
          m.isPickable = false;
          m.alwaysSelectAsActiveMesh = true; // skinned bounds don't follow the pose
        }
        for (const side of [-1, 1]) {
          const p = side < 0 ? 'L' : 'R';
          const shoulder = node(`${p}_Shoulder`);
          const elbow = node(`${p}_Elbow`);
          const hand = node(`${p}_Hand`);
          if (!shoulder || !elbow || !hand) continue;
          // "out" for this arm: the side its elbow already lies on
          const out = Math.sign(elbow.getAbsolutePosition().x - shoulder.getAbsolutePosition().x) || side;
          aimBone(shoulder, elbow, new Vector3(out * 0.22, -1, 0.02));
          aimBone(elbow, hand, new Vector3(out * 0.08, -1, 0.1));
        }
        spine = node('Spine3') ?? null;
        spineRest = spine?.rotationQuaternion?.clone() ?? null;
        setState('ready');
      })
      .catch(() => {
        if (!disposed) setState('failed');
      });

    const down = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      spin = 0;
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      yaw += dx * 0.012;
      spin = dx * 0.6;
      lastX = e.clientX;
    };
    const up = () => {
      dragging = false;
      idle = 0;
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    engine.runRenderLoop(() => {
      const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
      t += dt;
      if (!dragging) {
        idle += dt;
        yaw += spin * dt;
        spin *= Math.exp(-dt * 4);
        // after a while, turn back to face you
        if (idle > 3) {
          const target = FACE - 0.3;
          let d = (target - yaw) % (Math.PI * 2);
          if (d > Math.PI) d -= Math.PI * 2;
          if (d < -Math.PI) d += Math.PI * 2;
          yaw += d * Math.min(1, dt * 1.5);
        }
      }
      if (root) root.rotation.y = yaw;
      // a slow breath through the chest
      if (spine && spineRest) spine.rotationQuaternion = spineRest.multiply(Quaternion.RotationYawPitchRoll(0, Math.sin(t * 1.6) * 0.02, 0));
      scene.render();
    });
    const observer = new ResizeObserver(() => engine.resize());
    observer.observe(canvas);

    return () => {
      disposed = true;
      observer.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      engine.stopRenderLoop();
      release?.();
      scene.dispose();
      engine.dispose();
    };
  }, [agentId]);

  return (
    <div className={className} style={{ position: 'relative' }}>
      {state !== 'ready' && <div className="absolute inset-0">{fallback}</div>}
      {state !== 'failed' && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          style={{ touchAction: 'none', cursor: 'grab', opacity: state === 'ready' ? 1 : 0, transition: 'opacity 0.4s' }}
          aria-label="Your soldier in 3D. Drag to turn them."
        />
      )}
    </div>
  );
}
