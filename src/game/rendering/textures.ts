/**
 * Procedural, original textures drawn on canvases at load time (no external assets).
 */
import { DynamicTexture, Texture, type Scene } from './babylon';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(hex: string, f: number, alpha = 1): string {
  const [r, g, b] = hexToRgb(hex);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))));
  return `rgba(${c(r)},${c(g)},${c(b)},${alpha})`;
}

let lowQuality = false;

/**
 * A normal map made from a texture's own picture: darker reads as lower (mortar joints, cracks, grime,
 * the gaps between planks), so lit surfaces show relief instead of looking printed on. `strength` scales
 * the slopes. Low texture quality skips it (null).
 */
export function reliefTexture(scene: Scene, source: DynamicTexture, strength = 2.5): DynamicTexture | null {
  if (lowQuality) return null;
  const src = source.getContext() as unknown as CanvasRenderingContext2D;
  const { width: w, height: h } = source.getSize();
  const data = src.getImageData(0, 0, w, h).data;
  const height = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) height[i] = (data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11) / 255;
  const tex = new DynamicTexture(`${source.name}-relief`, { width: w, height: h }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const out = ctx.createImageData(w, h);
  const at = (x: number, y: number) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * w + x) * 4;
      out.data[o] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      out.data[o + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
      out.data[o + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      out.data[o + 3] = 255;
    }
  ctx.putImageData(out, 0, 0);
  tex.update(true);
  tex.wrapU = source.wrapU;
  tex.wrapV = source.wrapV;
  tex.anisotropicFilteringLevel = 8;
  return tex;
}

/** Map textures at half size with no anisotropic filtering (low-end GPUs). Set before a scene is built. */
export function setTextureQuality(q: 'low' | 'high') {
  lowQuality = q === 'low';
}

function makeTexture(
  scene: Scene,
  name: string,
  size: number,
  draw: (ctx: CanvasRenderingContext2D, s: number) => void,
  hasAlpha = false,
  wrap = true,
): DynamicTexture {
  // only the tiling map textures are worth shrinking; sprites and the sky are already small
  if (lowQuality && wrap && size >= 256) size /= 2;
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  draw(ctx, size);
  tex.update(true);
  tex.hasAlpha = hasAlpha;
  tex.wrapU = wrap ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = wrap ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = lowQuality ? 1 : 8;
  return tex;
}

function speckle(ctx: CanvasRenderingContext2D, s: number, base: string, count: number, r: () => number, amp = 0.08) {
  for (let i = 0; i < count; i++) {
    const x = r() * s;
    const y = r() * s;
    const sz = 1 + r() * 3;
    ctx.fillStyle = shade(base, (r() - 0.5) * 2 * amp, 0.5);
    ctx.fillRect(x, y, sz, sz);
  }
}

/**
 * Painted plaster wall: v spans the full wall height, so the base course sits at the canvas bottom.
 * Kept deliberately quiet (large soft brush shapes, no speckle) so enemies read clearly against it.
 */
