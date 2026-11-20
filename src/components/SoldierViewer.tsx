import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Color3, Color4, DirectionalLight, Engine, FreeCamera, HemisphericLight, Scene, Vector3 } from '../game/rendering/babylon';
import { muzzleFlashTexture, radialTexture } from '../game/rendering/textures';
import { BotAssets, type BotView } from '../game/bots/BotVisual';
import { AgentAssets } from '../game/bots/AgentVisual';
import { loadWeaponSkins } from '../game/weapons/WeaponSkins';
import type { WeaponSkin } from '../game/weapons/WeaponSkins';
import { getAgent } from '../game/agents';

/**
 * The player's soldier in 3D, standing on the main menu with their rifle, posed and animated by the same code
 * as in a match. Drag left and right to turn them round; click to have them fire a shot. When idle they slowly
 * turn back to face you. Shows `fallback` while the model loads, and instead of it when the build has no models.
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
    const camera = new FreeCamera('soldier-cam', new Vector3(0, 1.02, 3.05), scene);
    camera.setTarget(new Vector3(0, 0.9, 0));
    camera.fov = 0.62;
    camera.minZ = 0.05;
    camera.maxZ = 30;
    const sky = new HemisphericLight('soldier-sky', new Vector3(0.2, 1, 0.3), scene);
    sky.intensity = 0.9;
    sky.groundColor = new Color3(0.35, 0.28, 0.2);
    const sun = new DirectionalLight('soldier-sun', new Vector3(0.45, -0.7, -0.75), scene);
    sun.intensity = 2.4;
    sun.diffuse = new Color3(1, 0.93, 0.82);
    // a warm rim from behind, so the figure stands off the dark menu
    const rim = new DirectionalLight('soldier-rim', new Vector3(-0.5, -0.25, 1), scene);
    rim.intensity = 1.6;
    rim.diffuse = new Color3(1, 0.68, 0.3);

    const bot = new BotAssets(scene, muzzleFlashTexture(scene), radialTexture(scene, 'blob', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0)', 64));
    let visual: BotView | null = null;
    let assets: AgentAssets | null = null;
    let skins: Map<string, WeaponSkin> | null = null;

    const FACE = 0; // facing the camera (the model faces +Z, where the camera stands)
    let yaw = FACE - 0.45; // a three-quarter view to start with
    let spin = 0; // turn speed carried on after a flick
    let dragging = false;
    let moved = 0;
    let idle = 0;
    let lastX = 0;

    Promise.all([loadWeaponSkins(scene, ['vandal']).catch(() => new Map<string, WeaponSkin>()), AgentAssets.load(scene, getAgent(agentId).model, bot)])
      .then(([loadedSkins, loaded]) => {
        if (disposed) {
          loaded.dispose();
          for (const s of loadedSkins.values()) s.dispose();
          return;
        }
        skins = loadedSkins as Map<string, WeaponSkin>;
        assets = loaded;
        assets.rifle = (loadedSkins as Map<string, WeaponSkin>).get('vandal') ?? null;
        visual = assets.create(0);
        setState('ready');
      })
      .catch(() => {
        if (!disposed) setState('failed');
      });

    const down = (e: PointerEvent) => {
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      spin = 0;
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      moved += Math.abs(dx);
      yaw += dx * 0.012;
      spin = dx * 0.6;
      lastX = e.clientX;
    };
    const up = () => {
      // a click without a drag: they fire a round
      if (dragging && moved < 4) visual?.muzzleFlash();
      dragging = false;
      idle = 0;
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    engine.runRenderLoop(() => {
      const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
      if (!dragging) {
        idle += dt;
        yaw += spin * dt;
        spin *= Math.exp(-dt * 4);
        // after a while, turn back towards the three-quarter view
        if (idle > 3) {
          const target = FACE - 0.45;
          let d = (target - yaw) % (Math.PI * 2);
          if (d > Math.PI) d -= Math.PI * 2;
          if (d < -Math.PI) d += Math.PI * 2;
          yaw += d * Math.min(1, dt * 1.5);
        }
      }
      visual?.update(dt, 0, 0, 0, yaw, -0.04, 0, 0, 0);
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
      visual?.dispose();
      assets?.dispose();
      if (skins) for (const s of skins.values()) s.dispose();
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
          aria-label="Your soldier in 3D. Drag to turn them, click to fire."
        />
      )}
    </div>
  );
}
