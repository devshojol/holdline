/**
 * The multiplayer server runs the same simulation code as the client (docs/multiplayer.md, section 5.3).
 * These files, and everything they import, must therefore work without a browser or the 3D engine.
 */
import { describe, expect, it } from 'vitest';

/** Source of every file under src/, keyed by its path from the repository root. */
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob('../src/**/*.{ts,tsx,json}', { query: '?raw', import: 'default', eager: true })).map(([path, src]) => [
    path.replace(/^\.\.\//, ''),
    src as string,
  ]),
);

/** Entry points of the shared simulation. `src/net` is shared as a whole. */
const SHARED_ROOTS = [
  'src/game/core/actions.ts',
  'src/game/physics/CollisionWorld.ts',
  'src/game/player/PlayerController.ts',
  'src/game/weapons/WeaponSystem.ts',
  'src/game/weapons/weaponConfigs.ts',
  'src/game/maps/MapData.ts',
  'src/game/maps/registry.ts',
  'src/game/bots/perception/visibility.ts',
  ...Object.keys(SOURCES).filter((p) => p.startsWith('src/net/')),
];

const IMPORT = /(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
/** Browser-only globals, used as a value (`window.x`, `document[...]`, `new Image(`…). */
const BROWSER_GLOBAL = /\b(?:window|document|navigator|localStorage|sessionStorage)\s*[.[]|\b(?:requestAnimationFrame|new (?:Image|Audio|AudioContext|OffscreenCanvas))\s*\(/;

function stripComments(src: string) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function stripStrings(src: string) {
  return src.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''");
}

/** Resolve a relative import to a file under src/, or null when there is none. */
function resolveImport(from: string, spec: string): string | null {
  const parts = from.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  const base = parts.join('/');
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((p) => p in SOURCES) ?? null;
}

/** Every file reachable from the shared roots through value imports (type-only imports are erased). */
function sharedFiles() {
  const seen = new Map<string, string[]>(); // file → the packages it imports
  const queue = [...SHARED_ROOTS];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    expect(file in SOURCES, `${file} is listed as shared but does not exist`).toBe(true);
    const packages: string[] = [];
    seen.set(file, packages);
    if (file.endsWith('.json')) continue;
    for (const m of stripComments(SOURCES[file]).matchAll(IMPORT)) {
      if (m[1]) continue;
      const spec = m[2];
      if (!spec.startsWith('.')) {
        packages.push(spec);
        continue;
      }
      const target = resolveImport(file, spec);
      expect(target, `${file} imports ${spec}, which was not found`).not.toBeNull();
      queue.push(target!);
    }
  }
  return seen;
}

describe('shared simulation code', () => {
  const files = sharedFiles();

  it('covers the simulation and the net modules', () => {
    const names = [...files.keys()];
    expect(names).toContain('src/net/protocol.ts');
    expect(names).toContain('src/game/maps/GridMap.ts');
    expect(names).toContain('src/game/maps/generated/kitsune.json');
    expect(names.length).toBeGreaterThan(20);
  });

  it('imports no packages (no Babylon, no React)', () => {
    for (const [file, packages] of files) expect(packages, file).toEqual([]);
  });

  it('uses no browser globals', () => {
    for (const file of files.keys()) {
      if (file.endsWith('.json')) continue;
      const hit = stripStrings(stripComments(SOURCES[file])).match(BROWSER_GLOBAL);
      expect(hit?.[0] ?? null, file).toBeNull();
    }
  });

  it('would catch a file that does not belong', () => {
    // the guard itself: a rendering file must trip both checks
    const renderer = stripStrings(stripComments(SOURCES['src/game/engine/GameEngine.ts']));
    expect(renderer).toMatch(BROWSER_GLOBAL);
    expect([...stripComments(SOURCES['src/game/rendering/babylon.ts']).matchAll(IMPORT)].some((m) => m[2].startsWith('@babylonjs'))).toBe(true);
  });
});
