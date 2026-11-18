import { describe, expect, it } from 'vitest';
import { Lobby, type Connection } from '../server/Lobby';
import {
  COUNTDOWN_MS,
  IDLE_KICK_MS,
  QUEUE_START_DELAY_MS,
  PROTOCOL_VERSION,
  RECONNECT_GRACE_MS,
  SCOREBOARD_MS,
  decodeServer,
  encode,
  type ClientMessage,
  type RoomState,
  type ServerMessage,
} from '../src/net/protocol';

/** A browser, as the lobby sees it: what it was sent, and a way to send. */
class Client implements Connection {
  inbox: ServerMessage[] = [];
  closed = false;
  id = '';
  resume = '';
  address?: string;
  constructor(
    private readonly lobby: Lobby,
    readonly name: string,
    resume?: string,
  ) {
    lobby.connect(this);
    this.say({ t: 'hello', version: PROTOCOL_VERSION, name, resume });
    const w = this.last('welcome');
    if (w) {
      this.id = w.playerId;
      this.resume = w.resume;
    }
  }
  send(data: string) {
    this.inbox.push(decodeServer(data)!);
  }
  close() {
    this.closed = true;
    this.lobby.disconnect(this);
  }
  say(msg: ClientMessage) {
    this.lobby.receive(this, encode(msg));
  }
  last<T extends ServerMessage['t']>(t: T) {
    return [...this.inbox].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined;
  }
  get room(): RoomState {
    return this.last('room.state')!.room;
  }
  get error() {
    return this.last('error')?.code;
  }
  /** The latest word on the search: a state while waiting, null once placed or cancelled, undefined if never queued. */
  get queue() {
    return this.last('queue.state')?.queue;
  }
  /** The room this client is in now, or null (it may have been in one before). */
  get inRoom(): RoomState | null {
    const types = this.inbox.map((m) => m.t);
    const left = types.lastIndexOf('room.left');
    const state = types.lastIndexOf('room.state');
    return state > left ? this.room : null;
  }
}

function setup() {
  let n = 0;
  const lobby = new Lobby({ token: () => `token-${n++}-xxxxxxxxxxxx` });
  lobby.tick(1000);
  return lobby;
}

/** A room with a host and one guest. */
function roomOfTwo() {
  const lobby = setup();
  const host = new Client(lobby, 'Sova');
  host.say({ t: 'room.create' });
  const guest = new Client(lobby, 'Jett');
  guest.say({ t: 'room.join', code: host.room.code });
  return { lobby, host, guest, code: host.room.code };
}

