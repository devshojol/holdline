/**
 * The browser's connection to the multiplayer game server, and the state the lobby UI renders from.
 * One socket carries everything (docs/multiplayer.md, section 6.5). Nothing connects until the player
 * creates or joins a room.
 */
import { useSyncExternalStore } from 'react';
import { store as appStore } from '../hooks/useAppStore';
import { load, save } from '../services/storage';
import {
  PROTOCOL_VERSION,
  decodeServer,
  encode,
  sanitizeName,
  type ClientMessage,
  type Loadout,
  type QueueState,
  type RoomState,
  type ScoreLine,
  type ServerMessage,
  type Team,
} from '../net/protocol';
import { normalizeRoomCode } from '../net/roomCode';
import type { RoomSettings } from '../net/settings';
import { readResume, writeResume } from './resume';
import type { PracticeConfig } from '../types';
import type { NetLink } from '../game/net/NetLink';
import { getMapDefinition } from '../game/maps/registry';
import { DEFAULT_PRACTICE } from '../settings/defaults';

/** A match this player has a body in. */
export interface ActiveMatch {
  /** The session setup the game engine is started with: the room's map, no bots, no time limit of its own. */
  config: PracticeConfig;
  link: NetLink;
  settings: RoomSettings;
}

export interface MultiplayerState {
  /** False when this build has no game server to talk to. */
  available: boolean;
  status: 'idle' | 'connecting' | 'online' | 'reconnecting';
  name: string;
  playerId: string | null;
  room: RoomState | null;
  /** The last thing that went wrong, in words for the player. */
  error: string | null;
  /** Round trip to the server in milliseconds, -1 until measured. */
  ping: number;
  /** Add to Date.now() to get the server's clock. */
  clockOffset: number;
  /** A room code from an invite link that hasn't been joined yet. */
  invite: string | null;
  /** The running match, once the server has placed this player in it. */
  match: ActiveMatch | null;
  /** Whether the game view is showing (false: the player stepped out to the lobby while the match runs). */
  inGame: boolean;
  /** The scoreboard of the running match, best first. */
  scores: ScoreLine[];
  /** How the last match in this room ended. */
  result: MatchResult | null;
  /** The search for a quick match, while one is on. */
  queue: QueueState | null;
  /** When the search started (local time, ms). */
  queueSince: number;
  /** The maps last chosen for quick match (empty = any map). */
  quickMaps: string[];
}

export interface MatchResult {
  scores: ScoreLine[];
  /** A player's id, a team, or null for a draw. */
  winner: string | Team | null;
  settings: RoomSettings;
}

const PING_MS = 2000;
/**
 * Attempts to reach the server before giving up, each a little later than the last (8 s apart at most):
 * about a minute and a half in all. A host that puts an idle server to sleep needs about a minute to wake it.
 */
const MAX_RETRIES = 14;

/** The server address: set at build time, or this machine in development. */
function serverUrl(): string {
  const configured = import.meta.env.VITE_MP_SERVER;
  if (configured) return configured;
  if (import.meta.env.DEV && typeof location !== 'undefined') return `ws://${location.hostname}:8787`;
  return '';
}

function inviteFromUrl(): string | null {
  if (typeof location === 'undefined') return null;
  return normalizeRoomCode(new URLSearchParams(location.search).get('room'));
}

let state: MultiplayerState = {
  available: serverUrl() !== '',
  status: 'idle',
  name: load('mp-name', ''),
  playerId: null,
  room: null,
  error: null,
  ping: -1,
  clockOffset: 0,
  invite: inviteFromUrl(),
  match: null,
  inGame: false,
  scores: [],
  result: null,
  queue: null,
  queueSince: 0,
  quickMaps: load<string[]>('mp-quick-maps', []),
};
const listeners = new Set<() => void>();

function set(patch: Partial<MultiplayerState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

let socket: WebSocket | null = null;
/** True once the server has answered our hello on the current socket. */
let greeted = false;
/** Messages waiting for the connection to be ready. */
let outbox: ClientMessage[] = [];
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let pingTimer: ReturnType<typeof setInterval> | undefined;
let lastRtt: number | undefined;
/** Set when the connection must not be re-opened by itself (the page is out of date, the player left). */
let stopped = true;

/** Testing: artificial delay on the connection, in ms each way (see `NetLink.setLag`). */
const lag = { oneWay: 0, jitter: 0 };
let lastSendAt = 0;
let lastReceiveAt = 0;

/** When a message should be let through: after the delay, and never before one that came earlier. */
function delayed(previous: number): number {
  return Math.max(previous, performance.now() + lag.oneWay + (Math.random() * 2 - 1) * lag.jitter);
}

function raw(msg: ClientMessage) {
  const ws = socket;
  if (ws?.readyState !== WebSocket.OPEN) return;
  if (lag.oneWay <= 0) {
    ws.send(encode(msg));
    return;
  }
  lastSendAt = delayed(lastSendAt);
  setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(encode(msg));
  }, lastSendAt - performance.now());
}

