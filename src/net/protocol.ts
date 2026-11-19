/**
 * The messages the client and the game server exchange over one WebSocket, and the single place they
 * are encoded and decoded. See docs/multiplayer.md, section 6.5.
 *
 * The wire format is JSON for now. Everything goes through `encode` / `decode`, so snapshots and
 * inputs can move to a binary layout later without touching the callers.
 */
import type { Vec3, WeaponId } from '../types';
import type { HitZone } from '../game/physics/CollisionWorld';
import type { Command } from './command';
import type { RoomSettings } from './settings';
import type { AgentId } from '../game/agents';

/**
 * Bumped whenever a message changes shape, or the shared simulation changes (a movement constant, say):
 * client and server must run the same one. A client on another version is asked to reload.
 */
export const PROTOCOL_VERSION = 5;

/** Rates, in messages per second (docs/multiplayer.md, section 6.1). */
export const INPUT_RATE = 60;
export const SNAPSHOT_RATE = 30;
/** How far in the past remote players are drawn, in milliseconds. */
export const INTERP_DELAY_MS = 100;
/**
 * The most connection delay the server makes up for when resolving a shot, in milliseconds. Other
 * players are rewound by at most this plus `INTERP_DELAY_MS`.
 */
export const MAX_REWIND_MS = 200;
/** Largest message either side accepts, in characters. */
export const MAX_MESSAGE_SIZE = 16 * 1024;
export const MAX_NAME_LENGTH = 16;
/** Countdown between the host pressing Start and the match beginning, and how long the scoreboard stays up. */
export const COUNTDOWN_MS = 5000;
export const SCOREBOARD_MS = 15000;
/** How long a dropped player's place is kept for them. */
export const RECONNECT_GRACE_MS = 30000;
/** Fewest players a match starts with. */
export const MIN_PLAYERS = 2;
/** Quick match: how long a group of at least `MIN_PLAYERS` waits for more before its match starts. */
export const QUEUE_START_DELAY_MS = 15000;
/** Quick match: a running match takes newcomers only while it has more than this much time and this many kills left. */
export const QUICK_MIN_TIME_LEFT_MS = 90_000;
export const QUICK_MIN_KILLS_LEFT = 10;
/** Quick match: a player who does nothing for this long is removed, so their place can go to someone else. */
export const IDLE_KICK_MS = 60_000;

export type Team = 'a' | 'b';
export type { HitZone };

/* ------------------------------------------------------------------ */
/* Lobby                                                               */
/* ------------------------------------------------------------------ */

export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'scoreboard';

export interface RoomPlayer {
  id: string;
  name: string;
  host: boolean;
  ready: boolean;
  /** Team Deathmatch only. */
  team: Team | null;
  /** Round-trip time in milliseconds, -1 until measured. */
  ping: number;
  connected: boolean;
  /** The agent they picked (cosmetic). */
  agent: AgentId;
}

export interface RoomState {
  code: string;
  /** 'custom': created by a player, who is its host. 'quick': created by the matchmaker, no host. */
  kind: 'custom' | 'quick';
  phase: RoomPhase;
  settings: RoomSettings;
  players: RoomPlayer[];
  /** Server time (ms) the current phase ends: the countdown, the match, or the scoreboard. 0 in the lobby. */
  phaseEndsAt: number;
}

export interface QueueState {
  /** Maps this player accepts; empty = any map. */
  maps: string[];
  /** Players waiting who share at least one map with this player (including them). */
  waiting: number;
  /** Server time (ms) the forming match starts, or 0 while there is nobody to play with. */
  startsAt: number;
}

export interface Loadout {
  primary: WeaponId;
  secondary: WeaponId;
}

/* ------------------------------------------------------------------ */
/* Match                                                               */
/* ------------------------------------------------------------------ */

/** Bits of `PlayerSnapshot.flags`. */
export const PF_ALIVE = 1;
export const PF_GROUNDED = 2;
export const PF_WALKING = 4;
export const PF_PROTECTED = 16;
export const PF_CROUCHING = 32;

/** One player as everyone sees them. */
export interface PlayerSnapshot {
  id: string;
  /** Feet position. */
  pos: Vec3;
  yaw: number;
  pitch: number;
  /** 0 = standing, 1 = fully crouched. */
  crouch: number;
  flags: number;
  /** The gun in their hands. */
  weapon: WeaponId;
}

/** The receiving player's own state, which nobody else is sent. */
export interface SelfSnapshot {
  pos: Vec3;
  vel: Vec3;
  /** 0 = standing, 1 = fully crouched. */
  crouch: number;
  /** `PF_ALIVE`, `PF_GROUNDED`, `PF_CROUCHING`. */
  flags: number;
  health: number;
  armor: number;
  /** The last command of theirs the server has applied: prediction replays everything after it. */
  ackSeq: number;
}