export function wallTexture(scene: Scene, base: string, accent: string, seed: number) {
  return makeTexture(scene, `wall-${seed}`, 512, (ctx, s) => {
    const r = rng(seed);
    // soft vertical wash: a little lighter towards the top
    const wash = ctx.createLinearGradient(0, 0, 0, s);
    wash.addColorStop(0, shade(base, 0.07));
    wash.addColorStop(0.6, base);
    wash.addColorStop(1, shade(base, -0.06));
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, s, s);
    // large, low-contrast brush shapes (drawn wrapped so the texture tiles)
    for (let i = 0; i < 26; i++) {
      const x = r() * s;
      const y = r() * s * 0.8;
      const rad = 60 + r() * 120;
      const tone = (r() - 0.5) * 0.09;
      for (const dx of [-s, 0, s]) {
        const g = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, rad);
        g.addColorStop(0, shade(base, tone, 0.5));
        g.addColorStop(1, shade(base, tone, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - rad, y - rad, rad * 2, rad * 2);
      }
    }
    // plaster grain: fine, low-contrast flecks that catch the light once turned into relief
    for (let i = 0; i < 2600; i++) {
      const tone = (r() - 0.5) * 0.12;
      ctx.fillStyle = shade(base, tone, 0.35);
      const sz = 1 + r() * 2.2;
      ctx.fillRect(r() * s, r() * s * 0.84, sz, sz);
    }
    // weathering: rain streaks running down from the cornice and grime rising from the ground
    for (let i = 0; i < 9; i++) {
      const x = r() * s;
      const len = s * (0.15 + r() * 0.35);
      const g = ctx.createLinearGradient(0, s * 0.05, 0, s * 0.05 + len);
      g.addColorStop(0, shade(base, -0.16, 0.38));
      g.addColorStop(1, shade(base, -0.16, 0));
      ctx.fillStyle = g;
      for (const dx of [-s, 0, s]) ctx.fillRect(x + dx, s * 0.05, 6 + r() * 16, len);
    }
    const grime = ctx.createLinearGradient(0, s * 0.62, 0, s * 0.84);
    grime.addColorStop(0, shade(base, -0.2, 0));
    grime.addColorStop(1, shade(base, -0.2, 0.45));
    ctx.fillStyle = grime;
    ctx.fillRect(0, s * 0.62, s, s * 0.22);
    // a few hairline cracks
    ctx.strokeStyle = shade(base, -0.32, 0.55);
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      let x = r() * s;
      let y = s * (0.15 + r() * 0.55);
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (r() - 0.5) * 22;
        y += 6 + r() * 12;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // top cornice band with an accent stripe
    ctx.fillStyle = shade(base, -0.16);
    ctx.fillRect(0, 0, s, s * 0.04);
    ctx.fillStyle = shade(base, 0.12, 0.7);
    ctx.fillRect(0, s * 0.04, s, s * 0.006);
    ctx.fillStyle = shade(accent, -0.05, 0.9);
    ctx.fillRect(0, s * 0.05, s, s * 0.012);
    // stone base course (below ~0.95 m, under head height)
    const baseTop = s * 0.84;
    ctx.fillStyle = shade(base, -0.24);
    ctx.fillRect(0, baseTop, s, s - baseTop);
    const blocks = 4;
    for (let i = 0; i < blocks; i++) {
      ctx.fillStyle = shade(base, -0.24 + (r() - 0.5) * 0.06);
      ctx.fillRect((i * s) / blocks + 2, baseTop + 4, s / blocks - 4, s - baseTop - 4);
    }
    ctx.fillStyle = shade(base, -0.1);
    ctx.fillRect(0, baseTop - s * 0.008, s, s * 0.012);
    ctx.fillStyle = shade(base, -0.38, 0.8);
    ctx.fillRect(0, baseTop + s * 0.004, s, s * 0.004);
  });
}

/**
 * Paved floor: texture spans 4×4 m of stone setts about 0.5 m long in running bond, each with its own tone
 * and a worn, lighter top, set in darker joints, with broad patches of wear and grime over the whole.
 */
export function floorTexture(scene: Scene, base: string, seed: number) {
  return makeTexture(scene, `floor-${seed}`, 512, (ctx, s) => {
    const r = rng(seed);
    ctx.fillStyle = shade(base, -0.34);
    ctx.fillRect(0, 0, s, s);
    const rows = 10;
    const th = s / rows;
    const j = Math.max(1.5, s / 220);
    for (let row = 0; row < rows; row++) {
      let x = row % 2 ? -th * 0.6 : 0;
      while (x < s) {
        const w = th * (1.1 + r() * 0.7);
        const tone = (r() - 0.5) * 0.12;
        const y = row * th;
        for (const dx of [0, -s, s]) {
          const g = ctx.createLinearGradient(0, y, 0, y + th);
          g.addColorStop(0, shade(base, tone + 0.05));
          g.addColorStop(1, shade(base, tone - 0.06));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.roundRect(x + dx + j, y + j, w - j * 2, th - j * 2, j * 1.6);
          ctx.fill();
        }
        x += w;
      }
    }
    // broad worn patches
    for (let i = 0; i < 14; i++) {
      const x = r() * s;
      const y = r() * s;
      const rad = 50 + r() * 90;
      const tone = (r() - 0.5) * 0.1;
      for (const dx of [-s, 0, s])
        for (const dy of [-s, 0, s]) {
          const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
          g.addColorStop(0, shade(base, tone, 0.4));
          g.addColorStop(1, shade(base, tone, 0));
          ctx.fillStyle = g;
          ctx.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
        }
    }
    speckle(ctx, s, base, 1400, r, 0.08);
  });
}