describe('lobby', () => {
  it('creates a room and lets a friend join by code', () => {
    const { host, guest, code } = roomOfTwo();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    for (const c of [host, guest]) {
      expect(c.room.players.map((p) => [p.name, p.host])).toEqual([
        ['Sova', true],
        ['Jett', false],
      ]);
      expect(c.room.phase).toBe('lobby');
    }
    expect(guest.id).not.toBe(host.id);
  });

  it('reads codes however they are typed, and reports wrong ones', () => {
    const { lobby, code } = roomOfTwo();
    const typed = new Client(lobby, 'Omen');
    typed.say({ t: 'room.join', code: ` ${code.slice(0, 3).toLowerCase()}-${code.slice(3).toLowerCase()} ` });
    expect(typed.room.players).toHaveLength(3);
    const lost = new Client(lobby, 'Sage');
    lost.say({ t: 'room.join', code: 'ZZZZZZ' });
    expect(lost.error).toBe('room-not-found');
    expect(lost.last('room.state')).toBeUndefined();
  });

  it('refuses old clients, missing names and messages before hello', () => {
    const lobby = setup();
    const stranger: Connection & { inbox: ServerMessage[] } = { inbox: [], send: (d) => stranger.inbox.push(decodeServer(d)!), close() {} };
    lobby.connect(stranger);
    lobby.receive(stranger, encode({ t: 'room.create' }));
    expect(stranger.inbox.at(-1)).toMatchObject({ t: 'error', code: 'bad-message' });
    lobby.receive(stranger, encode({ t: 'hello', version: PROTOCOL_VERSION + 1, name: 'Old' }));
    expect(stranger.inbox.at(-1)).toMatchObject({ t: 'error', code: 'version' });
    expect(new Client(lobby, '   ').error).toBe('name-rejected');
    lobby.receive(stranger, 'garbage');
    expect(lobby.roomCount).toBe(0);
  });

  it('tells two players with the same name apart', () => {
    const { lobby, code } = roomOfTwo();
    const twin = new Client(lobby, 'jett');
    twin.say({ t: 'room.join', code });
    expect(twin.room.players.map((p) => p.name)).toEqual(['Sova', 'Jett', 'jett (2)']);
  });

  it('lets only the host change settings, and shows everyone the change', () => {
    const { host, guest } = roomOfTwo();
    guest.say({ t: 'room.settings', patch: { mapId: 'kitsune' } });
    expect(guest.error).toBe('not-host');
    expect(host.room.settings.mapId).toBe('vellora');
    host.say({ t: 'room.settings', patch: { mapId: 'kitsune', timeLimitMin: 15, killLimit: 9999 } });
    expect(guest.room.settings).toMatchObject({ mapId: 'kitsune', timeLimitMin: 15, killLimit: 40 });
    // the room can't shrink below the players in it
    host.say({ t: 'room.settings', patch: { maxPlayers: 2 } });
    expect(host.room.settings.maxPlayers).toBe(2);
  });

  it('is full at the player limit', () => {
    const { lobby, host, code } = roomOfTwo();
    host.say({ t: 'room.settings', patch: { maxPlayers: 2 } });
    const third = new Client(lobby, 'Omen');
    third.say({ t: 'room.join', code });
    expect(third.error).toBe('room-full');
    expect(host.room.players).toHaveLength(2);
  });

  it('shows who is ready', () => {
    const { host, guest } = roomOfTwo();
    guest.say({ t: 'room.ready', ready: true });
    expect(host.room.players.map((p) => p.ready)).toEqual([false, true]);
  });

  it('puts players on teams in Team Deathmatch', () => {
    const { lobby, host, guest, code } = roomOfTwo();
    host.say({ t: 'room.settings', patch: { mode: 'team-deathmatch' } });
    expect(host.room.players.map((p) => p.team)).toEqual(['a', 'b']);
    const third = new Client(lobby, 'Omen');
    third.say({ t: 'room.join', code });
    expect(third.room.players[2].team).toBe('a');
    guest.say({ t: 'room.team', team: 'a' });
    guest.say({ t: 'room.team', team: 'b', id: host.id }); // only the host moves other players
    expect(host.room.players.map((p) => p.team)).toEqual(['a', 'a', 'a']);
    host.say({ t: 'room.team', team: 'b', id: third.id });
    expect(host.room.players.map((p) => p.team)).toEqual(['a', 'a', 'b']);
    host.say({ t: 'room.settings', patch: { mode: 'deathmatch' } });
    expect(host.room.players.every((p) => p.team === null)).toBe(true);
  });

  it('lets the host kick and hand over the role', () => {
    const { lobby, host, guest, code } = roomOfTwo();
    const third = new Client(lobby, 'Omen');
    third.say({ t: 'room.join', code });
    guest.say({ t: 'room.kick', id: third.id });
    expect(guest.error).toBe('not-host');
    host.say({ t: 'room.kick', id: third.id });
    expect(third.last('room.left')?.reason).toBe('kicked');
    expect(host.room.players).toHaveLength(2);
    host.say({ t: 'room.host', id: guest.id });
    expect(host.room.players.map((p) => p.host)).toEqual([false, true]);
  });

  it('passes the host role on when the host leaves, and closes an empty room', () => {
    const { lobby, host, guest } = roomOfTwo();
    host.say({ t: 'room.leave' });
    expect(host.last('room.left')?.reason).toBe('left');
    expect(guest.room.players).toEqual([expect.objectContaining({ name: 'Jett', host: true })]);
    guest.say({ t: 'room.leave' });
    expect(lobby.roomCount).toBe(0);
  });

  it('runs a match through its phases and returns to the lobby', () => {
    const { lobby, host, guest } = roomOfTwo();
    guest.say({ t: 'room.start' });
    expect(guest.error).toBe('not-host');
    guest.say({ t: 'room.ready', ready: true });
    host.say({ t: 'room.settings', patch: { timeLimitMin: 5 } });
    host.say({ t: 'room.start' });
    expect(guest.room).toMatchObject({ phase: 'countdown', phaseEndsAt: 1000 + COUNTDOWN_MS });
    host.say({ t: 'room.settings', patch: { mapId: 'kitsune' } }); // locked once the countdown starts
    expect(host.room.settings.mapId).toBe('vellora');

    let now = 1000 + COUNTDOWN_MS;
    lobby.tick(now);
    expect(guest.room).toMatchObject({ phase: 'playing', phaseEndsAt: now + 5 * 60_000 });
    now += 5 * 60_000;
    lobby.tick(now);
    expect(guest.room).toMatchObject({ phase: 'scoreboard', phaseEndsAt: now + SCOREBOARD_MS });
    lobby.tick(now + SCOREBOARD_MS);
    expect(guest.room).toMatchObject({ phase: 'lobby', phaseEndsAt: 0 });
    expect(guest.room.players.every((p) => !p.ready)).toBe(true);
  });

  it('lets one player start a match against bots', () => {
    const lobby = setup();
    const host = new Client(lobby, 'Sova');
    host.say({ t: 'room.create' });
    host.say({ t: 'room.settings', patch: { botFill: 4, botDifficulty: 'hard' } });
    host.say({ t: 'room.start' });
    expect(host.error).toBeUndefined();
    lobby.tick(1000 + COUNTDOWN_MS);
    expect(host.room.phase).toBe('playing');
    const bots = () => host.last('scores')!.scores.filter((p) => p.bot).length;
    expect(bots()).toBe(3);
    // a friend joining takes a bot's place; leaving gives it back
    const friend = new Client(lobby, 'Jett');
    friend.say({ t: 'room.join', code: host.room.code });
    expect(bots()).toBe(2);
    expect(host.last('scores')!.scores).toHaveLength(4);
    friend.say({ t: 'room.leave' });
    expect(bots()).toBe(3);
  });

  it('needs two players to start, and lets the host end early', () => {
    const lobby = setup();
    const host = new Client(lobby, 'Sova');
    host.say({ t: 'room.create' });
    host.say({ t: 'room.start' });
    expect(host.error).toBe('not-enough-players');
    const guest = new Client(lobby, 'Jett');
    guest.say({ t: 'room.join', code: host.room.code });
    host.say({ t: 'room.start' });
    host.say({ t: 'room.end' }); // during the countdown: straight back to the lobby
    expect(host.room.phase).toBe('lobby');
    host.say({ t: 'room.start' });
    lobby.tick(1000 + COUNTDOWN_MS);
    host.say({ t: 'room.end' });
    expect(guest.room.phase).toBe('scoreboard');
  });

  it('respects the join-in-progress setting', () => {
    const { lobby, host, code } = roomOfTwo();
    host.say({ t: 'room.settings', patch: { joinInProgress: false } });
    host.say({ t: 'room.start' });
    const late = new Client(lobby, 'Omen');
    late.say({ t: 'room.join', code });
    expect(late.error).toBe('match-in-progress');
  });

  it('shows each player’s agent and ignores ones that do not exist', () => {
    const { host, guest } = roomOfTwo();
    expect(host.room.players[1].agent).toBe('ranger');
    guest.say({ t: 'agent', agent: 'slate' });
    expect(host.room.players[1].agent).toBe('slate');
    guest.say({ t: 'agent', agent: 'nobody' } as never);
    expect(host.room.players[1].agent).toBe('slate');
  });

  it('keeps a dropped player’s place and gives it back on reconnect', () => {
    const { lobby, host, guest } = roomOfTwo();
    lobby.disconnect(guest);
    expect(host.room.players[1]).toMatchObject({ name: 'Jett', connected: false });
    lobby.tick(1000 + RECONNECT_GRACE_MS - 1);
    const back = new Client(lobby, 'Jett', guest.resume);
    expect(back.id).toBe(guest.id);
    expect(back.room.players[1]).toMatchObject({ name: 'Jett', connected: true });
    expect(host.room.players).toHaveLength(2);
  });

  it('holds a dropped host’s role during the grace period, then passes it on', () => {
    const { lobby, host, guest } = roomOfTwo();
    lobby.disconnect(host);
    expect(guest.room.players.map((p) => [p.name, p.host, p.connected])).toEqual([
      ['Sova', true, false],
      ['Jett', false, true],
    ]);
    lobby.tick(1000 + RECONNECT_GRACE_MS);
    expect(guest.room.players).toEqual([expect.objectContaining({ name: 'Jett', host: true })]);
    // too late: the token no longer brings the old place back
    const back = new Client(lobby, 'Sova', host.resume);
    expect(back.id).not.toBe(host.id);
    expect(back.last('room.state')).toBeUndefined();
  });

  it('gives a reloading host the room back', () => {
    const { lobby, host, guest } = roomOfTwo();
    lobby.disconnect(host);
    const back = new Client(lobby, 'Sova', host.resume);
    expect(back.last('welcome')?.room).toBe(guest.room.code);
    expect(guest.room.players.map((p) => [p.name, p.host, p.connected])).toEqual([
      ['Sova', true, true],
      ['Jett', false, true],
    ]);
  });

  it('cancels a countdown when a player drops out of a two-player room', () => {
    const { lobby, host, guest } = roomOfTwo();
    host.say({ t: 'room.start' });
    lobby.disconnect(guest);
    expect(host.room.phase).toBe('lobby');
  });

  it('answers pings and shows the measured latency', () => {
    const { lobby, host, guest } = roomOfTwo();
    guest.say({ t: 'ping', time: 5, rtt: 42.4 });
    expect(guest.last('pong')).toMatchObject({ time: 5, serverTime: 1000 });
    lobby.tick(4000);
    expect(host.room.players[1].ping).toBe(42);
  });

  it('stops an address guessing codes or creating rooms in bulk', () => {
    const { lobby, code } = roomOfTwo();
    const guesser = new Client(lobby, 'Guess');
    guesser.address = '203.0.113.9';
    for (let i = 0; i < 10; i++) guesser.say({ t: 'room.join', code: 'ZZZZZ2' });
    expect(guesser.error).toBe('room-not-found');
    guesser.say({ t: 'room.join', code }); // even the right code is refused now
    expect(guesser.error).toBe('rate-limited');
    expect(guesser.last('room.state')).toBeUndefined();
    // a second connection from the same address shares the count
    const again = new Client(lobby, 'Guess2');
    again.address = '203.0.113.9';
    again.say({ t: 'room.join', code });
    expect(again.error).toBe('rate-limited');
    // …and a minute later the address may try again
    lobby.tick(1000 + 61_000);
    guesser.say({ t: 'room.join', code });
    expect(guesser.room.players).toHaveLength(3);

    const maker = new Client(lobby, 'Maker');
    for (let i = 0; i < 6; i++) maker.say({ t: 'room.create' });
    expect(maker.error).toBeUndefined();
    maker.say({ t: 'room.create' });
    expect(maker.error).toBe('rate-limited');
  });

  it('drops a connection that floods it', () => {
    const lobby = new Lobby({ maxMessagesPerSec: 20 });
    lobby.tick(1000);
    const spammer = new Client(lobby, 'Spam');
    for (let i = 0; i < 30; i++) spammer.say({ t: 'ping', time: i });
    expect(spammer.error).toBe('rate-limited');
    expect(spammer.closed).toBe(true);
  });
});

