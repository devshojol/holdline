import { Bot, ChartColumn, ChevronLeft, ChevronRight, CircleHelp, Crosshair, Map as MapIcon, Play, Settings, Swords, Users, X, type LucideIcon } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { store, useAppStore, type Page } from '../hooks/useAppStore';
import { cx } from '../components/ui';
import { AgentPortrait } from '../components/AgentPicker';
import { normaliseConfig } from './PracticePage';
import { multiplayer, useMultiplayer } from '../multiplayer/client';
import { ensureName } from '../multiplayer/crazygamesRooms';
import { crazyGames } from '../platform/crazygames';
import { keyLabel, type BindAction } from '../settings/keybindings';
import { QUICK_MATCH_SETTINGS } from '../net/settings';
import { AGENTS, getAgent } from '../game/agents';
import { LOGO, PITCH, TAGLINE } from '../brand';

/** The game's name in two colours. */
export function Logo({ size = 'lg' }: { size?: 'lg' | 'sm' }) {
  return (
    <div className={cx('font-display uppercase leading-[0.85] text-ink drop-shadow-[0_3px_0_rgba(0,0,0,0.6)]', size === 'lg' ? 'text-6xl' : 'text-2xl')}>
      <span className="text-accent">{LOGO[0]}</span>
      {LOGO[1]}
    </div>
  );
}

/** A dark button in the bottom bar or the play stack. */
function Slab({ label, icon: Icon, onClick, className, sub }: { label: string; icon: LucideIcon; onClick: () => void; className?: string; sub?: string }) {
  return (
    <button type="button" onClick={onClick} className={cx('tal-slab flex items-center gap-2.5 px-4 text-left', className)}>
      <Icon size={20} className="shrink-0 text-accent" />
      <span className="min-w-0">
        <span className="block font-display text-base uppercase leading-none">{label}</span>
        {sub && <span className="mt-1 block truncate text-xs text-mute">{sub}</span>}
      </span>
    </button>
  );
}

/**
 * The lobby: your soldier in the middle, Quick Play as the big gold button at the bottom right with the other
 * ways to play above it, and the rest of the game (loadout, maps, career, settings) along the bottom.
 * Everything fits the window: nothing scrolls.
 */
