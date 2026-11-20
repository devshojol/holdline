import { lazy, Suspense, useEffect, type CSSProperties } from 'react';
import { store, useAppStore } from '../hooks/useAppStore';
import { cx, setBackAction } from '../components/ui';
import { useUiScale } from '../hooks/useUiScale';
import { useMultiplayer } from '../multiplayer/client';
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

setBackAction(() => store.go('home'));

export function App() {
  const scale = useUiScale();
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
              <div className="font-display text-xl uppercase tracking-widest text-mute">Loading the battlefield</div>
              <div className="tal-loadbar mt-4" />
            </div>
          </div>
        }
      >
        <GamePage config={session} net={match?.link} />
      </Suspense>
    );

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      // scaled as a whole: it still fills the window (its 100% is not scaled), and everything inside is laid out
      // as if the window were 1/scale times as large
      style={scale === 1 ? undefined : { zoom: scale }}
    >
      <Backdrop />

      {/* no website chrome: each screen is the whole window, with its own Back button (home has none) */}
      <main className="relative z-10 min-h-0 flex-1 overflow-hidden">
        <div className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-xs text-warn md:hidden">
          Gameplay needs a keyboard and mouse on a desktop browser. You can still browse settings and stats here.
        </div>
        <div key={page} className={cx('tal-screen flex h-full flex-col', page === 'home' ? '' : 'px-5 py-4')}>
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
    </div>
  );
}
