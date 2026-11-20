import { Bot, Check, LogIn, Pencil, Plus, RotateCcw, Search, Timer, Users, X } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { Button, Card, PageHeader, cx } from '../components/ui';
import { AgentPicker, AgentPortrait } from '../components/AgentPicker';
import { getAgent } from '../game/agents';
import { store, useAppStore } from '../hooks/useAppStore';
import { normaliseConfig } from './PracticePage';
import { showSettingsSection } from './SettingsPage';
import { MatchResultView } from '../components/Scoreboard';
import { MAP_SUMMARIES } from '../game/maps/registry';
import { mapName } from '../utils/labels';
import { RoomLobby } from '../components/RoomLobby';
import { multiplayer, useMultiplayer } from '../multiplayer/client';
import { MAX_NAME_LENGTH, QUEUE_START_DELAY_MS, sanitizeName } from '../net/protocol';
import { ROOM_CODE_LENGTH } from '../net/roomCode';
import { MAX_ROOM_PLAYERS, QUICK_MATCH_SETTINGS } from '../net/settings';

export function MultiplayerPage() {
  const room = useMultiplayer((s) => s.room);
  const available = useMultiplayer((s) => s.available);

  const searching = useMultiplayer((s) => s.queue !== null);
  const hasName = useMultiplayer((s) => sanitizeName(s.name) !== null);

  // a reload returns to the room this tab was in; leaving the page ends a connection nothing is using
  useEffect(() => {
    multiplayer.resume();
    return () => multiplayer.idle();
  }, []);

  if (room) return <RoomLobby room={room} />;
  if (searching)
    return (
      <div>
        <PageHeader kicker="Quick match" title="Finding a match" />
        <Searching />
      </div>
    );

  return (
    <div>
      <PageHeader kicker="Multiplayer" title="Play with others">
        {available && hasName && <PlayerTag />}
      </PageHeader>
      {!available ? <Unavailable /> : hasName ? <Entry /> : <CallsignGate />}
    </div>
  );
}

function Unavailable() {
  return (
    <Card title="Multiplayer is not available in this build">
      <p className="max-w-2xl text-sm text-mute">
        Playing with others needs a game server, and this copy of the app was built without one. Everything else works as usual. To turn multiplayer on, run the
        server (<code className="text-ink">npm run server</code>) and build the app with <code className="text-ink">VITE_MP_SERVER</code> set to its address.
      </p>
    </Card>
  );
}

/** The player's tag: their picture, name and agent. The name is changed in Settings. */
export function PlayerTag() {
  const name = useMultiplayer((s) => s.name);
  const agent = getAgent(useMultiplayer((s) => s.agent));
  return (
    <div className="tal-playercard" style={{ '--agent': agent.accent } as CSSProperties}>
      <AgentPortrait agent={agent} className="h-14 w-14 shrink-0" />
      <div className="min-w-0 self-center">
        <div className="max-w-[14rem] truncate font-display text-xl font-bold uppercase leading-none tracking-wide text-ink">{sanitizeName(name) ?? 'No name'}</div>
        <div className="mt-1 text-xs uppercase tracking-widest" style={{ color: agent.accent }}>
          {agent.name}
        </div>
      </div>
      <button
        type="button"
        title="Change your name in Settings"
        aria-label="Change your name in Settings"
        onClick={() => {
          showSettingsSection('profile');
          store.go('settings');
        }}
        className="ml-1 self-center p-1.5 text-dim transition-colors hover:text-ink"
      >
        <Pencil size={15} />
      </button>
    </div>
  );
}

/** First visit: the player picks the name others will see. Asked once; afterwards it is changed in Settings. */
function CallsignGate() {
  const invite = useMultiplayer((s) => s.invite);
  const [draft, setDraft] = useState('');
  const clean = sanitizeName(draft);
  return (
    <div className="grid place-items-center py-6 lg:py-16">
      <form
        className="tal-callsign tal-rise"
        onSubmit={(e) => {
          e.preventDefault();
          if (!clean) return;
          multiplayer.setName(clean);
          multiplayer.nameChosen();
        }}
      >
        <div className="font-display text-xs font-semibold uppercase tracking-[0.4em] text-accent">{invite ? `Invited to room ${invite}` : 'Before you drop in'}</div>
        <h2 className="mt-1 font-display text-5xl font-extrabold uppercase leading-none tracking-[0.04em] text-white">Choose your callsign</h2>
        <p className="mx-auto mt-3 max-w-sm text-sm text-mute">The name other players see on the scoreboard and the kill feed. No account needed.</p>
        <input
          autoFocus
          className="tal-callsign-input mt-6"
          value={draft}
          maxLength={MAX_NAME_LENGTH}
          placeholder="CALLSIGN"
          aria-label="Callsign"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" size="lg" className="mt-5 w-full" disabled={!clean}>
          <Check size={20} /> Lock in
        </Button>
        <p className="mt-3 text-xs text-dim">You only do this once. It can be changed later in Settings.</p>
      </form>
    </div>
  );
}

