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
  quad(p: number[][], n: [number, number, number], uv: number[][], shade?: number[], vertexNormals?: number[][]) {
    const base = this.positions.length / 3;
    for (let i = 0; i < 4; i++) {
      this.positions.push(p[i][0], p[i][1], p[i][2]);
      // per-vertex normals give round shapes smooth shading; `n` still decides which way the face points
      const vn = vertexNormals ? vertexNormals[i] : n;
      this.normals.push(vn[0], vn[1], vn[2]);
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

  /**
   * Round, smooth-shaded section about a vertical axis: radius r0 at y0 and r1 at y1, so one call
   * makes a cylinder, a taper or (with r1 = 0) a cone.
   */
  tube(cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, sides = 24, phase = 0, faceted = false) {
    // outward normal tilts up when the section narrows towards the top
    const run = y1 - y0;
    const lean = r0 - r1;
    const len = Math.hypot(run, lean) || 1;
    const nh = run / len;
    const ny = lean / len;
    for (let i = 0; i < sides; i++) {
      const t0 = phase + (i / sides) * Math.PI * 2;
      const t1 = phase + ((i + 1) / sides) * Math.PI * 2;
      const c0 = Math.cos(t0);
      const s0 = Math.sin(t0);
      const c1 = Math.cos(t1);
      const s1 = Math.sin(t1);
      const tm = (t0 + t1) / 2;
      this.quad(
        [
          [cx + c0 * r0, y0, cz + s0 * r0],
          [cx + c1 * r0, y0, cz + s1 * r0],
          [cx + c1 * r1, y1, cz + s1 * r1],
          [cx + c0 * r1, y1, cz + s0 * r1],
        ],
        [Math.cos(tm) * nh, ny, Math.sin(tm) * nh],
        [
          [i / sides, 0],
          [(i + 1) / sides, 0],
          [(i + 1) / sides, 1],
          [i / sides, 1],
        ],
        undefined,
        faceted
          ? undefined
          : [
              [c0 * nh, ny, s0 * nh],
              [c1 * nh, ny, s1 * nh],
              [c1 * nh, ny, s1 * nh],
              [c0 * nh, ny, s0 * nh],
            ],
      );
    }
  }

  /** Straight square-section bar between two points (truss members, rods, rails at any angle). */
  strut(a: number[], b: number[], w: number) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-4) return;
    d[0] /= len;
    d[1] /= len;
    d[2] /= len;
    // two unit vectors square to the bar
    const ref = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    let u = [d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]];
    const ul = Math.hypot(u[0], u[1], u[2]);
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
    const h = w / 2;
    const corner = (p: number[], su: number, sv: number) => [p[0] + (u[0] * su + v[0] * sv) * h, p[1] + (u[1] * su + v[1] * sv) * h, p[2] + (u[2] * su + v[2] * sv) * h];
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const faces: [number, number, number, number, number[]][] = [
      [1, -1, 1, 1, u],
      [-1, 1, -1, -1, [-u[0], -u[1], -u[2]]],
      [1, 1, -1, 1, v],
      [-1, -1, 1, -1, [-v[0], -v[1], -v[2]]],
    ];
    for (const [su0, sv0, su1, sv1, n] of faces)
      this.quad([corner(a, su0, sv0), corner(a, su1, sv1), corner(b, su1, sv1), corner(b, su0, sv0)], n as [number, number, number], uvs);
  }

  /** Upright ring (or disc with inner = 0) facing along +X/−X or +Z/−Z: clock faces, portholes, fans. */
  ringV(c: number[], axis: 'x' | 'z', sign: number, outer: number, inner = 0, sides = 24) {
    const n: [number, number, number] = axis === 'x' ? [sign, 0, 0] : [0, 0, sign];
    const at = (t: number, r: number) => (axis === 'x' ? [c[0], c[1] + Math.sin(t) * r, c[2] + Math.cos(t) * r] : [c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r, c[2]]);
    for (let i = 0; i < sides; i++) {
      const t0 = (i / sides) * Math.PI * 2;
      const t1 = ((i + 1) / sides) * Math.PI * 2;
      this.quad([at(t0, inner), at(t1, inner), at(t1, outer), at(t0, outer)], n, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  }

  /** Flat ring (or full disc with inner = 0) facing up or down. */
  disc(cx: number, cz: number, y: number, outer: number, inner = 0, up = true, sides = 24) {
    const n: [number, number, number] = [0, up ? 1 : -1, 0];
    for (let i = 0; i < sides; i++) {
      const t0 = (i / sides) * Math.PI * 2;
      const t1 = ((i + 1) / sides) * Math.PI * 2;
      this.quad(
        [
          [cx + Math.cos(t0) * inner, y, cz + Math.sin(t0) * inner],
          [cx + Math.cos(t1) * inner, y, cz + Math.sin(t1) * inner],
          [cx + Math.cos(t1) * outer, y, cz + Math.sin(t1) * outer],
          [cx + Math.cos(t0) * outer, y, cz + Math.sin(t0) * outer],
        ],
        n,
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      );
    }
  }

  /** Dome: a hemisphere (stretched to `height`) built from smooth rings. */
  dome(cx: number, cz: number, y: number, radius: number, height: number, rings = 6, sides = 24) {
    for (let j = 0; j < rings; j++) {
      const a0 = (j / rings) * (Math.PI / 2);
      const a1 = ((j + 1) / rings) * (Math.PI / 2);
      this.tube(cx, cz, y + Math.sin(a0) * height, y + Math.sin(a1) * height, Math.cos(a0) * radius, Math.cos(a1) * radius, sides);
    }
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
      /** Facade-local point: `a` metres along the wall from cell k's centre, height y, `d` metres out from the face. */
      const P = (k: number, a: number, y: number, d: number): number[] => {
        const c = cellC(k);
        const r = cellR(k);
        return alongRows ? [space.x(c) + dc * (half + d), y, space.z(r) - a] : [space.x(c) + a, y, space.z(r) - dr * (half + d)];
      };
      /** Box in facade-local terms: centred at `offset` along the wall, standing off it from d0 to d1. */
      const boxAt = (key: string, color: string, k: number, offset: number, width: number, y0: number, y1: number, d0: number, d1: number, emissive?: string) => {
        const p = P(k, offset - width / 2, y0, d0);
        const q = P(k, offset + width / 2, y1, d1);
        batch(key, color, emissive).box(
          [Math.min(p[0], q[0]), y0, Math.min(p[2], q[2])],
          [Math.max(p[0], q[0]), y1, Math.max(p[2], q[2])],
          uv,
          false,
          null,
        );
      };
      const box = (key: string, color: string, k: number, offset: number, width: number, y0: number, y1: number, depth: number, emissive?: string) =>
        boxAt(key, color, k, offset, width, y0, y1, 0, depth, emissive);
      /** Flat panel facing out of the wall (both sides drawn), given as facade-local corner points. */
      const panel = (color: string, pts: number[][], n: [number, number, number], back = 0.75) => {
        const quadUv = [[0, 0], [1, 0], [1, 1], [0, 1]];
        const b = batch('', color);
        b.quad(pts, n, quadUv);
        b.quad(pts, [-n[0], -n[1], -n[2]], quadUv, [back, back, back, back]);
      };
      const out: [number, number, number] = [dc, 0, -dr];
      const side: [number, number, number] = alongRows ? [0, 0, -1] : [1, 0, 0];
      const IRON = '#2b2825';
      /** Wall lantern: back plate, bracket arm, and a caged lamp with a cap hanging from it. */
      const lantern = (k: number, a: number, y: number) => {
        boxAt('', IRON, k, a, 0.16, y + 0.02, y + 0.46, 0, 0.03);
        boxAt('', IRON, k, a, 0.045, y + 0.38, y + 0.425, 0.03, 0.3);
        boxAt('', IRON, k, a, 0.03, y + 0.29, y + 0.38, 0.245, 0.275);
        boxAt('', IRON, k, a, 0.1, y + 0.27, y + 0.3, 0.21, 0.31); // finial under the arm
        boxAt('', IRON, k, a, 0.27, y + 0.23, y + 0.27, 0.125, 0.395); // cap
        boxAt('', IRON, k, a, 0.19, y + 0.27, y + 0.29, 0.165, 0.355);
        boxAt('facade-lamp', '#ffe7b0', k, a, 0.17, y + 0.02, y + 0.23, 0.175, 0.345, '#d9b060'); // glass
        for (const sa of [-0.095, 0.095])
          for (const sd of [0.165, 0.355]) boxAt('', IRON, k, a + sa, 0.022, y + 0.02, y + 0.23, sd - 0.011, sd + 0.011);
        boxAt('', IRON, k, a, 0.23, y - 0.015, y + 0.02, 0.145, 0.375); // base
        boxAt('', IRON, k, a, 0.07, y - 0.06, y - 0.015, 0.225, 0.295);
      };
      const trim = shade(zone.wall, 0.78);
      const frame = shade(zone.wall, 1.12);
      const paint = shade(zone.accent, 0.8);
      const paintDark = shade(zone.accent, 0.58);
      /** Shop awning: striped canopy on an iron frame with side cheeks, stays to the wall and a scalloped valance. */
      const awning = (k: number, width: number, yWall: number, yFront: number, reach: number) => {
        const w = width / 2;
        const len = Math.hypot(reach, yWall - yFront);
        const up: [number, number, number] = [(dc * (yWall - yFront)) / len, reach / len, (-dr * (yWall - yFront)) / len];
        const stripes = 6;
        const sw = width / stripes;
        const cream = '#efe6d2';
        for (let i = 0; i < stripes; i++) {
          const a0 = -w + i * sw;
          const a1 = a0 + sw;
          const color = i % 2 ? cream : paint;
          panel(color, [P(k, a0, yWall, 0.02), P(k, a1, yWall, 0.02), P(k, a1, yFront, reach), P(k, a0, yFront, reach)], up, 0.72);
          // valance: a hanging flap per stripe, cut to a point
          const mid = (a0 + a1) / 2;
          panel(color, [P(k, a0, yFront, reach), P(k, a1, yFront, reach), P(k, a1, yFront - 0.14, reach), P(k, a0, yFront - 0.14, reach)], out, 0.8);
          panel(color, [P(k, a0, yFront - 0.14, reach), P(k, a1, yFront - 0.14, reach), P(k, mid, yFront - 0.26, reach), P(k, mid, yFront - 0.26, reach)], out, 0.8);
        }
        for (const sa of [-w, w]) {
          // closed triangular cheek at each end
          panel(paintDark, [P(k, sa, yFront, 0.02), P(k, sa, yFront, reach), P(k, sa, yWall, 0.02), P(k, sa, yWall, 0.02)], side, 0.9);
          // iron stay from the wall up to the front rail
          const inset = sa < 0 ? sa + 0.05 : sa - 0.05;
          panel(IRON, [P(k, inset, yFront - 0.5, 0.02), P(k, inset, yFront - 0.02, reach - 0.03), P(k, inset, yFront + 0.02, reach - 0.03), P(k, inset, yFront - 0.44, 0.02)], side, 1);
          boxAt('', IRON, k, inset, 0.07, yFront - 0.58, yFront - 0.38, 0, 0.035); // wall shoe
        }
        boxAt('', IRON, k, 0, width + 0.04, yFront - 0.02, yFront + 0.025, reach - 0.035, reach + 0.01); // front rail
        boxAt('', IRON, k, 0, width + 0.04, yWall - 0.03, yWall + 0.05, 0, 0.05); // head rail on the wall
      };
      // pilasters at the run ends and every 3 cells
      for (let k = k0; k <= k1 + 1; k += 3) {
        const kk = Math.min(k, k1);
        const off = k > k1 ? 1 : -1;
        const top = cellTop[cellR(kk) * cols + cellC(kk)];
        // pilaster: plinth, shaft and a stepped capital under the eave
        const pa = off * (half - 0.02);
        box('', trim, kk, pa, 0.42, 0.5, top - 0.42, 0.09);
        box('', shade(zone.wall, 0.7), kk, pa, 0.52, 0, 0.5, 0.13);
        box('', trim, kk, pa, 0.47, 0.5, 0.58, 0.11);
        box('', trim, kk, pa, 0.5, top - 0.42, top - 0.28, 0.12);
        box('', shade(zone.wall, 0.88), kk, pa, 0.58, top - 0.28, top - 0.1, 0.16);
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
        else if (roll < 0.8) lantern(kd, 0, 3.0);
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
            box('', '#5f4534', k, 0, 1.26, 3.77, 3.82, 0.27); // rim
            // planting: tufts of uneven height and depth, some carrying a bloom
            for (let f = 0; f < 7; f++) {
              const fa = -0.48 + f * 0.16;
              const fh = 0.12 + h01(f, k, seed + 17) * 0.2;
              const fd = 0.06 + h01(k, f, seed + 19) * 0.06;
              boxAt('', f % 2 ? '#4f7d3c' : '#3f6b33', k, fa, 0.17, 3.8, 3.8 + fh, fd, fd + 0.15);
              if (h01(f, line, seed + 23) < 0.6) boxAt('', f % 3 === 0 ? '#e8c85a' : f % 3 === 1 ? paint : '#f2efe6', k, fa, 0.09, 3.8 + fh, 3.8 + fh + 0.07, fd + 0.03, fd + 0.12);
            }
          }
          if (h01(line, k, seed + 11) < 0.6) {
            // shutters folded back against the wall
            box(`facade-door-${paint}`, paint, k, -0.92, 0.5, 3.6, 4.9, 0.045);
            box(`facade-door-${paint}`, paint, k, 0.92, 0.5, 3.6, 4.9, 0.045);
          }
        } else if (roll > 0.86) {
          lantern(k, 0, 2.95);
        } else if (kit.wallUnits && roll > 0.74 && top >= 5.2) {
          // wall-mounted cooling unit with a pipe run up to the roof
          // wall-mounted condenser: brackets, casing with a top lip, a round fan behind a guard, louvres and a pipe run
          for (const sa of [-0.34, 0.34]) {
            boxAt('', '#4b5257', k, sa, 0.05, 3.42, 3.5, 0, 0.36);
            panel('#4b5257', [P(k, sa, 3.1, 0.01), P(k, sa, 3.42, 0.3), P(k, sa, 3.46, 0.3), P(k, sa, 3.16, 0.01)], side, 1);
          }
          boxAt('', '#c9cdd0', k, 0, 0.95, 3.5, 4.12, 0.02, 0.34);
          boxAt('', '#aeb3b7', k, 0, 0.99, 4.12, 4.16, 0, 0.36);
          const fa = -0.17;
          const fy = 3.81;
          const ring = (r0: number, r1: number, color: string, d: number) => {
            for (let i = 0; i < 12; i++) {
              const t0 = (i / 12) * Math.PI * 2;
              const t1 = ((i + 1) / 12) * Math.PI * 2;
              batch('', color).quad(
                [P(k, fa + Math.cos(t0) * r0, fy + Math.sin(t0) * r0, d), P(k, fa + Math.cos(t1) * r0, fy + Math.sin(t1) * r0, d), P(k, fa + Math.cos(t1) * r1, fy + Math.sin(t1) * r1, d), P(k, fa + Math.cos(t0) * r1, fy + Math.sin(t0) * r1, d)],
                out,
                [[0, 0], [1, 0], [1, 1], [0, 1]],
              );
            }
          };
          ring(0, 0.25, '#23282c', 0.343); // fan well
          ring(0.25, 0.28, '#8e9499', 0.346); // guard rim
          ring(0, 0.06, '#8e9499', 0.348); // hub
          for (let i = 0; i < 4; i++) {
            const t = (i / 4) * Math.PI;
            boxAt('', '#8e9499', k, fa, Math.abs(Math.cos(t)) * 0.5 + 0.014, fy - Math.abs(Math.sin(t)) * 0.25 - 0.007, fy + Math.abs(Math.sin(t)) * 0.25 + 0.007, 0.346, 0.352);
          }
          for (let i = 0; i < 5; i++) boxAt('', '#8e9499', k, 0.3, 0.24, 3.6 + i * 0.1, 3.64 + i * 0.1, 0.34, 0.352); // louvres
          boxAt('', '#8d9499', k, 0.4, 0.06, 4.16, top - 0.2, 0.02, 0.08);
          boxAt('', '#6f767b', k, 0.4, 0.1, 4.6, 4.66, 0, 0.1);
        }
      }
    }
  }
}


