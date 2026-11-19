/**
 * Match settings shared by the lobby UI and the server. A custom room's host edits them; quick match
 * uses `QUICK_MATCH_SETTINGS`. See docs/multiplayer.md, section 3.
 */
import type { WeaponConfig, WeaponId } from '../types';
import { DEFAULT_MAP_ID, MAP_DEFINITIONS } from '../game/maps/registry';
import { WEAPONS } from '../game/weapons/weaponConfigs';

export type MatchMode = 'deathmatch' | 'team-deathmatch';

/**
 * Which guns may be carried:
 *  - `all`: anything.
 *  - `rifles`: the primary must be a rifle; sidearms stay available.
 *  - `sidearms`: no primaries.
 *  - `no-operator`: anything but the sniper.
 *  - `single`: everyone carries `singleWeapon` and nothing else.
 */
export type WeaponRule = 'all' | 'rifles' | 'sidearms' | 'no-operator' | 'single';

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface RoomSettings {
  mapId: string;
  mode: MatchMode;
  /** Match length in minutes. */
  timeLimitMin: number;
  /** First player (or team) to this many kills wins; 0 = no limit. */
  killLimit: number;
  maxPlayers: number;
  weapons: WeaponRule;
  /** The gun everyone carries when `weapons` is `single`. */
  singleWeapon: WeaponId;
  /** Body and leg hits deal no damage. */
  headshotsOnly: boolean;
  /** No reserve limit; reloads still happen. */
  infiniteAmmo: boolean;
  respawnDelaySec: number;
  /** Seconds a player can't be hurt after spawning (ends when they fire); 0 = off. */
  spawnProtectionSec: number;
  /** Whether players may join after the match has started. */
  joinInProgress: boolean;
  /** Team Deathmatch only. */
  friendlyFire: boolean;
  /**
   * Bots join until the match has this many players, and step out one by one as people join.
   * 0 = no bots.
   */
  botFill: number;
  botDifficulty: BotDifficulty;
}

export const MAX_ROOM_PLAYERS = 10;

/** The values the lobby offers for each numeric setting. The server accepts nothing else. */
export const ROOM_OPTIONS = {
  timeLimitMin: [5, 10, 15, 20, 30],
  killLimit: [0, 20, 30, 40, 50, 75, 100],
  respawnDelaySec: [1, 3, 5],
  spawnProtectionSec: [0, 2, 4],
  botFill: [0, 2, 4, 6, 8, 10],
  botDifficulty: ['easy', 'normal', 'hard'],
  mode: ['deathmatch', 'team-deathmatch'],
  weapons: ['all', 'rifles', 'sidearms', 'no-operator', 'single'],
} as const;

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  mapId: DEFAULT_MAP_ID,
  mode: 'deathmatch',
  timeLimitMin: 5,
  killLimit: 40,
  maxPlayers: MAX_ROOM_PLAYERS,
  weapons: 'all',
  singleWeapon: 'vandal',
  headshotsOnly: false,
  infiniteAmmo: false,
  respawnDelaySec: 3,
  spawnProtectionSec: 2,
  joinInProgress: true,
  friendlyFire: false,
  botFill: 0,
  botDifficulty: 'normal',
};

/** Quick match always plays these rules; only the map varies. */
export const QUICK_MATCH_SETTINGS: Omit<RoomSettings, 'mapId'> = {
  mode: 'deathmatch',
  timeLimitMin: 5,
  killLimit: 40,
  maxPlayers: MAX_ROOM_PLAYERS,
  weapons: 'all',
  singleWeapon: 'vandal',
  headshotsOnly: false,
  infiniteAmmo: false,
  respawnDelaySec: 3,
  spawnProtectionSec: 2,
  joinInProgress: true,
  friendlyFire: false,
  // a quick match is never empty: bots make up the numbers until people arrive
  botFill: 6,
  botDifficulty: 'normal',
};

export function isMapId(id: unknown): id is string {
  return typeof id === 'string' && MAP_DEFINITIONS.some((m) => m.id === id);
}

function oneOf<T>(options: readonly T[], value: unknown, fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

/**
 * Apply a change sent by a host to the current settings. Anything unknown or out of range keeps its
 * current value, so the server can pass untrusted input straight in.
 */
export function applyRoomSettings(current: RoomSettings, patch: unknown): RoomSettings {
  if (!patch || typeof patch !== 'object') return current;
  const p = patch as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const maxPlayers = typeof p.maxPlayers === 'number' && Number.isInteger(p.maxPlayers) ? p.maxPlayers : current.maxPlayers;
  return {
    mapId: isMapId(p.mapId) ? p.mapId : current.mapId,
    mode: oneOf(ROOM_OPTIONS.mode, p.mode, current.mode),
    timeLimitMin: oneOf(ROOM_OPTIONS.timeLimitMin, p.timeLimitMin, current.timeLimitMin),
    killLimit: oneOf(ROOM_OPTIONS.killLimit, p.killLimit, current.killLimit),
    maxPlayers: Math.max(2, Math.min(MAX_ROOM_PLAYERS, maxPlayers)),
    weapons: oneOf(ROOM_OPTIONS.weapons, p.weapons, current.weapons),
    singleWeapon: typeof p.singleWeapon === 'string' && p.singleWeapon in WEAPONS ? (p.singleWeapon as WeaponId) : current.singleWeapon,
    headshotsOnly: bool(p.headshotsOnly, current.headshotsOnly),
    infiniteAmmo: bool(p.infiniteAmmo, current.infiniteAmmo),
    respawnDelaySec: oneOf(ROOM_OPTIONS.respawnDelaySec, p.respawnDelaySec, current.respawnDelaySec),
    spawnProtectionSec: oneOf(ROOM_OPTIONS.spawnProtectionSec, p.spawnProtectionSec, current.spawnProtectionSec),
    joinInProgress: bool(p.joinInProgress, current.joinInProgress),
    friendlyFire: bool(p.friendlyFire, current.friendlyFire),
    botFill: oneOf(ROOM_OPTIONS.botFill, p.botFill, current.botFill),
    botDifficulty: oneOf(ROOM_OPTIONS.botDifficulty, p.botDifficulty, current.botDifficulty),
  };
}

/** Whether a room's weapon rule lets a player carry this gun. */
export function isWeaponAllowed(settings: Pick<RoomSettings, 'weapons' | 'singleWeapon'>, weapon: WeaponConfig): boolean {
  switch (settings.weapons) {
    case 'all':
      return true;
    case 'rifles':
      return weapon.slot === 'secondary' || weapon.category === 'Rifle';
    case 'sidearms':
      return weapon.slot === 'secondary';
    case 'no-operator':
      return weapon.category !== 'Sniper';
    case 'single':
      return weapon.id === settings.singleWeapon;
  }
}
