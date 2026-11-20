/**
 * Rooms and the players in them: create, join by code, settings, host powers, and the room's phases
 * (lobby → countdown → playing → scoreboard → lobby). See docs/multiplayer.md, section 2.2.
 *
 * This file knows nothing about sockets. `index.ts` hands it connections and raw messages and calls
 * `tick` on a timer, which is also how the tests drive it.
 */
import { WEAPONS } from '../src/game/weapons/weaponConfigs';
import { DEFAULT_AGENT, isAgentId, type AgentId } from '../src/game/agents';
import {
  COUNTDOWN_MS,
  IDLE_KICK_MS,
  MIN_PLAYERS,
  QUEUE_START_DELAY_MS,
  QUICK_MIN_KILLS_LEFT,
  QUICK_MIN_TIME_LEFT_MS,
  PROTOCOL_VERSION,
  RECONNECT_GRACE_MS,
  SCOREBOARD_MS,
  decodeClient,
  encode,
  sanitizeName,
  type ClientMessage,
  type ErrorCode,
  type Loadout,
  type QueueState,
  type RoomPhase,
  type RoomState,
  type ServerMessage,
  type Team,
} from '../src/net/protocol';
import { generateRoomCode, normalizeRoomCode } from '../src/net/roomCode';
import { MAP_DEFINITIONS } from '../src/game/maps/registry';
import { DEFAULT_ROOM_SETTINGS, QUICK_MATCH_SETTINGS, applyRoomSettings, isMapId, type RoomSettings } from '../src/net/settings';
import { Match } from './Match';

/** One client socket, as far as the lobby is concerned. */
export interface Connection {
  send(data: string): void;
  close(): void;
  /** Where the socket comes from, when known. Limits on repeated attempts are counted per address. */
  address?: string;
}

/** Wrong room codes one address may send in a minute: enough for typos, far too few to find a room by guessing. */
const MAX_JOIN_FAILURES_PER_MIN = 10;
/** Rooms one address may create in a minute. */
const MAX_CREATES_PER_MIN = 6;

export interface LobbyOptions {
  /** Random numbers for room codes (0..1). */
  rng?: () => number;
  /** Unguessable strings for player ids and resume tokens. */
  token?: () => string;
  /** Most messages one connection may send per second before it is dropped. */
  maxMessagesPerSec?: number;
  /** Most rooms that may exist at once. */
  maxRooms?: number;
}

/** A player, from their hello until they leave or their reconnect grace runs out. */
interface Session {
  id: string;
  name: string;
  resume: string;
  conn: Connection | null;
  room: Room | null;
  ping: number;
  loadout: Loadout;
  agent: AgentId;
  /** Server time the connection dropped (0 while connected). */
  droppedAt: number;
  /** The maps this player last queued for (empty = any), kept so they can be put back in the queue. */
  queueMaps: string[];
}

/** A player waiting for a quick match. */
interface Queued {
  /** Maps they accept; empty = any map. */
  maps: string[];
  /** The last `queue.state` sent, so it is only sent again when it changes. */
  sent: string;
}

interface Member {
  session: Session;
  /** The name shown in this room (made unique among its members). */
  name: string;
  ready: boolean;
  team: Team | null;
}

interface Room {
  code: string;
  kind: 'custom' | 'quick';
  phase: RoomPhase;
  settings: RoomSettings;
  /** In joining order: when the host leaves, the first connected member takes over. */
  members: Member[];
  hostId: string | null;
  phaseEndsAt: number;
  /** Something changed since the last `room.state` was sent. */
  dirty: boolean;
  /** The match being played (phase 'playing' only). */
  match: Match | null;
}

interface Socket {
  session: Session | null;
  /** Messages received in the current one-second window. */
  count: number;
  windowStart: number;
}

const DEFAULT_LOADOUT: Loadout = { primary: 'vandal', secondary: 'classic' };
/** How often a room is re-sent when only pings changed. */
const PING_BROADCAST_MS = 2000;

function cryptoRng() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
}

export class Lobby {
  private readonly sockets = new Map<Connection, Socket>();
  private readonly sessions = new Map<string, Session>();
  private readonly byResume = new Map<string, Session>();
  private readonly rooms = new Map<string, Room>();
  private readonly rng: () => number;
  private readonly token: () => string;
  private readonly maxMessagesPerSec: number;
  private readonly maxRooms: number;
  private now = 0;
  private lastPingBroadcast = 0;
  /** Players waiting for a quick match, in order of arrival. */
  private queue = new Map<Session, Queued>();
  /** Per map: the server time at which enough waiting players to start a match first accepted it. */
  private readonly forming = new Map<string, number>();
  private lastMatchmake = 0;
  /** Recent attempts per address and kind (server times), for the per-minute limits. */
  private readonly attempts = new Map<string, number[]>();