/** Send now if the connection is ready, otherwise as soon as it is (opening it if needed). */
function send(msg: ClientMessage) {
  if (greeted) {
    raw(msg);
    return;
  }
  outbox.push(msg);
  open();
}

function open() {
  if (socket || !state.available) return;
  stopped = false;
  clearTimeout(retryTimer);
  set({ status: retries > 0 ? 'reconnecting' : 'connecting' });
  const ws = new WebSocket(serverUrl());
  socket = ws;
  ws.onopen = () => raw({ t: 'hello', version: PROTOCOL_VERSION, playerId: state.playerId ?? '', name: state.name, resume: readResume() });
  ws.onmessage = (e) => {
    const msg = decodeServer(e.data);
    if (!msg || socket !== ws) return;
    if (lag.oneWay <= 0) {
      receive(msg);
      return;
    }
    lastReceiveAt = delayed(lastReceiveAt);
    setTimeout(() => {
      if (socket === ws) receive(msg);
    }, lastReceiveAt - performance.now());
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    greeted = false;
    clearInterval(pingTimer);
    // come back by ourselves while there is a room to return to or something still to send
    if (!stopped && (state.room || state.queue || outbox.length > 0) && retries < MAX_RETRIES) {
      set({ status: 'reconnecting', ping: -1 });
      retryTimer = setTimeout(open, Math.min(8000, 500 * 2 ** retries++));
      return;
    }
    const lost = !stopped && (state.room !== null || state.queue !== null || outbox.length > 0);
    outbox = [];
    retries = 0;
    set({ status: 'idle', ping: -1, room: null, queue: null, match: null, inGame: false, error: lost ? 'Could not reach the game server. Check your connection and try again.' : state.error });
  };
}

function close() {
  stopped = true;
  clearTimeout(retryTimer);
  outbox = [];
  retries = 0;
  const ws = socket;
  socket = null;
  greeted = false;
  clearInterval(pingTimer);
  ws?.close();
  set({ status: 'idle', ping: -1, room: null, queue: null, match: null, inGame: false });
}

function receive(msg: ServerMessage) {
  switch (msg.t) {
    case 'welcome': {
      greeted = true;
      retries = 0;
      const hadRoom = state.room !== null;
      writeResume(msg.resume);
      set({ status: 'online', playerId: msg.playerId, clockOffset: msg.serverTime - Date.now(), room: msg.room ? state.room : null });
      const { primary, secondary } = appStore.get().practice;
      raw({ t: 'loadout', loadout: { primary, secondary } });
      const queued = outbox;
      outbox = [];
      // a join or create that was waiting is pointless if the server already put us back in a room
      for (const m of queued) if (!(msg.room && (m.t === 'room.create' || (m.t === 'room.join' && normalizeRoomCode(m.code) === msg.room)))) raw(m);
      // the connection dropped in the middle of a search: take up the search again
      if (!msg.room && state.queue && !queued.some((m) => m.t === 'queue.join')) raw({ t: 'queue.join', maps: state.queue.maps });
      if (!msg.room && !state.queue && queued.length === 0) {
        // we came back for a room that no longer has us: nothing to stay connected for
        writeResume(null);
        close();
        if (hadRoom) set({ error: 'The connection dropped for too long, or the server restarted, and your place in the room was lost.' });
        return;
      }
      clearInterval(pingTimer);
      const ping = () => raw({ t: 'ping', time: performance.now(), rtt: lastRtt });
      pingTimer = setInterval(ping, PING_MS);
      ping();
      return;
    }
    case 'pong': {
      const rtt = performance.now() - msg.time;
      lastRtt = rtt;
      set({ ping: Math.round(rtt), clockOffset: msg.serverTime + rtt / 2 - Date.now() });
      return;
    }
    case 'queue.state':
      // a state while already in a room means the room was dissolved and we are back in the queue
      if (msg.queue) set({ queue: msg.queue, queueSince: state.queue ? state.queueSince : Date.now(), room: null, match: null, inGame: false });
      else set({ queue: null });
      return;
    case 'room.state':
      set({ room: msg.room, queue: null, error: null, invite: state.invite === msg.room.code ? null : state.invite });
      clearInviteFromUrl();
      return;
    case 'match.start': {
      const current = state.match;
      if (current && current.settings.mapId === msg.settings.mapId) {
        // Back in the match we were already drawing (the connection dropped and returned): keep the
        // game as it is and just move the player to where the server put them.
        current.link.spawn = msg.spawn;
        current.link.endsAt = msg.endsAt;
        current.link.playerId = state.playerId ?? current.link.playerId;
        set({ scores: msg.scores });
        current.link.onMessage?.({ t: 'event', time: msg.serverTime, event: { type: 'respawn', id: current.link.playerId, pos: msg.spawn.pos, yaw: msg.spawn.yaw } });
        return;
      }
      const def = getMapDefinition(msg.settings.mapId);
      const { primary, secondary } = appStore.get().practice;
      const config: PracticeConfig = {
        ...DEFAULT_PRACTICE,
        mapId: def.id,
        locationId: def.locations[0].id,
        playerSpawnId: '',
        enemySpotIds: [],
        mode: 'deathmatch',
        primary,
        secondary,
        botCount: 0,
        durationSec: 0,
        infiniteAmmo: msg.settings.infiniteAmmo,
      };
      const link: NetLink = {
        playerId: state.playerId ?? '',
        spawn: msg.spawn,
        endsAt: msg.endsAt,
        nameOf: (id) => state.scores.find((p) => p.id === id)?.name ?? state.room?.players.find((p) => p.id === id)?.name ?? 'Player',
        send: raw,
        onMessage: null,
        drop: () => socket?.close(),
        setLag(ms, jitter = 0) {
          lag.oneWay = Math.max(0, ms) / 2;
          lag.jitter = Math.min(lag.oneWay, Math.max(0, jitter) / 2);
        },
      };
      set({ match: { config, link, settings: msg.settings }, inGame: true, scores: msg.scores, result: null });
      return;
    }
    case 'snapshot':
    case 'event':
      state.match?.link.onMessage?.(msg);
      return;
    case 'scores':
      set({ scores: msg.scores });
      return;
    case 'match.end':
      set({ match: null, inGame: false, scores: [], result: state.match ? { scores: msg.scores, winner: msg.winner, settings: state.match.settings } : state.result });
      return;
    case 'room.left':
      set({
        match: null,
        inGame: false,
        scores: [],
        room: null,
        // a quick match that ran its course leaves its final score to look at; any other way out clears it
        result: msg.reason === 'closed' ? state.result : null,
        error:
          msg.reason === 'kicked'
            ? 'The host removed you from the room.'
            : msg.reason === 'idle'
              ? 'You were removed from the match for being inactive, so someone else could have the place.'
              : state.error,
      });
      return;
    case 'error':
      set({ error: msg.message });
      if (msg.code === 'version' || msg.code === 'name-rejected') close();
      return;
  }
}

