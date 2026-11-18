/**
 * Runs a practice mode: owns the bots, assigns peek spots, handles deaths/respawns
 * and mode-specific bookkeeping (escapes, bait shots, deathmatch spawns).
 */

import type { BotWeapons, EnemySpot, MapLocation, PracticeConfig, SpawnPoint, WeaponId } from '../../types';
import { WEAPONS } from '../weapons/weaponConfigs';
import { Bot, type BotContext } from '../bots/Bot';
import type { BotView } from '../bots/BotVisual';
import { DeathmatchBehavior } from '../bots/behaviors/DeathmatchBehavior';
import { PeekBehavior } from '../bots/behaviors/PeekBehavior';
import { analysePeekLine, BOT_EYE, isHumanoidVisible } from '../bots/perception/visibility';
import { nearestWalkable } from '../bots/navigation/GridNavigator';
import type { MapData } from '../maps/MapData';
import { STAND_EYE } from '../player/PlayerController';
import type { SessionTracker } from './SessionTracker';

/** Bots never peek closer than this to the player's spawn (horizontal metres). */
const MIN_SPOT_DISTANCE = 6;

/** Closest horizontal distance between a spawn and a spot's whole peek line (cover → full peek). */
function spotDistance(spawn: SpawnPoint, spot: EnemySpot): number {
  const ax = spot.cover[0], az = spot.cover[2];
  const bx = ax + spot.peekDir[0] * spot.maxPeek, bz = az + spot.peekDir[1] * spot.maxPeek;
  const px = spawn.pos[0], pz = spawn.pos[2];
  const vx = bx - ax, vz = bz - az;
  const len2 = vx * vx + vz * vz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / len2)) : 0;
  return Math.hypot(ax + vx * t - px, az + vz * t - pz);
}

/**
 * Whether a spot works from a spawn: the bot can hide behind its cover and become visible by
 * peeking, and its peek line stays a sensible distance away (spots are shared by all spawns of a
 * side, so one generated for a far spawn can sit right next to another spawn).
 */
export function spotUsableFrom(world: MapData['world'], spawn: SpawnPoint, spot: EnemySpot): boolean {
  if (spotDistance(spawn, spot) < MIN_SPOT_DISTANCE) return false;
  const eye: [number, number, number] = [spawn.pos[0], spawn.pos[1] + STAND_EYE, spawn.pos[2]];
  const info = analysePeekLine(world, eye, spot.cover[0], spot.cover[1], spot.cover[2], spot.peekDir[0], spot.peekDir[1], spot.maxPeek);
  return info.exposeAt !== null && info.hideAt !== null;
}

/** Weighted pools bots draw their gun from. The sniper is left out: a body shot from it kills. */
const BOT_WEAPON_POOLS: Record<Exclude<BotWeapons, 'mirror'>, [WeaponId, number][]> = {
  mixed: [
    ['vandal', 3],
    ['phantom', 3],
    ['spectre', 2],
    ['guardian', 1],
    ['sheriff', 1],
    ['ghost', 1],
    ['classic', 1],
  ],
  rifles: [
    ['vandal', 1],
    ['phantom', 1],
  ],
  pistols: [
    ['classic', 2],
    ['ghost', 2],
    ['sheriff', 1],
  ],
};

/** Retake: seconds until the spike detonates, seconds of holding to defuse, and how close you must stand. */
export const SPIKE_FUSE = 45;
export const SPIKE_DEFUSE = 5;
export const SPIKE_RANGE = 2.2;

export interface Spike {
  x: number;
  y: number;
  z: number;
  /** Seconds left on the fuse. */
  fuse: number;
  /** Defuse progress, 0–1. Letting go or stepping away resets it. */
  progress: number;
  state: 'armed' | 'defused' | 'exploded';
  /** The player is close enough to defuse. */
  inRange: boolean;
}

/** How long a bot keeps its firing slot after it last asked to shoot (seconds). */
const ATTACK_SLOT_HOLD = 1.2;

interface PendingRespawn {
  bot: Bot;
  at: number;
}

export interface DirectorDeps {
  map: MapData;
  location: MapLocation;
  config: PracticeConfig;
  tracker: SessionTracker;
  /** Builds the on-screen body for a new bot (null = headless, e.g. tests). */
  createVisual: ((id: number) => BotView) | null;
  /** Told when a bot is handed a gun, so its body can show that gun (optional). */
  onBotWeapon?: (bot: Bot) => void;
  rng: () => number;
}

