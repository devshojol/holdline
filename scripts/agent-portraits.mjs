/**
 * Make the agents' profile pictures (public/models/agents/portraits/<id>.webp) by rendering a
 * head-and-shoulders shot of each agent model in the browser.
 *
 *   npm run dev                          (the page renders with the game's own loader)
 *   node scripts/agent-portraits.mjs     (prints a snippet, then waits for the pictures)
 *
 * Paste the printed snippet into the dev page's console. It renders every agent in
 * src/game/agents.ts and sends each picture here; the script saves them and exits after the last.
 */
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 5199;
const out = join(dirname(fileURLToPath(import.meta.url)), '../public/models/agents/portraits');
mkdirSync(out, { recursive: true });

/** Runs in the page. Width × height of the picture, and the receiver's port, are filled in below. */
const SNIPPET = async (W, H, port) => {
  const B = await import('/src/game/rendering/babylon.ts');
  const { loadContainer } = await import('/src/game/rendering/gltf.ts');
  const { AGENTS } = await import('/src/game/agents.ts');
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const engine = new B.Engine(canvas, true, { preserveDrawingBuffer: true, alpha: true, premultipliedAlpha: false });
  const done = [];
  for (const agent of AGENTS) {
    const scene = new B.Scene(engine);
    scene.clearColor = new B.Color4(0, 0, 0, 0);
    const container = await loadContainer(scene, agent.model);
    container.addAllToScene();
    const node = (name) => scene.transformNodes.find((n) => n.name.replace(/_\d+$/, '') === name);
    for (const n of scene.transformNodes) n.computeWorldMatrix(true);
    const head = node('Head').getAbsolutePosition();
    const eyes = node('L_Eyeball').getAbsolutePosition().add(node('R_Eyeball').getAbsolutePosition()).scale(0.5);
    const scale = 1.63 / eyes.y; // the same height for every agent, so each fills the frame alike
    const fwd = eyes.subtract(head);
    fwd.y = 0;
    fwd.normalize();
    const side = new B.Vector3(fwd.z, 0, -fwd.x);
    const target = eyes.add(new B.Vector3(0, -0.085 / scale, 0));
    const eye = target.add(fwd.scale(1.05 / scale)).add(side.scale(0.3 / scale)).add(new B.Vector3(0, 0.04 / scale, 0));
    const cam = new B.FreeCamera('cam', eye, scene);
    cam.setTarget(target);
    cam.fov = 0.52;
    cam.minZ = 0.01 / scale;
    cam.maxZ = 100 / scale;
    const sky = new B.HemisphericLight('sky', new B.Vector3(0.2, 1, 0.1), scene);
    sky.intensity = 1.5;
    sky.groundColor = new B.Color3(0.45, 0.45, 0.5);
    const key = new B.DirectionalLight('key', fwd.scale(-1).add(side.scale(-0.6)).add(new B.Vector3(0, -0.7, 0)), scene);
    key.intensity = 2.2;
    await scene.whenReadyAsync();
    for (let i = 0; i < 3; i++) scene.render();
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.86));
    await fetch(`http://localhost:${port}/${agent.id}?last=${agent === AGENTS[AGENTS.length - 1] ? 1 : 0}`, { method: 'POST', body: blob });
    done.push(`${agent.id} ${Math.round(blob.size / 1024)} KB`);
    scene.dispose();
  }
  engine.dispose();
  return done;
};

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method !== 'POST') return res.end();
  const url = new URL(req.url, 'http://localhost');
  const id = url.pathname.slice(1).replace(/[^a-z0-9-]/g, '');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    writeFileSync(join(out, `${id}.webp`), Buffer.concat(chunks));
    console.log('saved', `${id}.webp`);
    res.end('ok');
    if (url.searchParams.get('last') === '1') process.exit(0);
  });
}).listen(PORT, () => console.log(`Paste into the dev page's console:\n\nawait (${SNIPPET.toString()})(384, 480, ${PORT})\n`));