export interface ScoreLine {
  id: string;
  name: string;
  team: Team | null;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  ping: number;
  /** Played by the server, filling a place until a person takes it. */
  bot?: boolean;
  /** The agent they play as (a bot's is picked at random). */
  agent: AgentId;
}

export interface ShotMessage {
  /** The command the shot was fired on. */
  seq: number;
  weapon: WeaponId;
  /** Eye position and final direction (after spread and recoil). */
  origin: Vec3;
  dir: Vec3;
  /** Server time (ms) of the world the shooter was looking at (their interpolation time). */
  viewTime: number;
}

export type MatchEvent =
  /** Someone else fired: play the sound and draw the tracer. */
  | { type: 'shot'; by: string; weapon: WeaponId; origin: Vec3; end: Vec3 }
  /** Sent to the shooter: their shot `seq` hit. */
  | { type: 'hit'; seq: number; victim: string; zone: HitZone; damage: number; killed: boolean }
  /** Sent to the victim. */
  | { type: 'damage'; by: string; from: Vec3; zone: HitZone; damage: number }
  | { type: 'kill'; killer: string; victim: string; weapon: WeaponId; headshot: boolean; assists: string[] }
  /** `yaw` in degrees, as spawn points are. */
  | { type: 'respawn'; id: string; pos: Vec3; yaw: number }
  /** Sent to one player: the guns they carry from now on (a change made mid-life takes effect at the respawn). */
  | { type: 'loadout'; loadout: Loadout };

export type ErrorCode =
  | 'version'
  | 'bad-message'
  | 'room-not-found'
  | 'room-full'
  | 'match-in-progress'
  | 'not-host'
  | 'rate-limited'
  | 'name-rejected'
  | 'not-enough-players'
  | 'unavailable';

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export type ClientMessage =
  /** `resume`: the token from an earlier `welcome`, to take back the same place after a reload or a dropped connection. */
  | { t: 'hello'; version: number; name: string; resume?: string }
  | { t: 'room.create' }
  | { t: 'room.join'; code: string }
  | { t: 'room.leave' }
  | { t: 'room.settings'; patch: Partial<RoomSettings> }
  | { t: 'room.kick'; id: string }
  | { t: 'room.host'; id: string }
  | { t: 'room.start' }
  | { t: 'room.end' }
  | { t: 'room.ready'; ready: boolean }
  | { t: 'room.team'; team: Team; id?: string }
  | { t: 'loadout'; loadout: Loadout }
  /** The agent this player wants to be seen as. A change made during a match shows from the next match. */
  | { t: 'agent'; agent: AgentId }
  /** The gun now in the player's hands (so others see the right one). */
  | { t: 'weapon'; weapon: WeaponId }
  | { t: 'queue.join'; maps: string[] }
  | { t: 'queue.leave' }
  | { t: 'input'; cmds: Command[] }
  | { t: 'shot'; shot: ShotMessage }
  /** `rtt`: the round trip the client measured from its previous ping, in milliseconds (shown in the lobby). */
  | { t: 'ping'; time: number; rtt?: number };

export type ServerMessage =
  /** `room`: the code of the room this player is (still) in, or null. Its `room.state` follows. */
  | { t: 'welcome'; playerId: string; resume: string; serverTime: number; room: string | null }
  | { t: 'room.state'; room: RoomState }
  /** 'closed': a quick match ended and its room is gone. 'idle': removed from a quick match for doing nothing. */
  | { t: 'room.left'; reason: 'left' | 'kicked' | 'closed' | 'idle' }
  | { t: 'queue.state'; queue: QueueState | null }
  | { t: 'match.start'; settings: RoomSettings; serverTime: number; endsAt: number; spawn: { pos: Vec3; yaw: number }; scores: ScoreLine[] }
  /** The scoreboard: sent when it changes (a kill, a player joining or leaving) and every few seconds for pings. */
  | { t: 'scores'; scores: ScoreLine[] }
  | { t: 'snapshot'; time: number; self: SelfSnapshot | null; players: PlayerSnapshot[] }
  | { t: 'event'; time: number; event: MatchEvent }
  | { t: 'match.end'; scores: ScoreLine[]; winner: string | Team | null }
  | { t: 'pong'; time: number; serverTime: number }
  | { t: 'error'; code: ErrorCode; message: string };

export type MessageType<M extends { t: string }> = M['t'];

