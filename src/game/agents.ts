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
  { id: 'ranger', name: 'Ranger', model: 'models/agents/ranger.glb', accent: '#9aa86a', body: '#4c5334', gear: '#6f6040' },
  { id: 'shade', name: 'Shade', model: 'models/agents/shade.glb', accent: '#c8463c', body: '#2a2b2f', gear: '#1a1b1e' },
  { id: 'dune', name: 'Dune', model: 'models/agents/dune.glb', accent: '#d9b77a', body: '#a08c66', gear: '#7d6a48' },
  { id: 'slate', name: 'Slate', model: 'models/agents/slate.glb', accent: '#e0a52e', body: '#5a6068', gear: '#26282c' },
  { id: 'tide', name: 'Tide', model: 'models/agents/tide.glb', accent: '#6f9bd6', body: '#26344e', gear: '#4b4e52' },
  { id: 'frost', name: 'Frost', model: 'models/agents/frost.glb', accent: '#cfd6dc', body: '#aeb3b8', gear: '#6c7176' },
  { id: 'ember', name: 'Ember', model: 'models/agents/ember.glb', accent: '#e2674a', body: '#2a2b2f', gear: '#1a1b1e' },
  { id: 'grove', name: 'Grove', model: 'models/agents/grove.glb', accent: '#6fbf73', body: '#4c5334', gear: '#6f6040' },
  { id: 'flint', name: 'Flint', model: 'models/agents/flint.glb', accent: '#b9c2cc', body: '#5a6068', gear: '#26282c' },
  { id: 'moss', name: 'Moss', model: 'models/agents/moss.glb', accent: '#c9b26a', body: '#a08c66', gear: '#7d6a48' },
] as const satisfies readonly AgentDef[];

export type AgentId = (typeof AGENTS)[number]['id'];

export const DEFAULT_AGENT: AgentId = 'ranger';

export function isAgentId(id: unknown): id is AgentId {
  return typeof id === 'string' && AGENTS.some((a) => a.id === id);
}

export function getAgent(id: string | null | undefined): AgentDef {
  return AGENTS.find((a) => a.id === id) ?? AGENTS.find((a) => a.id === DEFAULT_AGENT)!;
}

/** The agent's profile picture: a render of their model (tools/blender/make_bots.py), relative to the site root. */
export function agentPortrait(agent: AgentDef): string {
  return `models/agents/portraits/${agent.id}.webp`;
}

/** A random agent, preferring ones nobody in `taken` is playing yet. */
export function randomAgentId(rng: () => number, taken: Iterable<string> = []): AgentId {
  const used = new Set(taken);
  const free = AGENTS.filter((a) => !used.has(a.id));
  const pool = free.length ? free : AGENTS;
  return pool[Math.floor(rng() * pool.length) % pool.length].id;
}