export function HomePage() {
  const practice = useAppStore((s) => s.practice);
  const keys = useAppStore((s) => s.settings.keys);
  const online = useMultiplayer((s) => s.available);
  const name = useMultiplayer((s) => s.name);
  const agent = getAgent(useMultiplayer((s) => s.agent));
  const [help, setHelp] = useState(false);
  const cfg = normaliseConfig(practice);
  const k = (a: BindAction) => keyLabel(keys[a][0] || keys[a][1]) || '—';

  const bots = () => store.play(normaliseConfig({ ...cfg, mode: 'deathmatch', botCount: 5, durationSec: 300, playerSpawnId: '', enemySpotIds: [] }));
  /** Quick Play: an online deathmatch on any map. The server finds a match with room, or starts one that bots fill. */
  const quick = async () => {
    if (!online) return bots(); // a build with no game server
    if (crazyGames.enabled) await ensureName(); // their players arrive with a name; ours are asked once
    store.go('multiplayer');
    multiplayer.quickPlay();
  };
  const cycle = (step: number) => {
    const i = AGENTS.findIndex((a) => a.id === agent.id);
    multiplayer.setAgent(AGENTS[(i + step + AGENTS.length) % AGENTS.length].id);
  };
  const go = (page: Page) => () => store.go(page);

  return (
    <div className="relative h-full overflow-hidden">
      {/* key art, pushed back so the soldier and the buttons read over it */}
      <div aria-hidden="true" className="absolute inset-0">
        <img src="images/home-hero.jpg" alt="" draggable={false} className="h-full w-full scale-105 object-cover opacity-20 blur-[3px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_55%,transparent_20%,rgba(10,15,21,0.92)_75%)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bg to-transparent" />
      </div>

      {/* top: the name on the left, you and the options on the right */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between px-6 pt-5">
        <div className="tal-rise" style={{ '--i': 0 } as CSSProperties}>
          <Logo />
          <div className="mt-2 font-label text-base font-semibold uppercase tracking-[0.25em] text-mute">{TAGLINE}</div>
        </div>
        <div className="tal-rise flex items-center gap-2" style={{ '--i': 1 } as CSSProperties}>
          <button type="button" onClick={go('multiplayer')} className="tal-slab flex items-center gap-3 py-1.5 pl-1.5 pr-4" title="Change your name and soldier">
            <AgentPortrait agent={agent} className="h-11 w-11 shrink-0 border border-white/15" />
            <span className="text-left leading-tight">
              <span className="block font-display text-base uppercase">{name || 'New recruit'}</span>
              <span className="block text-xs text-mute">{agent.name}</span>
            </span>
          </button>
          <button type="button" onClick={() => setHelp((h) => !h)} className="tal-slab grid h-14 w-14 place-items-center" aria-label="How to play" aria-expanded={help}>
            <CircleHelp size={22} />
          </button>
          <button type="button" onClick={go('settings')} className="tal-slab grid h-14 w-14 place-items-center" aria-label="Settings">
            <Settings size={22} />
          </button>
        </div>
      </div>

      {/* centre: your soldier, with arrows to pick another */}
      <div className="absolute inset-x-0 bottom-[86px] top-[110px] z-0 flex flex-col items-center justify-end">
        <div className="relative flex items-end gap-4">
          <button type="button" onClick={() => cycle(-1)} className="tal-slab mb-28 grid h-12 w-12 place-items-center" aria-label="Previous soldier">
            <ChevronLeft size={24} />
          </button>
          <div className="relative">
            <div aria-hidden="true" className="absolute inset-x-[-30%] bottom-[-18px] h-16 rounded-[50%] bg-accent/25 blur-2xl" style={{ background: `${agent.accent}40` }} />
            <AgentPortrait key={agent.id} agent={agent} className="tal-showcase h-[340px] w-[272px]" />
          </div>
          <button type="button" onClick={() => cycle(1)} className="tal-slab mb-28 grid h-12 w-12 place-items-center" aria-label="Next soldier">
            <ChevronRight size={24} />
          </button>
        </div>
        <div className="mt-2 font-display text-2xl uppercase" style={{ color: agent.accent }}>
          {agent.name}
        </div>
      </div>

      {/* left: the pitch, and how to play when asked */}
      <div className="absolute left-6 top-[150px] z-10 w-[300px]">
        <p className="tal-rise text-base text-mute" style={{ '--i': 2 } as CSSProperties}>
          {PITCH}
        </p>
        <div className={cx('mt-4 border border-white/10 bg-black/60 p-4 backdrop-blur-sm transition-opacity', help ? 'opacity-100' : 'pointer-events-none opacity-0')} role="region" aria-label="How to play">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-display text-sm uppercase text-accent">How to play</span>
            <button type="button" onClick={() => setHelp(false)} aria-label="Close" className="text-mute hover:text-ink">
              <X size={16} />
            </button>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            {[
              [[k('forward'), k('left'), k('back'), k('right')].join(''), 'Move'],
              ['Mouse', 'Aim, click to shoot'],
              [k('reload'), 'Reload'],
              [k('crouch'), 'Crouch'],
              [k('walk'), 'Walk quietly'],
              [k('mapToggle'), `Map · hold ${k('mapHold')} for scores`],
            ].map(([key, what]) => (
              <div key={what} className="contents">
                <dt>
                  <kbd className="inline-block min-w-[2.4rem] border border-white/20 bg-black/50 px-1.5 py-0.5 text-center font-display text-xs uppercase text-ink">{key}</kbd>
                </dt>
                <dd className="self-center text-mute">{what}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-sm text-dim">Most kills in {QUICK_MATCH_SETTINGS.timeLimitMin} minutes wins.</p>
        </div>
      </div>

      {/* bottom right: the ways to play, Quick Play biggest */}
      <div className="absolute bottom-5 right-6 z-10 flex w-[330px] flex-col gap-2">
        <Slab label="Play with friends" sub="Make a room, send the link" icon={Users} onClick={go('multiplayer')} className="tal-rise h-14" />
        <Slab label="Practice vs bots" sub="Offline, your own rules" icon={Bot} onClick={go('practice')} className="tal-rise h-14" />
        <button type="button" data-pulse="true" onClick={() => void quick()} className="tal-gold tal-rise flex h-[86px] items-center gap-4 px-6 text-left">
          <Play size={36} className="shrink-0 fill-current" />
          <span>
            <span className="block whitespace-nowrap font-display text-[2rem] uppercase leading-none">Quick play</span>
            <span className="mt-1 block text-sm font-semibold opacity-80">{online ? `Online · ${QUICK_MATCH_SETTINGS.timeLimitMin} min · up to 10 players` : 'Deathmatch against bots'}</span>
          </span>
        </button>
      </div>

      {/* bottom left: the rest of the game */}
      <nav aria-label="Game menu" className="absolute bottom-5 left-6 z-10 flex gap-2">
        <button type="button" onClick={go('weapons')} className="tal-gold flex h-14 items-center gap-2 px-5 font-display text-base uppercase">
          <Swords size={20} /> Loadout
        </button>
        <Slab label="Maps" icon={MapIcon} onClick={go('maps')} className="h-14" />
        <Slab label="Career" icon={ChartColumn} onClick={go('statistics')} className="h-14" />
        <Slab label="Crosshair" icon={Crosshair} onClick={go('crosshair')} className="h-14" />
      </nav>
    </div>
  );
}
