import { ChevronRight, LogOut, MousePointer2, Play, RotateCcw, Square, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { EngineStatus, HudState, KillFeedEntry, PauseInfo, PracticeConfig, SessionStats, WeaponId } from '../types';
import { GameEngine } from '../game/engine/GameEngine';
import { store, useAppStore } from '../hooks/useAppStore';
import { Hud } from '../components/hud/Hud';
import { SessionReportBody } from '../components/SessionReport';
import { LoadoutMenu } from '../components/LoadoutMenu';
import { Button, Slider } from '../components/ui';
import { MODE_INFO, locationName, mapName } from '../utils/labels';
import { WEAPONS } from '../game/weapons/weaponConfigs';
import { cmPer360 } from '../settings/defaults';
import { exitGameFullscreen } from '../utils/fullscreen';
import type { NetLink } from '../game/net/NetLink';
import { multiplayer, useMultiplayer } from '../multiplayer/client';
import { Scoreboard } from '../components/Scoreboard';
import { MapPreview } from '../components/MapPreview';
import { TIPS } from '../utils/tips';

declare global {
  interface Window {
    __TAL__?: GameEngine;
  }
}

const PAUSE_TEXT: Record<PauseInfo['reason'], string> = {
  user: 'Paused',
  'pointer-lock': 'Paused — mouse released',
  blur: 'Paused — window lost focus',
  hidden: 'Paused — tab hidden',
  'context-lost': 'Paused — graphics context lost',
  start: 'Ready',
  loadout: 'Weapon menu',
};

/** `net`: the session is a multiplayer match on this connection (no restart, no report, the world never pauses). */
export function GamePage({ config, net }: { config: PracticeConfig; net?: NetLink }) {
  const settings = useAppStore((s) => s.settings);
  const routine = useAppStore((s) => s.routine);
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [status, setStatus] = useState<EngineStatus>('loading');
  const [pause, setPause] = useState<PauseInfo | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [feed, setFeed] = useState<KillFeedEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SessionStats | null>(null);
  const [renderer, setRenderer] = useState('');
  const [startIssue, setStartIssue] = useState<'cooldown' | 'blocked' | null>(null);
  /** One tip per session, for the loading screen. */
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  /** Weapons in hand; the weapon menu (B) changes them mid-session. */
  const [loadout, setLoadout] = useState({ primary: config.primary, secondary: config.secondary });
  /** Multiplayer: guns chosen in the weapon menu that the server hasn't handed over yet. */
  const [pendingLoadout, setPendingLoadout] = useState<{ primary: WeaponId; secondary: WeaponId } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setReport(null);
    setHud(null);
    setFeed([]);
    setError(null);
    setLoadout({ primary: config.primary, secondary: config.secondary });
    // One engine per mount. It can be disposed while still loading (React StrictMode mounts
    // effects twice in dev, and Quit/Restart can happen mid-load) — dispose() cancels the build.
    const engine = GameEngine.create({ container: hostRef.current!, overlay: overlayRef.current!, config, settings: store.get().settings, net });
    engineRef.current = engine;
    window.__TAL__ = engine;
    engine.on((ev) => {
      switch (ev.type) {
        case 'status':
          setStatus(ev.status);
          setPause(ev.pause ?? null);
          break;
        case 'hud':
          setHud(ev.hud);
          break;
        case 'killfeed':
          setFeed((f) => [...f.slice(-4), ev.entry]);
          setTimeout(() => setFeed((f) => f.filter((x) => x.id !== ev.entry.id)), 4500);
          break;
        case 'notice':
          setNotice(ev.message);
          break;
        case 'ended':
          if (net) break; // a match's results come from the server, not from this session's tracker
          if (ev.stats.shots > 0 || ev.stats.durationSec >= 10) store.addSession(ev.stats);
          store.recordRoutineScore(ev.stats.score);
          setReport(ev.stats);
          break;
        case 'loadout':
          // multiplayer: the server has put the chosen guns in hand
          setLoadout(ev.loadout);
          setPendingLoadout(null);
          store.updatePractice(ev.loadout);
          break;
        case 'error':
          setError(ev.message);
          break;
      }
    });
    engine.ready
      .then(() => {
        if (cancelled) return;
        setRenderer(engine.rendererLabel);
        setStatus(engine.status);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });
    return () => {
      cancelled = true;
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
      if (window.__TAL__ === engine) window.__TAL__ = undefined;
      if (net) exitGameFullscreen(); // the match ended or was left: the room's page is not a fullscreen one
    };
  }, [config, net]);

  useEffect(() => {
    engineRef.current?.updateSettings(settings);
  }, [settings]);

  // Resuming needs a click: browsers only grant pointer lock inside a user gesture.
  const resume = async (freeMouse = false) => {
    const e = engineRef.current;
    if (!e) return;
    try {
      const ok = await e.start({ freeMouse });
      setStartIssue(ok ? null : e.startIssue ?? 'blocked');
    } catch {
      setStartIssue('blocked');
    }
  };

  const pickWeapon = async (slot: 0 | 1, id: WeaponId) => {
    const e = engineRef.current;
    if (!e) return;
    if (net) {
      // In a match the server decides when the guns change hands: at once while spawn-protected,
      // otherwise at the next respawn. The engine swaps them when the server says so.
      const chosen = { ...(pendingLoadout ?? loadout), ...(slot === 0 ? { primary: id } : { secondary: id }) };
      setPendingLoadout(chosen);
      multiplayer.setLoadout(chosen);
      return;
    }
    await e.setWeapon(slot, id);
    if (engineRef.current !== e) return;
    setLoadout(e.loadout);
    // remembered as the default loadout for the next session
    store.updatePractice(slot === 0 ? { primary: id } : { secondary: id });
  };
  const inLoadout = status === 'paused' && pause?.reason === 'loadout' && !report;

  // B closes the weapon menu again (the key press is a user gesture, so the mouse can be re-captured)
  useEffect(() => {
    if (!inLoadout) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.code === 'KeyB' && !ev.repeat) void resume();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [inLoadout]);

  const endSession = () => engineRef.current?.end();
  const quit = () => {
    if (net) {
      // the match goes on without this view: back to the room, from where it can be rejoined
      exitGameFullscreen();
      multiplayer.showLobby();
      return;
    }
    const e = engineRef.current;
    if (e && e.status !== 'ended' && e.status !== 'loading') e.end();
    exitGameFullscreen();
    store.stopPlaying();
  };
  const restart = () => {
    const e = engineRef.current;
    if (e && e.status !== 'ended' && e.status !== 'loading') e.end();
    store.play({ ...config, ...loadout });
  };

  const sens = settings.sensitivity;

  // Multiplayer: Tab holds the scoreboard open
  const scores = useMultiplayer((s) => s.scores);
  const matchSettings = useMultiplayer((s) => s.match?.settings ?? null);
  const [showScores, setShowScores] = useState(false);
  const reconnecting = useMultiplayer((s) => s.status === 'reconnecting');
  useEffect(() => {
    if (!net) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.code !== 'Tab') return;
      ev.preventDefault();
      setShowScores(ev.type === 'keydown');
    };
    const hide = () => setShowScores(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKey);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', hide);
    };
  }, [net]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {/* the shared 3D canvas is mounted in here by the engine */}
      <div ref={hostRef} className="absolute inset-0" />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {hud && status !== 'loading' && !report && <Hud hud={hud} flags={settings.hud} feed={feed} renderer={renderer} />}

      {net && matchSettings && showScores && status !== 'loading' && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/35">
          <div className="w-[min(760px,94vw)] border border-line bg-panel/95 p-5">
            <Scoreboard scores={scores} settings={matchSettings} me={net.playerId} />
          </div>
        </div>
      )}

      {net && reconnecting && (
        <div role="status" className="pointer-events-none absolute left-1/2 top-20 -translate-x-1/2 border border-warn/50 bg-black/75 px-4 py-2 text-sm text-warn">
          Connection lost. Reconnecting — your place and score are kept for 30 seconds.
        </div>
      )}

      {notice && status === 'running' && (
        <div className="pointer-events-none absolute bottom-28 left-1/2 max-w-xl -translate-x-1/2 border border-warn/40 bg-black/70 px-4 py-2 text-center text-sm text-warn">
          {notice}
        </div>
      )}

      {status === 'loading' && !error && (
        <div className="absolute inset-0 overflow-hidden bg-bg">
          {/* the map being loaded, laid out behind the title */}
          <div className="tal-holo absolute inset-0 grid place-items-center opacity-50" aria-hidden="true">
            <div className="tal-holo-plate aspect-square h-[78%] max-w-[78%]">
              <MapPreview mapId={config.mapId} focus={false} showSight={false} className="h-full w-full" />
              <div className="tal-holo-scan" />
            </div>
          </div>
          <div className="tal-vignette" aria-hidden="true" />
          <div className="absolute inset-x-0 bottom-0 px-8 pb-10 md:px-16">
            <div className="font-display text-sm font-semibold uppercase tracking-[0.4em] text-accent">{net ? 'Multiplayer · Deathmatch' : MODE_INFO[config.mode].label}</div>
            <div className="tal-title-in font-display text-7xl font-extrabold uppercase leading-[0.9] tracking-[0.04em] md:text-8xl">{mapName(config.mapId)}</div>
            <div className="mt-5 max-w-2xl">
              <div className="tal-loadbar" />
              <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm">
                <span className="text-mute">
                  <span className="mr-2 font-display font-bold uppercase tracking-widest text-accent">Tip</span>
                  {tip}
                </span>
                <span className="text-xs uppercase tracking-widest text-dim">Building the map…</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-bg/95 p-8">
          <div className="max-w-lg border border-accent/40 bg-panel p-6">
            <div className="flex items-center gap-2 font-display text-2xl font-bold uppercase text-accent">
              <TriangleAlert /> Can't start the 3D engine
            </div>
            <p className="mt-3 text-mute">{error}</p>
            <p className="mt-2 text-sm text-dim">Holdline needs WebGL 2 (or WebGL). Make sure hardware acceleration is enabled in your browser settings.</p>
            <Button className="mt-5" onClick={() => store.stopPlaying()}>
              Back to menu
            </Button>
          </div>
        </div>
      )}

      {inLoadout && (
        <LoadoutMenu
          primary={(pendingLoadout ?? loadout).primary}
          secondary={(pendingLoadout ?? loadout).secondary}
          onPick={(slot, id) => void pickWeapon(slot, id)}
          onClose={() => void resume()}
          issue={startIssue}
          note={net ? (pendingLoadout ? 'Chosen. You get these guns when you next respawn (at once if you have only just spawned).' : 'The match goes on while you choose. New guns arrive when you next respawn.') : undefined}
        />
      )}

      {(status === 'ready' || status === 'paused') && !report && !inLoadout && (
        <div className="absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-[2px]">
          <div className="tal-card w-[min(560px,92vw)] border border-line bg-panel/95 p-7">
            <div className="font-display text-sm font-semibold uppercase tracking-[0.25em] text-accent">
              {net ? (status === 'ready' ? 'Match in progress' : 'Menu — the match goes on') : status === 'ready' ? 'Ready' : PAUSE_TEXT[pause?.reason ?? 'user']}
            </div>
            <div className="font-display text-3xl font-bold uppercase">
              {MODE_INFO[config.mode].label}
            </div>
            <div className="mt-1 text-sm text-mute">
              {mapName(config.mapId)} ·{' '}
              {net ? 'Multiplayer' : `${locationName(config.mapId, config.locationId)} · ${config.side === 'attack' ? 'Attacking' : 'Defending'}`} ·{' '}
              {WEAPONS[loadout.primary].name}
            </div>
            <button
              onClick={() => void resume()}
              className="tal-primary clip-angle mt-6 flex w-full items-center justify-center gap-3 bg-accent py-5 font-display text-2xl font-bold uppercase tracking-widest text-white hover:bg-[#ff5d6a]"
            >
              {status === 'ready' ? <Play size={24} /> : <MousePointer2 size={22} />}
              {status === 'ready' ? (net ? 'Click to play' : 'Click to start') : 'Click to resume'}
            </button>
            {startIssue === 'cooldown' && <p className="mt-2 text-xs text-warn">The browser needs a moment after Esc before it can re-capture the mouse — click again.</p>}
            {startIssue === 'blocked' && (
              <div className="mt-2 text-xs text-warn">
                The browser didn't capture the mouse. Click the button again. If it keeps failing, check that this tab isn't blocking mouse
                lock in the address-bar site settings, or{' '}
                <button className="underline underline-offset-2 hover:text-ink" onClick={() => void resume(true)}>
                  play with the free cursor
                </button>{' '}
                (less precise).
              </div>
            )}

            {status === 'paused' && (
              <div className="mt-5 border-t border-line pt-4">
                <Slider
                  label="Sensitivity"
                  value={sens.sensitivity}
                  min={0.05}
                  max={3}
                  step={0.001}
                  onChange={(v) => store.updateSettings((s) => ({ ...s, sensitivity: { ...s.sensitivity, sensitivity: v } }))}
                  hint={`eDPI ${Math.round(sens.dpi * sens.sensitivity)} · ${cmPer360(sens.dpi, sens.sensitivity).toFixed(1)} cm/360°`}
                />
                <Slider
                  label="Master volume"
                  value={settings.audio.master}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(v) => store.updateSettings((s) => ({ ...s, audio: { ...s.audio, master: v } }))}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
              </div>
            )}

            {net ? (
              <div className="mt-5">
                <Button variant="outline" size="sm" onClick={quit}>
                  <LogOut size={14} /> Back to the room
                </Button>
              </div>
            ) : (
              <div className="mt-5 grid grid-cols-3 gap-2">
                <Button variant="outline" size="sm" onClick={restart}>
                  <RotateCcw size={14} /> Restart
                </Button>
                <Button variant="outline" size="sm" onClick={endSession} disabled={status === 'ready'}>
                  <Square size={14} /> End session
                </Button>
                <Button variant="danger" size="sm" onClick={quit}>
                  <LogOut size={14} /> Quit
                </Button>
              </div>
            )}
            <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-dim">
              <span>WASD move · Shift walk</span>
              <span>Ctrl / C crouch · Space jump</span>
              <span>LMB fire · RMB aim / burst</span>
              <span>R reload · 1 / 2 or wheel weapons{config.mode === 'retake' ? ' · E defuse' : ''}</span>
              <span>B weapon menu</span>
              <span>{net ? 'Esc menu · Tab scoreboard' : 'Esc pause'}</span>
            </div>
          </div>
        </div>
      )}

      {report && (
        <div className="absolute inset-0 overflow-y-auto bg-bg/95 p-8">
          <div className="mx-auto max-w-4xl animate-in">
            <div className="font-display text-sm font-semibold uppercase tracking-[0.25em] text-accent">Session complete</div>
            <div className="mb-4 font-display text-5xl font-bold uppercase">Session report</div>
            {routine && (
              <div className="mb-4 border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
                <span className="font-display font-bold uppercase tracking-widest text-accent">Daily routine</span> · drill {routine.index + 1} of {routine.steps.length}
                {' · '}
                {routine.titles[routine.index]} · running total{' '}
                <span className="font-semibold text-ink">{routine.scores.reduce((a, b) => a + b, 0)}</span>
              </div>
            )}
            <SessionReportBody s={report} />
            <div className="mt-6 flex flex-wrap gap-2">
              {routine ? (
                <Button onClick={() => store.nextRoutineStep()}>
                  <ChevronRight size={16} /> {routine.index + 1 < routine.steps.length ? `Next drill: ${routine.titles[routine.index + 1]}` : 'Finish routine'}
                </Button>
              ) : (
                <Button onClick={() => store.play({ ...config, ...loadout })}>
                  <RotateCcw size={16} /> Play again
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  store.stopPlaying();
                  store.go('practice');
                }}
              >
                Change setup
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  store.stopPlaying();
                  store.go('statistics');
                }}
              >
                View statistics
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
