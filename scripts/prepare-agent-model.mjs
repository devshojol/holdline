/**
 * Prepare a Sketchfab Valorant agent GLB for use as a character model (public/models/miks.glb,
 * public/models/agents/*.glb).
 *
 * Run from a scratch folder that has the tools installed:
 *   npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer sharp
 *   node prepare-agent-model.mjs <downloaded.glb> <out.glb> [triangle ratio = 0.5] [eyes-from.glb]
 * then run scripts/compress-models.mjs over public/models.
 *
 * Steps:
 *  - materials converted to metal/roughness, mesh welded and simplified, textures resized to 1024 px WebP;
 *  - the game rig (hundreds of face, finger, twist and cloth joints) collapsed to the joints the bot
 *    posing uses (src/game/bots/AgentVisual.ts). Joints are matched by name without the numeric
 *    suffix the exporter adds, so any agent on the same rig works. In these assets the rest pose
 *    equals the bind pose, so moving a removed joint's skin weights onto its nearest kept ancestor
 *    leaves the rest shape unchanged. The bind matrices are rebuilt from the rest pose.
 *  - a model without eyeball joints (a masked agent) gets two plain eye nodes under the head, copied
 *    from another agent on the same rig (the 4th argument): the game measures height and facing from them.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, metalRough, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [, , input, output, ratioArg, eyesFrom] = process.argv;
if (!input || !output) throw new Error('usage: node prepare-agent-model.mjs <in.glb> <out.glb> [ratio]');
const ratio = Number(ratioArg ?? 0.5);

/**
 * Joint name without the exporter's numeric suffix ("L_Hand_0201" → "L_Hand"). Older exports of the
 * same rig spell the names with spaces ("L Hand_0201"), which count as underscores.
 */
const base = (name) => (name.endsWith('rootJoint') ? '_rootJoint' : name.replace(/ /g, '_').replace(/_\d+$/, ''));
const KEEP = new Set(['_rootJoint', 'Skeleton', 'Root', 'Splitter', 'Spine1', 'Spine2', 'Spine3', 'Spine4', 'Neck', 'Head',
  'L_Eyeball', 'R_Eyeball', 'L_Clavicle', 'L_Shoulder', 'L_Elbow', 'L_Hand', 'L_Middle1',
  'R_Clavicle', 'R_Shoulder', 'R_Elbow', 'R_Hand', 'R_Middle1', 'Pelvis',
  'L_Hip', 'L_Knee', 'L_Foot', 'L_Toe', 'R_Hip', 'R_Knee', 'R_Foot', 'R_Toe']);
/** Removed joints that must follow a kept joint which is not their ancestor (the face rig hangs off a twin of the head). */
const ALIAS = { Head_CS: 'Head' };

/** Product a × b of column-major 4×4 matrices. */
function mul(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
    out[c * 4 + r] = sum;
  }
  return out;
}

/** Inverse of a column-major 4×4 matrix. */
function invert(m) {
  const a = Array.from({ length: 4 }, (_, r) => [m[r], m[4 + r], m[8 + r], m[12 + r], ...[0, 1, 2, 3].map((c) => (c === r ? 1 : 0))]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    if (Math.abs(d) < 1e-12) throw new Error('singular joint matrix');
    for (let k = 0; k < 8; k++) a[c][k] /= d;
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = a[r][c];
      for (let k = 0; k < 8; k++) a[r][k] -= f * a[c][k];
    }
  }
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[c * 4 + r] = a[r][4 + c];
  return out;
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
await MeshoptSimplifier.ready;
await doc.transform(
  metalRough(), // older exports use specular/glossiness, which the game's loader doesn't register
  dedup(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.0008 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82, resize: [1024, 1024] }),
);