const CLIENT_TYPES: ReadonlySet<string> = new Set<MessageType<ClientMessage> | 'i'>([
  'i',
  'hello',
  'room.create',
  'room.join',
  'room.leave',
  'room.settings',
  'room.kick',
  'room.host',
  'room.start',
  'room.end',
  'room.ready',
  'room.team',
  'loadout',
  'agent',
  'weapon',
  'queue.join',
  'queue.leave',
  'input',
  'shot',
  'ping',
]);

const SERVER_TYPES: ReadonlySet<string> = new Set<MessageType<ServerMessage> | 's'>([
  's',
  'welcome',
  'room.state',
  'room.left',
  'queue.state',
  'match.start',
  'scores',
  'snapshot',
  'event',
  'match.end',
  'pong',
  'error',
]);

/*
 * Snapshots and inputs are nearly all of the traffic, so on the wire they are packed into arrays
 * instead of objects with a name for every number. Everything else is sent as it is.
 *
 *   snapshot → { t: 's', n: time, s: [x, y, z, vx, vy, vz, crouch, flags, health, armor, ackSeq] | null,
 *                p: [[id, x, y, z, yaw, pitch, crouch, flags, weapon], …] }
 *   input    → { t: 'i', c: [[seq, dt, held, pressed, yaw, pitch, speed], …] }
 */

export function encode(msg: ClientMessage | ServerMessage): string {
  if (msg.t === 'snapshot') {
    const s = msg.self;
    return JSON.stringify({
      t: 's',
      n: msg.time,
      s: s ? [...s.pos, ...s.vel, s.crouch, s.flags, s.health, s.armor, s.ackSeq] : null,
      p: msg.players.map((p) => [p.id, ...p.pos, p.yaw, p.pitch, p.crouch, p.flags, p.weapon]),
    });
  }
  if (msg.t === 'input') return JSON.stringify({ t: 'i', c: msg.cmds.map((c) => [c.seq, c.dt, c.held, c.pressed, c.yaw, c.pitch, c.speed]) });
  return JSON.stringify(msg);
}

/** Unpack a snapshot. Only the server sends these, so the shape is trusted. */
function unpackSnapshot(m: { n: number; s: number[] | null; p: [string, number, number, number, number, number, number, number, WeaponId][] }): ServerMessage {
  const s = m.s;
  return {
    t: 'snapshot',
    time: m.n,
    self: s ? { pos: [s[0], s[1], s[2]], vel: [s[3], s[4], s[5]], crouch: s[6], flags: s[7], health: s[8], armor: s[9], ackSeq: s[10] } : null,
    players: m.p.map((p) => ({ id: p[0], pos: [p[1], p[2], p[3]], yaw: p[4], pitch: p[5], crouch: p[6], flags: p[7], weapon: p[8] })),
  };
}

/**
 * Unpack an input message. A client sends these, so nothing is assumed: whatever is in each slot is
 * handed on as a command's fields, and `sanitizeCommand` decides whether it is one.
 */
function unpackInput(m: { c?: unknown }): ClientMessage {
  const list = Array.isArray(m.c) ? m.c : [];
  const cmds = list.map((c: unknown) => {
    const a = Array.isArray(c) ? c : [];
    return { seq: a[0], dt: a[1], held: a[2], pressed: a[3], yaw: a[4], pitch: a[5], speed: a[6] };
  });
  return { t: 'input', cmds: cmds as Command[] };
}

function parse(data: unknown, types: ReadonlySet<string>): { t: string } | null {
  if (typeof data !== 'string' || data.length > MAX_MESSAGE_SIZE) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
  const t = (msg as { t?: unknown }).t;
  return typeof t === 'string' && types.has(t) ? (msg as { t: string }) : null;
}

/**
 * Decode a message from a client. Only the envelope is checked here (size, JSON, a known type): the
 * server must still validate each field it uses, since the sender is untrusted.
 */
export function decodeClient(data: unknown): ClientMessage | null {
  const msg = parse(data, CLIENT_TYPES);
  if (msg?.t === 'i') return unpackInput(msg as { c?: unknown });
  return msg?.t === 'input' ? null : (msg as ClientMessage | null); // inputs only come packed
}

export function decodeServer(data: unknown): ServerMessage | null {
  const msg = parse(data, SERVER_TYPES);
  if (msg?.t === 's') return unpackSnapshot(msg as unknown as Parameters<typeof unpackSnapshot>[0]);
  return msg?.t === 'snapshot' ? null : (msg as ServerMessage | null);
}

/** Trim a display name to what the lobby shows; null when nothing usable is left. */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // drop control and invisible formatting characters, collapse runs of spaces
  const name = raw
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  return name.length > 0 ? name : null;
}
