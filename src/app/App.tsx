import { ChartColumn, Crosshair, House, Map as MapIcon, MousePointer2, Settings, Swords, Target, Users } from 'lucide-react';
import { lazy, Suspense, useEffect, useState, type ComponentType, type CSSProperties } from 'react';
import { version } from '../../package.json';
import { store, useAppStore, type Page } from '../hooks/useAppStore';
import { cx } from '../components/ui';
import { useMultiplayer } from '../multiplayer/client';
import { TIPS } from '../utils/tips';
import { uiSound } from '../utils/uiSound';
import { HomePage } from '../pages/HomePage';
import { PracticePage } from '../pages/PracticePage';
import { MultiplayerPage } from '../pages/MultiplayerPage';
import { MapsPage } from '../pages/MapsPage';
import { WeaponsPage } from '../pages/WeaponsPage';
import { CrosshairPage } from '../pages/CrosshairPage';
import { SensitivityPage } from '../pages/SensitivityPage';
import { StatisticsPage } from '../pages/StatisticsPage';
import { SettingsPage } from '../pages/SettingsPage';

// The game page pulls in the whole 3D engine (~3 MB), so it loads on demand: the menus show
// without it, and it is fetched in the background once the browser is idle.
const loadGamePage = () => import('../pages/GamePage').then((m) => ({ default: m.GamePage }));
const GamePage = lazy(loadGamePage);

type Tab = { id: Page; label: string; icon: ComponentType<{ size?: number; className?: string }> };

/** The main screens, in the top bar. */
const SCREENS: Tab[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'practice', label: 'Practice', icon: Target },
  { id: 'multiplayer', label: 'Multiplayer', icon: Users },
  { id: 'maps', label: 'Maps', icon: MapIcon },
  { id: 'weapons', label: 'Weapons', icon: Swords },
  { id: 'statistics', label: 'Statistics', icon: ChartColumn },
];

/** Set-up screens, on the right of the top bar. */
const OPTIONS: Tab[] = [
  { id: 'crosshair', label: 'Crosshair', icon: Crosshair },
  { id: 'sensitivity', label: 'Sensitivity', icon: MousePointer2 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

/** Sparks drifting up the backdrop: fixed values, so they don't jump when the menu re-renders. */
const SPARKS = Array.from({ length: 14 }, (_, i) => ({
  '--x': `${(i * 61 + 7) % 100}%`,
  '--s': `${2 + (i % 3)}px`,
  '--d': `${11 + ((i * 7) % 10)}s`,
  '--w': `${-((i * 37) % 17)}s`,
  '--dx': `${((i * 53) % 90) - 45}px`,
})) as CSSProperties[];

function Backdrop() {
  return (
    <div className="tal-backdrop" aria-hidden="true">
      <div className="tal-floor" />
      <div className="tal-beam" />
      <div className="tal-beam" />
      {SPARKS.map((style, i) => (
        <span key={i} className="tal-spark" style={style} />
      ))}
      <div className="tal-vignette" />
    </div>
  );
}

function Brand() {
  return (
    <button onClick={() => store.go('home')} className="flex shrink-0 items-center gap-3 px-4 md:px-6" aria-label="Holdline, main menu">
      <span className="relative grid h-9 w-9 place-items-center border border-accent/70 bg-accent/15">
        <Crosshair size={20} className="text-accent" />
      </span>
      <span className="text-left leading-none">
        <span className="block font-display text-lg font-bold uppercase tracking-[0.14em] text-ink">Holdline</span>
        <span className="block font-display text-[11px] font-semibold uppercase tracking-[0.42em] text-accent">Aim trainer</span>
      </span>
    </button>
  );
}

function TabButton({ tab, active, compact }: { tab: Tab; active: boolean; compact?: boolean }) {
  const Icon = tab.icon;
  return (
    <button onClick={() => store.go(tab.id)} aria-current={active ? 'page' : undefined} title={compact ? tab.label : undefined} className={cx('tal-tab', compact ? 'text-sm' : 'text-[15px] xl:text-base')}>
      <Icon size={compact ? 16 : 17} className={active ? 'text-accent' : 'opacity-70'} />
      {/* compact tabs show only their icon on narrower screens; the name stays for screen readers */}
      <span className={compact ? 'max-2xl:sr-only' : undefined}>{tab.label}</span>
    </button>
  );
}

function Footer({ page }: { page: Page }) {
  const online = useMultiplayer((s) => s.status === 'online');
  const available = useMultiplayer((s) => s.available);
  const name = useMultiplayer((s) => s.name);
  const [tip, setTip] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTip((i) => (i + 1) % TIPS.length), 9000);
    return () => clearInterval(t);
  }, []);
  return (
    <footer className="tal-footer flex h-9 shrink-0 items-center gap-4 px-4 text-xs text-mute md:px-6">
      {page !== 'home' && (
        <span className="hidden shrink-0 items-center gap-2 sm:flex">
          <span className="tal-key">Esc</span> Back
        </span>
      )}
      <span key={tip} className="animate-in min-w-0 flex-1 truncate text-dim">
        <span className="mr-2 font-display font-bold uppercase tracking-widest text-accent">Tip</span>
        {TIPS[tip]}
      </span>
      {name && <span className="hidden shrink-0 text-ink md:inline">{name}</span>}
      {available && (
        <span className="hidden shrink-0 items-center gap-1.5 md:flex" title={online ? 'Connected to the game server' : 'Not connected to the game server (it connects when you play)'}>
          <span className={cx('h-1.5 w-1.5 rounded-full', online ? 'bg-ok shadow-[0_0_6px_1px_rgba(61,220,151,0.8)]' : 'bg-dim')} />
          {online ? 'Online' : 'Offline'}
        </span>
      )}
      <span className="tabular shrink-0 text-dim">v{version}</span>
    </footer>
  );
}