export const MODE_LABELS: Record<PracticeConfig['mode'], string> = {
  'angle-hold': 'Angle Holding',
  jiggle: 'Jiggle Peek Training',
  'site-clear': 'Site Clear',
  retake: 'Retake',
  deathmatch: 'Deathmatch',
  spray: 'Spray Control',
};

export class PracticeDirector {
  readonly bots: Bot[] = [];
  readonly spots: EnemySpot[];
  readonly playerSpawn: SpawnPoint;
  readonly unusableSpots: string[] = [];
  private pending: PendingRespawn[] = [];
  private playerRespawnAt = -1;
  private spawnCells: [number, number, number][] = [];
  /** Site clear: where defenders may be posted, the current round number and its timing. */
  private posts: EnemySpot[] = [];
  private round = 0;
  private roundStart = 0;
  private nextRoundAt = -1;
  /** Retake: the planted spike (null in every other mode). */
  spike: Spike | null = null;
  /** Set by the engine each frame: the player is holding the defuse key. */
  useHeld = false;

  constructor(private readonly d: DirectorDeps) {
    const setup = d.location.sides[d.config.side];
    this.playerSpawn = setup.playerSpawns.find((s) => s.id === d.config.playerSpawnId) ?? setup.playerSpawns[0];
    const chosen = d.config.enemySpotIds.length
      ? setup.enemySpots.filter((s) => d.config.enemySpotIds.includes(s.id))
      : setup.enemySpots;
    const usable = (list: EnemySpot[]) =>
      list.filter((s) => {
        const ok = spotUsableFrom(d.map.world, this.playerSpawn, s);
        if (!ok && !this.unusableSpots.includes(s.id)) this.unusableSpots.push(s.id);
        return ok;
      });
    let spots = usable(chosen);
    if (spots.length === 0) spots = usable(setup.enemySpots);
    if (spots.length === 0) spots = setup.enemySpots.filter((s) => spotDistance(this.playerSpawn, s) >= MIN_SPOT_DISTANCE);
    if (spots.length === 0) spots = setup.enemySpots;
    this.spots = spots;
    // Site clear: defenders start hidden at any of the side's cover positions that isn't on top of the
    // player's spawn. The player comes to them, so a post needn't be visible from the spawn.
    // Positions picked in the menu are respected when enough of them are left.
    const isFar = (s: EnemySpot) => Math.hypot(s.cover[0] - this.playerSpawn.pos[0], s.cover[2] - this.playerSpawn.pos[2]) >= 9;
    const picked = chosen.filter(isFar);
    const far = setup.enemySpots.filter(isFar);
    this.posts = picked.length >= 2 ? picked : far.length >= 2 ? far : setup.enemySpots;
    if (d.config.mode === 'retake') {
      // Plant on the nearest site if the defenders' posts surround one, otherwise in the middle of them.
      const cx = this.posts.reduce((a, s) => a + s.cover[0], 0) / this.posts.length;
      const cz = this.posts.reduce((a, s) => a + s.cover[2], 0) / this.posts.length;
      let at: [number, number] = [cx, cz];
      let best = 16;
      for (const m of d.map.def.siteMarks) {
        const x = d.map.space.x(m.c);
        const z = d.map.space.z(m.r);
        const dist = Math.hypot(x - cx, z - cz);
        if (dist < best) {
          best = dist;
          at = [x, z];
        }
      }
      const { nav, space } = d.map;
      const idx = nearestWalkable(nav, space.col(at[0]), space.row(at[1]), 6);
      const x = idx >= 0 ? space.x(idx % nav.cols) : at[0];
      const z = idx >= 0 ? space.z(Math.floor(idx / nav.cols)) : at[1];
      const y = idx >= 0 ? nav.height[idx] : 0;
      this.spike = { x, y, z, fuse: SPIKE_FUSE, progress: 0, state: 'armed', inRange: false };
      // defenders hold the posts closest to it
      this.posts = [...this.posts].sort((a, b) => Math.hypot(a.cover[0] - x, a.cover[2] - z) - Math.hypot(b.cover[0] - x, b.cover[2] - z));
    }

    // Deathmatch spawn cells: walkable ground cells.
    const { nav, space } = d.map;
    for (let r = 0; r < nav.rows; r++)
      for (let c = 0; c < nav.cols; c++) {
        const i = r * nav.cols + c;
        if (nav.walkable[i]) this.spawnCells.push([space.x(c), nav.height[i], space.z(r)]);
      }
  }