export function crateTexture(scene: Scene, base: string, seed: number) {
  return makeTexture(scene, `crate-${seed}`, 256, (ctx, s) => {
    const r = rng(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = shade(base, (r() - 0.5) * 0.18);
      ctx.fillRect(0, (i * s) / 6, s, s / 6 - 2);
      ctx.fillStyle = shade(base, -0.35, 0.8);
      ctx.fillRect(0, ((i + 1) * s) / 6 - 2, s, 2);
    }
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = shade(base, -0.2, 0.35);
      ctx.fillRect(r() * s, r() * s, 6 + r() * 30, 1);
    }
    // frame
    const f = s * 0.09;
    ctx.fillStyle = shade(base, -0.28);
    ctx.fillRect(0, 0, s, f);
    ctx.fillRect(0, s - f, s, f);
    ctx.fillRect(0, 0, f, s);
    ctx.fillRect(s - f, 0, f, s);
    // diagonal brace
    ctx.strokeStyle = shade(base, -0.25);
    ctx.lineWidth = f * 0.8;
    ctx.beginPath();
    ctx.moveTo(f, f);
    ctx.lineTo(s - f, s - f);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, s - 2, s - 2);
  });
}

export function metalTexture(scene: Scene, base: string, seed: number) {
  return makeTexture(scene, `metal-${seed}`, 256, (ctx, s) => {
    const r = rng(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 16) {
      ctx.fillStyle = shade(base, 0.12, 0.6);
      ctx.fillRect(x, 0, 5, s);
      ctx.fillStyle = shade(base, -0.25, 0.6);
      ctx.fillRect(x + 9, 0, 3, s);
    }
    speckle(ctx, s, base, 500, r, 0.2);
    ctx.fillStyle = shade(base, -0.35);
    ctx.fillRect(0, 0, s, 10);
    ctx.fillRect(0, s - 10, s, 10);
  });
}

/** Roof tiles: texture spans 2×2 m, courses run along u and overlap down the slope. */
export function roofTexture(scene: Scene, base: string, seed: number) {
  return makeTexture(scene, `roof-${seed}`, 256, (ctx, s) => {
    const r = rng(seed);
    ctx.fillStyle = shade(base, -0.3);
    ctx.fillRect(0, 0, s, s);
    const courses = 5;
    const h = s / courses;
    const perRow = 8;
    const w = s / perRow;
    for (let j = 0; j < courses; j++) {
      const off = j % 2 ? w / 2 : 0;
      for (let i = -1; i <= perRow; i++) {
        const tone = (r() - 0.5) * 0.16;
        const g = ctx.createLinearGradient(i * w + off, 0, i * w + off + w, 0);
        g.addColorStop(0, shade(base, tone - 0.18));
        g.addColorStop(0.5, shade(base, tone + 0.08));
        g.addColorStop(1, shade(base, tone - 0.18));
        ctx.fillStyle = g;
        ctx.fillRect(i * w + off + 1, j * h, w - 2, h - 3);
      }
      ctx.fillStyle = shade(base, -0.45, 0.7);
      ctx.fillRect(0, (j + 1) * h - 3, s, 3);
    }
  });
}