/** Menu sounds for every control, and Esc to step back to the main menu. */
function useMenuFeel(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const control = (e: Event) => (e.target instanceof Element ? e.target.closest('button:not(:disabled), a[href], [role="switch"]') : null);
    const volume = () => store.get().settings.audio.master;
    let last: Element | null = null;
    const onOver = (e: Event) => {
      const el = control(e);
      if (el === last) return;
      last = el;
      if (el) uiSound('hover', volume());
    };
    const onClick = (e: Event) => {
      if (control(e)) uiSound('click', volume());
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape' || store.get().page === 'home') return;
      // Esc in a field leaves the field, not the screen
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (!typing) store.go('home');
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [active]);
}

export function App() {
  const page = useAppStore((s) => s.page);
  const playing = useAppStore((s) => s.playing);

  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 1500));
    idle(() => void loadGamePage().catch(() => {}));
  }, []);

  const match = useMultiplayer((s) => (s.inGame ? s.match : null));
  const session = match ? match.config : playing;
  useMenuFeel(!session);

  if (session)
    return (
      <Suspense
        fallback={
          <div className="grid h-full place-items-center bg-bg">
            <div className="w-72 text-center">
              <div className="font-display text-xl uppercase tracking-widest text-mute">Loading game engine</div>
              <div className="tal-loadbar mt-4" />
            </div>
          </div>
        }
      >
        <GamePage config={session} net={match?.link} />
      </Suspense>
    );

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <Backdrop />

      <header className="tal-topbar flex shrink-0 flex-col md:h-16 md:flex-row md:items-stretch">
        <div className="flex h-14 items-center md:h-auto">
          <Brand />
        </div>
        <nav aria-label="Screens" className="flex h-11 min-w-0 flex-1 items-stretch overflow-x-auto md:h-auto">
          {SCREENS.map((t) => (
            <TabButton key={t.id} tab={t} active={t.id === page} />
          ))}
          <span className="flex-1" />
          {OPTIONS.map((t) => (
            <TabButton key={t.id} tab={t} active={t.id === page} compact />
          ))}
        </nav>
      </header>

      <main className="relative z-10 min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-xs text-warn md:hidden">
          Gameplay needs a keyboard and mouse on a desktop browser. You can still browse settings and stats here.
        </div>
        <div key={page} className={cx('tal-screen mx-auto px-4 py-5 md:px-8 md:py-7', page === 'home' ? 'max-w-[1560px] lg:h-full' : 'max-w-[1320px]')}>
          {page === 'home' && <HomePage />}
          {page === 'practice' && <PracticePage />}
          {page === 'multiplayer' && <MultiplayerPage />}
          {page === 'maps' && <MapsPage />}
          {page === 'weapons' && <WeaponsPage />}
          {page === 'crosshair' && <CrosshairPage />}
          {page === 'sensitivity' && <SensitivityPage />}
          {page === 'statistics' && <StatisticsPage />}
          {page === 'settings' && <SettingsPage />}
        </div>
      </main>

      <Footer page={page} />
    </div>
  );
}