  get mode() {
    return this.d.config.mode;
  }

  private attackers = new Map<Bot, number>();

  /** Pick a gun for a bot that is (re)spawning. */
  private pickWeapon(rng: () => number): WeaponId {
    const mode = this.d.config.botWeapons ?? 'mixed';
    if (mode === 'mirror') return this.d.config.primary === 'operator' ? 'vandal' : this.d.config.primary;
    const pool = BOT_WEAPON_POOLS[mode] ?? BOT_WEAPON_POOLS.mixed;
    let r = rng() * pool.reduce((a, [, w]) => a + w, 0);
    for (const [id, w] of pool) {
      r -= w;
      if (r <= 0) return id;
    }
    return pool[0][0];
  }

  /**
   * Limit how many bots shoot at once (tuning.maxAttackers, 0 = no limit). A bot that is allowed to
   * fire holds its slot for a moment after it last asked, so bursts are not cut in half.
   */
  mayFire(bot: Bot, time: number): boolean {
    const max = this.d.config.tuning.maxAttackers ?? 0;
    if (max <= 0) return true;
    for (const [b, t] of this.attackers) if (!b.alive || time - t > ATTACK_SLOT_HOLD) this.attackers.delete(b);
    if (this.attackers.has(bot) || this.attackers.size < max) {
      this.attackers.set(bot, time);
      return true;
    }
    return false;
  }

  /** Hand a bot one of the session's guns. */
  private arm(bot: Bot, rng: () => number) {
    bot.setWeapon(WEAPONS[this.pickWeapon(rng)]);
    this.d.onBotWeapon?.(bot);
  }

  private makeBot(): Bot {
    const visual = this.d.createVisual ? this.d.createVisual(Bot.nextId) : null;
    const bot = new Bot(this.d.config.tuning, visual);
    this.bots.push(bot);
    return bot;
  }

  private claimed(except?: Bot): Set<string> {
    const s = new Set<string>();
    for (const b of this.bots) {
      if (b === except || !b.alive) continue;
      if (b.brain instanceof PeekBehavior) s.add(b.brain.spot.id);
    }
    for (const p of this.pending) if (p.bot.brain instanceof PeekBehavior) s.add(p.bot.brain.spot.id);
    return s;
  }

  private pickSpot(bot: Bot, ctx: BotContext, avoid?: string): EnemySpot {
    const claimed = this.claimed(bot);
    let free = this.spots.filter((s) => !claimed.has(s.id) && s.id !== avoid);
    if (free.length === 0) free = this.spots.filter((s) => !claimed.has(s.id));
    if (free.length === 0) free = this.spots;
    return free[Math.floor(ctx.rng() * free.length)];
  }

  private spawnPeekBot(bot: Bot, ctx: BotContext, avoid?: string) {
    const spot = this.pickSpot(bot, ctx, avoid);
    const mode = this.d.config.mode === 'jiggle' ? 'jiggle' : 'angle-hold';
    const brain = new PeekBehavior(spot, this.d.config.behavior, mode, {
      onEscape: () => this.d.tracker.escape(),
      claimed: () => this.claimed(bot),
      spots: this.spots,
    });
    bot.reset();
    this.arm(bot, ctx.rng);
    bot.brain = brain;
    brain.start(bot, ctx);
    bot.visual?.setVisible(true);
  }

  /** Find a deathmatch spawn far from (and hidden from) the given eye and away from other bots. */
  private dmSpawnPoint(ctx: BotContext, avoidEye: [number, number, number], avoidBots: boolean): [number, number, number] {
    let best: [number, number, number] | null = null;
    for (let i = 0; i < 60; i++) {
      const c = this.spawnCells[Math.floor(ctx.rng() * this.spawnCells.length)];
      const dist = Math.hypot(c[0] - avoidEye[0], c[2] - avoidEye[2]);
      if (dist < 16) continue;
      if (Math.abs(c[1]) > 0.01) continue;
      if (isHumanoidVisible(ctx.world, avoidEye[0], avoidEye[1], avoidEye[2], c[0], c[1], c[2], 0)) continue;
      if (avoidBots) {
        let ok = true;
        for (const b of this.bots) {
          if (!b.alive) continue;
          if (Math.hypot(b.x - c[0], b.z - c[2]) < 12) ok = false;
          else if (isHumanoidVisible(ctx.world, b.x, b.y + BOT_EYE, b.z, c[0], c[1], c[2], 0)) ok = false;
          if (!ok) break;
        }
        if (!ok) continue;
      }
      best = c;
      break;
    }
    return best ?? this.spawnCells[Math.floor(ctx.rng() * this.spawnCells.length)];
  }

