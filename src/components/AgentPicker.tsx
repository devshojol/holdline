import { AGENTS, getAgent, type AgentDef, type AgentId } from '../game/agents';
import { multiplayer, useMultiplayer } from '../multiplayer/client';
import { Card, cx } from './ui';

/** A badge for an agent: their initial on their colour (the agents themselves are 3D models). */
export function AgentPortrait({ agent, className }: { agent: AgentDef; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" fill={agent.gear} />
      <rect x="0" y="52" width="64" height="12" fill={agent.accent} opacity="0.85" />
      <text
        x="32"
        y="42"
        textAnchor="middle"
        fontSize="34"
        fontWeight="700"
        fontFamily="inherit"
        fill={agent.accent}
      >
        {agent.name[0]}
      </text>
    </svg>
  );
}

/** Pick the agent you are seen as in multiplayer. Purely cosmetic; bots get a random one. */
export function AgentPicker({ note }: { note?: string }) {
  const current = useMultiplayer((s) => s.agent);
  const agent = getAgent(current);
  return (
    <Card title="Agent" right={<span className="text-xs text-dim">{note ?? 'How other players see you'}</span>}>
      <div className="mb-3 flex items-center gap-3">
        <AgentPortrait agent={agent} className="h-14 w-14 shrink-0 border border-line" />
        <div className="min-w-0">
          <div className="font-display text-2xl font-bold uppercase leading-none tracking-wide text-ink">{agent.name}</div>
          <p className="mt-1 text-sm text-mute">Bots play a random agent.</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5" role="radiogroup" aria-label="Agent">
        {AGENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={a.id === current}
            onClick={() => multiplayer.setAgent(a.id as AgentId)}
            className={cx(
              'flex items-center gap-2 border-2 px-1.5 py-1 text-left transition-colors',
              a.id === current ? 'border-accent bg-panel2' : 'border-transparent opacity-75 hover:border-mute hover:opacity-100',
            )}
          >
            <AgentPortrait agent={a} className="block h-7 w-7 shrink-0" />
            <span className="truncate font-display text-sm font-bold uppercase tracking-wide text-ink">{a.name}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