describe('quick match', () => {
  /** Run the server's clock forward, ticking 30 times a second as the real one does. */
  function clock(lobby: Lobby) {
    let now = 1000;
    return {
      now: () => now,
      wait(ms: number) {
        for (const end = now + ms; now < end; ) {
          now = Math.min(end, now + 1000 / 30);
          lobby.tick(now);
        }
      },
    };
  }
  /** Keep a client looking busy so it isn't removed for idling. */
  const act = (c: Client, seq: number) => c.say({ t: 'input', cmds: [{ seq, dt: 1 / 120, held: 1, pressed: 0, yaw: seq * 0.01, pitch: 0, speed: 1 }] });

  it('gives a lone player a match with bots after the wait', () => {
    const lobby = setup();
    const t = clock(lobby);
    const a = new Client(lobby, 'Sova');
    a.say({ t: 'queue.join', maps: ['vellora'] });
    expect(a.queue).toEqual({ maps: ['vellora'], waiting: 1, startsAt: 1000 + QUEUE_START_DELAY_MS });
    t.wait(QUEUE_START_DELAY_MS - 2000);
    expect(a.inRoom).toBeNull();
    t.wait(3000);
    expect(a.queue).toBeNull();
    expect(a.room).toMatchObject({ kind: 'quick', phase: 'countdown', settings: { mapId: 'vellora', botFill: 6 } });
    expect(a.room.players.map((p) => p.name)).toEqual(['Sova']); // bots are not in the room, only in the match
    t.wait(COUNTDOWN_MS + 500);
    expect(a.room.phase).toBe('playing');
    const board = a.last('scores')!.scores;
    expect(board).toHaveLength(6);
    expect(board.filter((p) => p.bot)).toHaveLength(5);
    expect(a.last('snapshot')!.players).toHaveLength(5);
  });

  it('adds anyone who arrives during the wait, without restarting it', () => {
    const lobby = setup();
    const t = clock(lobby);
    const a = new Client(lobby, 'Sova');
    a.say({ t: 'queue.join', maps: ['vellora'] });
    const startsAt = t.now() + QUEUE_START_DELAY_MS;
    t.wait(5000);
    const b = new Client(lobby, 'Jett');
    b.say({ t: 'queue.join', maps: ['vellora'] });
    expect(a.queue).toEqual({ maps: ['vellora'], waiting: 2, startsAt });
    t.wait(5000);
    const c = new Client(lobby, 'Omen');
    c.say({ t: 'queue.join', maps: [] }); // any map
    expect(c.queue).toMatchObject({ waiting: 3, startsAt });
    expect(a.inRoom).toBeNull();
    t.wait(QUEUE_START_DELAY_MS - 10_000 + 1000);
    for (const p of [a, b, c]) {
      expect(p.queue).toBeNull();
      expect(p.room).toMatchObject({ kind: 'quick', phase: 'countdown', settings: { mapId: 'vellora', mode: 'deathmatch', killLimit: 40, timeLimitMin: 10 } });
      expect(p.room.players.map((x) => x.name)).toEqual(['Sova', 'Jett', 'Omen']);
      expect(p.room.players.some((x) => x.host)).toBe(false);
    }
    t.wait(COUNTDOWN_MS + 100);
    expect(a.room.phase).toBe('playing');
    expect(a.last('match.start')).toBeDefined();
    expect(a.last('scores')!.scores.filter((p) => p.bot)).toHaveLength(3); // three people, three bots: six in all
    expect(lobby.queueLength).toBe(0);
  });

  it('starts at once with a full lobby', () => {
    const lobby = setup();
    const players = Array.from({ length: 11 }, (_, i) => {
      const p = new Client(lobby, `P${i}`);
      p.say({ t: 'queue.join', maps: ['kitsune'] });
      return p;
    });
    expect(players.slice(0, 10).every((p) => p.inRoom?.phase === 'countdown')).toBe(true);
    expect(players[0].room.players).toHaveLength(10);
    // the eleventh takes a place only when one opens; the match is full
    expect(players[10].inRoom).toBeNull();
    expect(players[10].queue).toMatchObject({ waiting: 1 });
  });

  it('only groups players who accept the same map', () => {
    const lobby = setup();
    const t = clock(lobby);
    const a = new Client(lobby, 'Sova');
    const b = new Client(lobby, 'Jett');
    a.say({ t: 'queue.join', maps: ['vellora'] });
    b.say({ t: 'queue.join', maps: ['kitsune', 'not-a-map'] });
    expect(b.queue).toMatchObject({ maps: ['kitsune'], waiting: 1 });
    t.wait(5000);
    const c = new Client(lobby, 'Omen');
    c.say({ t: 'queue.join', maps: ['kitsune', 'coralis'] });
    expect(c.queue).toMatchObject({ waiting: 2 });
    t.wait(QUEUE_START_DELAY_MS);
    // two matches: one on each map, each with the players who asked for it
    expect(a.inRoom?.settings.mapId).toBe('vellora');
    expect(a.inRoom?.players.map((p) => p.name)).toEqual(['Sova']);
    expect(b.inRoom?.settings.mapId).toBe('kitsune');
    expect(c.inRoom?.players.map((p) => p.name)).toEqual(['Jett', 'Omen']);
    expect(lobby.roomCount).toBe(2);
  });

  it('puts a late arrival into the match already running', () => {
    const lobby = setup();
    const t = clock(lobby);
    const a = new Client(lobby, 'Sova');
    const b = new Client(lobby, 'Jett');
    a.say({ t: 'queue.join', maps: [] });
    b.say({ t: 'queue.join', maps: [] });
    t.wait(QUEUE_START_DELAY_MS + COUNTDOWN_MS + 2000);
    expect(a.room.phase).toBe('playing');
    const late = new Client(lobby, 'Omen');
    late.say({ t: 'queue.join', maps: [a.room.settings.mapId] });
    expect(late.queue).toBeNull();
    expect(late.room.players).toHaveLength(3);
    expect(late.last('match.start')).toBeDefined(); // straight into the match
    expect(lobby.roomCount).toBe(1);
    // …but not when it is nearly over: with under three minutes left a newcomer waits for the next one
    let seq = 0;
    for (let i = 0; i < 8; i++) {
      t.wait(55_000);
      for (const p of [a, b, late]) act(p, seq);
      seq++;
    }
    const tooLate = new Client(lobby, 'Sage');
    tooLate.say({ t: 'queue.join', maps: [] });
    expect(tooLate.inRoom).toBeNull();
    expect(tooLate.queue).toMatchObject({ waiting: 1 });
    // a person who joins takes a bot's place, so the match keeps its six players
    expect(late.last('scores')!.scores.filter((p) => p.bot)).toHaveLength(3);
  });

  it('cannot be entered by code, changed or started by a player', () => {
    const lobby = setup();
    const t = clock(lobby);
    const a = new Client(lobby, 'Sova');
    const b = new Client(lobby, 'Jett');
    a.say({ t: 'queue.join', maps: [] });
    b.say({ t: 'queue.join', maps: [] });
    t.wait(QUEUE_START_DELAY_MS + 1000);
    const outsider = new Client(lobby, 'Omen');
    outsider.say({ t: 'room.join', code: a.room.code });
    expect(outsider.error).toBe('room-not-found');
    a.say({ t: 'room.settings', patch: { killLimit: 100 } });
    a.say({ t: 'room.end' });
    expect(a.error).toBe('not-host');
    expect(a.room).toMatchObject({ phase: 'countdown', settings: { killLimit: 40 } });
  });

  it('lets a player cancel, and forgets one who disconnects', () => {
    const lobby = setup();
    const t = clock(lobby);
    const a = new Client(lobby, 'Sova');
    const b = new Client(lobby, 'Jett');
    a.say({ t: 'queue.join', maps: [] });
    b.say({ t: 'queue.join', maps: [] });
    expect(a.queue).toMatchObject({ waiting: 2 });
    b.say({ t: 'queue.leave' });
    expect(b.queue).toBeNull();
    expect(a.queue).toMatchObject({ waiting: 1 });
    const c = new Client(lobby, 'Omen');
    c.say({ t: 'queue.join', maps: [] });
    lobby.disconnect(c);
    t.wait(2000);
    expect(lobby.queueLength).toBe(1);
    // creating a custom room takes you out of the queue
    a.say({ t: 'room.create' });
    expect(lobby.queueLength).toBe(0);
    expect(a.room.kind).toBe('custom');
    t.wait(QUEUE_START_DELAY_MS + 2000);
    expect(lobby.roomCount).toBe(1); // nobody was left searching, so no match was made
  });

  it('carries on when one of two leaves during the countdown, and folds when nobody is left', () => {
    const lobby = setup();
    const t = clock(lobby);
    const a = new Client(lobby, 'Sova');
    const b = new Client(lobby, 'Jett');
    a.say({ t: 'queue.join', maps: ['vellora'] });
    b.say({ t: 'queue.join', maps: ['vellora'] });
    t.wait(QUEUE_START_DELAY_MS + 1000);
    expect(a.room.phase).toBe('countdown');
    b.say({ t: 'room.leave' });
    expect(a.room.players.map((p) => p.name)).toEqual(['Sova']); // bots will make up the numbers
    expect(a.room.phase).toBe('countdown');
    a.say({ t: 'room.leave' });
    expect(lobby.roomCount).toBe(0);
  });

  it('removes a player who does nothing for a minute, and keeps the ones playing', () => {
    const lobby = setup();
    const t = clock(lobby);
    const [a, b, idle] = ['Sova', 'Jett', 'Omen'].map((n) => {
      const p = new Client(lobby, n);
      p.say({ t: 'queue.join', maps: [] });
      return p;
    });
    t.wait(QUEUE_START_DELAY_MS + COUNTDOWN_MS + 1000);
    for (let i = 0; i < 14; i++) {
      t.wait(5000);
      act(a, i);
      act(b, i);
      // the idle client keeps sending commands, as a browser left on the start screen does: no keys, no movement
      idle.say({ t: 'input', cmds: [{ seq: i, dt: 1 / 120, held: 0, pressed: 0, yaw: 0, pitch: 0, speed: 1 }] });
    }
    expect(t.now() - 1000).toBeGreaterThan(IDLE_KICK_MS);
    expect(idle.last('room.left')?.reason).toBe('idle');
    expect(a.room.players.map((p) => p.name)).toEqual(['Sova', 'Jett']);
  });

  it('closes the room after the scoreboard so players can search again', () => {
    const lobby = setup();
    const t = clock(lobby);
    const a = new Client(lobby, 'Sova');
    const b = new Client(lobby, 'Jett');
    a.say({ t: 'queue.join', maps: [] });
    b.say({ t: 'queue.join', maps: [] });
    t.wait(QUEUE_START_DELAY_MS + COUNTDOWN_MS + 1000);
    for (let i = 0; i < 13; i++) {
      t.wait(50_000);
      act(a, i);
      act(b, i);
    }
    const end = a.last('match.end')!;
    expect(end.scores.filter((s) => !s.bot).map((s) => s.name).sort()).toEqual(['Jett', 'Sova']);
    expect(end.scores.filter((s) => s.bot)).toHaveLength(4);
    expect(a.last('room.left')?.reason).toBe('closed');
    expect(lobby.roomCount).toBe(0);
    a.say({ t: 'queue.join', maps: [] }); // play again
    expect(a.queue).toMatchObject({ waiting: 1 });
  });
});
