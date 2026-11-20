import { useState, type CSSProperties } from 'react';
import { AGENTS, agentPortrait, getAgent, type AgentDef, type AgentId } from '../game/agents';
import { multiplayer, useMultiplayer } from '../multiplayer/client';
import { cx } from './ui';

/**
 * An agent's profile picture: a render of their model. Where the picture is missing (the single-file
 * build ships no models) their initial on their colour stands in.
 */
export function AgentPortrait({ agent, className }: { agent: AgentDef; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = agentPortrait(agent);
  return (
    <span className={cx('tal-portrait', className)} style={{ '--agent': agent.accent } as CSSProperties} aria-hidden="true">
      {failed === src ? <span className="tal-portrait-initial">{agent.name[0]}</span> : <img src={src} alt="" draggable={false} onError={() => setFailed(src)} />}
    </span>
  );
}

/**
 * Agent select: the agent you are seen as in multiplayer, picked from the roster. Purely cosmetic; bots
 * get a random one. `compact` is the lobby's side panel; otherwise the roster sits under a large picture.
 */
export function AgentPicker({ note, compact }: { note?: string; compact?: boolean }) {
  const current = useMultiplayer((s) => s.agent);
  const agent = getAgent(current);
  return (
    <section className="tal-agent-select" data-compact={compact} style={{ '--agent': agent.accent } as CSSProperties} aria-label="Soldier select">
      <div className="tal-agent-hero">
        {/* the key replays the entrance when another agent is picked */}
        <AgentPortrait key={agent.id} agent={agent} className="tal-agent-hero-pic" />
        <div className="tal-agent-hero-text">
          <div className="font-display text-xs font-semibold uppercase tracking-[0.4em] text-mute">Your soldier</div>
          <div className={cx('font-display font-extrabold uppercase leading-[0.9] tracking-[0.04em] text-white', compact ? 'text-4xl' : 'text-6xl xl:text-7xl')}>{agent.name}</div>
          <div className="mt-2 text-xs text-mute">{note ?? 'How other players see you. Bots play a random soldier.'}</div>
        </div>
      </div>
      <div className="tal-agent-roster" role="radiogroup" aria-label="Soldier">
        {AGENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={a.id === current}
            aria-label={a.name}
            title={a.name}
            onClick={() => multiplayer.setAgent(a.id as AgentId)}
            className="tal-agent-tile"
            style={{ '--agent': a.accent } as CSSProperties}
          >
            <AgentPortrait agent={a} className="h-full w-full" />
            <span className="tal-agent-tile-name">{a.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