  private spawnDmBot(bot: Bot, ctx: BotContext) {
    const eye = ctx.player.eye();
    const [x, y, z] = this.dmSpawnPoint(ctx, eye, false);
    bot.reset();
    this.arm(bot, ctx.rng);
    bot.brain = new DeathmatchBehavior();
    bot.place(x, y, z, ctx.rng() * Math.PI * 2);
    bot.preAimed = false;
    bot.committed = true;
    bot.visual?.setVisible(true);
  }

  /** Site clear: post a fresh set of defenders. Nobody respawns until the round is over. */
  private startRound(ctx: BotContext) {
    const n = Math.max(1, Math.min(this.d.config.botCount, this.posts.length, 6));
    while (this.bots.length < n) this.makeBot();
    // retake: draw from the posts nearest the spike (the list is sorted by distance to it)
    const pool = this.spike ? this.posts.slice(0, n + 2) : [...this.posts];
    if (this.spike) Object.assign(this.spike, { fuse: SPIKE_FUSE, progress: 0, state: 'armed', inRange: false });
    const sp = this.playerSpawn;
    for (const bot of this.bots) {
      const post = pool.splice(Math.floor(ctx.rng() * pool.length), 1)[0];
      const [x, y, z] = post.cover;
      const yaw = Math.atan2(sp.pos[0] - x, sp.pos[2] - z);
      bot.reset();
      this.arm(bot, ctx.rng);
      bot.brain = new DeathmatchBehavior({ x, z, yaw });
      bot.place(x, y, z, yaw);
      bot.preAimed = true;
      bot.committed = true;
      bot.visual?.setVisible(true);
    }
    this.pending.length = 0;
    this.round++;
    this.roundStart = ctx.time;
    this.nextRoundAt = -1;
    ctx.graceUntil = ctx.time + 1;
    this.d.tracker.roundStarted();
  }

  /** Short status for the HUD (site clear only). */
  get statusLabel(): string | null {
    if (this.spike) {
      const sp = this.spike;
      if (sp.state === 'defused') return `Retake · Round ${this.round} · spike defused`;
      if (sp.state === 'exploded') return `Retake · Round ${this.round} · spike detonated`;
      const t = Math.ceil(sp.fuse);
      return `Retake · Round ${this.round} · 0:${String(t).padStart(2, '0')} · ${this.activeBots} left`;
    }
    if (this.mode !== 'site-clear') return null;
    const left = this.activeBots;
    return left > 0 ? `Site Clear · Round ${this.round} · ${left} left` : `Site Clear · Round ${this.round} cleared`;
  }

  /** Modes played as rounds against posted defenders who don't respawn. */
  private get roundMode() {
    return this.mode === 'site-clear' || this.mode === 'retake';
  }

  start(ctx: BotContext) {
    if (this.mode === 'spray') return; // a wall is the only target
    if (this.roundMode) {
      this.startRound(ctx);
      return;
    }
    const n = Math.max(1, Math.min(this.d.config.botCount, this.mode === 'deathmatch' ? 10 : this.spots.length));
    for (let i = 0; i < n; i++) {
      const bot = this.makeBot();
      if (this.mode === 'deathmatch') this.spawnDmBot(bot, ctx);
      else this.spawnPeekBot(bot, ctx);
    }
  }

  onBotKilled(bot: Bot, ctx: BotContext) {
    if (this.mode === 'retake') return; // killing everyone isn't enough: the spike still has to be defused
    if (this.mode === 'site-clear') {
      if (!this.bots.some((b) => b !== bot && b.alive) && this.nextRoundAt < 0 && this.playerRespawnAt < 0) {
        this.d.tracker.roundCleared(ctx.time - this.roundStart);
        this.nextRoundAt = ctx.time + 2;
      }
      return;
    }
    const delay = this.mode === 'deathmatch' ? 3 : 0.8 + ctx.rng() * 0.8;
    this.pending.push({ bot, at: ctx.time + delay });
  }