const root = doc.getRoot();
const skin = root.listSkins()[0];
const joints = skin.listJoints();
const parentOf = new Map();
for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
const EYES = ['L_Eyeball', 'R_Eyeball'];
const hasEyes = joints.some((j) => base(j.getName()) === 'L_Eyeball');
if (!hasEyes) {
  if (!eyesFrom) throw new Error('no eyeball joints: pass another agent on the same rig as the 4th argument');
  for (const e of EYES) KEEP.delete(e);
}
const keptJoints = joints.filter((j) => KEEP.has(base(j.getName())));
const missing = [...KEEP].filter((k) => !keptJoints.some((j) => base(j.getName()) === k));
if (missing.length) throw new Error('missing joints: ' + missing);
if (keptJoints.length !== KEEP.size) throw new Error('ambiguous joint names: ' + keptJoints.map((j) => j.getName()));
const byBase = new Map(keptJoints.map((j) => [base(j.getName()), j]));
const keptFor = (j) => {
  for (let n = j; n; n = parentOf.get(n)) {
    const b = base(n.getName());
    if (KEEP.has(b)) return n;
    if (ALIAS[b]) return byBase.get(ALIAS[b]);
  }
  throw new Error('no kept ancestor for ' + j.getName());
};
const newIndex = new Map(keptJoints.map((j, i) => [j, i]));
const remap = joints.map((j) => newIndex.get(keptFor(j)));
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
  if (!J || !W) continue;
  const ja = J.getArray(), wa = W.getArray();
  for (let v = 0; v < J.getCount(); v++) {
    const acc = new Map();
    for (let k = 0; k < 4; k++) { const w = wa[v * 4 + k]; if (w <= 0) continue; const nj = remap[ja[v * 4 + k]]; acc.set(nj, (acc.get(nj) ?? 0) + w); }
    const list = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = list.reduce((s, [, w]) => s + w, 0) || 1;
    const full = W.getNormalized() ? (wa instanceof Uint8Array ? 255 : 65535) : 1;
    for (let k = 0; k < 4; k++) { ja[v * 4 + k] = list[k] ? list[k][0] : 0; wa[v * 4 + k] = list[k] ? (list[k][1] / sum) * full : 0; }
  }
  J.setArray(ja); W.setArray(wa);
}
if (!hasEyes) {
  const ref = await io.read(eyesFrom);
  const head = keptJoints.find((j) => base(j.getName()) === 'Head');
  for (const e of EYES) {
    const src = ref.getRoot().listNodes().find((n) => base(n.getName()) === e);
    if (!src) throw new Error('no ' + e + ' in ' + eyesFrom);
    const eye = doc.createNode(e).setTranslation(src.getTranslation()).setRotation(src.getRotation());
    head.addChild(eye);
    keptJoints.push(eye); // a joint without weights, so the compressor doesn't prune it as an empty leaf
  }
}
// Bind matrices are rebuilt from the rest pose (rest pose = bind pose). The exporter leaves a
// placeholder matrix on joints that had no skin weights of their own, and those joints now carry
// the weights of the twist and helper joints below them. The mesh keeps the place the exporter's own
// bind gave it relative to the skeleton: M = world × inverse bind of the pelvis, the same for every
// joint while rest = bind (some exports put a large offset above the skeleton that their bind leaves
// out). Then the whole model is moved to stand on the origin, centred over it.
const pelvisIndex = joints.findIndex((j) => base(j.getName()) === 'Pelvis');
const ibmOld = skin.getInverseBindMatrices().getArray();
const M = mul(joints[pelvisIndex].getWorldMatrix(), ibmOld.slice(pelvisIndex * 16, pelvisIndex * 16 + 16));
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const P = prim.getAttribute('POSITION');
  if (!prim.getAttribute('JOINTS_0')) continue;
  const v = [0, 0, 0];
  for (let i = 0; i < P.getCount(); i++) {
    P.getElement(i, v);
    for (let k = 0; k < 3; k++) {
      const w = M[k] * v[0] + M[4 + k] * v[1] + M[8 + k] * v[2] + M[12 + k];
      lo[k] = Math.min(lo[k], w);
      hi[k] = Math.max(hi[k], w);
    }
  }
}
const shift = [-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2];
const scene = root.listScenes()[0];
const holder = doc.createNode('agent_origin').setTranslation(shift);
for (const n of scene.listChildren()) {
  scene.removeChild(n);
  holder.addChild(n);
}
scene.addChild(holder);
const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...shift, 1];
const TM = mul(T, M);
const ibm = new Float32Array(keptJoints.length * 16);
keptJoints.forEach((j, i) => ibm.set(mul(invert(j.getWorldMatrix()), TM), i * 16));
skin.getInverseBindMatrices().setArray(ibm);
console.log('height', (hi[1] - lo[1]).toFixed(3), '| moved by', shift.map((x) => +x.toFixed(3)));
for (const j of joints) skin.removeJoint(j);
for (const j of keptJoints) skin.addJoint(j);
// drop the removed joint nodes; anything kept below one (older exports have helper joints between the
// skeleton's root and its first kept joint) moves up to the nearest kept ancestor, staying where it was
const removed = joints.filter((j) => !KEEP.has(base(j.getName())));
const removedSet = new Set(removed);
const worldBefore = new Map(root.listNodes().map((n) => [n, n.getWorldMatrix()]));
const moved = [];
for (const j of removed) for (const c of j.listChildren()) {
  if (removedSet.has(c)) continue;
  let a = parentOf.get(j);
  while (a && removedSet.has(a)) a = parentOf.get(a);
  j.removeChild(c);
  a.addChild(c);
  moved.push(c);
}
for (const c of moved) {
  const p = root.listNodes().find((n) => n.listChildren().includes(c));
  c.setMatrix(mul(invert(p.getWorldMatrix()), worldBefore.get(c)));
}
for (const j of removed) { const p = parentOf.get(j); if (p) p.removeChild(j); }
for (const j of removed) j.dispose();
// kept joints get their plain names, so the game finds them whichever export they came from
for (const j of keptJoints) if (j.getName() !== base(j.getName()) && !j.getName().endsWith('rootJoint')) j.setName(base(j.getName()));
await doc.transform(prune());
await io.write(output, doc);
const tris = root.listMeshes().flatMap((m) => m.listPrimitives()).reduce((s, p) => s + p.getIndices().getCount() / 3, 0);
console.log('joints', joints.length, '->', keptJoints.length, '| triangles', tris, '| nodes', root.listNodes().length);