function Entry() {
  const status = useMultiplayer((s) => s.status);
  const error = useMultiplayer((s) => s.error);
  const invite = useMultiplayer((s) => s.invite);
  const result = useMultiplayer((s) => s.result);
  const playerId = useMultiplayer((s) => s.playerId);
  const [code, setCode] = useState(invite ?? '');

  const busy = status === 'connecting' || status === 'reconnecting';
  const codeReady = code.replace(/[\s-]/g, '').length === ROOM_CODE_LENGTH;

  return (
    <div className="space-y-5">
      {invite && (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-info/40 bg-info/10 px-4 py-3 text-sm text-ink">
          <span>
            You were invited to room <span className="font-display text-lg font-bold tracking-[0.2em]">{invite}</span>. Join when you are ready.
          </span>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => multiplayer.joinRoom(invite)}>
              <LogIn size={16} /> Join room
            </Button>
            <Button size="sm" variant="ghost" onClick={() => multiplayer.dismissInvite()}>
              Not now
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 border border-accent/50 bg-accent/10 px-4 py-3 text-sm text-ink">
          <span>{error}</span>
          <Button size="sm" variant="ghost" onClick={() => multiplayer.clearError()}>
            Dismiss
          </Button>
        </div>
      )}

      {result && (
        <MatchResultView scores={result.scores} settings={result.settings} winner={result.winner} me={playerId}>
          <Button disabled={busy} onClick={() => multiplayer.findMatch(multiplayer.get().quickMaps)}>
            <RotateCcw size={16} /> Play again
          </Button>
          <Button variant="ghost" onClick={() => multiplayer.dismissResult()}>
            Dismiss
          </Button>
        </MatchResultView>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
        <AgentPicker />

        <div className="flex flex-col gap-5">
          <QuickMatchCard disabled={busy} />

          <section className="tal-mode tal-rise" style={{ '--i': 2 } as CSSProperties}>
            <span className="tal-mode-index" aria-hidden="true">
              02
            </span>
            <div className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-info">With friends · up to {MAX_ROOM_PLAYERS}</div>
            <h2 className="font-display text-3xl font-extrabold uppercase leading-none tracking-[0.05em] text-ink">Custom room</h2>
            <p className="mt-2 text-sm text-mute">Your map, your rules. Send the link and start when everyone is in.</p>
            <div className="mt-4 flex flex-wrap items-stretch gap-2">
              <Button variant="outline" disabled={busy} onClick={() => multiplayer.createRoom()}>
                <Plus size={18} /> Create room
              </Button>
              <form
                className="flex flex-1 items-stretch gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (codeReady) multiplayer.joinRoom(code);
                }}
              >
                <input
                  className="min-w-0 flex-1 border border-line bg-black/40 px-3 font-display text-xl font-bold uppercase tracking-[0.25em] text-ink outline-none placeholder:text-dim focus:border-accent"
                  value={code}
                  maxLength={ROOM_CODE_LENGTH + 2}
                  placeholder="CODE"
                  aria-label="Room code"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
                <Button type="submit" variant="outline" disabled={!codeReady || busy}>
                  <LogIn size={18} /> Join
                </Button>
              </form>
            </div>
          </section>

          {busy && <p className="text-xs text-mute">Connecting to the game server… If nobody has played for a while it is asleep and takes up to a minute to wake.</p>}
        </div>
      </div>
    </div>
  );
}