  constructor(opts: LobbyOptions = {}) {
    this.rng = opts.rng ?? cryptoRng;
    this.token = opts.token ?? (() => crypto.randomUUID());
    this.maxMessagesPerSec = opts.maxMessagesPerSec ?? 200;
    this.maxRooms = opts.maxRooms ?? 500;
  }

  get roomCount() {
    return this.rooms.size;
  }
  get playerCount() {
    return this.sessions.size;
  }
  get queueLength() {
    return this.queue.size;
  }

  /* ------------------------------------------------------------------ */
  /* Connections                                                         */
  /* ------------------------------------------------------------------ */

  connect(conn: Connection) {
    this.sockets.set(conn, { session: null, count: 0, windowStart: this.now });
  }

  disconnect(conn: Connection) {
    const socket = this.sockets.get(conn);
    this.sockets.delete(conn);
    const session = socket?.session;
    if (!session || session.conn !== conn) return;
    session.conn = null;
    this.queue.delete(session);
    if (!session.room) {
      this.forget(session);
      return;
    }
    // keep their place for a while: a reload or a dropped connection can come back with the resume token
    session.droppedAt = this.now;
    // the host keeps the role while their place is held: a reload shouldn't hand the room to someone else
    const room = session.room;
    room.match?.remove(session.id); // their body leaves the world; score and place are kept
    if (room.phase === 'countdown' && !this.enoughToPlay(room)) this.cancelCountdown(room);
    room.dirty = true;
    this.flush(room);
  }

  receive(conn: Connection, data: unknown) {
    const socket = this.sockets.get(conn);
    if (!socket) return;
    if (this.now - socket.windowStart >= 1000) {
      socket.windowStart = this.now;
      socket.count = 0;
    }
    if (++socket.count > this.maxMessagesPerSec) {
      this.error(conn, 'rate-limited', 'Too many messages.');
      conn.close();
      return;
    }
    const msg = decodeClient(data);
    if (!msg) {
      this.error(conn, 'bad-message', 'Message not understood.');
      return;
    }
    if (msg.t === 'hello') {
      this.hello(conn, socket, msg);
      return;
    }
    const session = socket.session;
    if (!session) {
      this.error(conn, 'bad-message', 'Say hello first.');
      return;
    }
    this.handle(session, msg);
    if (session.room) this.flush(session.room);
  }

