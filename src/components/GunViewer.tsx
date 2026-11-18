import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { WeaponId } from '../types';
import { Color3, Color4, DirectionalLight, Engine, FreeCamera, HemisphericLight, Scene, TransformNode, Vector3 } from '../game/rendering/babylon';
import { loadContainer } from '../game/rendering/gltf';
import { applyGunReflections } from '../game/rendering/gunEnvironment';
import { weaponSkinFile } from '../game/weapons/WeaponSkins';

/**
 * The gun's own 3D model on a small stage: it turns slowly by itself, and can be dragged round to look at it
 * from any side. Shows `fallback` when the build has no model files or the model cannot be loaded.
 */
export function GunViewer({ id, className, fallback }: { id: WeaponId; className?: string; fallback: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const file = weaponSkinFile(id);
    if (!canvas || !file || !__LOCAL_MODELS__) {
      setFailed(true);
      return;
    }
    setFailed(false);
    let disposed = false;
    const engine = new Engine(canvas, true, { alpha: true, premultipliedAlpha: false, stencil: false });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0, 0, 0, 0);
    scene.imageProcessingConfiguration.toneMappingEnabled = true;
    scene.imageProcessingConfiguration.toneMappingType = 1; // ACES, like the game
    const camera = new FreeCamera('viewer-cam', new Vector3(0, 0, -1), scene);
    camera.setTarget(Vector3.Zero());
    camera.fov = 0.5;
    camera.minZ = 0.01;
    camera.maxZ = 20;
    const sky = new HemisphericLight('viewer-sky', new Vector3(0.2, 1, -0.3), scene);
    sky.intensity = 0.95;
    sky.groundColor = new Color3(0.32, 0.28, 0.24);
    const sun = new DirectionalLight('viewer-sun', new Vector3(-0.5, -0.8, 0.6), scene);
    sun.intensity = 2.2;

    // the gun hangs on a pivot at its own centre: drag turns the pivot
    const pivot = new TransformNode('viewer-pivot', scene);
    let yaw = Math.PI / 2 + 0.45; // start on a three-quarter view of the left side
    let pitch = 0.12;
    let dragging = false;
    let idle = 0; // seconds since the last drag: the slow turn starts again after a pause
    let lastX = 0;
    let lastY = 0;

    loadContainer(scene, file)
      .then((container) => {
        if (disposed) {
          container.dispose();
          return;
        }
        applyGunReflections(scene, container);
        container.addAllToScene();
        const holder = new TransformNode('viewer-gun', scene);
        holder.parent = pivot;
        for (const node of container.rootNodes) node.parent = holder;
        // measure with the pivot unturned: the bounds are in world space, the offset is in the pivot's
        pivot.rotation.set(0, 0, 0);
        pivot.computeWorldMatrix(true);
        holder.computeWorldMatrix(true);
        const { min, max } = holder.getHierarchyBoundingVectors(true);
        const centre = min.add(max).scale(0.5);
        holder.position.copyFrom(centre.scale(-1));
        // far enough back for the whole gun at any angle, in a wide and short picture
        const length = Vector3.Distance(min, max);
        const aspect = Math.max(1, engine.getRenderWidth() / Math.max(1, engine.getRenderHeight()));
        camera.position.z = -(length * 0.56) / Math.tan(camera.fov / 2) / Math.min(aspect, 1.9);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });

    const down = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      yaw -= (e.clientX - lastX) * 0.01;
      pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - lastY) * 0.01));
      lastX = e.clientX;
      lastY = e.clientY;
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
      const dt = engine.getDeltaTime() / 1000;
      if (!dragging) {
        idle += dt;
        if (idle > 1.5) yaw += dt * 0.35;
      }
      pivot.rotation.set(pitch, yaw, 0);
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
      scene.dispose();
      engine.dispose();
    };
  }, [id]);

  if (failed) return <>{fallback}</>;
  return <canvas ref={canvasRef} className={className} style={{ touchAction: 'none', cursor: 'grab' }} aria-label="3D view of the gun. Drag to turn it." />;
}
