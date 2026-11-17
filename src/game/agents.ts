/**
 * The agents a player can be seen as, each a rigged model in public/models (credits in its README),
 * posed in code by src/game/bots/AgentVisual.ts. The choice is cosmetic only. Bots get a random one,
 * in multiplayer (picked by the server) and in practice.
 *
 * Shared with the server, so no Babylon imports here. Without the model files (the single-file build,
 * the "dummy" bot model setting, or a file that fails to load) an agent is drawn as the built-in
 * blocky body in its own colours.
 */

export interface AgentDef {
  id: string;
  name: string;
  /** GLB file, relative to the site root. */
  model: string;
  /** Highlight colour in menus, and the trim of the blocky stand-in body. */
  accent: string;
  /** Suit colour of the blocky stand-in body. */
  body: string;
  /** Vest, boots and helmet of the blocky stand-in body. */
  gear: string;
}

export const AGENTS = [
  { id: 'brimstone', name: 'Brimstone', model: 'models/agents/brimstone.glb', accent: '#f08a3c', body: '#4a4438', gear: '#24211b' },
  { id: 'cypher', name: 'Cypher', model: 'models/agents/cypher.glb', accent: '#e9e4d4', body: '#5a5a5e', gear: '#1f1f22' },
  { id: 'iso', name: 'Iso', model: 'models/agents/iso.glb', accent: '#9a6bff', body: '#2c2a3a', gear: '#15141c' },
  { id: 'miks', name: 'Miks', model: 'models/miks.glb', accent: '#4fd1c5', body: '#3b4150', gear: '#1d2028' },
  { id: 'neon', name: 'Neon', model: 'models/agents/neon.glb', accent: '#3db8ff', body: '#1f2a4a', gear: '#11172a' },
  { id: 'omen', name: 'Omen', model: 'models/agents/omen.glb', accent: '#5a7cff', body: '#1c1d2a', gear: '#0e0e15' },
  { id: 'phoenix', name: 'Phoenix', model: 'models/agents/phoenix.glb', accent: '#ff6a2c', body: '#3a2d2c', gear: '#1d1717' },
  { id: 'sage', name: 'Sage', model: 'models/agents/sage.glb', accent: '#3fe0c0', body: '#d9e3ea', gear: '#6d7f8c' },
  { id: 'skye', name: 'Skye', model: 'models/agents/skye.glb', accent: '#9be05a', body: '#4b5638', gear: '#2b3122' },
] as const satisfies readonly AgentDef[];

export type AgentId = (typeof AGENTS)[number]['id'];

export const DEFAULT_AGENT: AgentId = 'phoenix';

export function isAgentId(id: unknown): id is AgentId {
  return typeof id === 'string' && AGENTS.some((a) => a.id === id);
}

export function getAgent(id: string | null | undefined): AgentDef {
  return AGENTS.find((a) => a.id === id) ?? AGENTS.find((a) => a.id === DEFAULT_AGENT)!;
}

/** A random agent, preferring ones nobody in `taken` is playing yet. */
export function randomAgentId(rng: () => number, taken: Iterable<string> = []): AgentId {
  const used = new Set(taken);
  const free = AGENTS.filter((a) => !used.has(a.id));
  const pool = free.length ? free : AGENTS;
  return pool[Math.floor(rng() * pool.length) % pool.length].id;
}