/**
 * Roof on top of a full-height wall mass (visual only, above the 6 m sight-line ceiling):
 * an overhanging eave slab, then either a pitched tiled roof or a flat roof with a parapet lip.
 */
/** Narrower than this, a wall gets a low coping instead of a full roof with deep eaves (metres). */
const COPING_WIDTH = 3.2;

function addRoof(box: MapBox, style: 'tile' | 'flat', roof: GeometryBatch, eave: GeometryBatch, allowCoping = true) {
  const y = box.max[1];
  const flatUv = { kind: 'box' as const, tile: 2, vTile: 2 };
  if (style === 'flat') {
    // parapet: a band round the wall head with a capping course on top
    const o = 0.1;
    eave.box([box.min[0] - o, y - 0.3, box.min[2] - o], [box.max[0] + o, y + 0.22, box.max[2] + o], flatUv, false, roof, 2);
    eave.box([box.min[0] - o - 0.06, y - 0.36, box.min[2] - o - 0.06], [box.max[0] + o + 0.06, y - 0.3, box.max[2] + o + 0.06], flatUv, false);
    return;
  }
  const coping = allowCoping && Math.min(box.max[0] - box.min[0], box.max[2] - box.min[2]) < COPING_WIDTH;
  const o = coping ? 0.13 : 0.38;
  const x0 = box.min[0] - o;
  const x1 = box.max[0] + o;
  const z0 = box.min[2] - o;
  const z1 = box.max[2] + o;
  const e = y + (coping ? 0.07 : 0.14);
  eave.box([x0, y - (coping ? 0.05 : 0.1), z0], [x1, e, z1], flatUv, false);
  if (!coping) {
    // a fascia board under the eave, so the roof edge has depth instead of ending in a thin slab
    const f = 0.22;
    eave.box([box.min[0] - f, y - 0.24, box.min[2] - f], [box.max[0] + f, y - 0.1, box.max[2] + f], flatUv, false);
  }
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
      addRoof({ min: [x - h, 0, z - h], max: [x + h, top, z + h], kind: 'wall', zone: zoneId }, style, roof, detail('', trim), false);
    /** Round section in a flat colour (or glowing, with `emissive`). */
    const round = (color: string, y0: number, y1: number, r0: number, r1 = r0, emissive?: string, key = '') =>
      detail(key, color, emissive).tube(x, z, y0, y1, r0, r1);
    /** Solid round slab: side wall plus top and underside. */
    const slab = (color: string, y0: number, y1: number, r: number, inner = 0) => {
      const b = detail('', color);
      b.tube(x, z, y0, y1, r, r);
      b.disc(x, z, y1, r, inner, true);
      b.disc(x, z, y0, r, inner, false);
    };
    /** Ring of evenly spaced upright posts at radius r. */
    const posts = (color: string, n: number, r: number, y0: number, y1: number, w: number) => {
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        const px = x + Math.cos(t) * r;
        const pz = z + Math.sin(t) * r;
        detail('', color).box([px - w / 2, y0, pz - w / 2], [px + w / 2, y1, pz + w / 2], FLAT_UV, false);
      }
    };
    const beacon = (top: number, bx = x, bz = z) => {
      detail('', '#5b6166').tube(bx, bz, top, top + 3, 0.06, 0.035, 10);
      detail('landmark-light', '#ff5a4a', '#d8402f').dome(bx, bz, top + 3, 0.15, 0.2, 4, 12);
      detail('landmark-light', '#ff5a4a', '#d8402f').tube(bx, bz, top + 2.92, top + 3, 0.15, 0.15, 12);
    };
    const strut = (color: string, a: number[], b: number[], w: number) => detail('', color).strut(a, b, w);
    const blockAt = (color: string, min: number[], max: number[], emissive?: string, key = '') => detail(key, color, emissive).box(min, max, FLAT_UV, false);
    /** The four compass directions a square landmark faces. */
    const FACES: ['x' | 'z', number][] = [['x', 1], ['x', -1], ['z', 1], ['z', -1]];
    /** Point on a square landmark's face: `out` from the axis, `along` the face, at height yy. */
    const onFace = (axis: 'x' | 'z', sign: number, out: number, along: number, yy: number) =>
      axis === 'x' ? [x + sign * out, yy, z + along] : [x + along, yy, z + sign * out];
    /** Box on a face: from `out0` to `out1` off the axis, `width` wide about `along`. */
    const faceBox = (color: string, axis: 'x' | 'z', sign: number, out0: number, out1: number, along: number, width: number, y0: number, y1: number, emissive?: string, key = '') => {
      const p = onFace(axis, sign, out0, along - width / 2, y0);
      const q = onFace(axis, sign, out1, along + width / 2, y1);
      blockAt(color, [Math.min(p[0], q[0]), y0, Math.min(p[2], q[2])], [Math.max(p[0], q[0]), y1, Math.max(p[2], q[2])], emissive, key);
    };
    // which way the site lies, as a face
    const toSite: ['x' | 'z', number] = Math.abs(sx - x) >= Math.abs(sz - z) ? ['x', sx >= x ? 1 : -1] : ['z', sz >= z ? 1 : -1];
    const GOLD = '#d9b25a';

    switch (kit.landmark) {
      case 'tower': {
        // bell tower: banded shaft with a clock on every side, an arcaded belfry with a bell, a pyramid roof
        const h = 1.7;
        const shaftTop = y + (tall ? 8.5 : 6.5);
        wallBlock(h, y - 0.5, shaftTop);
        flatBlock(trim, h + 0.1, y + 2.2, y + 2.4);
        flatBlock(light, h + 0.16, y + 2.4, y + 2.5);
        for (const cx of [-1, 1])
          for (const cz of [-1, 1]) blockAt(light, [x + cx * h - 0.2, y - 0.5, z + cz * h - 0.2], [x + cx * h + 0.2, shaftTop, z + cz * h + 0.2]); // corner quoins
        const cy = shaftTop - 1.75;
        for (const [axis, sign] of FACES) {
          const c = onFace(axis, sign, h + 0.03, 0, cy);
          detail('', '#f3eee2').ringV(c, axis, sign, 0.8);
          detail('', '#2b2825').ringV(onFace(axis, sign, h + 0.04, 0, cy), axis, sign, 0.92, 0.8);
          for (let i = 0; i < 12; i++) {
            const t = (i / 12) * Math.PI * 2;
            faceBox('#2b2825', axis, sign, h + 0.03, h + 0.05, Math.cos(t) * 0.68, 0.06, cy + Math.sin(t) * 0.68 - 0.03, cy + Math.sin(t) * 0.68 + 0.03);
          }
          faceBox('#2b2825', axis, sign, h + 0.03, h + 0.07, 0, 0.07, cy - 0.05, cy + 0.5); // hour hand
          faceBox('#2b2825', axis, sign, h + 0.03, h + 0.07, 0.3, 0.68, cy - 0.035, cy + 0.035); // minute hand
          faceBox(GOLD, axis, sign, h + 0.03, h + 0.09, 0, 0.12, cy - 0.06, cy + 0.06);
        }
        flatBlock(zone.accent, h + 0.21, shaftTop - 0.5, shaftTop - 0.25);
        flatBlock(trim, h + 0.24, shaftTop, shaftTop + 0.15);
        flatBlock(light, h + 0.36, shaftTop + 0.15, shaftTop + 0.32);
        const top = shaftTop + 0.32;
        flatBlock('#1c1815', h - 0.5, top, top + 2.4);
        for (const cx of [-1, 1])
          for (const cz of [-1, 1]) blockAt(light, [x + cx * (h - 0.36) - 0.36, top, z + cz * (h - 0.36) - 0.36], [x + cx * (h - 0.36) + 0.36, top + 2.4, z + cz * (h - 0.36) + 0.36]);
        for (const [axis, sign] of FACES) {
          faceBox(trim, axis, sign, h - 0.3, h - 0.12, 0, 2 * h - 1.44, top, top + 0.55); // balustrade
          faceBox(light, axis, sign, h - 0.4, h, 0, 2 * h - 1.44, top + 2.0, top + 2.4); // arch head
          for (const sgn of [-1, 1]) {
            faceBox(light, axis, sign, h - 0.4, h, sgn * (h - 0.9), 0.36, top + 1.7, top + 2.0); // arch shoulders
            faceBox(light, axis, sign, h - 0.4, h, sgn * (h - 1.12), 0.2, top + 1.85, top + 2.0);
          }
        }
        // the bell
        blockAt('#3a2f26', [x - h + 0.6, top + 1.78, z - 0.07], [x + h - 0.6, top + 1.92, z + 0.07]);
        round('#3a2f26', top + 1.5, top + 1.8, 0.07);
        detail('', GOLD).dome(x, z, top + 1.1, 0.5, 0.42);
        round(GOLD, top + 0.62, top + 1.1, 0.66, 0.5);
        round(GOLD, top + 0.55, top + 0.62, 0.72, 0.66);
        detail('', '#8a6f33').disc(x, z, top + 0.56, 0.7, 0, false);
        round('#2b2825', top + 0.42, top + 0.6, 0.07, 0.07, undefined, '');
        flatBlock(trim, h + 0.2, top + 2.4, top + 2.52);
        flatBlock(light, h + 0.3, top + 2.52, top + 2.64);
        roofOn(h, top + 2.64, 'tile');
        const apex = top + 2.64 + 0.14 + Math.min(2.4, (h + 0.38) * 0.55);
        round(GOLD, apex - 0.12, apex + 0.1, 0.12, 0.06);
        detail('', GOLD).dome(x, z, apex + 0.2, 0.14, 0.14, 4, 12);
        round(GOLD, apex + 0.06, apex + 0.2, 0.06, 0.14);
        round(GOLD, apex + 0.34, apex + 1.1, 0.03, 0.012);
        break;
      }
      case 'minaret': {
        // round shaft on a square plinth, a balcony on a flared corbel, an arcaded upper stage and a dome
        const base = y + (tall ? 9 : 7);
        flatBlock(trim, 1.35, y - 0.4, y + 0.9);
        flatBlock(light, 1.42, y + 0.9, y + 1.05);
        round(zone.wall, y + 1.05, base - 0.5, 1.12, 0.95);
        for (const by of [y + 3.2, base - 2.2]) round(trim, by, by + 0.16, 1.1, 1.08);
        round(zone.accent, base - 1.5, base - 1.1, 1.0, 0.99);
        round(trim, base - 0.5, base, 0.95, 1.6); // corbel flaring out under the balcony
        slab(light, base, base + 0.14, 1.68);
        posts(trim, 14, 1.58, base + 0.14, base + 0.72, 0.07);
        round(trim, base + 0.72, base + 0.8, 1.62, 1.62);
        detail('', trim).disc(x, z, base + 0.8, 1.62, 1.54, true);
        // arcade: dark openings between piers
        round('#221d1a', base + 0.14, base + 2.6, 0.72);
        posts(light, 8, 0.78, base + 0.14, base + 2.6, 0.2);
        slab(trim, base + 2.6, base + 2.85, 0.98);
        round(light, base + 2.85, base + 3.15, 0.82, 0.86);
        detail('', zone.accent).dome(x, z, base + 3.15, 0.9, 1.15);
        round('#d9b25a', base + 4.25, base + 4.45, 0.09, 0.05);
        round('#d9b25a', base + 4.45, base + 5.5, 0.035, 0.015);
        detail('', '#d9b25a').dome(x, z, base + 4.7, 0.11, 0.11, 3, 10);
        break;
      }
      case 'pagoda': {
        // stacked storeys, each smaller than the last: columns, a railed balcony, bracketed eaves with
        // upturned corners, and a ringed spire
        let floor = y - 0.3;
        const tiers = tall ? [1.7, 1.35, 1.0, 0.7] : [1.7, 1.3, 0.9];
        const red = shade(zone.accent, 0.85);
        for (const h of tiers) {
          flatBlock(trim, h + 0.34, floor - 0.1, floor + 0.04); // balcony deck
          wallBlock(h - 0.16, floor, floor + 2.3);
          for (const cx of [-1, 1])
            for (const cz of [-1, 1]) {
              detail('', red).tube(x + cx * (h - 0.06), z + cz * (h - 0.06), floor + 0.04, floor + 2.1, 0.1, 0.1, 12);
              blockAt(red, [x + cx * (h + 0.28) - 0.04, floor + 0.04, z + cz * (h + 0.28) - 0.04], [x + cx * (h + 0.28) + 0.04, floor + 0.6, z + cz * (h + 0.28) + 0.04]);
            }
          for (const [axis, sign] of FACES) {
            faceBox(red, axis, sign, h + 0.25, h + 0.31, 0, 2 * (h + 0.28), floor + 0.5, floor + 0.56); // handrail
            faceBox(red, axis, sign, h + 0.26, h + 0.3, 0, 2 * (h + 0.28), floor + 0.26, floor + 0.3);
            faceBox('#2a2420', axis, sign, h - 0.16, h - 0.14, 0, 0.6, floor + 0.04, floor + 1.5); // doorway
          }
          flatBlock(red, h + 0.02, floor + 2.02, floor + 2.14); // beam
          flatBlock(GOLD, h + 0.1, floor + 2.14, floor + 2.3); // bracket course
          roofOn(h, floor + 2.3, 'tile');
          const e = floor + 2.3 + 0.14;
          for (const cx of [-1, 1])
            for (const cz of [-1, 1]) {
              const ex = x + cx * (h + 0.34);
              const ez = z + cz * (h + 0.34);
              strut(GOLD, [ex, e - 0.04, ez], [ex + cx * 0.3, e + 0.24, ez + cz * 0.3], 0.09); // upturned corner
              if (cx === cz) detail('landmark-lamp', '#fff4c4', '#f0cf6a').tube(ex + cx * 0.24, ez + cz * 0.24, e - 0.34, e - 0.08, 0.07, 0.07, 8);
            }
          floor += 2.3 + 0.14 + Math.min(2.4, (h + 0.38) * 0.55) * 0.45;
        }
        // spire: a pole carrying a stack of rings and a ball
        const tip = floor + 0.2;
        round(GOLD, tip - 0.5, tip + 2.9, 0.06, 0.03);
        for (let i = 0; i < 6; i++) slab(GOLD, tip + 0.35 + i * 0.34, tip + 0.41 + i * 0.34, 0.34 - i * 0.04);
        detail('', GOLD).dome(x, z, tip + 2.9, 0.1, 0.12, 4, 12);
        break;
      }
      case 'sign': {
        // office block: window bands on every floor (some lit), a framed neon sign on each side,
        // and rooftop plant with a mast
        const h = 1.5;
        const top = y + (tall ? 10 : 8);
        wallBlock(h, y - 0.5, top);
        const glow = shade(zone.accent, 0.75);
        const neon = `landmark-neon-${zone.accent}`;
        let fi = 0;
        for (const [axis, sign] of FACES) {
          for (let fy = y + 0.9; fy + 1.1 < top; fy += 1.6) {
            for (const side of [-1, 1]) {
              const lit = h01(Math.round(fy * 10), fi++, index + 5) < 0.3;
              faceBox(lit ? '#ffe9b0' : '#1f2a36', axis, sign, h, h + 0.02, side * 1.02, 0.72, fy, fy + 1.0, lit ? '#d9b46a' : '#0b121a', lit ? 'landmark-window-lit' : 'landmark-window');
              faceBox(trim, axis, sign, h, h + 0.05, side * 1.02, 0.84, fy - 0.07, fy); // sill
              faceBox(trim, axis, sign, h, h + 0.04, side * 1.02, 0.05, fy, fy + 1.0); // mullion
            }
          }
          // sign: dark backing board with a glowing strip and end caps
          faceBox('#16191d', axis, sign, h, h + 0.1, 0, 0.72, y + 1.3, top - 0.7);
          faceBox(zone.accent, axis, sign, h + 0.1, h + 0.16, 0, 0.44, y + 1.5, top - 0.9, glow, neon);
          for (const yy of [y + 1.3, top - 0.78]) faceBox('#3a4046', axis, sign, h, h + 0.2, 0, 0.8, yy, yy + 0.08);
        }
        flatBlock(trim, h + 0.14, top - 0.1, top + 0.45); // parapet
        flatBlock('#3a4046', h + 0.2, top + 0.45, top + 0.53);
        // rooftop plant: a round tank, a vent stack and a housing
        detail('', '#aeb3b7').tube(x - 0.6, z - 0.55, top + 0.4, top + 1.45, 0.48, 0.48, 16);
        detail('', '#8e9499').tube(x - 0.6, z - 0.55, top + 1.45, top + 1.7, 0.48, 0.05, 16);
        blockAt('#c9cdd0', [x + 0.2, top + 0.4, z - 1.0], [x + 1.0, top + 1.05, z - 0.2]);
        detail('', '#6f767b').tube(x + 0.75, z + 0.7, top + 0.4, top + 1.6, 0.14, 0.14, 12);
        detail('', '#4b5257').tube(x + 0.75, z + 0.7, top + 1.6, top + 1.72, 0.2, 0.2, 12);
        beacon(top + 0.45, x - 0.2, z + 0.5);
        strut('#5b6166', [x - 0.6, top + 2.2, z + 0.5], [x + 0.2, top + 2.2, z + 0.5], 0.04);
        strut('#5b6166', [x - 0.45, top + 2.8, z + 0.5], [x + 0.05, top + 2.8, z + 0.5], 0.04);
        break;
      }
      case 'watertank': {
        // rooftop water tank: braced legs, a round deck, a staved barrel with iron hoops and a conical lid
        const legs = y + (tall ? 3.6 : 2.8);
        const steel = '#4a4641';
        for (const px of [x - 1.0, x + 0.84])
          for (const pz of [z - 1.0, z + 0.84]) detail('', steel).box([px, y - 0.2, pz], [px + 0.16, legs, pz + 0.16], FLAT_UV);
        for (const by of [y + 0.9, legs - 0.6]) {
          detail('', steel).box([x - 1.0, by, z - 1.0], [x + 1.0, by + 0.08, z - 0.92], FLAT_UV, false);
          detail('', steel).box([x - 1.0, by, z + 0.92], [x + 1.0, by + 0.08, z + 1.0], FLAT_UV, false);
          detail('', steel).box([x - 1.0, by, z - 1.0], [x - 0.92, by + 0.08, z + 1.0], FLAT_UV, false);
          detail('', steel).box([x + 0.92, by, z - 1.0], [x + 1.0, by + 0.08, z + 1.0], FLAT_UV, false);
        }
        slab(steel, legs, legs + 0.14, 1.55);
        // staves: alternate two wood tones round the barrel
        const wood = ['#8a6a4c', '#7b5d42'];
        const staves = 24;
        for (let i = 0; i < staves; i++) {
          const t0 = (i / staves) * Math.PI * 2;
          const t1 = ((i + 1) / staves) * Math.PI * 2;
          const r = 1.32;
          const n0 = [Math.cos(t0), 0, Math.sin(t0)];
          const n1 = [Math.cos(t1), 0, Math.sin(t1)];
          detail('', wood[i % 2]).quad(
            [
              [x + n0[0] * r, legs + 0.14, z + n0[2] * r],
              [x + n1[0] * r, legs + 0.14, z + n1[2] * r],
              [x + n1[0] * r, legs + 3.1, z + n1[2] * r],
              [x + n0[0] * r, legs + 3.1, z + n0[2] * r],
            ],
            [Math.cos((t0 + t1) / 2), 0, Math.sin((t0 + t1) / 2)],
            [[0, 0], [1, 0], [1, 1], [0, 1]],
            undefined,
            [n0, n1, n1, n0],
          );
        }
        for (const hy of [0.5, 1.5, 2.6]) round('#3a3632', legs + hy, legs + hy + 0.09, 1.345);
        round(zone.accent, legs + 0.95, legs + 1.3, 1.335);
        detail('', '#5f4a36').disc(x, z, legs + 3.1, 1.5, 0, false);
        round(kit.roofColor, legs + 3.1, legs + 4.1, 1.5, 0.06);
        round(steel, legs + 4.05, legs + 4.45, 0.05, 0.02);
        // overflow pipe down one leg
        detail('', '#6f767b').box([x + 1.33, y - 0.2, z - 0.05], [x + 1.41, legs + 1.2, z + 0.05], FLAT_UV, false);
        break;
      }
      case 'ziggurat': {
        // stepped pyramid with sloping faces, a stair up the side facing the site and a pillared shrine on top
        const steps = tall ? [1.7, 1.38, 1.06, 0.74] : [1.7, 1.3, 0.9];
        const stone = zone.wall;
        const R2 = Math.SQRT2;
        const tierH = 1.7;
        let floor = y - 0.3;
        const [axis, sign] = toSite;
        steps.forEach((h, i) => {
          // battered tier: wider at the foot than at the top
          detail('', i % 2 ? shade(stone, 0.93) : stone).tube(x, z, floor, floor + tierH, h * R2, (h - 0.16) * R2, 4, Math.PI / 4, true);
          flatBlock(trim, h - 0.1, floor + tierH, floor + tierH + 0.12);
          if (i === 1) flatBlock(zone.accent, h - 0.02, floor + tierH - 0.5, floor + tierH - 0.3);
          // stair: treads climbing from this tier's foot to the next tier's foot
          const inner = (steps[i + 1] ?? h - 0.5) + 0.02;
          const outer = h + 0.55;
          const treads = 6;
          for (let t = 0; t < treads; t++) {
            const d1 = outer - ((outer - inner) * t) / treads;
            faceBox(shade(stone, 1.06), axis, sign, inner - 0.05, d1, 0, 0.86, floor, floor + ((tierH + 0.12) * (t + 1)) / treads);
          }
          for (const sd of [-1, 1]) faceBox(trim, axis, sign, inner - 0.05, outer + 0.05, sd * 0.53, 0.2, floor, floor + 0.45); // stair cheeks
          floor += tierH + 0.12;
        });
        const top = steps[steps.length - 1] - 0.16;
        flatBlock('#1b1d18', top - 0.24, floor, floor + 1.45);
        for (const cx of [-1, 1])
          for (const cz of [-1, 1]) detail('', light).tube(x + cx * (top - 0.14), z + cz * (top - 0.14), floor, floor + 1.45, 0.11, 0.09, 12);
        flatBlock(trim, top + 0.06, floor + 1.45, floor + 1.7);
        flatBlock(zone.accent, top - 0.02, floor + 1.7, floor + 1.82);
        // roof comb: a tall crest with notches
        flatBlock(stone, 0.5, floor + 1.82, floor + 2.3);
        for (const cx of [-0.34, 0, 0.34]) blockAt(shade(stone, 0.9), [x + cx - 0.1, floor + 2.3, z - 0.14], [x + cx + 0.1, floor + 2.75, z + 0.14]);
        break;
      }
      case 'crane': {
        // tower crane: braced lattice mast on a concrete base, slewing ring and cab, a trussed jib
        // towards the site, a counter-jib with weights, tie rods, a trolley and a hook
        const paint = '#e0a12a';
        const steel = '#39424c';
        const top = y + (tall ? 15 : 12);
        const m = 0.75;
        flatBlock('#9a9d9f', 1.35, y - 0.3, y + 0.35);
        const corners: [number, number][] = [[-m, -m], [m, -m], [m, m], [-m, m]];
        for (const [cx, cz] of corners) strut(paint, [x + cx, y + 0.35, z + cz], [x + cx, top, z + cz], 0.15);
        const bay = 1.6;
        let flip = false;
        for (let by = y + 0.35; by < top - 0.2; by += bay) {
          const b1 = Math.min(top, by + bay);
          for (let i = 0; i < 4; i++) {
            const [ax, az] = corners[i];
            const [bx, bz] = corners[(i + 1) % 4];
            strut(paint, [x + ax, b1, z + az], [x + bx, b1, z + bz], 0.08); // ring
            strut(paint, flip ? [x + ax, by, z + az] : [x + bx, by, z + bz], flip ? [x + bx, b1, z + bz] : [x + ax, b1, z + az], 0.06); // diagonal
          }
          flip = !flip;
        }
        slab(steel, top, top + 0.3, 1.15);
        const [axis, sign] = toSite;
        /** Point in the jib's frame: `a` metres out towards the site, `l` sideways, height yy. */
        const J = (a: number, l: number, yy: number) => onFace(axis, sign, a, l, yy);
        const jib = top + 0.3;
        // cab beside the mast, glazed towards the site
        faceBox('#d7dade', axis, sign, 0.2, 1.5, -1.25, 1.0, jib, jib + 1.5);
        faceBox('#1f2a36', axis, sign, 1.5, 1.52, -1.25, 0.8, jib + 0.6, jib + 1.35, '#0b121a', 'landmark-window');
        // tower head
        const apex = [x, jib + 4.2, z];
        for (const [cx, cz] of corners) strut(paint, [x + cx * 0.8, jib, z + cz * 0.8], apex, 0.1);
        // jib: triangular truss (two bottom chords, one top chord, zig-zag bracing)
        const L = 14;
        const jw = 0.38;
        const jh = 0.95;
        for (const l of [-jw, jw]) strut(paint, J(-0.6, l, jib + 0.25), J(L, l, jib + 0.25), 0.1);
        strut(paint, J(-0.6, 0, jib + 0.25 + jh), J(L - 0.6, 0, jib + 0.25 + jh), 0.1);
        strut(paint, J(L - 0.6, 0, jib + 0.25 + jh), J(L, 0, jib + 0.25), 0.08);
        const panelLen = 1.3;
        for (let a = 0; a + panelLen <= L - 0.5; a += panelLen) {
          for (const l of [-jw, jw]) {
            strut(paint, J(a, l, jib + 0.25), J(a + panelLen / 2, 0, jib + 0.25 + jh), 0.05);
            strut(paint, J(a + panelLen / 2, 0, jib + 0.25 + jh), J(a + panelLen, l, jib + 0.25), 0.05);
          }
          strut(paint, J(a, -jw, jib + 0.25), J(a, jw, jib + 0.25), 0.05);
        }
        // counter-jib with a walkway and concrete weights
        const C = 5;
        for (const l of [-jw, jw]) strut(paint, J(-0.6, l, jib + 0.25), J(-C, l, jib + 0.25), 0.1);
        faceBox(steel, axis, sign, -C, -0.8, 0, 2 * jw, jib + 0.2, jib + 0.26);
        for (let i = 0; i < 3; i++) faceBox('#9a9d9f', axis, sign, -C + 0.1 + i * 0.5, -C + 0.5 + i * 0.5, 0, 0.9, jib - 0.75, jib + 0.2);
        // tie rods from the tower head
        strut(steel, apex, J(L * 0.62, 0, jib + 0.25 + jh), 0.05);
        strut(steel, apex, J(-C + 0.3, 0, jib + 0.3), 0.05);
        // trolley, hoist rope and hook block
        const ta = L * 0.6;
        faceBox(steel, axis, sign, ta - 0.4, ta + 0.4, 0, 0.9, jib + 0.02, jib + 0.2);
        const hookY = jib - 5;
        for (const l of [-0.12, 0.12]) strut('#22262a', J(ta, l, jib + 0.02), J(ta, l, hookY + 0.5), 0.025);
        faceBox(paint, axis, sign, ta - 0.22, ta + 0.22, 0, 0.36, hookY + 0.1, hookY + 0.5);
        strut('#22262a', J(ta, 0, hookY + 0.1), J(ta, 0, hookY - 0.2), 0.05);
        strut('#22262a', J(ta, 0, hookY - 0.2), J(ta + 0.16, 0, hookY - 0.28), 0.05);
        strut('#22262a', J(ta + 0.16, 0, hookY - 0.28), J(ta + 0.2, 0, hookY - 0.08), 0.05);
        beacon(jib + 4.2 - 2.4);
        break;
      }
      case 'lighthouse': {
        // round tapering tower in bands of white and the site's colour, a railed gallery,
        // a glazed lantern room with a lit lamp, and a conical roof
        const bands = tall ? 6 : 5;
        const bandH = 1.75;
        const r0 = 1.6;
        const r1 = 1.02;
        const foot = y - 0.3;
        const neck = foot + 0.7 + bands * bandH;
        const radius = (yy: number) => r0 + ((r1 - r0) * (yy - (foot + 0.7))) / (bands * bandH);
        const white = '#f1ece0';
        const iron = '#30363c';
        round('#8f8a80', foot, foot + 0.7, r0 + 0.22, r0 + 0.12); // stone footing
        detail('', '#8f8a80').disc(x, z, foot + 0.7, r0 + 0.12, r0 - 0.05, true);
        for (let i = 0; i < bands; i++) {
          const a0 = foot + 0.7 + i * bandH;
          round(i % 2 ? zone.accent : white, a0, a0 + bandH, radius(a0), radius(a0 + bandH));
        }
        // door at the foot and slit windows up the tower, facing the site
        const fx = (sx - x) / (best.d || 1);
        const fz = (sz - z) / (best.d || 1);
        const opening = (yy: number, w: number, h: number) => {
          const r = radius(yy) + 0.015;
          const px = x + fx * r;
          const pz = z + fz * r;
          detail('', '#1d2228').box([px - w / 2 - Math.abs(fx) * 0.04, yy, pz - w / 2 - Math.abs(fz) * 0.04], [px + w / 2 + Math.abs(fx) * 0.04, yy + h, pz + w / 2 + Math.abs(fz) * 0.04], FLAT_UV, false);
        };
        opening(foot + 0.7, 0.7, 1.5);
        for (let i = 1; i < bands; i++) opening(foot + 0.7 + i * bandH + 0.5, 0.26, 0.7);
        // gallery: flared corbel, deck and railing
        round(white, neck, neck + 0.4, r1, 1.55);
        slab(iron, neck + 0.4, neck + 0.52, 1.66);
        posts(iron, 16, 1.58, neck + 0.52, neck + 1.12, 0.05);
        round(iron, neck + 1.1, neck + 1.16, 1.6);
        round(iron, neck + 0.8, neck + 0.83, 1.59);
        // lantern room
        round(iron, neck + 0.52, neck + 0.9, 0.86);
        round('#fff4c4', neck + 0.9, neck + 2.05, 0.8, 0.8, '#f0cf6a', 'landmark-lamp');
        posts(iron, 8, 0.82, neck + 0.9, neck + 2.05, 0.06);
        round(iron, neck + 1.45, neck + 1.49, 0.83);
        slab(iron, neck + 2.05, neck + 2.17, 1.02);
        round(zone.accent, neck + 2.17, neck + 3.05, 1.02, 0.12);
        detail('', iron).dome(x, z, neck + 3.0, 0.16, 0.16, 3, 10);
        round(iron, neck + 3.1, neck + 3.75, 0.03, 0.012);
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