/** Once an invite has been used, take `?room=` out of the address so a reload doesn't join again. */
function clearInviteFromUrl() {
  if (typeof location === 'undefined' || !new URLSearchParams(location.search).has('room')) return;
  const url = new URL(location.href);
  url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

export const multiplayer = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  setName(name: string) {
    set({ name });
    save('mp-name', sanitizeName(name) ?? '');
  },
  createRoom() {
    set({ error: null });
    send({ t: 'room.create' });
  },
  joinRoom(code: string) {
    const normal = normalizeRoomCode(code);
    if (!normal) {
      set({ error: 'A room code is 6 letters and digits.' });
      return;
    }
    set({ error: null });
    send({ t: 'room.join', code: normal });
  },
  /** Search for a quick match on any of `maps` (empty = any map). */
  findMatch(maps: string[]) {
    save('mp-quick-maps', maps);
    set({ error: null, result: null, quickMaps: maps, queue: { maps, waiting: 1, startsAt: 0 }, queueSince: Date.now() });
    send({ t: 'queue.join', maps });
  },
  cancelSearch() {
    raw({ t: 'queue.leave' });
    close();
  },
  /** Called when the Multiplayer page is left: outside a room or a search there is nothing to stay connected for. */
  idle() {
    if (!state.room && !state.queue && state.status !== 'idle') close();
  },
  dismissResult() {
    set({ result: null });
  },
  /** Leave the room and drop the connection: there is nothing to stay connected for outside a room. */
  leaveRoom() {
    raw({ t: 'room.leave' });
    writeResume(null);
    close();
  },
  /** Called when the page opens: a reload returns to the room this tab was in. */
  resume() {
    if (!state.room && state.status === 'idle' && readResume() && sanitizeName(state.name)) open();
  },
  dismissInvite() {
    set({ invite: null });
    clearInviteFromUrl();
  },
  clearError() {
    set({ error: null });
  },
  updateSettings(patch: Partial<RoomSettings>) {
    send({ t: 'room.settings', patch });
  },
  setReady(ready: boolean) {
    send({ t: 'room.ready', ready });
  },
  setTeam(team: Team, id?: string) {
    send({ t: 'room.team', team, id });
  },
  kick(id: string) {
    send({ t: 'room.kick', id });
  },
  makeHost(id: string) {
    send({ t: 'room.host', id });
  },
  start() {
    send({ t: 'room.start' });
  },
  end() {
    send({ t: 'room.end' });
  },
  /** Tell the server which guns this player now carries (the weapon menu, mid-match). */
  setLoadout(loadout: Loadout) {
    if (greeted) raw({ t: 'loadout', loadout });
  },
  /** Step out of the game view to the lobby; the match goes on and can be returned to. */
  showLobby() {
    set({ inGame: false });
  },
  showGame() {
    if (state.match) set({ inGame: true });
  },
  /** The link a friend opens to join this room. */
  inviteLink(code: string) {
    return `${location.origin}${location.pathname}?room=${code}`;
  },
};

export function useMultiplayer<T>(selector: (s: MultiplayerState) => T): T {
  return useSyncExternalStore(multiplayer.subscribe, () => selector(multiplayer.get()));
}

// development: when this module is hot-replaced, don't leave the old copy's socket connected
if (import.meta.hot) import.meta.hot.dispose(() => close());
