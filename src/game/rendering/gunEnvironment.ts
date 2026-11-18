/**
 * What the guns' metal reflects. The maps are lit with plain lights and have no environment map, and
 * a metal surface with nothing to reflect renders flat and matte, like plastic. This builds a small
 * sky-and-ground cube map in code (no file): a bright sky with a sun, a pale horizon, a warm sandy
 * ground and a soft light band, which gives barrels and receivers moving highlights as the gun turns.
 */
import { RawCubeTexture } from '@babylonjs/core/Materials/Textures/rawCubeTexture';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import { Constants, type Scene } from './babylon';

const SIZE = 64;
const cache = new WeakMap<Scene, RawCubeTexture>();

/** Colour seen in direction (x, y, z), 0..1 per channel. */
function sky(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z) || 1;
  x /= len;
  y /= len;
  z /= len;
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
  const smooth = (e0: number, e1: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const ground = [0.3, 0.25, 0.19];
  const horizon = [0.92, 0.88, 0.8];
  const zenith = [0.42, 0.55, 0.78];
  let c = y < 0 ? mix(horizon, ground, smooth(0, -0.35, y)) : mix(horizon, zenith, smooth(0, 0.7, y));
  // the sun, high and to one side, with a wide glow
  const sun = x * 0.45 + y * 0.75 + z * 0.48;
  c = mix(c, [1, 0.98, 0.92], smooth(0.9, 0.995, sun));
  c = mix(c, [1, 0.96, 0.88], 0.35 * smooth(0.5, 0.95, sun));
  // a soft light band just above the horizon behind the player: long highlights along the barrel
  c = mix(c, [1, 1, 1], 0.55 * smooth(0.25, 0.05, Math.abs(y - 0.22)) * smooth(-0.2, -0.9, z));
  return [c[0], c[1], c[2]];
}

function gunEnvironment(scene: Scene): RawCubeTexture {
  let tex = cache.get(scene);
  if (tex) return tex;
  // face order: +X, -X, +Y, -Y, +Z, -Z
  const dirs: ((u: number, v: number) => [number, number, number])[] = [
    (u, v) => [1, -v, -u],
    (u, v) => [-1, -v, u],
    (u, v) => [u, 1, v],
    (u, v) => [u, -1, -v],
    (u, v) => [u, -v, 1],
    (u, v) => [-u, -v, -1],
  ];
  const faces = dirs.map((dir) => {
    const data = new Uint8Array(SIZE * SIZE * 4);
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) {
        const [r, g, b] = sky(...dir(((i + 0.5) / SIZE) * 2 - 1, ((j + 0.5) / SIZE) * 2 - 1));
        const k = (j * SIZE + i) * 4;
        data[k] = Math.round(Math.pow(r, 1 / 2.2) * 255);
        data[k + 1] = Math.round(Math.pow(g, 1 / 2.2) * 255);
        data[k + 2] = Math.round(Math.pow(b, 1 / 2.2) * 255);
        data[k + 3] = 255;
      }
    }
    return data;
  });
  tex = new RawCubeTexture(scene, faces, SIZE, Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_UNSIGNED_BYTE, true, false, Constants.TEXTURE_TRILINEAR_SAMPLINGMODE);
  tex.gammaSpace = true;
  tex.name = 'gun-environment';
  cache.set(scene, tex);
  return tex;
}

/** Give every material of a loaded gun the reflection environment. */
export function applyGunReflections(scene: Scene, container: AssetContainer) {
  const env = gunEnvironment(scene);
  for (const mat of container.materials) {
    const m = mat as unknown as { reflectionTexture?: BaseTexture | null; environmentIntensity?: number };
    if (!('reflectionTexture' in m)) continue;
    m.reflectionTexture = env;
    m.environmentIntensity = 1.5;
  }
}