  /** Advance timers to `now` (server time in ms): phase changes, reconnect grace, ping updates. */
  tick(now: number) {
    this.now = now;
    for (const session of [...this.sessions.values()]) {
      if (!session.conn && session.droppedAt > 0 && now - session.droppedAt >= RECONNECT_GRACE_MS) {
        const room = session.room;
        this.removeFromRoom(session, null);
        this.forget(session);
        if (room) this.flush(room);
      }
    }
    if (now - this.lastMatchmake >= 1000) {
      this.lastMatchmake = now;
      this.matchmake();
      // forget attempt records that have aged out
      for (const [key, list] of this.attempts) if (list.every((t) => now - t >= 60_000)) this.attempts.delete(key);
    }
    const pings = now - this.lastPingBroadcast >= PING_BROADCAST_MS;
    if (pings) this.lastPingBroadcast = now;
    for (const room of [...this.rooms.values()]) {
      if (room.phaseEndsAt > 0 && now >= room.phaseEndsAt) this.advancePhase(room);
      if (pings) room.dirty = true;
      this.flush(room);
      const match = room.match;
      if (!match) continue;
      match.tick(now);
      if (match.over) {
        // the kill limit was reached
        this.endMatch(room);
        this.flush(room);
        continue;
      }
      if (pings) {
        for (const m of room.members) match.setPing(m.session.id, m.session.ping);
        this.broadcast(room, { t: 'scores', scores: match.scoreboard() });
        // quick match: someone doing nothing is holding a place another player could have
        if (room.kind === 'quick') {
          for (const m of [...room.members]) if (match.idleFor(m.session.id, now) >= IDLE_KICK_MS) this.removeFromRoom(m.session, 'idle');
          if (!this.rooms.has(room.code)) continue;
        }
      }
      this.sendSnapshots(room, match);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Messages                                                            */
  /* ------------------------------------------------------------------ */

  private hello(conn: Connection, socket: Socket, msg: Extract<ClientMessage, { t: 'hello' }>) {
    if (msg.version !== PROTOCOL_VERSION) {
      this.error(conn, 'version', 'This page is out of date. Reload it to play.');
      conn.close();
      return;
    }
    const name = sanitizeName(msg.name);
    if (!name) {
      this.error(conn, 'name-rejected', 'Choose a display name first.');
      return;
    }
    if (socket.session) {
      // a second hello on the same socket only changes the name (outside a room)
      if (!socket.session.room) socket.session.name = name;
      this.welcome(socket.session);
      return;
    }
    let session = typeof msg.resume === 'string' ? this.byResume.get(msg.resume) : undefined;
    if (session) {
      // coming back: the old socket, if it is somehow still open, is replaced
      const old = session.conn;
      if (old && old !== conn) {
        const oldSocket = this.sockets.get(old);
        if (oldSocket) oldSocket.session = null;
        old.close();
      }
      session.conn = conn;
      session.droppedAt = 0;
      if (!session.room) session.name = name;
    } else {
      session = { id: this.token().replace(/-/g, '').slice(0, 12), name, resume: this.token(), conn, room: null, ping: -1, loadout: DEFAULT_LOADOUT, agent: DEFAULT_AGENT, droppedAt: 0, queueMaps: [] };
      this.sessions.set(session.id, session);
      this.byResume.set(session.resume, session);
    }
    socket.session = session;
    this.welcome(session);
    const room = session.room;
    if (room) {
      if (!room.hostId) this.pickHost(room);
      room.dirty = true;
      this.flush(room);
      this.enterMatch(room, session);
    }
  }

  private welcome(session: Session) {
    this.send(session, { t: 'welcome', playerId: session.id, resume: session.resume, serverTime: this.now, room: session.room?.code ?? null });
  }

  private handle(session: Session, msg: Exclude<ClientMessage, { t: 'hello' }>) {
    const room = session.room;
    switch (msg.t) {
      case 'ping': {
        if (typeof msg.rtt === 'number' && Number.isFinite(msg.rtt)) session.ping = Math.max(0, Math.min(9999, Math.round(msg.rtt)));
        this.send(session, { t: 'pong', time: typeof msg.time === 'number' ? msg.time : 0, serverTime: this.now });
        return;
      }
      case 'loadout': {
        const l = msg.loadout as Partial<Loadout> | undefined;
        const primary = l && typeof l.primary === 'string' ? WEAPONS[l.primary] : undefined;
        const secondary = l && typeof l.secondary === 'string' ? WEAPONS[l.secondary] : undefined;
        if (primary?.slot === 'primary' && secondary?.slot === 'secondary') {
          session.loadout = { primary: primary.id, secondary: secondary.id };
          room?.match?.setLoadout(session.id, session.loadout, this.now);
        }
        return;
      }
      case 'agent': {
        if (!isAgentId(msg.agent) || msg.agent === session.agent) return;
        session.agent = msg.agent;
        if (room) room.dirty = true;
        return;
      }
      case 'room.create': {
        if (this.rooms.size >= this.maxRooms) {
          this.fail(session, 'unavailable', 'The server is full. Try again in a few minutes.');
          return;
        }
        const creates = this.recent(session, 'create');
        if (creates.length >= MAX_CREATES_PER_MIN) {
          this.fail(session, 'rate-limited', 'You are creating rooms too quickly. Wait a minute and try again.');
          return;
        }
        creates.push(this.now);
        this.leaveQueue(session);
        this.removeFromRoom(session, 'left');
        const created: Room = {
          code: this.newCode(),
          kind: 'custom',
          phase: 'lobby',
          settings: DEFAULT_ROOM_SETTINGS,
          members: [],
          hostId: session.id,
          phaseEndsAt: 0,
          dirty: true,
          match: null,
        };
        this.rooms.set(created.code, created);
        this.addMember(created, session);
        return;
      }
      case 'room.join': {
        const code = normalizeRoomCode(msg.code);
        const target = code ? this.rooms.get(code) : undefined;
        // a quick match is entered through the queue, never by its code
        const failures = this.recent(session, 'join');
        if (failures.length >= MAX_JOIN_FAILURES_PER_MIN) {
          this.fail(session, 'rate-limited', 'Too many wrong codes. Wait a minute and try again.');
          return;
        }
        if (!target || (target.kind === 'quick' && target !== room)) {
          failures.push(this.now);
          this.fail(session, 'room-not-found', 'No room has that code. Check it and try again.');
          return;
        }
        if (target === room) {
          target.dirty = true;
          return;
        }
        if (target.members.length >= target.settings.maxPlayers) {
          this.fail(session, 'room-full', 'That room is full.');
          return;
        }
        if (target.phase !== 'lobby' && !target.settings.joinInProgress) {
          this.fail(session, 'match-in-progress', 'That room is in a match and is not taking new players until it ends.');
          return;
        }
        this.leaveQueue(session);
        this.removeFromRoom(session, 'left');
        this.addMember(target, session);
        return;
      }
      case 'room.leave': {
        this.removeFromRoom(session, 'left');
        if (room) this.flush(room);
        return;
      }
      case 'queue.join': {
        const maps = Array.isArray(msg.maps) ? [...new Set(msg.maps.filter(isMapId))] : [];
        this.removeFromRoom(session, 'left');
        if (room) this.flush(room);
        // accepting every map is the same as accepting any
        session.queueMaps = maps.length === MAP_DEFINITIONS.length ? [] : maps;
        this.queue.delete(session);
        this.queue.set(session, { maps: session.queueMaps, sent: '' });
        this.matchmake();
        return;
      }
      case 'queue.leave':
        this.leaveQueue(session);
        return;
      case 'input':
        room?.match?.input(session.id, msg.cmds, this.now);
        return;
      case 'shot':
        room?.match?.shot(session.id, msg.shot, this.now);
        return;
      case 'weapon':
        room?.match?.setHeld(session.id, msg.weapon);
        return;
    }

    // everything below acts on the room the player is in
    if (!room) {
      this.fail(session, 'room-not-found', 'You are not in a room.');
      return;
    }
    const me = room.members.find((m) => m.session === session)!;
    const isHost = room.hostId === session.id;
    const teams = room.settings.mode === 'team-deathmatch';

    switch (msg.t) {
      case 'room.ready':
        me.ready = msg.ready === true;
        room.dirty = true;
        return;
      case 'room.team': {
        if (!teams || (msg.team !== 'a' && msg.team !== 'b')) return;
        // players choose their own side; the host can also move someone else
        const target = typeof msg.id === 'string' && msg.id !== session.id ? (isHost ? room.members.find((m) => m.session.id === msg.id) : undefined) : me;
        if (!target || room.phase !== 'lobby') return;
        target.team = msg.team;
        room.dirty = true;
        return;
      }
    }

    if (!isHost) {
      this.fail(session, 'not-host', 'Only the host can do that.');
      return;
    }
    switch (msg.t) {
      case 'room.settings': {
        if (room.phase !== 'lobby') return;
        const next = applyRoomSettings(room.settings, msg.patch);
        // the room can't be made smaller than the number of players already in it
        next.maxPlayers = Math.max(next.maxPlayers, room.members.length);
        if (next.mode !== room.settings.mode) this.assignTeams(room, next.mode === 'team-deathmatch');
        room.settings = next;
        room.dirty = true;
        return;
      }
      case 'room.kick': {
        const target = room.members.find((m) => m.session.id === msg.id);
        if (!target || target.session === session) return;
        this.removeFromRoom(target.session, 'kicked');
        if (!target.session.conn) this.forget(target.session);
        return;
      }
      case 'room.host': {
        const target = room.members.find((m) => m.session.id === msg.id);
        if (!target || !target.session.conn) return;
        room.hostId = target.session.id;
        room.dirty = true;
        return;
      }
      case 'room.start': {
        if (room.phase !== 'lobby') return;
        if (!this.enoughToPlay(room)) {
          this.fail(session, 'not-enough-players', `A match needs at least ${MIN_PLAYERS} players. Invite a friend, or turn on bots.`);
          return;
        }
        const waiting = this.notReady(room);
        if (waiting > 0) {
          this.fail(session, 'not-ready', `Waiting for ${waiting} ${waiting === 1 ? 'player' : 'players'} to press Ready.`);
          return;
        }
        this.setPhase(room, 'countdown', this.now + COUNTDOWN_MS);
        return;
      }
      case 'room.end': {
        if (room.phase === 'countdown') this.setPhase(room, 'lobby', 0);
        else if (room.phase === 'playing') this.endMatch(room);
        return;
      }
    }
  }

  /** The attempts of one kind an address has made in the last minute. */
  private recent(session: Session, kind: string): number[] {
    const key = `${kind}:${session.conn?.address ?? session.id}`;
    const list = (this.attempts.get(key) ?? []).filter((t) => this.now - t < 60_000);
    this.attempts.set(key, list);
    return list;
  }

  /* ------------------------------------------------------------------ */
  /* Rooms                                                               */
  /* ------------------------------------------------------------------ */

  private connectedCount(room: Room) {
    return room.members.filter((m) => m.session.conn).length;
  }

  /** A match needs someone to play it and someone to play against: a second person, or bots. */
  /** Connected players other than the host who haven't pressed Ready (the host's Start is their ready). */
  private notReady(room: Room) {
    return room.members.filter((m) => m.session.conn && m.session.id !== room.hostId && !m.ready).length;
  }

  private enoughToPlay(room: Room) {
    const connected = this.connectedCount(room);
    return connected >= 1 && Math.max(connected, room.settings.botFill) >= MIN_PLAYERS;
  }

  /** Keep the match topped up with bots: enough to reach the room's fill number, fewer as people join. */
  private syncBots(room: Room) {
    room.match?.setBotCount(Math.max(0, Math.min(room.settings.maxPlayers, room.settings.botFill) - room.members.length), this.now);
  }

  private newCode(): string {
    for (;;) {
      const code = generateRoomCode(this.rng);
      if (!this.rooms.has(code)) return code;
    }
  }

  private addMember(room: Room, session: Session) {
    const taken = new Set(room.members.map((m) => m.name.toLowerCase()));
    let name = session.name;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${session.name} (${n})`;
    let team: Team | null = null;
    if (room.settings.mode === 'team-deathmatch') {
      const a = room.members.filter((m) => m.team === 'a').length;
      team = a <= room.members.length - a ? 'a' : 'b';
    }
    room.members.push({ session, name, ready: false, team });
    session.room = room;
    if (!room.hostId && room.kind === 'custom') room.hostId = session.id;
    room.dirty = true;
    // joining a match in progress: the room first, then the match
    this.flush(room);
    this.enterMatch(room, session);
  }

  /** Take a player out of their room. `reason` is what they are told (null: they are gone, tell nobody). */
  private removeFromRoom(session: Session, reason: 'left' | 'kicked' | 'idle' | null) {
    const room = session.room;
    if (!room) return;
    session.room = null;
    room.match?.remove(session.id, true);
    room.members = room.members.filter((m) => m.session !== session);
    if (reason) this.send(session, { t: 'room.left', reason });
    if (room.members.length === 0) {
      this.rooms.delete(room.code);
      return;
    }
    if (room.hostId === session.id) this.pickHost(room);
    this.syncBots(room); // a bot takes the place of whoever left
    // a match can't start with one player
    if (room.phase === 'countdown' && !this.enoughToPlay(room)) this.cancelCountdown(room);
    room.dirty = true;
    this.flush(room);
  }

  /** Too few players left to start. A custom room goes back to its lobby; a quick match's players go back to the queue. */
  private cancelCountdown(room: Room) {
    if (room.kind === 'custom') {
      this.setPhase(room, 'lobby', 0);
      return;
    }
    const back = room.members.map((m) => m.session).filter((s) => s.conn);
    this.closeRoom(room, null);
    // they were waiting before the players still in the queue: put them ahead of those
    const rest = [...this.queue];
    this.queue = new Map();
    for (const s of back) this.queue.set(s, { maps: s.queueMaps, sent: '' });
    for (const [s, q] of rest) this.queue.set(s, q);
    this.sendQueueStates();
  }

  /** Remove a room and everyone in it. `reason` is what its connected players are told (null: nothing). */
  private closeRoom(room: Room, reason: 'closed' | null) {
    for (const m of room.members) {
      m.session.room = null;
      if (reason) this.send(m.session, { t: 'room.left', reason });
      if (!m.session.conn) this.forget(m.session);
    }
    room.members = [];
    room.match = null;
    this.rooms.delete(room.code);
  }

  /* ------------------------------------------------------------------ */
  /* Quick match                                                         */
  /* ------------------------------------------------------------------ */

  private leaveQueue(session: Session) {
    if (!this.queue.delete(session)) return;
    this.send(session, { t: 'queue.state', queue: null });
    this.matchmake(); // the others' counts and timers may have changed
  }

  /**
   * Place waiting players (docs/multiplayer.md, section 4): first into quick matches that have room,
   * then into new matches once enough of them accept a common map.
   */
  private matchmake() {
    const accepts = (q: Queued, map: string) => q.maps.length === 0 || q.maps.includes(map);

    // 1. a match that is forming or under way, with a free place and enough of it left to be worth joining
    for (const [session, q] of [...this.queue]) {
      let best: Room | null = null;
      for (const room of this.rooms.values()) {
        if (room.kind !== 'quick' || !accepts(q, room.settings.mapId) || room.members.length >= room.settings.maxPlayers) continue;
        const open =
          room.phase === 'countdown' ||
          (room.phase === 'playing' &&
            room.phaseEndsAt - this.now > QUICK_MIN_TIME_LEFT_MS &&
            (room.settings.killLimit === 0 || room.settings.killLimit - (room.match?.leadingKills() ?? 0) > QUICK_MIN_KILLS_LEFT));
        if (open && (!best || room.members.length > best.members.length)) best = room;
      }
      if (!best) continue;
      this.queue.delete(session);
      this.send(session, { t: 'queue.state', queue: null });
      this.addMember(best, session);
      this.flush(best);
    }

    // 2. new matches: a map starts when it is full, or a while after enough players who accept it arrived.
    // With bots filling the match one person is enough; without them it takes two.
    const quickMinimum = QUICK_MATCH_SETTINGS.botFill >= MIN_PLAYERS ? 1 : MIN_PLAYERS;
    for (;;) {
      const waiting = new Map<string, Session[]>();
      for (const def of MAP_DEFINITIONS) {
        const list = [...this.queue].filter(([, q]) => accepts(q, def.id)).map(([s]) => s);
        waiting.set(def.id, list);
        if (list.length < quickMinimum) this.forming.delete(def.id);
        else if (!this.forming.has(def.id)) this.forming.set(def.id, this.now);
      }
      let ready: string[] = [];
      let most = 0;
      for (const [map, list] of waiting) {
        const since = this.forming.get(map);
        if (since === undefined || (list.length < QUICK_MATCH_SETTINGS.maxPlayers && this.now - since < QUEUE_START_DELAY_MS)) continue;
        if (list.length > most) {
          most = list.length;
          ready = [map];
        } else if (list.length === most) ready.push(map);
      }
      if (ready.length === 0 || this.rooms.size >= this.maxRooms) break;
      // the map most players accept; between equals (everyone chose Any), any of them
      const mapId = ready[Math.floor(this.rng() * ready.length) % ready.length];
      const room: Room = {
        code: this.newCode(),
        kind: 'quick',
        phase: 'countdown',
        settings: { ...QUICK_MATCH_SETTINGS, mapId },
        members: [],
        hostId: null,
        phaseEndsAt: this.now + COUNTDOWN_MS,
        dirty: true,
        match: null,
      };
      this.rooms.set(room.code, room);
      for (const session of waiting.get(mapId)!.slice(0, room.settings.maxPlayers)) {
        this.queue.delete(session);
        this.send(session, { t: 'queue.state', queue: null });
        this.addMember(room, session);
      }
      this.forming.delete(mapId);
      this.flush(room);
    }
    this.sendQueueStates();
  }

  /** Tell each waiting player how the search stands, when that has changed. */
  private sendQueueStates() {
    const accepts = (q: Queued, map: string) => q.maps.length === 0 || q.maps.includes(map);
    for (const [session, q] of this.queue) {
      let waiting = 0;
      for (const other of this.queue.values()) if (MAP_DEFINITIONS.some((d) => accepts(q, d.id) && accepts(other, d.id))) waiting++;
      let startsAt = 0;
      for (const [map, since] of this.forming) if (accepts(q, map) && (startsAt === 0 || since + QUEUE_START_DELAY_MS < startsAt)) startsAt = since + QUEUE_START_DELAY_MS;
      const state: QueueState = { maps: q.maps, waiting, startsAt };
      const data = encode({ t: 'queue.state', queue: state });
      if (data === q.sent) continue;
      q.sent = data;
      session.conn?.send(data);
    }
  }

  /** Give the host role to the connected player who has been in the room longest. */
  private pickHost(room: Room) {
    if (room.kind !== 'custom') return;
    room.hostId = room.members.find((m) => m.session.conn)?.session.id ?? null;
    room.dirty = true;
  }

  private assignTeams(room: Room, teams: boolean) {
    room.members.forEach((m, i) => {
      m.team = teams ? (i % 2 === 0 ? 'a' : 'b') : null;
    });
  }

  private setPhase(room: Room, phase: RoomPhase, endsAt: number) {
    const was = room.phase;
    room.phase = phase;
    room.phaseEndsAt = endsAt;
    if (phase === 'lobby') for (const m of room.members) m.ready = false;
    room.dirty = true;
    if (phase === 'playing') {
      room.match = new Match(
        room.settings,
        (to, msg) => {
          if (to === null) this.broadcast(room, msg);
          else room.members.find((m) => m.session.id === to)?.session.conn?.send(encode(msg));
        },
        this.rng,
      );
      this.flush(room);
      for (const m of room.members) this.enterMatch(room, m.session);
      this.syncBots(room);
    } else if (was === 'playing') {
      const match = room.match;
      room.match = null;
      this.broadcast(room, { t: 'match.end', scores: match?.scoreboard() ?? [], winner: match?.winner() ?? null });
    }
  }

  /** Give a connected player a body in the room's match, if one is running, and tell them where it is. */
  private enterMatch(room: Room, session: Session) {
    const match = room.match;
    if (!match || !session.conn || match.has(session.id)) return;
    const member = room.members.find((m) => m.session === session);
    if (!member) return;
    const spawn = match.add(session.id, { name: member.name, team: member.team, loadout: session.loadout, ping: session.ping, agent: session.agent }, this.now);
    this.syncBots(room); // a person arriving takes a bot's place
    this.send(session, { t: 'match.start', settings: room.settings, serverTime: this.now, endsAt: room.phaseEndsAt, spawn, scores: match.scoreboard() });
  }

  private broadcast(room: Room, msg: ServerMessage) {
    const data = encode(msg);
    for (const m of room.members) m.session.conn?.send(data);
  }

  private sendSnapshots(room: Room, match: Match) {
    for (const m of room.members) {
      const conn = m.session.conn;
      if (!conn || !match.has(m.session.id)) continue;
      conn.send(encode({ t: 'snapshot', time: this.now, ...match.snapshot(m.session.id) }));
    }
  }

  /**
   * A match is over. A custom room goes straight back to its lobby (each player keeps the results on screen
   * until they close them); a quick match shows its scoreboard for a while, then the room closes.
   */
  private endMatch(room: Room) {
    if (room.kind === 'quick') this.setPhase(room, 'scoreboard', this.now + SCOREBOARD_MS);
    else this.setPhase(room, 'lobby', 0);
  }

  private advancePhase(room: Room) {
    if (room.phase === 'countdown') this.setPhase(room, 'playing', this.now + room.settings.timeLimitMin * 60_000);
    else if (room.phase === 'playing') this.endMatch(room);
    else if (room.kind === 'quick') this.closeRoom(room, 'closed'); // a quick match's room ends with its scoreboard
    else this.setPhase(room, 'lobby', 0);
  }

  private stateOf(room: Room): RoomState {
    return {
      code: room.code,
      kind: room.kind,
      phase: room.phase,
      settings: room.settings,
      phaseEndsAt: room.phaseEndsAt,
      players: room.members.map((m) => ({
        id: m.session.id,
        name: m.name,
        host: m.session.id === room.hostId,
        ready: m.ready,
        team: m.team,
        ping: m.session.ping,
        connected: m.session.conn !== null,
        agent: m.session.agent,
      })),
    };
  }

  /** Send the room to everyone in it, if it changed. */
  private flush(room: Room) {
    if (!room.dirty || !this.rooms.has(room.code)) return;
    room.dirty = false;
    const data = encode({ t: 'room.state', room: this.stateOf(room) });
    for (const m of room.members) m.session.conn?.send(data);
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  private forget(session: Session) {
    this.sessions.delete(session.id);
    this.byResume.delete(session.resume);
  }

  private send(session: Session, msg: ServerMessage) {
    session.conn?.send(encode(msg));
  }

  private fail(session: Session, code: ErrorCode, message: string) {
    this.send(session, { t: 'error', code, message });
  }

  private error(conn: Connection, code: ErrorCode, message: string) {
    conn.send(encode({ t: 'error', code, message }));
  }
}
