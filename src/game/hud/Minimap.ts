/**
 * HUD minimap, drawn on the 2D overlay canvas.
 *
 * The map is pre-rendered once from the grid (floor plan tinted by zone, raised floors, cover) and then
 * drawn each frame rotated so the player's facing is always "up". The view cone is cut off by walls. Enemies within `enemyRange` metres are
 * always shown, even through walls (a training aid); enemies the player can actually see are drawn
 * larger and brighter.
 */
import { CELL, shapeOf } from '../maps/GridMap';
import type { MapData } from '../maps/MapData';

/** Pixels per grid cell in the pre-rendered image. */
const PPC = 16;
/** Anything at least this tall blocks the view cone (metres). */
const SIGHT_HEIGHT = 1.7;

export interface MinimapEnemy {
  x: number;
  z: number;
  alive: boolean;
  visible: boolean;
}

export interface MinimapOptions {
  /** Panel size in CSS pixels. */
  size: number;
  /** World metres from the centre to the panel edge. */
  viewRange: number;
  /** Enemies closer than this (metres) are always drawn. */
  enemyRange: number;
  /** Horizontal field of view (radians) for the view cone. */
  fov: number;
  /** An objective to mark (the planted spike). */
  objective?: { x: number; z: number } | null;
  /** Footsteps just heard: where, and how old (0 = now … 1 = about to go). Drawn as a ring that spreads and fades. */
  sounds?: { x: number; z: number; age: number }[];
}

export class Minimap {
  private readonly img: HTMLCanvasElement;
  private readonly sites: { letter: string; x: number; z: number }[];
  private readonly callouts: { name: string; x: number; z: number; color: string }[];
  /** 1 where a cell blocks sight (row-major). */
  private readonly opaque: Uint8Array;

  constructor(private readonly map: MapData) {
    const { def, space, cellTop } = map;
    const rows = def.grid.length;
    const cols = def.grid[0].length;
    this.img = document.createElement('canvas');
    this.img.width = cols * PPC;
    this.img.height = rows * PPC;
    const g = this.img.getContext('2d')!;
    const isCover = (ch: string) => ch === 'c' || ch === 'C' || ch === 'D';
    const walk = (c: number, r: number) => r >= 0 && r < rows && c >= 0 && c < cols && shapeOf(def.grid[r][c]).walkable;
    /** Part of the playable floor plan: walkable ground or cover standing on it. */
    const floor = (c: number, r: number) => walk(c, r) || (r >= 0 && r < rows && c >= 0 && c < cols && isCover(def.grid[r][c]));

    this.opaque = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const ch = def.grid[r][c];
        this.opaque[r * cols + c] = !shapeOf(ch).walkable && ch !== 'w' && cellTop[r * cols + c] >= SIGHT_HEIGHT ? 1 : 0;
      }

