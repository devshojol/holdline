import { mapKit, mapMood, type MapBox, type MapData, type MapKit } from '../maps/MapData';
import { CELL, WALL_HEIGHT } from '../maps/GridMap';
import {
  Color3,
  CreatePlane,
  CreateSphere,
  Mesh,
  StandardMaterial,
  Texture,
  VertexData,
  type Scene,
  type ShadowGenerator,
} from './babylon';
import {
  crateTexture,
  floorTexture,
  letterTexture,
  metalTexture,
  occlusionTexture,
  radialTexture,
  roofTexture,
  skyTexture,
  stoneTexture,
  wallTexture,
} from './textures';

type FlatBatch = (color: string) => GeometryBatch;

/** Brightness of a wall or prop where it meets the ground (baked contact shading). */
const CONTACT_SHADE = 0.68;

type UvMode = { kind: 'world'; tile: number; vHeight: number } | { kind: 'box'; tile: number; vTile: number };

class GeometryBatch {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  indices: number[] = [];
  /** Colour multiplied into the vertices added next (lets many flat-coloured parts share one mesh). */
  tint: [number, number, number] = [1, 1, 1];

  /** `shade` is a per-vertex brightness (1 = unchanged) used for baked contact shading. */
  quad(p: number[][], n: [number, number, number], uv: number[][], shade?: number[]) {
    const base = this.positions.length / 3;
    for (let i = 0; i < 4; i++) {
      this.positions.push(p[i][0], p[i][1], p[i][2]);
      this.normals.push(n[0], n[1], n[2]);
      this.uvs.push(uv[i][0], uv[i][1]);
      const k = shade ? shade[i] : 1;
      // darker vertices lean slightly cool, like sky-lit shadow
      const [tr, tg, tb] = this.tint;
      this.colors.push(tr * k, tg * Math.min(1, k * 1.015), tb * Math.min(1, k * 1.05), 1);
    }
    // Babylon convention: (p1-p0)x(p2-p0) points opposite the face normal.
    const ax = p[1][0] - p[0][0];
    const ay = p[1][1] - p[0][1];
    const az = p[1][2] - p[0][2];
    const bx = p[2][0] - p[0][0];
    const by = p[2][1] - p[0][1];
    const bz = p[2][2] - p[0][2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    const dot = cx * n[0] + cy * n[1] + cz * n[2];
    if (dot < 0) this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  box(min: number[], max: number[], uv: UvMode, skipBottom = true, topBatch: GeometryBatch | null = null, topTile = 4) {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const U = (a: number, b: number, along: number, v: number): number[] => {
      if (uv.kind === 'world') return [along / uv.tile, v / uv.vHeight];
      void a;
      void b;
      return [along / uv.tile, v / uv.vTile];
    };
    const sideV = (y: number) => (uv.kind === 'world' ? y : y - y0);
    const alongX = (x: number) => (uv.kind === 'world' ? x : x - x0);
    const alongZ = (z: number) => (uv.kind === 'world' ? z : z - z0);
    // Side faces. Boxes standing on the ground get a darker contact band at the bottom.
    const band = y0 < 0.01 ? Math.min(0.9, (y1 - y0) * 0.5) : 0;
    const side = (ax: number, az: number, bx: number, bz: number, n: [number, number, number], ua: number, ub: number) => {
      const face = (ya: number, yb: number, ka: number, kb: number) =>
        this.quad(
          [
            [ax, ya, az],
            [bx, ya, bz],
            [bx, yb, bz],
            [ax, yb, az],
          ],
          n,
          [U(0, 0, ua, sideV(ya)), U(0, 0, ub, sideV(ya)), U(0, 0, ub, sideV(yb)), U(0, 0, ua, sideV(yb))],
          [ka, ka, kb, kb],
        );
      if (band > 0) {
        face(y0, y0 + band, CONTACT_SHADE, 1);
        face(y0 + band, y1, 1, 1);
      } else face(y0, y1, 1, 1);
    };
    side(x1, z0, x1, z1, [1, 0, 0], alongZ(z0), alongZ(z1)); // +X
    side(x0, z1, x0, z0, [-1, 0, 0], -alongZ(z1), -alongZ(z0)); // -X
    side(x1, z1, x0, z1, [0, 0, 1], -alongX(x1), -alongX(x0)); // +Z
    side(x0, z0, x1, z0, [0, 0, -1], alongX(x0), alongX(x1)); // -Z
    // top
    if (topBatch) {
      topBatch.quad(
        [
          [x0, y1, z0],
          [x1, y1, z0],
          [x1, y1, z1],
          [x0, y1, z1],
        ],
        [0, 1, 0],
        [
          [x0 / topTile, z0 / topTile],
          [x1 / topTile, z0 / topTile],
          [x1 / topTile, z1 / topTile],
          [x0 / topTile, z1 / topTile],
        ],
      );
    }
    const tileTop = uv.tile;
    if (!topBatch) this.quad(
      [
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      [0, 1, 0],
      [
        [alongX(x0) / tileTop, alongZ(z0) / tileTop],
        [alongX(x1) / tileTop, alongZ(z0) / tileTop],
        [alongX(x1) / tileTop, alongZ(z1) / tileTop],
        [alongX(x0) / tileTop, alongZ(z1) / tileTop],
      ],
    );
    if (!skipBottom || y0 > 0.01) {
      this.quad(
        [
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y0, z0],
          [x0, y0, z0],
        ],
        [0, -1, 0],
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      );
    }
  }

  floor(minX: number, minZ: number, maxX: number, maxZ: number, tile: number) {
    this.quad(
      [
        [minX, 0, minZ],
        [maxX, 0, minZ],
        [maxX, 0, maxZ],
        [minX, 0, maxZ],
      ],
      [0, 1, 0],
      [
        [minX / tile, minZ / tile],
        [maxX / tile, minZ / tile],
        [maxX / tile, maxZ / tile],
        [minX / tile, maxZ / tile],
      ],
    );
  }

  /** `uv2Of` maps a world (x, z) to the map's occlusion texture; only batches that use it pass it. */
  build(name: string, scene: Scene, uv2Of?: (x: number, z: number) => [number, number]): Mesh | null {
    if (this.indices.length === 0) return null;
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.positions;
    vd.normals = this.normals;
    vd.uvs = this.uvs;
    vd.colors = this.colors;
    if (uv2Of) {
      const uv2: number[] = [];
      for (let i = 0; i < this.positions.length; i += 3) {
        const [u, v] = uv2Of(this.positions[i], this.positions[i + 2]);
        uv2.push(u, v);
      }
      vd.uvs2 = uv2;
    }
    vd.indices = this.indices;
    vd.applyToMesh(mesh, false);
    return mesh;
  }
}

export interface MapRenderResult {
  meshes: Mesh[];
  dispose(): void;
}

export function renderMap(scene: Scene, data: MapData, shadow: ShadowGenerator | null): MapRenderResult {
  const { def } = data;
  const meshes: Mesh[] = [];
  const materials: StandardMaterial[] = [];
  const mat = (name: string, tex: Texture | null, color?: Color3, spec = 0.06) => {
    const m = new StandardMaterial(name, scene);
    if (tex) m.diffuseTexture = tex;
    if (color) m.diffuseColor = color;
    m.specularColor = new Color3(spec, spec, spec);
    m.specularPower = 32;
    materials.push(m);
    return m;
  };

  // Baked occlusion for floors and other horizontal tops, sampled through a second UV set.
  const { cols, rows } = data.nav;
  const ao = occlusionTexture(scene, cols, rows, data.cellTop, CELL);
  ao.coordinatesIndex = 1;
  const uv2Of = (x: number, z: number): [number, number] => [
    (x - data.bounds.minX) / (cols * CELL),
    (data.bounds.maxZ - z) / (rows * CELL),
  ];
  const usesAo = (key: string) => key.startsWith('floor-') || key.startsWith('cap-');

  const batches = new Map<string, { batch: GeometryBatch; material: StandardMaterial; castShadow: boolean }>();
  const getBatch = (key: string, makeMat: () => StandardMaterial, castShadow = true) => {
    let b = batches.get(key);
    if (!b) {
      b = { batch: new GeometryBatch(), material: makeMat(), castShadow };
      if (usesAo(key)) b.material.ambientTexture = ao;
      batches.set(key, b);
    }
    return b.batch;
  };

  const zones = def.palette.zones;
  const kit = mapKit(def);
  const zoneSeed = (z: string) => [...z].reduce((a, c) => a + c.charCodeAt(0), 0);

  // Flat-coloured parts share one mesh and carry their colour per vertex.
  const flat: FlatBatch = (color) => {
    const shared = getBatch('flat', () => mat('flat', null, Color3.White(), 0.1), false);
    const c = Color3.FromHexString(color);
    shared.tint = [c.r, c.g, c.b];
    return shared;
  };

  for (const box of data.boxes) {
    const zone = zones[box.zone] ?? Object.values(zones)[0];
    const seed = zoneSeed(box.zone);
    switch (box.kind) {
      case 'wall':
      case 'raised':
      case 'lintel': {
        // Wall tops get stone capping; raised floors (Heaven, stairs) get the zone's floor paving.
        const top =
          box.kind === 'raised'
            ? getBatch(`floor-${box.zone}`, () => mat(`floor-${box.zone}`, floorTexture(scene, zone.floor, seed + 101)), false)
            : getBatch(`cap-${box.zone}`, () => mat(`cap-${box.zone}`, stoneTexture(scene, zone.wall, seed + 7)));
        getBatch(`wall-${box.zone}`, () => mat(`wall-${box.zone}`, wallTexture(scene, zone.wall, zone.accent, seed))).box(
          box.min,
          box.max,
          { kind: 'world', tile: 4, vHeight: WALL_HEIGHT },
          true,
          top,
          box.kind === 'raised' ? 4 : 2,
        );
        if (box.kind === 'wall' && box.min[1] < 0.01 && box.max[1] >= WALL_HEIGHT - 0.01) {
          addRoof(
            box,
            kit.roof,
            getBatch('roof', () => mat('roof', kit.roof === 'tile' ? roofTexture(scene, kit.roofColor, 17) : null, kit.roof === 'tile' ? undefined : Color3.FromHexString(kit.roofColor))),
            getBatch(`eave-${box.zone}`, () => mat(`eave-${box.zone}`, null, Color3.FromHexString(shade(zone.wall, 0.86)))),
          );
        }
        break;
      }
      case 'pillar':
      case 'rail':
        getBatch(`stone-${box.zone}`, () => mat(`stone-${box.zone}`, stoneTexture(scene, zone.wall, seed + 7))).box(
          box.min,
          box.max,
          { kind: 'world', tile: 2, vHeight: 1.5 },
        );
        break;
      case 'crate':
      case 'crate-low': {
        const color = box.kind === 'crate' ? kit.crateColor : shade(kit.crateColor, 0.86);
        const body = getBatch(box.kind, () => mat(box.kind, crateTexture(scene, color, box.kind === 'crate' ? 11 : 23)));
        addCrates(box, body, flat, shade(color, 0.62));
        break;
      }
      case 'stack':
        addContainers(
          box,
          getBatch(`stack-${box.zone}`, () => mat(`stack-${box.zone}`, metalTexture(scene, zone.accent, seed + 3), undefined, 0.15)),
          flat,
          shade(zone.accent, 0.62),
        );
        break;
    }
  }

  // Only the glowing facade parts (lamps, window glass) need a material of their own.
  const detail = (key: string, color: string, emissive?: string) => {
    if (!emissive) return flat(color);
    return getBatch(key, () => {
      const m = mat(key, null, Color3.FromHexString(color), 0.12);
      m.emissiveColor = Color3.FromHexString(emissive);
      return m;
    }, false);
  };
  addFacadeDetail(data, kit, detail);
  if (kit.bunting) addBunting(data, flat);
  addLandmarks(
    data,
    kit,
    (zoneId) => {
      const z = zones[zoneId] ?? Object.values(zones)[0];
      return getBatch(`wall-${zoneId}`, () => mat(`wall-${zoneId}`, wallTexture(scene, z.wall, z.accent, zoneSeed(zoneId))));
    },
    getBatch('roof', () => mat('roof', kit.roof === 'tile' ? roofTexture(scene, kit.roofColor, 17) : null, kit.roof === 'tile' ? undefined : Color3.FromHexString(kit.roofColor))),
    detail,
  );

  for (const f of data.floors) {
    const zone = zones[f.zone] ?? Object.values(zones)[0];
    getBatch(`floor-${f.zone}`, () => mat(`floor-${f.zone}`, floorTexture(scene, zone.floor, zoneSeed(f.zone) + 101)), false).floor(
      f.minX,
      f.minZ,
      f.maxX,
      f.maxZ,
      4,
    );
  }

  for (const [key, { batch, material, castShadow }] of batches) {
    const mesh = batch.build(`map-${key}`, scene, usesAo(key) ? uv2Of : undefined);
    if (!mesh) continue;
    mesh.material = material;
    mesh.useVertexColors = true;
    mesh.hasVertexAlpha = false;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    if (shadow && castShadow) shadow.addShadowCaster(mesh, false);
    meshes.push(mesh);
  }

  // Painted site letters.
  for (const mark of def.siteMarks) {
    const plane = CreatePlane(`site-${mark.letter}`, { size: 5 }, scene);
    plane.rotation.x = Math.PI / 2;
    plane.position.set(data.space.x(mark.c), 0.02, data.space.z(mark.r));
    const m = new StandardMaterial(`site-mat-${mark.letter}`, scene);
    const t = letterTexture(scene, mark.letter, 'rgba(255,255,255,0.55)');
    m.diffuseTexture = t;
    m.useAlphaFromDiffuseTexture = true;
    m.specularColor = Color3.Black();
    m.emissiveColor = new Color3(0.15, 0.15, 0.15);
    materials.push(m);
    plane.material = m;
    plane.receiveShadows = true;
    plane.isPickable = false;
    plane.freezeWorldMatrix();
    meshes.push(plane);
  }

  // Sky dome.
  const sky = CreateSphere('sky', { diameter: 600, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene);
  const skyMat = new StandardMaterial('sky-mat', scene);
  const skyTex = skyTexture(scene, def.palette.sky[0], def.palette.sky[1], zoneSeed(def.id));
  skyMat.emissiveTexture = skyTex;
  skyMat.diffuseColor = Color3.Black();
  skyMat.specularColor = Color3.Black();
  skyMat.disableLighting = true;
  skyMat.fogEnabled = false;
  sky.material = skyMat;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  materials.push(skyMat);
  meshes.push(sky);

  // Beyond the walls: two layers of distant silhouette, already blended towards the haze colour.
  {
    const vista = buildVista(scene, def.palette.fog, def.palette.sky[0], kit.vista, zoneSeed(def.id));
    const vm = new StandardMaterial('vista-mat', scene);
    vm.emissiveColor = Color3.White();
    vm.diffuseColor = Color3.Black();
    vm.specularColor = Color3.Black();
    vm.disableLighting = true;
    vm.fogEnabled = false;
    vm.backFaceCulling = false;
    vista.material = vm;
    materials.push(vm);
    meshes.push(vista);
  }

  // Sun: a soft glow and a bright core, far away in the direction the light comes from.
  const mood = mapMood(def);
  const [sx, sy, sz] = mood.sunDir;
  const sl = Math.hypot(sx, sy, sz);
  for (const [name, size, alpha] of [
    ['sun-glow', 190, 0.55],
    ['sun-core', 26, 1],
  ] as const) {
    const disc = CreatePlane(name, { size }, scene);
    disc.position.set((-sx / sl) * 260, (-sy / sl) * 260, (-sz / sl) * 260);
    disc.billboardMode = Mesh.BILLBOARDMODE_ALL;
    disc.infiniteDistance = true;
    disc.isPickable = false;
    const m = new StandardMaterial(`${name}-mat`, scene);
    const t = radialTexture(scene, name, name === 'sun-core' ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.75)', 'rgba(255,255,255,0)', 128);
    m.emissiveTexture = t;
    m.opacityTexture = t;
    m.emissiveColor = Color3.FromHexString(mood.sun);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.disableLighting = true;
    m.fogEnabled = false;
    m.alpha = alpha;
    m.alphaMode = 1; // additive
    m.disableDepthWrite = true;
    disc.material = m;
    materials.push(m);
    meshes.push(disc);
  }

  for (const m of materials) m.freeze();

  return {
    meshes,
    dispose() {
      for (const m of meshes) m.dispose();
      for (const m of materials) m.dispose(true, true);
    },
  };
}

/** Deterministic hash → [0, 1). */
function h01(a: number, b: number, c: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${[f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Visual-only facade detail on walls that face open ground: pilasters, doors, high windows and
 * wall lamps. Below head height everything sits within 13 cm of the wall face (the door step aside);
 * sills and awnings stand further out but are above it. None of it has collision.
 */
function addFacadeDetail(data: MapData, kit: MapKit, batch: (key: string, color: string, emissive?: string) => GeometryBatch) {
  const { def, space, cellTop } = data;
  const rows = def.grid.length;
  const cols = def.grid[0].length;
  const at = (c: number, r: number) => (r >= 0 && r < rows && c >= 0 && c < cols ? def.grid[r][c] : '#');
  const open = (c: number, r: number) => at(c, r) === '.';
  const half = CELL / 2;
  const uv = { kind: 'box' as const, tile: 1, vTile: 1 };
  const seed = [...def.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 3) | 0;

  // The four facade directions: wall cell (c, r) with open ground at (c + dc, r + dr).
  const dirs: { dc: number; dr: number }[] = [
    { dc: 1, dr: 0 },
    { dc: -1, dr: 0 },
    { dc: 0, dr: 1 },
    { dc: 0, dr: -1 },
  ];
  for (const { dc, dr } of dirs) {
    const alongRows = dc !== 0; // facade runs along the grid's rows (varies r) when it faces ±X
    const lines = alongRows ? cols : rows;
    const len = alongRows ? rows : cols;
    for (let line = 0; line < lines; line++) {
      let k = 0;
      while (k < len) {
        const c = alongRows ? line : k;
        const r = alongRows ? k : line;
        if (!(at(c, r) === '#' && open(c + dc, r + dr))) {
          k++;
          continue;
        }
        let e = k;
        while (e + 1 < len) {
          const c2 = alongRows ? line : e + 1;
          const r2 = alongRows ? e + 1 : line;
          if (at(c2, r2) === '#' && open(c2 + dc, r2 + dr)) e++;
          else break;
        }
        placeRun(line, k, e);
        k = e + 1;
      }
    }

    function placeRun(line: number, k0: number, k1: number) {
      const n = k1 - k0 + 1;
      // world helpers for a point along the facade (t in cells from k0's near edge) at height y, protruding p
      const cellC = (k: number) => (alongRows ? line : k);
      const cellR = (k: number) => (alongRows ? k : line);
      const zone = def.palette.zones[def.zoneOf(cellC(k0), cellR(k0))] ?? Object.values(def.palette.zones)[0];
      const box = (key: string, color: string, k: number, offset: number, width: number, y0: number, y1: number, depth: number, emissive?: string) => {
        // k: cell index along the run; offset: metres from that cell's centre along the facade
        const c = cellC(k);
        const r = cellR(k);
        const cx = space.x(c) + dc * half;
        const cz = space.z(r) - dr * half; // row grows towards −Z
        const nx = dc;
        const nz = -dr;
        let min: number[];
        let max: number[];
        if (alongRows) {
          // face normal ±X; facade runs along Z (row direction is −Z)
          const z = space.z(r) - offset;
          const x0 = nx > 0 ? cx : cx - depth;
          const x1 = nx > 0 ? cx + depth : cx;
          min = [x0, y0, z - width / 2];
          max = [x1, y1, z + width / 2];
        } else {
          const x = space.x(c) + offset;
          const z0 = nz > 0 ? cz : cz - depth;
          const z1 = nz > 0 ? cz + depth : cz;
          min = [x - width / 2, y0, z0];
          max = [x + width / 2, y1, z1];
        }
        batch(key, color, emissive).box(min, max, uv, true, null);
      };
      const trim = shade(zone.wall, 0.78);
      const frame = shade(zone.wall, 1.12);
      const paint = shade(zone.accent, 0.8);
      const paintDark = shade(zone.accent, 0.58);
      /** Cloth awning: a sloped sheet from the wall down to a front valance, seen from above and below. */
      const awning = (k: number, width: number, yWall: number, yFront: number, out: number) => {
        const c = cellC(k);
        const r = cellR(k);
        const P = (a: number, y: number, d: number): number[] =>
          alongRows ? [space.x(c) + dc * (half + d), y, space.z(r) - a] : [space.x(c) + a, y, space.z(r) - dr * (half + d)];
        const w = width / 2;
        const len = Math.hypot(out, yWall - yFront);
        const up: [number, number, number] = [(dc * (yWall - yFront)) / len, out / len, (-dr * (yWall - yFront)) / len];
        const cloth = batch(`facade-awning-${paint}`, paint);
        const pts = [P(-w, yWall, 0), P(w, yWall, 0), P(w, yFront, out), P(-w, yFront, out)];
        const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
        cloth.quad(pts, up, uvs);
        cloth.quad(pts, [-up[0], -up[1], -up[2]], uvs, [0.7, 0.7, 0.8, 0.8]);
        // hanging valance along the front edge
        const fr = [P(-w, yFront - 0.22, out), P(w, yFront - 0.22, out), P(w, yFront, out), P(-w, yFront, out)];
        const stripe = batch(`facade-awning-${paintDark}`, paintDark);
        stripe.quad(fr, [dc, 0, -dr], uvs);
        stripe.quad(fr, [-dc, 0, dr], uvs, [0.7, 0.7, 0.7, 0.7]);
      };
      // pilasters at the run ends and every 3 cells
      for (let k = k0; k <= k1 + 1; k += 3) {
        const kk = Math.min(k, k1);
        const off = k > k1 ? 1 : -1;
        const top = cellTop[cellR(kk) * cols + cellC(kk)];
        box(`facade-pilaster-${zone.wall}`, trim, kk, off * (half - 0.02), 0.42, 0, top, 0.1);
        if (k > k1) break;
      }
      // a door on some runs of 3+ cells: a deep surround with the leaf set back inside it
      if (n >= 3 && h01(line, k0, seed) < 0.45) {
        const kd = k0 + 1 + Math.floor(h01(k0, line, seed + 1) * (n - 2));
        const fk = `facade-frame-${frame}`;
        box(fk, frame, kd, -0.84, 0.2, 0, 2.78, 0.1); // jambs
        box(fk, frame, kd, 0.84, 0.2, 0, 2.78, 0.1);
        box(fk, frame, kd, 0, 2.08, 2.78, 3.02, 0.13); // head
        box('facade-reveal', '#1a1512', kd, 0, 1.48, 0, 2.78, 0.012); // shadowed reveal behind the leaf
        box(`facade-door-${paintDark}`, paintDark, kd, 0, 1.36, 0.04, 2.7, 0.035); // door leaf
        for (const side of [-1, 1]) {
          box(`facade-door-${paint}`, paint, kd, side * 0.34, 0.5, 0.3, 1.2, 0.055); // raised panels
          box(`facade-door-${paint}`, paint, kd, side * 0.34, 0.5, 1.4, 2.5, 0.055);
        }
        box('facade-handle', '#c9b27a', kd, 0.08, 0.05, 1.05, 1.25, 0.08);
        box('facade-door-step', shade(zone.floor, 0.8), kd, 0, 2.1, 0, 0.12, 0.35);
        const roll = h01(kd, line, seed + 2);
        if (kit.awnings && roll < 0.5) awning(kd, 2.4, 3.6, 3.12, 0.8);
        else if (roll < 0.8) box('facade-lamp', '#ffe2a8', kd, 0, 0.32, 3.12, 3.32, 0.14, '#c9a560');
      }
      // high windows and lamps along the rest
      for (let k = k0; k <= k1; k++) {
        const top = cellTop[cellR(k) * cols + cellC(k)];
        const roll = h01(k, line, seed + 7);
        if (roll < 0.34 && top >= 5.2) {
          const fk = `facade-frame-${frame}`;
          box(fk, frame, k, -0.56, 0.14, 3.6, 4.9, 0.09); // jambs
          box(fk, frame, k, 0.56, 0.14, 3.6, 4.9, 0.09);
          box(fk, frame, k, 0, 1.4, 4.9, 5.08, 0.12); // head
          box(fk, frame, k, 0, 1.5, 3.46, 3.6, 0.18); // sill
          box('facade-window', '#1d2a36', k, 0, 0.98, 3.6, 4.9, 0.012, '#0c1620');
          box(fk, frame, k, 0, 0.05, 3.6, 4.9, 0.035); // glazing bars
          box(fk, frame, k, 0, 0.98, 4.22, 4.27, 0.035);
          if (kit.bunting && h01(k, line, seed + 13) < 0.5) {
            // flower box on the sill
            box('facade-planter', '#7a5a44', k, 0, 1.2, 3.6, 3.8, 0.24);
            box('facade-leaves', '#4f7d3c', k, 0, 1.1, 3.8, 3.93, 0.22);
            for (let f = 0; f < 4; f++) box('facade-flowers', f % 2 ? '#e8c85a' : paint, k, -0.42 + f * 0.28, 0.12, 3.93, 4.02, 0.2);
          }
          if (h01(line, k, seed + 11) < 0.6) {
            // shutters folded back against the wall
            box(`facade-door-${paint}`, paint, k, -0.92, 0.5, 3.6, 4.9, 0.045);
            box(`facade-door-${paint}`, paint, k, 0.92, 0.5, 3.6, 4.9, 0.045);
          }
        } else if (roll > 0.86) {
          box('facade-lamp', '#ffe2a8', k, 0, 0.3, 2.9, 3.1, 0.12, '#c9a560');
        } else if (kit.wallUnits && roll > 0.74 && top >= 5.2) {
          // wall-mounted cooling unit with a pipe run up to the roof
          box('facade-unit', '#c5c9cc', k, 0, 0.95, 3.5, 4.15, 0.34);
          box('facade-grille', '#5c6468', k, -0.12, 0.5, 3.6, 4.05, 0.35);
          box('facade-pipe', '#8d9499', k, 0.36, 0.07, 4.15, top, 0.08);
        }
      }
    }
  }
}


/**
 * Roof on top of a full-height wall mass (visual only, above the 6 m sight-line ceiling):
 * an overhanging eave slab, then either a pitched tiled roof or a flat roof with a parapet lip.
 */
function addRoof(box: MapBox, style: 'tile' | 'flat', roof: GeometryBatch, eave: GeometryBatch) {
  const y = box.max[1];
  const flatUv = { kind: 'box' as const, tile: 2, vTile: 2 };
  if (style === 'flat') {
    const o = 0.14;
    eave.box([box.min[0] - o, y - 0.3, box.min[2] - o], [box.max[0] + o, y + 0.28, box.max[2] + o], flatUv, false, roof, 2);
    return;
  }
  const o = 0.38;
  const x0 = box.min[0] - o;
  const x1 = box.max[0] + o;
  const z0 = box.min[2] - o;
  const z1 = box.max[2] + o;
  const e = y + 0.14;
  eave.box([x0, y - 0.1, z0], [x1, e, z1], flatUv, false);
  const w = x1 - x0;
  const d = z1 - z0;
  const run = Math.min(w, d) / 2;
  const rise = Math.min(2.4, run * 0.55);
  const top = e + rise;
  const slope = Math.hypot(run, rise);
  const ny = run / slope;
  const nh = rise / slope;
  // ridge runs along the longer side; the short ends are hips
  const rx0 = w >= d ? x0 + run : (x0 + x1) / 2;
  const rx1 = w >= d ? x1 - run : (x0 + x1) / 2;
  const rz0 = w >= d ? (z0 + z1) / 2 : z0 + run;
  const rz1 = w >= d ? (z0 + z1) / 2 : z1 - run;
  const v = slope / 2;
  const face = (a: number[], b: number[], c: number[], dd: number[], n: [number, number, number], len: number, inset: number) =>
    roof.quad([a, b, c, dd], n, [
      [0, 0],
      [len / 2, 0],
      [(len - inset) / 2, v],
      [inset / 2, v],
    ]);
  const ix = rx0 - x0;
  const iz = rz0 - z0;
  face([x0, e, z0], [x1, e, z0], [rx1, top, rz0], [rx0, top, rz0], [0, ny, -nh], w, ix); // -Z slope
  face([x1, e, z1], [x0, e, z1], [rx0, top, rz1], [rx1, top, rz1], [0, ny, nh], w, ix); // +Z slope
  face([x0, e, z1], [x0, e, z0], [rx0, top, rz0], [rx0, top, rz1], [-nh, ny, 0], d, iz); // -X slope
  face([x1, e, z0], [x1, e, z1], [rx1, top, rz1], [rx1, top, rz0], [nh, ny, 0], d, iz); // +X slope
}

const FLAT_UV = { kind: 'box' as const, tile: 1, vTile: 1 };

/** A box drawn as a recessed body inside a proud frame along its twelve edges (crate, container). */
function addFramedBox(body: GeometryBatch, frame: GeometryBatch, min: number[], max: number[], uv: UvMode, bar: number, inset: number) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  body.box([x0 + inset, y0, z0 + inset], [x1 - inset, y1 - inset, z1 - inset], uv, y0 < 0.01);
  const b = Math.min(bar, (x1 - x0) / 3, (z1 - z0) / 3, (y1 - y0) / 3);
  const part = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => frame.box([ax, ay, az], [bx, by, bz], FLAT_UV, false);
  for (const x of [x0, x1 - b])
    for (const z of [z0, z1 - b]) part(x, y0, z, x + b, y1, z + b); // posts
  for (const y of [y0, y1 - b]) {
    for (const z of [z0, z1 - b]) part(x0 + b, y, z, x1 - b, y + b, z + b); // rails along X
    for (const x of [x0, x1 - b]) part(x, y, z0 + b, x + b, y + b, z1 - b); // rails along Z
  }
}

/** Split a merged run into `unit`-sized pieces along X and Z. */
function eachUnit(box: MapBox, unit: number, fn: (min: number[], max: number[], i: number) => void) {
  const nx = Math.max(1, Math.round((box.max[0] - box.min[0]) / unit));
  const nz = Math.max(1, Math.round((box.max[2] - box.min[2]) / unit));
  const dx = (box.max[0] - box.min[0]) / nx;
  const dz = (box.max[2] - box.min[2]) / nz;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++)
      fn([box.min[0] + i * dx, box.min[1], box.min[2] + j * dz], [box.min[0] + (i + 1) * dx, box.max[1], box.min[2] + (j + 1) * dz], i * 31 + j);
}

/** Wooden crates filling a crate collision box exactly: one per cell, tall ones stacked two high. */
function addCrates(box: MapBox, body: GeometryBatch, flat: FlatBatch, frameColor: string) {
  eachUnit(box, CELL, (min, max, i) => {
    const h = max[1] - min[1];
    const levels = h > 1.7 ? 2 : 1;
    for (let l = 0; l < levels; l++) {
      const y0 = min[1] + (h * l) / levels;
      const y1 = min[1] + (h * (l + 1)) / levels;
      const k = 0.9 + 0.1 * h01(Math.round(min[0] * 10), Math.round(min[2] * 10), i + l * 7);
      body.tint = [k, k, k];
      addFramedBox(body, flat(frameColor), [min[0], y0, min[2]], [max[0], y1, max[2]], { kind: 'box', tile: max[0] - min[0], vTile: y1 - y0 }, 0.11, 0.035);
    }
    body.tint = [1, 1, 1];
  });
}

/** Shipping containers filling a stack collision box: two cells long where there is room, two high. */
function addContainers(box: MapBox, body: GeometryBatch, flat: FlatBatch, frameColor: string) {
  const long = box.max[0] - box.min[0] >= box.max[2] - box.min[2] ? 0 : 2;
  const nLong = Math.max(1, Math.round((box.max[long] - box.min[long]) / (CELL * 2)));
  const nShort = Math.max(1, Math.round((box.max[2 - long] - box.min[2 - long]) / CELL));
  const h = box.max[1] - box.min[1];
  for (let i = 0; i < nLong; i++)
    for (let j = 0; j < nShort; j++)
      for (let l = 0; l < 2; l++) {
        const min = [0, box.min[1] + (h * l) / 2, 0];
        const max = [0, box.min[1] + (h * (l + 1)) / 2, 0];
        min[long] = box.min[long] + ((box.max[long] - box.min[long]) * i) / nLong;
        max[long] = box.min[long] + ((box.max[long] - box.min[long]) * (i + 1)) / nLong;
        min[2 - long] = box.min[2 - long] + ((box.max[2 - long] - box.min[2 - long]) * j) / nShort;
        max[2 - long] = box.min[2 - long] + ((box.max[2 - long] - box.min[2 - long]) * (j + 1)) / nShort;
        const k = 0.86 + 0.14 * h01(i, j, l + Math.round(box.min[0]));
        body.tint = [k, k, k];
        addFramedBox(body, flat(frameColor), min, max, { kind: 'box', tile: 2, vTile: h / 2 }, 0.13, 0.05);
      }
  body.tint = [1, 1, 1];
}

/** Strings of small flags sagging between facing walls across narrow streets, well above head height. */
function addBunting(data: MapData, flat: FlatBatch) {
  const { def, space, cellTop } = data;
  const rows = def.grid.length;
  const cols = def.grid[0].length;
  const at = (c: number, r: number) => (r >= 0 && r < rows && c >= 0 && c < cols ? def.grid[r][c] : '#');
  const seed = [...def.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 9) | 0;
  const accents = Object.values(def.palette.zones).map((z) => z.accent);
  const colors = [accents[0], '#f1ead8', accents[1 % accents.length], '#e8c85a'];
  const half = CELL / 2;
  const string = (ax: number, az: number, bx: number, bz: number, salt: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(8, Math.round(len / 0.55));
    const y = 4.7 + h01(salt, 3, seed) * 0.7;
    const sag = 0.25 + len * 0.045;
    // normal across the string, so the flags face along the street
    const nx = (bz - az) / len;
    const nz = -(bx - ax) / len;
    const at2 = (t: number) => [ax + (bx - ax) * t, y - sag * 4 * t * (1 - t), az + (bz - az) * t];
    for (let i = 0; i < n; i++) {
      const p = at2(i / n);
      const q = at2((i + 1) / n);
      const cord = [p, q, [q[0], q[1] + 0.025, q[2]], [p[0], p[1] + 0.025, p[2]]];
      const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
      const line = flat('#3a332c');
      line.quad(cord, [nx, 0, nz], uv);
      line.quad(cord, [-nx, 0, -nz], uv);
      const m = [(p[0] + q[0]) / 2, Math.min(p[1], q[1]) - 0.3, (p[2] + q[2]) / 2];
      const a = [p[0] + (q[0] - p[0]) * 0.12, p[1], p[2] + (q[2] - p[2]) * 0.12];
      const b = [p[0] + (q[0] - p[0]) * 0.88, q[1], p[2] + (q[2] - p[2]) * 0.88];
      const flag = flat(colors[(i + salt) % colors.length]);
      flag.quad([a, b, m, m], [nx, 0, nz], uv);
      flag.quad([a, b, m, m], [-nx, 0, -nz], uv, [0.85, 0.85, 0.85, 0.85]);
    }
  };
  const tall = (c: number, r: number) => at(c, r) === '#' && cellTop[r * cols + c] >= WALL_HEIGHT;
  for (let r = 1; r < rows - 1; r++)
    for (let c = 0; c < cols - 2; c++) {
      // across a street that runs north–south (walls to the west and east)
      if (tall(c, r) && at(c + 1, r) === '.') {
        let n = 1;
        while (at(c + 1 + n, r) === '.') n++;
        if (n >= 2 && n <= 6 && tall(c + 1 + n, r) && (r + Math.floor(h01(c, 1, seed) * 5)) % 5 === 0)
          string(space.x(c) + half, space.z(r), space.x(c + 1 + n) - half, space.z(r), c * 7 + r);
      }
    }
  for (let c = 1; c < cols - 1; c++)
    for (let r = 0; r < rows - 2; r++) {
      // across a street that runs east–west (walls to the north and south)
      if (tall(c, r) && at(c, r + 1) === '.') {
        let n = 1;
        while (at(c, r + 1 + n) === '.') n++;
        if (n >= 2 && n <= 6 && tall(c, r + 1 + n) && (c + Math.floor(h01(r, 2, seed) * 5)) % 5 === 0)
          string(space.x(c), space.z(r) - half, space.x(c), space.z(r + 1 + n) + half, c * 5 + r * 3);
      }
    }
}

/**
 * One landmark tower per site, rising from the roof of the nearest building so each site has a
 * shape to recognise it by from a distance. Entirely above the walls, so it never affects play.
 */
function addLandmarks(
  data: MapData,
  kit: MapKit,
  wall: (zone: string) => GeometryBatch,
  roof: GeometryBatch,
  detail: (key: string, color: string, emissive?: string) => GeometryBatch,
) {
  const { def, space } = data;
  def.siteMarks.forEach((mark, index) => {
    const sx = space.x(mark.c);
    const sz = space.z(mark.r);
    const size = 3.4;
    const need = size + 1;
    let best: { x: number; z: number; y: number; d: number } | null = null;
    for (const b of data.boxes) {
      if (b.kind !== 'wall' || b.min[1] > 0.01 || b.max[1] < WALL_HEIGHT) continue;
      if (b.max[0] - b.min[0] < need || b.max[2] - b.min[2] < need) continue;
      const x = Math.max(b.min[0] + need / 2, Math.min(b.max[0] - need / 2, sx));
      const z = Math.max(b.min[2] + need / 2, Math.min(b.max[2] - need / 2, sz));
      const d = Math.hypot(x - sx, z - sz);
      if (d > 6 && (!best || d < best.d)) best = { x, z, y: b.max[1], d };
    }
    if (!best) return;
    const zoneId = def.zoneOf(Math.floor(mark.c), Math.floor(mark.r));
    const zone = def.palette.zones[zoneId] ?? Object.values(def.palette.zones)[0];
    const { x, z, y } = best;
    const trim = shade(zone.wall, 0.8);
    const light = shade(zone.wall, 1.05);
    const tall = index % 2 === 0;
    /** Square block centred on the landmark: half-width `h`, from y0 to y1. */
    const flatBlock = (color: string, h: number, y0: number, y1: number, emissive?: string, key = '') =>
      detail(key, color, emissive).box([x - h, y0, z - h], [x + h, y1, z + h], FLAT_UV, false);
    const wallBlock = (h: number, y0: number, y1: number) =>
      wall(zoneId).box([x - h, y0, z - h], [x + h, y1, z + h], { kind: 'world', tile: 4, vHeight: WALL_HEIGHT });
    const roofOn = (h: number, top: number, style: 'tile' | 'flat' = kit.roof) =>
      addRoof({ min: [x - h, 0, z - h], max: [x + h, top, z + h], kind: 'wall', zone: zoneId }, style, roof, detail('', trim));
    const beacon = (top: number) => {
      detail('', '#5b6166').box([x - 0.07, top, z - 0.07], [x + 0.07, top + 3, z + 0.07], FLAT_UV);
      detail('landmark-light', '#ff5a4a', '#d8402f').box([x - 0.16, top + 3, z - 0.16], [x + 0.16, top + 3.3, z + 0.16], FLAT_UV);
    };

    switch (kit.landmark) {
      case 'tower': {
        // bell tower: shaft with the site's colour band, an open belfry and a roof
        const h = 1.7;
        const shaftTop = y + (tall ? 8.5 : 6.5);
        wallBlock(h, y - 0.5, shaftTop);
        flatBlock(trim, h + 0.08, y + 2.2, y + 2.5);
        flatBlock(zone.accent, h + 0.05, shaftTop - 2.9, shaftTop - 2.3);
        flatBlock(trim, h + 0.22, shaftTop, shaftTop + 0.3);
        const top = shaftTop + 0.3;
        flatBlock('#221d1a', h - 0.5, top, top + 2.2);
        for (const px of [x - h, x + h - 0.7])
          for (const pz of [z - h, z + h - 0.7]) detail('', light).box([px, top, pz], [px + 0.7, top + 2.2, pz + 0.7], FLAT_UV);
        flatBlock(trim, h + 0.2, top + 2.2, top + 2.5);
        roofOn(h, top + 2.5);
        if (kit.roof === 'flat') beacon(top + 2.5);
        break;
      }
      case 'minaret': {
        // slim shaft, a balcony, a narrower upper stage and a stepped dome in the site's colour
        const base = y + (tall ? 9 : 7);
        wallBlock(1.15, y - 0.5, base);
        flatBlock(trim, 1.75, base, base + 0.25);
        flatBlock(light, 1.7, base + 0.25, base + 0.95);
        flatBlock('#221d1a', 0.95, base + 0.25, base + 3);
        for (const px of [x - 0.95, x + 0.6])
          for (const pz of [z - 0.95, z + 0.6]) detail('', light).box([px, base + 0.25, pz], [px + 0.35, base + 3, pz + 0.35], FLAT_UV);
        flatBlock(trim, 1.2, base + 3, base + 3.3);
        const dome = [1.05, 0.9, 0.68, 0.4];
        dome.forEach((h, i) => flatBlock(zone.accent, h, base + 3.3 + i * 0.42, base + 3.3 + (i + 1) * 0.42));
        flatBlock('#d9b25a', 0.06, base + 3.3 + dome.length * 0.42, base + 6.2);
        break;
      }
      case 'pagoda': {
        // stacked storeys, each smaller than the last, each under its own tiled roof
        let floor = y - 0.3;
        const tiers = tall ? [1.7, 1.35, 1.0, 0.7] : [1.7, 1.3, 0.9];
        for (const h of tiers) {
          wallBlock(h, floor, floor + 2.3);
          flatBlock(zone.accent, h + 0.04, floor + 1.95, floor + 2.3);
          roofOn(h, floor + 2.3, 'tile');
          floor += 2.3 + 0.14 + Math.min(2.4, (h + 0.38) * 0.55) * 0.45;
        }
        flatBlock('#d9b25a', 0.07, floor, floor + 2.6);
        break;
      }
      case 'sign': {
        // office block with a glowing vertical sign on two sides and a mast
        const h = 1.5;
        const top = y + (tall ? 10 : 8);
        wallBlock(h, y - 0.5, top);
        flatBlock(trim, h + 0.15, top, top + 0.35);
        const glow = shade(zone.accent, 0.75);
        detail(`landmark-neon-${zone.accent}`, zone.accent, glow).box([x - 0.5, y + 1.6, z - h - 0.12], [x + 0.5, top - 0.9, z - h], FLAT_UV, false);
        detail(`landmark-neon-${zone.accent}`, zone.accent, glow).box([x - h - 0.12, y + 1.6, z - 0.5], [x - h, top - 0.9, z + 0.5], FLAT_UV, false);
        detail(`landmark-neon-${zone.accent}`, zone.accent, glow).box([x + h, y + 1.6, z - 0.5], [x + h + 0.12, top - 0.9, z + 0.5], FLAT_UV, false);
        detail(`landmark-neon-${zone.accent}`, zone.accent, glow).box([x - 0.5, y + 1.6, z + h], [x + 0.5, top - 0.9, z + h + 0.12], FLAT_UV, false);
        beacon(top + 0.35);
        break;
      }
      case 'watertank': {
        // rooftop water tank on four legs with hoops and a pointed lid
        const legs = y + (tall ? 3.6 : 2.8);
        for (const px of [x - 1.2, x + 1.02])
          for (const pz of [z - 1.2, z + 1.02]) detail('', '#4f4a44').box([px, y - 0.2, pz], [px + 0.18, legs, pz + 0.18], FLAT_UV);
        flatBlock('#4f4a44', 1.45, legs, legs + 0.16);
        flatBlock('#8a6a4c', 1.3, legs + 0.16, legs + 3.2);
        for (const hy of [0.7, 1.7, 2.7]) flatBlock('#3d3833', 1.34, legs + hy, legs + hy + 0.1);
        flatBlock(zone.accent, 1.33, legs + 1.05, legs + 1.45);
        roofOn(1.3, legs + 3.2, 'tile');
        break;
      }
      case 'ziggurat': {
        // stepped stone pyramid with a dark shrine on top
        const steps = tall ? [1.7, 1.4, 1.1, 0.8] : [1.7, 1.3, 0.9];
        let floor = y - 0.3;
        steps.forEach((h, i) => {
          wallBlock(h, floor, floor + 1.7);
          if (i === 1) flatBlock(zone.accent, h + 0.04, floor + 1.25, floor + 1.55);
          flatBlock(trim, h + 0.1, floor + 1.7, floor + 1.88);
          floor += 1.88;
        });
        const top = steps[steps.length - 1];
        flatBlock('#1f211c', top - 0.25, floor, floor + 1.5);
        for (const px of [x - top + 0.05, x + top - 0.3])
          for (const pz of [z - top + 0.05, z + top - 0.3]) detail('', light).box([px, floor, pz], [px + 0.25, floor + 1.5, pz + 0.25], FLAT_UV);
        flatBlock(trim, top, floor + 1.5, floor + 1.8);
        break;
      }
      case 'crane': {
        // tower crane: lattice mast, cab, a long jib over the yard and a short counter-jib
        const paint = '#e0a12a';
        const top = y + (tall ? 15 : 12);
        const m = 0.8;
        for (const px of [x - m, x + m - 0.16])
          for (const pz of [z - m, z + m - 0.16]) detail('', paint).box([px, y - 0.2, pz], [px + 0.16, top, pz + 0.16], FLAT_UV);
        for (let ry = y + 1.5; ry < top; ry += 1.8) {
          detail('', paint).box([x - m, ry, z - m], [x + m, ry + 0.1, z - m + 0.1], FLAT_UV, false);
          detail('', paint).box([x - m, ry, z + m - 0.1], [x + m, ry + 0.1, z + m], FLAT_UV, false);
          detail('', paint).box([x - m, ry, z - m], [x - m + 0.1, ry + 0.1, z + m], FLAT_UV, false);
          detail('', paint).box([x + m - 0.1, ry, z - m], [x + m, ry + 0.1, z + m], FLAT_UV, false);
        }
        flatBlock('#39424c', 1.0, top, top + 0.3);
        detail('', '#d7dade').box([x - 0.9, top + 0.3, z - 0.9], [x + 0.3, top + 1.7, z + 0.3], FLAT_UV, false);
        // the jib points towards the site it marks
        const dx = sx - x;
        const dz = sz - z;
        const alongX = Math.abs(dx) >= Math.abs(dz);
        const dir = (alongX ? dx : dz) >= 0 ? 1 : -1;
        const beam = (from: number, to: number, y0: number, y1: number, w: number) => {
          const a = Math.min(from, to);
          const b = Math.max(from, to);
          if (alongX) detail('', paint).box([x + a, y0, z - w], [x + b, y1, z + w], FLAT_UV, false);
          else detail('', paint).box([x - w, y0, z + a], [x + w, y1, z + b], FLAT_UV, false);
        };
        beam(-4.5 * dir, 13 * dir, top + 1.7, top + 2.05, 0.3);
        beam(-4.5 * dir, -2.6 * dir, top + 0.9, top + 1.7, 0.5); // counterweight
        flatBlock(paint, 0.12, top + 2.05, top + 4);
        // hoist cable and hook block
        const hx = alongX ? x + 9 * dir : x;
        const hz = alongX ? z : z + 9 * dir;
        detail('', '#2b2f33').box([hx - 0.03, top - 3, hz - 0.03], [hx + 0.03, top + 1.7, hz + 0.03], FLAT_UV, false);
        detail('', '#2b2f33').box([hx - 0.25, top - 3.5, hz - 0.25], [hx + 0.25, top - 3, hz + 0.25], FLAT_UV, false);
        beacon(top + 4 - 2.7);
        break;
      }
      case 'lighthouse': {
        // tapering tower in bands of white and the site's colour, a gallery and a lit lamp room
        const bands = tall ? 6 : 5;
        let floor = y - 0.4;
        for (let i = 0; i < bands; i++) {
          const h = 1.6 - i * 0.14;
          flatBlock(i % 2 ? zone.accent : '#efe9dc', h, floor, floor + 1.7);
          floor += 1.7;
        }
        flatBlock('#3a4046', 1.55, floor, floor + 0.2);
        flatBlock('#3a4046', 1.5, floor + 0.2, floor + 0.75);
        flatBlock('#fff2b8', 0.62, floor + 0.2, floor + 1.9, '#e6c860', 'landmark-lamp');
        for (const px of [x - 0.75, x + 0.63])
          for (const pz of [z - 0.75, z + 0.63]) detail('', '#3a4046').box([px, floor + 0.2, pz], [px + 0.12, floor + 1.9, pz + 0.12], FLAT_UV);
        flatBlock('#3a4046', 0.95, floor + 1.9, floor + 2.1);
        roofOn(0.85, floor + 2.1, 'tile');
        break;
      }
    }
  });
}

/** Distant silhouette ring (hills or a city skyline) in two layers, coloured per vertex. */
function buildVista(scene: Scene, fogHex: string, skyHex: string, kind: 'hills' | 'city', seed: number): Mesh {
  const fog = Color3.FromHexString(fogHex);
  const sky = Color3.FromHexString(skyHex);
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const layers = [
    { radius: 255, base: 26, amp: 46, depth: 0.22, phase: 0 },
    { radius: 215, base: 10, amp: 30, depth: 0.42, phase: 1.7 },
  ];
  for (const L of layers) {
    const n = kind === 'city' ? 150 : 120;
    const tone = (k: number) => [fog.r + (sky.r * 0.55 - fog.r) * k, fog.g + (sky.g * 0.6 - fog.g) * k, fog.b + (sky.b * 0.7 - fog.b) * k];
    const height = (i: number) => {
      if (kind === 'city') {
        const block = Math.floor(i / 3);
        return L.base * 0.6 + L.amp * (0.25 + 0.9 * h01(block, seed, Math.round(L.radius)) ** 2);
      }
      const a = (i / n) * Math.PI * 2 + L.phase + seed;
      return L.base + L.amp * (0.5 + 0.28 * Math.sin(a * 3) + 0.16 * Math.sin(a * 7 + 1.3) + 0.08 * Math.sin(a * 15 + 0.4));
    };
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const h0 = height(i);
      const h1 = kind === 'city' ? h0 : height((i + 1) % n);
      const base = positions.length / 3;
      positions.push(Math.cos(a0) * L.radius, -6, Math.sin(a0) * L.radius, Math.cos(a1) * L.radius, -6, Math.sin(a1) * L.radius);
      positions.push(Math.cos(a1) * L.radius, h1, Math.sin(a1) * L.radius, Math.cos(a0) * L.radius, h0, Math.sin(a0) * L.radius);
      const low = tone(L.depth * 0.5);
      const high = tone(L.depth);
      colors.push(...low, 1, ...low, 1, ...high, 1, ...high, 1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const mesh = new Mesh('vista', scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.colors = colors;
  vd.indices = indices;
  vd.applyToMesh(mesh, false);
  mesh.useVertexColors = true;
  mesh.hasVertexAlpha = false;
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();
  return mesh;
}
