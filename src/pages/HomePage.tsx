import { Bot, Play, Settings, Users, type LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { store, useAppStore } from '../hooks/useAppStore';
import { cx } from '../components/ui';
import { normaliseConfig } from './PracticePage';
import { multiplayer, useMultiplayer } from '../multiplayer/client';
import { ensureName } from '../multiplayer/crazygamesRooms';
import { crazyGames } from '../platform/crazygames';
import { keyLabel, type BindAction } from '../settings/keybindings';
import { QUICK_MATCH_SETTINGS } from '../net/settings';

/** A secondary way in: practice, friends, settings. */
function Choice({ index, label, hint, icon: Icon, onClick }: { index: number; label: string; hint: string; icon: LucideIcon; onClick: () => void }) {
  return (
    <button onClick={onClick} className="tal-menu-item tal-rise" style={{ '--i': index } as CSSProperties}>
      <Icon size={22} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1">
        <span className="block font-display text-xl font-bold uppercase leading-none tracking-[0.08em]">{label}</span>
        <span className="mt-1 block truncate text-sm text-mute">{hint}</span>
      </span>
    </button>
  );
}

/** One key and what it does, for the controls card. */
function Key({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <kbd className="min-w-[2.4rem] border border-white/20 bg-black/50 px-1.5 py-0.5 text-center font-display text-sm font-bold uppercase text-ink">{k}</kbd>
      <span className="text-sm text-mute">{children}</span>
    </div>
  );
}

/**
 * The first screen: one big Play button. Quick Play puts the player in an online deathmatch (bots fill the
 * room until people arrive); practice against bots and playing with friends sit just under it.
 */
export function HomePage() {
  const practice = useAppStore((s) => s.practice);
  const keys = useAppStore((s) => s.settings.keys);
  const online = useMultiplayer((s) => s.available);
  const cfg = normaliseConfig(practice);
  const k = (a: BindAction) => keyLabel(keys[a][0] || keys[a][1]) || '—';
  const move = [k('forward'), k('left'), k('back'), k('right')].join('');

  /** Quick Play: an online deathmatch on any map. The server finds a match with room, or starts one that bots fill. */
  const quick = async () => {
    if (!online) return store.play({ ...cfg, mode: 'deathmatch', botCount: 5, durationSec: 300 }); // no game server in this build
    if (crazyGames.enabled) await ensureName(); // their players arrive with a name; ours are asked once
    store.go('multiplayer');
    multiplayer.quickPlay();
  };
  const botsNow = () => store.play(normaliseConfig({ ...cfg, mode: 'deathmatch', botCount: 5, durationSec: 300, playerSpawnId: '', enemySpotIds: [] }));

  return (
    <div className="relative h-full min-h-[520px] overflow-hidden">
      {/* the key art, fading into the menu on the left */}
      <div aria-hidden="true" className="absolute inset-0 -z-0">
        <img src="images/home-hero.jpg" alt="" className="absolute inset-y-0 right-0 h-full w-[78%] object-cover object-[60%_30%]" draggable={false} />
        <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/90 to-transparent" style={{ backgroundSize: '100% 100%' }} />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-bg to-transparent" />
      </div>

      <div className="relative z-10 flex h-full flex-col justify-center gap-6 lg:max-w-[440px]">
        <div className="tal-rise" style={{ '--i': 0 } as CSSProperties}>
          <div className="font-display text-sm font-semibold uppercase tracking-[0.35em] text-accent">Online FPS · {QUICK_MATCH_SETTINGS.timeLimitMin}-minute deathmatch</div>
          <h1 className="tal-title-in mt-1 font-display text-7xl font-extrabold uppercase leading-[0.86] tracking-[0.04em] text-ink">
            Hold<span className="text-accent">line</span>
          </h1>
          <p className="mt-3 text-base text-mute">Jump into a match in seconds. Bots fill the room until other players arrive.</p>
        </div>

        <button
          onClick={() => void quick()}
          className="tal-rise clip-angle-sm group flex items-center gap-4 bg-accent px-6 py-5 text-left text-[#1a1206] shadow-[0_0_40px_-8px_rgba(245,165,36,0.7)] transition-transform hover:-translate-y-0.5 active:translate-y-0"
          style={{ '--i': 1 } as CSSProperties}
        >
          <Play size={34} className="shrink-0 fill-current" />
          <span className="min-w-0 flex-1">
            <span className="block font-display text-4xl font-extrabold uppercase leading-none tracking-[0.06em]">Play now</span>
            <span className="mt-1 block text-sm font-semibold opacity-80">{online ? 'Online match · any map · up to 10 players' : 'Deathmatch against bots'}</span>
          </span>
        </button>

        <nav aria-label="More ways to play" className="grid gap-2">
          <Choice index={2} label="Play with friends" hint="Make a room and send the link" icon={Users} onClick={() => store.go('multiplayer')} />
          <Choice index={3} label="Practice vs bots" hint="Offline, any map, your own rules" icon={Bot} onClick={() => store.go('practice')} />
        </nav>

        <div className="tal-rise flex flex-wrap items-center justify-between gap-3" style={{ '--i': 4 } as CSSProperties}>
          <button onClick={botsNow} className={cx('text-sm text-mute underline-offset-4 hover:text-ink hover:underline', !online && 'hidden')}>
            Or start a bot match right now
          </button>
          <button onClick={() => store.go('settings')} className="inline-flex items-center gap-1.5 text-sm text-mute hover:text-ink">
            <Settings size={15} /> Controls and settings
          </button>
        </div>
      </div>

      {/* how to play, at a glance */}
      <div className="tal-rise absolute bottom-2 right-2 z-10 hidden w-[300px] border border-white/10 bg-black/55 p-4 backdrop-blur-sm lg:block" style={{ '--i': 5 } as CSSProperties}>
        <div className="mb-2 font-display text-sm font-semibold uppercase tracking-[0.25em] text-accent">How to play</div>
        <div className="grid gap-1.5">
          <Key k={move}>Move</Key>
          <Key k="Mouse">Aim · click to shoot</Key>
          <Key k={k('reload')}>Reload</Key>
          <Key k={k('crouch')}>Crouch · {k('walk')} walk quietly</Key>
          <Key k={k('mapToggle')}>Map · hold {k('mapHold')} for scores</Key>
        </div>
        <p className="mt-2 text-sm text-dim">Most kills when the time runs out wins.</p>
      </div>
    </div>
  );
}