  /** Returns seconds until respawn. */
  onPlayerDeath(ctx: BotContext): number {
    const delay = this.mode === 'deathmatch' ? 2 : 1.5;
    this.playerRespawnAt = ctx.time + delay;
    return delay;
  }

  /** Player gunfire / footsteps alert nearby deathmatch bots. */
  hear(ctx: BotContext, x: number, z: number, radius: number) {
    for (const b of this.bots) {
      if (!b.alive || !b.brain?.hear) continue;
      if (Math.hypot(b.x - x, b.z - z) <= radius) b.brain.hear(b, ctx, x, z);
    }
  }

  update(ctx: BotContext, dt: number, respawnPlayer: (x: number, y: number, z: number, yawDeg: number) => void) {
    for (const b of this.bots) b.update(ctx, dt);

    // retake: run the fuse and the defuse
    const sp = this.spike;
    if (sp && sp.state === 'armed' && this.nextRoundAt < 0 && this.playerRespawnAt < 0) {
      sp.fuse -= dt;
      sp.inRange = ctx.player.alive && Math.hypot(ctx.player.pos.x - sp.x, ctx.player.pos.z - sp.z) < SPIKE_RANGE && Math.abs(ctx.player.pos.y - sp.y) < 1.5;
      sp.progress = sp.inRange && this.useHeld ? sp.progress + dt / SPIKE_DEFUSE : 0;
      if (sp.progress >= 1) {
        sp.progress = 1;
        sp.state = 'defused';
        this.d.tracker.roundCleared(SPIKE_FUSE - sp.fuse);
        this.nextRoundAt = ctx.time + 2.5;
      } else if (sp.fuse <= 0) {
        sp.fuse = 0;
        sp.state = 'exploded';
        this.nextRoundAt = ctx.time + 2.5;
      }
    }

    // round modes: the round is over, so send the player back and post new defenders
    if (this.nextRoundAt >= 0 && ctx.time >= this.nextRoundAt) {
      const s = this.playerSpawn;
      respawnPlayer(s.pos[0], s.pos[1], s.pos[2], s.yaw);
      this.startRound(ctx);
    }

    // bot respawns
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (ctx.time >= p.at - 0.6) p.bot.visual?.setVisible(false);
      if (ctx.time < p.at) continue;
      this.pending.splice(i, 1);
      const prevSpot = p.bot.brain instanceof PeekBehavior ? p.bot.brain.spot.id : undefined;
      if (this.mode === 'deathmatch') this.spawnDmBot(p.bot, ctx);
      else this.spawnPeekBot(p.bot, ctx, prevSpot);
    }

    // player respawn
    if (this.playerRespawnAt >= 0 && ctx.time >= this.playerRespawnAt) {
      this.playerRespawnAt = -1;
      // spawn protection: nobody shoots for a moment after the player is back
      ctx.graceUntil = ctx.time + (this.mode === 'deathmatch' ? 2 : 1.2);
      if (this.roundMode) {
        // died mid-round: the round is lost, start a new one from the spawn
        const s = this.playerSpawn;
        respawnPlayer(s.pos[0], s.pos[1], s.pos[2], s.yaw);
        this.startRound(ctx);
      } else if (this.mode === 'deathmatch') {
        const [x, y, z] = this.dmSpawnPoint(ctx, ctx.player.eye(), true);
        // face towards map centre
        const yaw = (Math.atan2(-x, -z) * 180) / Math.PI;
        respawnPlayer(x, y, z, yaw);
      } else {
        const s = this.playerSpawn;
        respawnPlayer(s.pos[0], s.pos[1], s.pos[2], s.yaw);
        // reset peekers so the player isn't instantly traded
        for (const b of this.bots) {
          if (b.alive && b.brain instanceof PeekBehavior) b.brain.start(b, ctx);
        }
      }
    }
  }

  get activeBots() {
    return this.bots.filter((b) => b.alive).length;
  }

  dispose() {
    for (const b of this.bots) b.visual?.dispose();
    this.bots.length = 0;
    this.pending.length = 0;
  }
}