export function stoneTexture(scene: Scene, base: string, seed: number) {
  return makeTexture(scene, `stone-${seed}`, 256, (ctx, s) => {
    const r = rng(seed);
    ctx.fillStyle = shade(base, -0.3);
    ctx.fillRect(0, 0, s, s);
    const rows = 4;
    const h = s / rows;
    for (let j = 0; j < rows; j++) {
      const w = s / 2;
      const off = j % 2 ? w / 2 : 0;
      for (let i = -1; i < 3; i++) {
        ctx.fillStyle = shade(base, (r() - 0.5) * 0.18);
        ctx.fillRect(i * w + off + 2, j * h + 2, w - 4, h - 4);
      }
    }
    speckle(ctx, s, base, 900, r, 0.15);
  });
}

/** Sky dome: zenith-to-horizon gradient, a haze band at the horizon and soft painted clouds. */
export function skyTexture(scene: Scene, top: string, horizon: string, seed = 5, clouds = 0) {
  const w = 1024;
  const h = 512;
  const tex = new DynamicTexture('sky', { width: w, height: h }, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  // Sphere UVs run top→bottom while canvas rows are uploaded bottom-up, so draw inverted:
  // y = h is the zenith, y = h / 2 the horizon.
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, shade(top, -0.12));
  g.addColorStop(0.2, top);
  g.addColorStop(0.42, shade(horizon, -0.04));
  g.addColorStop(0.5, shade(horizon, 0.25));
  g.addColorStop(0.53, horizon);
  g.addColorStop(1, shade(horizon, -0.25));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // clouds: clusters of soft puffs between the horizon and ~55° up, lit from above
  const r = rng(seed);
  const puff = (x: number, y: number, rad: number, color: string) => {
    for (const dx of [-w, 0, w]) {
      const c = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, rad);
      c.addColorStop(0, color);
      c.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = c;
      ctx.fillRect(x + dx - rad, y - rad, rad * 2, rad * 2);
    }
  };
  for (let i = 0; i < 16; i++) {
    const cx = r() * w;
    const cy = h * (0.56 + r() * 0.2);
    const span = 50 + r() * 90;
    const n = 6 + Math.floor(r() * 6);
    for (let k = 0; k < n; k++) {
      const x = cx + (r() - 0.5) * span * 2;
      const y = cy + (r() - 0.5) * span * 0.25;
      const rad = 16 + r() * 30;
      puff(x, y - rad * 0.25, rad, shade(horizon, -0.12, 0.22 - 0.1 * clouds)); // shaded underside
      puff(x, y + rad * 0.15, rad * 0.9, `rgba(255,255,255,${0.3 + 0.4 * clouds})`); // lit top
    }
  }
  tex.update(true);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}

/**
 * Baked ambient occlusion for horizontal surfaces, one texture per map: each texel darkens with
 * how close it is to a taller neighbouring cell (wall, crate, step). u runs along columns, v along rows.
 */
export function occlusionTexture(scene: Scene, cols: number, rows: number, cellTop: Float32Array, cell: number) {
  const R = lowQuality ? 4 : 8; // texels per cell
  const w = cols * R;
  const h = rows * R;
  const tex = new DynamicTexture('map-ao', { width: w, height: h }, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(w, h);
  const reach = 1.1; // metres
  const top = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? 99 : cellTop[r * cols + c]);
  for (let py = 0; py < h; py++) {
    const r = Math.floor(py / R);
    const fy = ((py % R) + 0.5) / R; // 0..1 inside the cell
    for (let px = 0; px < w; px++) {
      const c = Math.floor(px / R);
      const fx = ((px % R) + 0.5) / R;
      const own = top(c, r);
      let light = 1;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (!dc && !dr) continue;
          const rise = top(c + dc, r + dr) - own;
          if (rise < 0.3) continue;
          const ex = dc < 0 ? fx : dc > 0 ? 1 - fx : 0;
          const ey = dr < 0 ? fy : dr > 0 ? 1 - fy : 0;
          const d = Math.hypot(ex, ey) * cell;
          if (d >= reach) continue;
          const k = 1 - d / reach;
          light *= 1 - 0.5 * k * k * Math.min(1, rise / 1.5);
        }
      const v = Math.round(255 * Math.max(0.42, light));
      const o = (py * w + px) * 4;
      img.data[o] = v;
      img.data[o + 1] = Math.min(255, v + 4); // shadowed corners lean slightly cool
      img.data[o + 2] = Math.min(255, v + 10);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update(false);
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}

export function radialTexture(scene: Scene, name: string, inner: string, outer: string, size = 64) {
  return makeTexture(
    scene,
    name,
    size,
    (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, inner);
      g.addColorStop(1, outer);
      ctx.clearRect(0, 0, s, s);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    },
    true,
    false,
  );
}