function QuickMatchCard({ disabled }: { disabled: boolean }) {
  const saved = useMultiplayer((s) => s.quickMaps);
  /** Empty = any map. */
  const [maps, setMaps] = useState<string[]>(saved);
  const toggle = (id: string) => setMaps((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  const chip = (on: boolean) =>
    cx('border px-3 py-1.5 font-display text-sm font-semibold uppercase tracking-wider transition-colors', on ? 'border-accent bg-accent/15 text-ink' : 'border-line bg-black/30 text-mute hover:border-mute hover:text-ink');

  return (
    <section className="tal-mode tal-rise" data-primary="true" style={{ '--i': 1 } as CSSProperties}>
      <span className="tal-mode-index" aria-hidden="true">
        01
      </span>
      <div className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-accent">Deathmatch · starts by itself</div>
      <h2 className="font-display text-4xl font-extrabold uppercase leading-none tracking-[0.05em] text-white">Quick match</h2>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-mute">
        <span className="flex items-center gap-1.5">
          <Users size={15} className="text-dim" /> Up to {QUICK_MATCH_SETTINGS.maxPlayers}, bots fill in
        </span>
        <span className="flex items-center gap-1.5">
          <Timer size={15} className="text-dim" /> {QUICK_MATCH_SETTINGS.timeLimitMin} min · first to {QUICK_MATCH_SETTINGS.killLimit}
        </span>
      </div>
      <div className="mb-2 mt-4 text-xs uppercase tracking-widest text-dim">Maps</div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={maps.length === 0} className={chip(maps.length === 0)} onClick={() => setMaps([])}>
          Any map
        </button>
        {MAP_SUMMARIES.map((m) => (
          <button key={m.id} type="button" aria-pressed={maps.includes(m.id)} className={chip(maps.includes(m.id))} onClick={() => toggle(m.id)}>
            {m.name}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-dim">
        {maps.length === 0 ? 'Any map finds a match fastest.' : 'Fewer maps can mean a longer wait.'} A match starts within {QUEUE_START_DELAY_MS / 1000} seconds.
      </p>
      <Button size="lg" className="mt-4 w-full" disabled={disabled} onClick={() => multiplayer.findMatch(maps)}>
        <Search size={20} /> Find match
      </Button>
    </section>
  );
}

/** Seconds of "connecting" (a sleeping server takes up to a minute to wake) before a bot match starts instead. */
const BOT_FALLBACK_SEC = 12;

function Searching() {
  const queue = useMultiplayer((s) => s.queue);
  const practice = useAppStore((s) => s.practice);
  const [keepWaiting, setKeepWaiting] = useState(false);
  const since = useMultiplayer((s) => s.queueSince);
  const status = useMultiplayer((s) => s.status);
  const clockOffset = useMultiplayer((s) => s.clockOffset);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (!queue) return null;

  const elapsed = Math.max(0, Math.floor((now - since) / 1000));
  const waking = status !== 'online';
  const botsIn = BOT_FALLBACK_SEC - elapsed;
  const playBots = () => {
    multiplayer.cancelSearch();
    store.play(normaliseConfig({ ...practice, mode: 'deathmatch', botCount: 5, durationSec: 300, playerSpawnId: '', enemySpotIds: [] }));
  };
  if (waking && !keepWaiting && botsIn <= 0) {
    // nobody should sit looking at a spinner: play against bots while the server wakes
    queueMicrotask(playBots);
    return null;
  }
  const startsIn = queue.startsAt > 0 ? Math.max(0, Math.ceil((queue.startsAt - (now + clockOffset)) / 1000)) : null;
  const others = queue.waiting - 1;
  const alone = others <= 0 && elapsed >= 60;

  /** Where the other searchers show on the radar: fixed spots, one per player, so they don't jump about. */
  const blips = Array.from({ length: Math.min(9, Math.max(0, others)) }, (_, i) => {
    const angle = i * 2.4 + 0.6;
    const radius = 18 + ((i * 13) % 26);
    return { '--x': `${50 + Math.cos(angle) * radius}%`, '--y': `${50 + Math.sin(angle) * radius}%` } as CSSProperties;
  });

  return (
    <Card>
      <div className="flex flex-col items-center gap-8 py-4 md:flex-row md:justify-center md:gap-14">
        <div className="tal-radar grid place-items-center" aria-hidden="true">
          {blips.map((style, i) => (
            <span key={i} className="tal-radar-blip" style={style} />
          ))}
          <div className="relative z-10 text-center">
            <div className="font-display tabular text-6xl font-extrabold leading-none text-white">
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
            </div>
            <div className="mt-1 font-display text-xs font-semibold uppercase tracking-[0.3em] text-accent">Searching</div>
          </div>
        </div>
        <div className="max-w-sm text-center md:text-left">
          <div className="text-xs uppercase tracking-widest text-dim">Maps</div>
          <div className="font-display text-2xl font-bold uppercase leading-tight tracking-wide text-ink">{queue.maps.length === 0 ? 'Any map' : queue.maps.map(mapName).join(' · ')}</div>
          <div role="status" className="mt-4">
            <div className="text-xs uppercase tracking-widest text-dim">Status</div>
            <div className="text-base text-ink">
              {waking
                ? keepWaiting
                  ? 'Waking the game server… (up to a minute)'
                  : `Waking the game server… a match against bots starts in ${Math.max(0, botsIn)} s`
                : startsIn !== null
                  ? `${others > 0 ? `${queue.waiting} players searching` : 'Bots will join you'} · match starts in ${startsIn} s`
                  : others > 0
                    ? `${queue.waiting} players searching`
                    : 'Looking for a match'}
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            {waking && (
              <Button onClick={playBots}>
                <Bot size={18} /> Play bots now
              </Button>
            )}
            {waking && !keepWaiting && (
              <Button variant="outline" onClick={() => setKeepWaiting(true)}>
                Keep waiting
              </Button>
            )}
            <Button variant="outline" onClick={() => multiplayer.cancelSearch()}>
              <X size={18} /> Cancel
            </Button>
          </div>
        </div>
      </div>
      {alone && (
        <p className="mt-4 text-sm text-warn">
          Nobody else has been searching for a minute.{' '}
          {queue.maps.length > 0 ? 'Searching on any map reaches more players: ' : 'You can keep waiting, or play with friends in a custom room: '}
          {queue.maps.length > 0 ? (
            <button className="underline underline-offset-2 hover:text-ink" onClick={() => multiplayer.findMatch([])}>
              search any map
            </button>
          ) : (
            <button className="underline underline-offset-2 hover:text-ink" onClick={() => multiplayer.cancelSearch()}>
              cancel the search
            </button>
          )}
          .
        </p>
      )}
    </Card>
  );
}