    const siteZones = new Set((def.siteMarks ?? []).map((m) => def.zoneOf(Math.floor(m.c), Math.floor(m.r))));
    const edges = (test: (c: number, r: number) => boolean, inside: (c: number, r: number) => boolean) => {
      g.beginPath();
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          if (!inside(c, r)) continue;
          const x = c * PPC;
          const y = r * PPC;
          if (!test(c, r - 1)) g.moveTo(x, y), g.lineTo(x + PPC, y);
          if (!test(c, r + 1)) g.moveTo(x, y + PPC), g.lineTo(x + PPC, y + PPC);
          if (!test(c - 1, r)) g.moveTo(x, y), g.lineTo(x, y + PPC);
          if (!test(c + 1, r)) g.moveTo(x + PPC, y), g.lineTo(x + PPC, y + PPC);
        }
    };
    g.lineJoin = 'round';
    g.lineCap = 'round';

    // soft shadow under the whole floor plan, so it lifts off the panel
    edges(floor, floor);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 7;
    g.stroke();

    // floor: one flat tone, tinted by zone (sites more strongly), raised floors a step lighter
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (!floor(c, r)) continue;
        const s = shapeOf(def.grid[r][c]);
        const lift = s.walkable && s.floor > 0.01 ? Math.min(18, 6 + s.floor * 5) : 0;
        g.fillStyle = `rgb(${186 + lift},${192 + lift},${202 + lift})`;
        g.fillRect(c * PPC, r * PPC, PPC + 0.5, PPC + 0.5);
        const zoneId = def.zoneOf(c, r);
        const zone = def.palette.zones[zoneId];
        if (zone) {
          g.globalAlpha = siteZones.has(zoneId) ? 0.26 : 0.1;
          g.fillStyle = zone.accent;
          g.fillRect(c * PPC, r * PPC, PPC + 0.5, PPC + 0.5);
          g.globalAlpha = 1;
        }
      }

    // steps between floor heights
    g.beginPath();
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (!walk(c, r)) continue;
        const h = shapeOf(def.grid[r][c]).floor;
        if (walk(c + 1, r) && Math.abs(shapeOf(def.grid[r][c + 1]).floor - h) > 0.01) g.moveTo((c + 1) * PPC, r * PPC), g.lineTo((c + 1) * PPC, (r + 1) * PPC);
        if (walk(c, r + 1) && Math.abs(shapeOf(def.grid[r + 1][c]).floor - h) > 0.01) g.moveTo(c * PPC, (r + 1) * PPC), g.lineTo((c + 1) * PPC, (r + 1) * PPC);
      }
    g.strokeStyle = 'rgba(40,48,60,0.28)';
    g.lineWidth = 1;
    g.stroke();

    // cover and other objects inside the floor plan
    const object = (match: (ch: string) => boolean, fill: string, inset: number) => {
      g.fillStyle = fill;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          if (!match(def.grid[r][c])) continue;
          // run neighbouring pieces together, inset only on free sides
          const n = (dc: number, dr: number) => r + dr >= 0 && r + dr < rows && c + dc >= 0 && c + dc < cols && match(def.grid[r + dr][c + dc]);
          const x0 = c * PPC + (n(-1, 0) ? 0 : inset);
          const y0 = r * PPC + (n(0, -1) ? 0 : inset);
          const x1 = (c + 1) * PPC - (n(1, 0) ? 0 : inset);
          const y1 = (r + 1) * PPC - (n(0, 1) ? 0 : inset);
          g.fillRect(x0, y0, x1 - x0 + 0.5, y1 - y0 + 0.5);
        }
    };
    object((ch) => ch === 'c', '#7d8794', 2);
    object((ch) => ch === 'C', '#5c6673', 1.5);
    object((ch) => ch === 'D', '#434c58', 1);
    object((ch) => ch === 'w' || ch === 'r', '#8f99a6', 0);
    object((ch) => ch === 'P', '#39414c', 1);

    // crisp wall line around the floor plan
    edges(floor, floor);
    g.strokeStyle = '#f4f6f9';
    g.lineWidth = 2;
    g.stroke();

    this.sites = (def.siteMarks ?? []).map((m) => ({ letter: m.letter, x: space.x(m.c), z: space.z(m.r) }));
    this.callouts = (def.callouts ?? [])
      .filter((c) => !/ site$/i.test(c.name))
      .map((c) => ({ name: c.name.toUpperCase(), x: space.x(c.c), z: space.z(c.r), color: def.palette.zones[def.zoneOf(Math.floor(c.c), Math.floor(c.r))]?.accent ?? '#ffffff' }));
  }

  /** The named area a point is in: the nearest callout, with its area's colour. */
  areaAt(x: number, z: number): { name: string; color: string } | null {
    let best: { name: string; color: string } | null = null;
    let bestD = Infinity;
    for (const c of this.callouts) {
      const d = (c.x - x) ** 2 + (c.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /**
   * The whole map, north up, in a panel of `side` CSS pixels centred on (centreX, centreY): the big map shown
   * with M or while Tab is held. Same marks as the minimap (you, enemies it may show, footsteps, the objective),
   * with every area named and the site badges larger.
   */
  drawFull(
    ctx: CanvasRenderingContext2D,
    dpr: number,
    centreX: number,
    centreY: number,
    side: number,
    player: { x: number; z: number; yaw: number; alive: boolean },
    enemies: MinimapEnemy[],
    o: Pick<MinimapOptions, 'enemyRange' | 'objective' | 'sounds'>,
  ) {
    const rows = this.map.def.grid.length;
    const cols = this.map.def.grid[0].length;
    const pad = 18 * dpr;
    const box = side * dpr;
    const k = (box - pad * 2) / Math.max(this.img.width, this.img.height);
    const w = this.img.width * k;
    const h = this.img.height * k;
    const left = centreX * dpr - w / 2;
    const top = centreY * dpr - h / 2;
    const toScreen = (x: number, z: number): [number, number] => [left + (x / CELL + cols / 2) * PPC * k, top + (rows / 2 - z / CELL) * PPC * k];

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(left - pad, top - pad - 30 * dpr, w + pad * 2, h + pad * 2 + 30 * dpr, 14 * dpr);
    ctx.fillStyle = 'rgba(10,13,19,0.88)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = dpr;
    ctx.stroke();

    // title: the map's name, and the area you are in
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(18 * dpr)}px "Barlow Condensed", system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(this.map.def.name.toUpperCase(), left, top - 18 * dpr);
    const area = this.areaAt(player.x, player.z);
    if (area) {
      ctx.textAlign = 'right';
      ctx.font = `600 ${Math.round(14 * dpr)}px "Barlow Condensed", system-ui, sans-serif`;
      ctx.fillStyle = area.color;
      ctx.fillText(`● ${area.name}`, left + w, top - 18 * dpr);
    }

    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.img, left, top, w, h);

    ctx.textAlign = 'center';
    ctx.font = `600 ${Math.round(12 * dpr)}px "Barlow Condensed", system-ui, sans-serif`;
    for (const c of this.callouts) {
      const [sx, sy] = toScreen(c.x, c.z);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(c.name, sx + dpr, sy + dpr);
      ctx.fillStyle = 'rgba(18,24,34,0.92)';
      ctx.fillText(c.name, sx, sy);
    }
    ctx.font = `700 ${Math.round(17 * dpr)}px "Barlow Condensed", system-ui, sans-serif`;
    for (const site of this.sites) {
      const [sx, sy] = toScreen(site.x, site.z);
      ctx.beginPath();
      ctx.arc(sx, sy, 13 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(18,23,32,0.88)';
      ctx.fill();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(site.letter, sx, sy + dpr);
    }
    if (o.objective) {
      const [sx, sy] = toScreen(o.objective.x, o.objective.z);
      const r = 8 * dpr;
      ctx.beginPath();
      ctx.moveTo(sx, sy - r);
      ctx.lineTo(sx + r, sy);
      ctx.lineTo(sx, sy + r);
      ctx.lineTo(sx - r, sy);
      ctx.closePath();
      ctx.fillStyle = '#ffb54a';
      ctx.fill();
    }
    for (const snd of o.sounds ?? []) {
      const [sx, sy] = toScreen(snd.x, snd.z);
      ctx.beginPath();
      ctx.arc(sx, sy, (4 + 9 * snd.age) * dpr, 0, Math.PI * 2);
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = `rgba(255, 96, 60, ${(0.9 * (1 - snd.age)).toFixed(3)})`;
      ctx.stroke();
    }
    for (const e of enemies) {
      if (!e.alive || Math.hypot(e.x - player.x, e.z - player.z) > o.enemyRange) continue;
      const [sx, sy] = toScreen(e.x, e.z);
      ctx.beginPath();
      ctx.arc(sx, sy, (e.visible ? 6.5 : 5) * dpr, 0, Math.PI * 2);
      ctx.fillStyle = e.visible ? '#ff603c' : 'rgba(232,96,70,0.85)';
      ctx.fill();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = e.visible ? '#ffffff' : 'rgba(40,0,6,0.85)';
      ctx.stroke();
    }

    // you: an arrow turned the way you face
    const [px, py] = toScreen(player.x, player.z);
    ctx.translate(px, py);
    ctx.rotate(player.yaw);
    const a = 1.4 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, -9 * a);
    ctx.lineTo(6.5 * a, 6.5 * a);
    ctx.lineTo(0, 3 * a);
    ctx.lineTo(-6.5 * a, 6.5 * a);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = 'rgba(10,14,20,0.9)';
    ctx.stroke();
    ctx.fillStyle = player.alive ? '#5ee0c8' : 'rgba(200,200,200,0.6)';
    ctx.fill();
    ctx.restore();
  }

  /** Distance a sight ray travels from (x, z) along (dx, dz) before a wall stops it, up to `max` metres. */
  private sightDistance(x: number, z: number, dx: number, dz: number, max: number): number {
    const rows = this.map.def.grid.length;
    const cols = this.map.def.grid[0].length;
    const step = 0.3;
    for (let d = step; d < max; d += step) {
      const c = Math.floor((x + dx * d) / CELL + cols / 2);
      const r = Math.floor(rows / 2 - (z + dz * d) / CELL);
      if (c < 0 || r < 0 || c >= cols || r >= rows || this.opaque[r * cols + c]) return d;
    }
    return max;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    dpr: number,
    left: number,
    top: number,
    player: { x: number; z: number; yaw: number; alive: boolean },
    enemies: MinimapEnemy[],
    o: MinimapOptions,
  ) {
    const size = o.size * dpr;
    const x0 = left * dpr;
    const y0 = top * dpr;
    const cx = x0 + size / 2;
    const cy = y0 + size / 2;
    const pxPerM = size / 2 / o.viewRange;
    const rows = this.map.def.grid.length;
    const cols = this.map.def.grid[0].length;
    const cos = Math.cos(player.yaw);
    const sin = Math.sin(player.yaw);
    const toScreen = (x: number, z: number): [number, number] => {
      const dx = x - player.x;
      const dz = z - player.z;
      return [cx + (dx * cos - dz * sin) * pxPerM, cy - (dx * sin + dz * cos) * pxPerM];
    };

    ctx.save();
    // panel
    const rad = 12 * dpr;
    ctx.beginPath();
    ctx.roundRect(x0, y0, size, size, rad);
    const bg = ctx.createRadialGradient(cx, cy, size * 0.1, cx, cy, size * 0.75);
    bg.addColorStop(0, 'rgba(24,30,40,0.86)');
    bg.addColorStop(1, 'rgba(10,13,19,0.9)');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.clip();

    // map image: image u = (x/CELL + cols/2)·PPC, v = (rows/2 − z/CELL)·PPC; rotate so facing is up
    const u = (player.x / CELL + cols / 2) * PPC;
    const v = (rows / 2 - player.z / CELL) * PPC;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-player.yaw);
    const k = pxPerM / (PPC / CELL);
    ctx.scale(k, k);
    ctx.translate(-u, -v);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.img, 0, 0);
    ctx.restore();

    // view cone, cut off by walls
    if (player.alive) {
      const half = o.fov / 2;
      const reach = Math.min(o.viewRange * 0.9, 24);
      const rays = 40;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (let i = 0; i <= rays; i++) {
        const a = player.yaw - half + (o.fov * i) / rays;
        const dx = Math.sin(a);
        const dz = Math.cos(a);
        const d = this.sightDistance(player.x, player.z, dx, dz, reach);
        const [px, py] = toScreen(player.x + dx * d, player.z + dz * d);
        ctx.lineTo(px, py);
      }
      ctx.closePath();
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach * pxPerM);
      grad.addColorStop(0, 'rgba(255,255,255,0.5)');
      grad.addColorStop(0.6, 'rgba(255,255,255,0.22)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // callout names (kept upright)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(8.5 * dpr)}px "Barlow Condensed", system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(22,28,38,0.78)';
    for (const c of this.callouts) {
      const [sx, sy] = toScreen(c.x, c.z);
      if (Math.abs(sx - cx) > size / 2 || Math.abs(sy - cy) > size / 2) continue;
      ctx.fillText(c.name, sx, sy);
    }

    // site badges (kept upright)
    ctx.font = `700 ${Math.round(13 * dpr)}px "Barlow Condensed", system-ui, sans-serif`;
    for (const s of this.sites) {
      const [sx, sy] = toScreen(s.x, s.z);
      ctx.beginPath();
      ctx.arc(sx, sy, 9.5 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(18,23,32,0.82)';
      ctx.fill();
      ctx.lineWidth = 1.2 * dpr;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(s.letter, sx, sy + 0.5 * dpr);
    }

    // objective marker: a diamond, kept at the panel edge when it is further away than the view
    if (o.objective) {
      let [sx, sy] = toScreen(o.objective.x, o.objective.z);
      const lim = size / 2 - 9 * dpr;
      const m = Math.max(Math.abs(sx - cx), Math.abs(sy - cy));
      if (m > lim) {
        sx = cx + ((sx - cx) * lim) / m;
        sy = cy + ((sy - cy) * lim) / m;
      }
      const r = 6 * dpr;
      ctx.beginPath();
      ctx.moveTo(sx, sy - r);
      ctx.lineTo(sx + r, sy);
      ctx.lineTo(sx, sy + r);
      ctx.lineTo(sx - r, sy);
      ctx.closePath();
      ctx.fillStyle = '#ffb54a';
      ctx.fill();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = 'rgba(20,12,0,0.9)';
      ctx.stroke();
    }

    // footsteps just heard: a ring at the spot, spreading and fading
    for (const snd of o.sounds ?? []) {
      const [sx, sy] = toScreen(snd.x, snd.z);
      const fade = 1 - snd.age;
      ctx.beginPath();
      ctx.arc(sx, sy, (3 + 7 * snd.age) * dpr, 0, Math.PI * 2);
      ctx.lineWidth = 1.6 * dpr;
      ctx.strokeStyle = `rgba(255, 96, 60, ${(0.9 * fade).toFixed(3)})`;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, sy, 2.2 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 96, 60, ${(0.75 * fade).toFixed(3)})`;
      ctx.fill();
    }

    // enemies within range (always), visible ones emphasised
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - player.x, e.z - player.z);
      if (d > o.enemyRange) continue;
      const [sx, sy] = toScreen(e.x, e.z);
      const r = (e.visible ? 5.2 : 4) * dpr;
      if (e.visible) {
        // halo around enemies in direct view
        ctx.beginPath();
        ctx.arc(sx, sy, r + 4 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,96,60,0.28)';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = e.visible ? '#ff603c' : 'rgba(232,96,70,0.8)';
      ctx.fill();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = e.visible ? '#ffffff' : 'rgba(40,0,6,0.85)';
      ctx.stroke();
    }

    // player arrow
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.moveTo(0, -9 * dpr);
    ctx.lineTo(6.5 * dpr, 6.5 * dpr);
    ctx.lineTo(0, 3 * dpr);
    ctx.lineTo(-6.5 * dpr, 6.5 * dpr);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.2 * dpr;
    ctx.strokeStyle = 'rgba(10,14,20,0.85)';
    ctx.stroke();
    ctx.fillStyle = player.alive ? '#5ee0c8' : 'rgba(200,200,200,0.6)';
    ctx.fill();
    ctx.lineWidth = 1 * dpr;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
    ctx.restore();

    // frame + enemy range ring hint
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x0 + 0.5 * dpr, y0 + 0.5 * dpr, size - dpr, size - dpr, rad);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();
    if (o.enemyRange < o.viewRange) {
      ctx.beginPath();
      ctx.arc(cx, cy, o.enemyRange * pxPerM, 0, Math.PI * 2);
      ctx.setLineDash([3 * dpr, 4 * dpr]);
      ctx.strokeStyle = 'rgba(255,70,85,0.25)';
      ctx.stroke();
    }
    ctx.restore();

    // where you are: the area's name on a tab under the panel, with a bar in the area's colour
    const area = this.areaAt(player.x, player.z);
    if (area) {
      const th = 24 * dpr;
      const ty = y0 + size + 5 * dpr;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x0, ty, size, th, 6 * dpr);
      ctx.fillStyle = 'rgba(12,16,23,0.82)';
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = area.color;
      ctx.fillRect(x0, ty, 5 * dpr, th);
      ctx.font = `700 ${Math.round(14 * dpr)}px "Barlow Condensed", system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(area.name, x0 + 14 * dpr, ty + th / 2 + 0.5 * dpr);
      ctx.restore();
    }
  }
}