export function bulletHoleTexture(scene: Scene) {
  return makeTexture(
    scene,
    'bullet-hole',
    64,
    (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(10,8,6,1)');
      g.addColorStop(0.35, 'rgba(25,20,16,0.95)');
      g.addColorStop(0.6, 'rgba(60,50,40,0.45)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    },
    true,
    false,
  );
}

export function muzzleFlashTexture(scene: Scene) {
  return makeTexture(
    scene,
    'muzzle',
    128,
    (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.translate(s / 2, s / 2);
      for (let i = 0; i < 7; i++) {
        ctx.rotate((Math.PI * 2) / 7);
        const g = ctx.createLinearGradient(0, 0, s / 2, 0);
        g.addColorStop(0, 'rgba(255,250,220,1)');
        g.addColorStop(0.5, 'rgba(255,190,90,0.7)');
        g.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.06);
        ctx.lineTo(s / 2, 0);
        ctx.lineTo(0, s * 0.06);
        ctx.fill();
      }
      const c = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.22);
      c.addColorStop(0, 'rgba(255,255,240,1)');
      c.addColorStop(1, 'rgba(255,200,100,0)');
      ctx.fillStyle = c;
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
    true,
    false,
  );
}

export function letterTexture(scene: Scene, letter: string, color: string) {
  return makeTexture(
    scene,
    `letter-${letter}`,
    256,
    (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.fillStyle = color;
      ctx.font = `800 ${s * 0.82}px "Barlow Condensed", Impact, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, s / 2, s / 2 + s * 0.04);
    },
    true,
    false,
  );
}

/**
 * Direction sign for a wall: the site's letter on a plate in the site's colour, with an arrow to the left or
 * right. Drawn for a plate twice as wide as it is tall (the square canvas is stretched across it).
 */
export function signTexture(scene: Scene, label: string, color: string, right: boolean) {
  return makeTexture(
    scene,
    `sign-${label}-${color}-${right ? 'r' : 'l'}`,
    256,
    (ctx, s) => {
      ctx.save();
      ctx.scale(0.5, 1); // work in a 2s × s space
      const w = s * 2;
      ctx.fillStyle = '#f4f1e8';
      ctx.fillRect(0, 0, w, s);
      ctx.fillStyle = shade(color, -0.08);
      ctx.fillRect(s * 0.06, s * 0.06, w - s * 0.12, s * 0.88);
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 ${s * 0.74}px "Barlow Condensed", Impact, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tx = right ? w * 0.34 : w * 0.66;
      ctx.fillText(label, tx, s * 0.54);
      // arrow: a shaft and a head
      const ax = right ? w * 0.6 : w * 0.4;
      const dir = right ? 1 : -1;
      ctx.fillRect(Math.min(ax, ax + dir * s * 0.34), s * 0.44, s * 0.34, s * 0.12);
      ctx.beginPath();
      ctx.moveTo(ax + dir * s * 0.62, s * 0.5);
      ctx.lineTo(ax + dir * s * 0.3, s * 0.24);
      ctx.lineTo(ax + dir * s * 0.3, s * 0.76);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
    false,
    false,
  );
}
