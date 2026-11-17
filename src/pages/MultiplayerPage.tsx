import { LogIn, Plus, RotateCcw, Search, Timer, Users, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, PageHeader, cx } from '../components/ui';
import { Scoreboard } from '../components/Scoreboard';
import { MAP_SUMMARIES } from '../game/maps/registry';
import { mapName } from '../utils/labels';
import { RoomLobby } from '../components/RoomLobby';
import { multiplayer, useMultiplayer } from '../multiplayer/client';
import { MAX_NAME_LENGTH, sanitizeName } from '../net/protocol';
import { ROOM_CODE_LENGTH } from '../net/roomCode';
import { MAX_ROOM_PLAYERS, QUICK_MATCH_SETTINGS } from '../net/settings';

export function MultiplayerPage() {
  const room = useMultiplayer((s) => s.room);
  const available = useMultiplayer((s) => s.available);

  const searching = useMultiplayer((s) => s.queue !== null);

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
      <PageHeader kicker="Multiplayer" title="Play with others" />
      {available ? <Entry /> : <Unavailable />}
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

function Entry() {
  const name = useMultiplayer((s) => s.name);
  const status = useMultiplayer((s) => s.status);
  const error = useMultiplayer((s) => s.error);
  const invite = useMultiplayer((s) => s.invite);
  const result = useMultiplayer((s) => s.result);
  const playerId = useMultiplayer((s) => s.playerId);
  const [code, setCode] = useState(invite ?? '');

  const hasName = sanitizeName(name) !== null;
  const busy = status === 'connecting' || status === 'reconnecting';
  const codeReady = code.replace(/[\s-]/g, '').length === ROOM_CODE_LENGTH;

  return (
    <div className="space-y-5">
      {invite && (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-info/40 bg-info/10 px-4 py-3 text-sm text-ink">
          <span>
            You were invited to room <span className="font-display text-lg font-bold tracking-[0.2em]">{invite}</span>.{' '}
            {hasName ? 'Join when you are ready.' : 'Choose a display name, then join.'}
          </span>
          <div className="flex gap-2">
            <Button size="sm" disabled={!hasName || busy} onClick={() => multiplayer.joinRoom(invite)}>
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
        <Card
          title="Last match"
          right={
            <div className="flex gap-2">
              <Button size="sm" disabled={!hasName || busy} onClick={() => multiplayer.findMatch(multiplayer.get().quickMaps)}>
                <RotateCcw size={16} /> Play again
              </Button>
              <Button size="sm" variant="ghost" onClick={() => multiplayer.dismissResult()}>
                Dismiss
              </Button>
            </div>
          }
        >
          <Scoreboard scores={result.scores} settings={result.settings} me={playerId} winner={result.winner} />
        </Card>
      )}

      <Card title="Display name">
        <label className="block max-w-sm">
          <input
            className="w-full border border-line bg-bg px-3 py-2 text-lg text-ink outline-none focus:border-accent"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            placeholder="What others see"
            aria-label="Display name"
            onChange={(e) => multiplayer.setName(e.target.value)}
          />
          <span className="mt-1.5 block text-xs text-dim">The only thing other players know about you. No account needed.</span>
        </label>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Custom room" right={<Badge tone="ok">Up to {MAX_ROOM_PLAYERS} players</Badge>}>
          <p className="mb-4 text-sm text-mute">Create a room, send the link to friends, pick the map and the rules, and start when everyone is in.</p>
          <Button size="lg" disabled={!hasName || busy} onClick={() => multiplayer.createRoom()}>
            <Plus size={20} /> Create room
          </Button>

          <div className="mt-6 border-t border-line pt-5">
            <div className="mb-2 text-xs uppercase tracking-widest text-dim">Join with a code</div>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (hasName && codeReady) multiplayer.joinRoom(code);
              }}
            >
              <input
                className="w-44 border border-line bg-bg px-3 py-2 font-display text-xl font-bold uppercase tracking-[0.25em] text-ink outline-none placeholder:text-dim focus:border-accent"
                value={code}
                maxLength={ROOM_CODE_LENGTH + 2}
                placeholder="K7M2QX"
                aria-label="Room code"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <Button type="submit" variant="outline" disabled={!hasName || !codeReady || busy}>
                <LogIn size={18} /> Join
              </Button>
            </form>
          </div>
          {!hasName && <p className="mt-3 text-xs text-warn">Choose a display name first.</p>}
          {busy && <p className="mt-3 text-xs text-mute">Connecting to the game server… If nobody has played for a while it is asleep and takes up to a minute to wake.</p>}
        </Card>

        <QuickMatchCard disabled={!hasName || busy} />
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
    cx('border px-3 py-1.5 font-display text-sm font-semibold uppercase tracking-wider transition-colors', on ? 'border-accent bg-accent/15 text-ink' : 'border-line bg-bg/60 text-mute hover:border-mute hover:text-ink');

  return (
    <Card title="Quick match" right={<Badge tone="ok">Starts by itself</Badge>}>
      <p className="mb-4 text-sm text-mute">Pick the maps you are happy to play, wait for other players, and the match starts by itself. You may join one already under way.</p>
      <div className="mb-2 text-xs uppercase tracking-widest text-dim">Maps</div>
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
      <p className="mt-2 text-xs text-dim">{maps.length === 0 ? 'Any map finds a match fastest.' : 'Fewer maps can mean a longer wait.'}</p>
      <Button size="lg" className="mt-5" disabled={disabled} onClick={() => multiplayer.findMatch(maps)}>
        <Search size={20} /> Find match
      </Button>
      <ul className="mt-5 space-y-2 border-t border-line pt-4 text-sm text-mute">
        <li className="flex items-center gap-2">
          <Users size={16} className="text-dim" /> Deathmatch, up to {QUICK_MATCH_SETTINGS.maxPlayers} players, all weapons
        </li>
        <li className="flex items-center gap-2">
          <Timer size={16} className="text-dim" /> {QUICK_MATCH_SETTINGS.timeLimitMin} minutes, first to {QUICK_MATCH_SETTINGS.killLimit} kills
        </li>
      </ul>
    </Card>
  );
}

function Searching() {
  const queue = useMultiplayer((s) => s.queue);
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
  const startsIn = queue.startsAt > 0 ? Math.max(0, Math.ceil((queue.startsAt - (now + clockOffset)) / 1000)) : null;
  const others = queue.waiting - 1;
  const alone = others <= 0 && elapsed >= 60;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-dim">Searching for</div>
          <div className="font-display tabular text-5xl font-bold leading-none text-ink">
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-dim">Maps</div>
          <div className="text-base text-ink">{queue.maps.length === 0 ? 'Any map' : queue.maps.map(mapName).join(', ')}</div>
        </div>
        <div role="status">
          <div className="text-xs uppercase tracking-widest text-dim">Players</div>
          <div className="text-base text-ink">
            {status !== 'online'
              ? 'Connecting to the game server… (up to a minute if it was asleep)'
              : startsIn !== null
                ? `${queue.waiting} waiting · match starts in ${startsIn} s`
                : others > 0
                  ? `${queue.waiting} waiting`
                  : 'Nobody else is searching yet'}
          </div>
        </div>
        <Button variant="outline" className="ml-auto" onClick={() => multiplayer.cancelSearch()}>
          <X size={18} /> Cancel
        </Button>
      </div>
      <div className="tal-loadbar mt-5" />
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
