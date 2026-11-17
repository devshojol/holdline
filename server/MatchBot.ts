/**
 * A bot that plays in a multiplayer match (docs/multiplayer.md, section 9).
 *
 * It is a player like any other: it has a body in the match, moves it by producing the same commands
 * a client sends, and fires through the same path, so collisions, hits, damage and scoring need no
 * special case. What this file adds is the deciding: where to go, whom to face and when to shoot.
 *
 * It is deliberately plainer than the practice bots (which peek and jiggle around one player): it
 * roams, fights whoever it sees, chases for a moment, and turns on whoever shoots it.
 */
import type { Vec3, WeaponConfig } from '../src/types';
import { findPath, type NavPoint } from '../src/game/bots/navigation/GridNavigator';
import { isHumanoidVisible } from '../src/game/bots/perception/visibility';
import type { MapData } from '../src/game/maps/MapData';
import type { PlayerController } from '../src/game/player/PlayerController';
import { actionMask, type Command } from '../src/net/command';
import type { BotDifficulty } from '../src/net/settings';

interface Skill {
  /** Seconds between seeing an enemy and the first shot. */
  reaction: number;
  /** How far off (degrees) the aim starts when a target appears. */
  aimError: number;
  /** Seconds for that error to shrink to about a third. */
  settle: number;
  /** How fast the bot can turn, degrees a second. */
  turnRate: number;
  /** Chance of going for the head instead of the chest. */
  headshot: number;
  /** Extra wobble while firing, degrees per bullet of a burst. */
  recoil: number;
  /** Whether it sidesteps between bursts. */
  strafes: boolean;
}

const SKILL: Record<BotDifficulty, Skill> = {
  easy: { reaction: 0.62, aimError: 8, settle: 0.9, turnRate: 300, headshot: 0.08, recoil: 0.5, strafes: false },
  normal: { reaction: 0.4, aimError: 5, settle: 0.6, turnRate: 460, headshot: 0.2, recoil: 0.34, strafes: true },
  hard: { reaction: 0.25, aimError: 2.8, settle: 0.4, turnRate: 680, headshot: 0.38, recoil: 0.2, strafes: true },
};

const DEG = Math.PI / 180;
const STEP = 1 / 120;
const FORWARD = actionMask(['forward']);
const LEFT = actionMask(['left']);
const RIGHT = actionMask(['right']);
/** How wide the bot sees, as the cosine of the half-angle (about 130° in all). */
const FOV_COS = Math.cos(65 * DEG);
/** Anyone this close is noticed whichever way the bot faces. */
const HEAR_RANGE = 4;
const SIGHT_RANGE = 70;
/** How often the bot looks around. */
const LOOK_INTERVAL = 0.12;
/** How long it goes after an enemy it can no longer see. */
const CHASE_SECONDS = 3.5;

/** Another player, as the bot may see them. */
export interface BotTarget {
  id: string;
  controller: PlayerController;
  /** Spawn protection: shooting them is pointless. */
  protected: boolean;
}

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class MatchBot {
  private readonly skill: Skill;
  private seq = 0;
  /** View the bot is turning towards. */
  private wantYaw = 0;
  private wantPitch = 0;

  // perception
  private lookTimer = 0;
  private targetId: string | null = null;
  /** Seconds the current target has been in view. */
  private seenFor = 0;
  private lastKnown: Vec3 | null = null;
  private chase = 0;
  private aimHead = false;
  private errYaw = 0;
  private errPitch = 0;

  // movement
  private path: NavPoint[] = [];
  private stuck = 0;
  private strafe = 0;
  private strafeTimer = 0;

  // shooting
  private ammo: number;
  private reload = 0;
  private cooldown = 0;
  private burstLeft = 0;
  private burstPause = 0;
  private shotsInBurst = 0;

  constructor(
    private readonly map: MapData,
    private readonly spawns: Vec3[],
    readonly weapon: WeaponConfig,
    difficulty: BotDifficulty,
    private readonly rng: () => number,
  ) {
    this.skill = SKILL[difficulty];
    this.ammo = weapon.magazine;
  }

  /** A fresh life: forget the fight that ended the last one. */
  reset(yaw: number) {
    this.wantYaw = wrap(yaw);
    this.wantPitch = 0;
    this.targetId = null;
    this.lastKnown = null;
    this.chase = 0;
    this.path = [];
    this.stuck = 0;
    this.ammo = this.weapon.magazine;
    this.reload = 0;
    this.burstLeft = 0;
    this.burstPause = 0;
  }

  /** Someone hit the bot from `from`: if it isn't already fighting, it turns to look. */
  onDamaged(from: Vec3) {
    if (this.targetId) return;
    this.lastKnown = from;
    this.chase = CHASE_SECONDS;
    this.path = [];
  }

  /**
   * Decide what to do for the next `dt` seconds. Returns the commands that move the body, and calls
   * `fire` (with the eye position and direction) for each bullet.
   */
  think(dt: number, self: PlayerController, others: BotTarget[], fire: (origin: Vec3, dir: Vec3) => void): Command[] {
    const world = this.map.world;
    const eye: Vec3 = [self.pos.x, self.pos.y + self.eyeHeight, self.pos.z];

    // ---- look around
    this.lookTimer -= dt;
    let target = others.find((o) => o.id === this.targetId && o.controller.alive) ?? null;
    if (this.lookTimer <= 0) {
      this.lookTimer = LOOK_INTERVAL;
      let best: BotTarget | null = null;
      let bestDist = Infinity;
      const fx = Math.sin(self.yaw);
      const fz = Math.cos(self.yaw);
      for (const o of others) {
        const c = o.controller;
        if (!c.alive) continue;
        const dx = c.pos.x - self.pos.x;
        const dz = c.pos.z - self.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > SIGHT_RANGE || dist >= bestDist) continue;
        const inView = dist < HEAR_RANGE || (dx * fx + dz * fz) / (dist || 1) > FOV_COS;
        if (!inView || !isHumanoidVisible(world, eye[0], eye[1], eye[2], c.pos.x, c.pos.y, c.pos.z, c.crouch, 1)) continue;
        best = o;
        bestDist = dist;
      }
      if (best && best.id !== this.targetId) {
        // a new enemy: the aim starts off and has to settle, and the reaction clock starts
        this.seenFor = 0;
        const off = this.skill.aimError * DEG;
        this.errYaw = (this.rng() * 2 - 1) * off;
        this.errPitch = (this.rng() * 2 - 1) * off * 0.6;
        this.aimHead = this.rng() < this.skill.headshot;
        this.burstLeft = 0;
        this.burstPause = 0;
      }
      if (!best && target) {
        // lost sight: remember where they were and go and look
        this.lastKnown = [target.controller.pos.x, target.controller.pos.y, target.controller.pos.z];
        this.chase = CHASE_SECONDS;
        this.path = [];
      }
      target = best;
      this.targetId = best?.id ?? null;
    }

    // ---- timers
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.burstPause = Math.max(0, this.burstPause - dt);
    if (this.reload > 0) {
      this.reload -= dt;
      if (this.reload <= 0) this.ammo = this.weapon.magazine;
    }
    this.chase = Math.max(0, this.chase - dt);

    let held = 0;
    if (target) {
      held = this.fight(dt, self, eye, target, fire);
    } else {
      held = this.travel(dt, self);
      // an empty or half-empty gun is reloaded between fights
      if (this.reload <= 0 && this.ammo < this.weapon.magazine * 0.5) this.reload = this.weapon.reloadTime;
    }

    // ---- turn towards the wanted view, no faster than this bot can
    const maxTurn = this.skill.turnRate * DEG * dt;
    const dy = wrap(this.wantYaw - self.yaw);
    const yaw = wrap(self.yaw + Math.max(-maxTurn, Math.min(maxTurn, dy)));
    const dp = this.wantPitch - self.pitch;
    const pitch = self.pitch + Math.max(-maxTurn, Math.min(maxTurn, dp));

    const cmds: Command[] = [];
    for (let left = dt; left > 1e-6; left -= STEP) cmds.push({ seq: this.seq++, dt: Math.min(STEP, left), held, pressed: 0, yaw, pitch, speed: this.weapon.runSpeedMult });
    return cmds;
  }

  /** Face the target, hold still or sidestep, and shoot in bursts once the reaction time has passed. */
  private fight(dt: number, self: PlayerController, eye: Vec3, target: BotTarget, fire: (origin: Vec3, dir: Vec3) => void): number {
    const c = target.controller;
    this.seenFor += dt;
    this.lastKnown = [c.pos.x, c.pos.y, c.pos.z];

    // the aim error shrinks the longer the target is in view
    const keep = Math.exp(-dt / this.skill.settle);
    this.errYaw *= keep;
    this.errPitch *= keep;

    const legs = 0.86 - 0.55 * c.crouch;
    const aimY = c.pos.y + legs + (this.aimHead ? 0.75 : 0.32);
    const dx = c.pos.x - eye[0];
    const dz = c.pos.z - eye[2];
    const dist = Math.hypot(dx, dz);
    const wobble = this.shotsInBurst * this.skill.recoil * DEG;
    this.wantYaw = Math.atan2(dx, dz) + this.errYaw + (this.rng() - 0.5) * wobble;
    this.wantPitch = Math.atan2(aimY - eye[1], dist) + this.errPitch + this.rng() * wobble * 0.6;

    // movement: close the distance when far, otherwise stand (or sidestep between bursts)
    let held = 0;
    if (dist > 32) held = FORWARD;
    else if (this.skill.strafes && this.burstPause > 0) {
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafe = this.rng() < 0.5 ? LEFT : RIGHT;
        this.strafeTimer = 0.3 + this.rng() * 0.4;
      }
      held = this.strafe;
    }

    // shooting
    const onTarget = Math.abs(wrap(this.wantYaw - self.yaw)) < 4 * DEG && Math.abs(this.wantPitch - self.pitch) < 4 * DEG;
    const ready = this.seenFor >= this.skill.reaction && this.reload <= 0 && this.cooldown <= 0 && this.burstPause <= 0 && !target.protected;
    if (ready && onTarget && self.speed < 1.2) {
      if (this.ammo <= 0) {
        this.reload = this.weapon.reloadTime;
      } else {
        if (this.burstLeft <= 0) {
          // tap at range, burst in the middle, spray up close
          const full = this.weapon.auto ? (dist > 28 ? 2 : dist > 10 ? 4 : 7) : 1;
          this.burstLeft = Math.max(1, Math.round(full * (0.7 + this.rng() * 0.6)));
          this.shotsInBurst = 0;
        }
        const cp = Math.cos(self.pitch);
        fire(eye, [Math.sin(self.yaw) * cp, Math.sin(self.pitch), Math.cos(self.yaw) * cp]);
        this.ammo--;
        this.shotsInBurst++;
        this.burstLeft--;
        this.cooldown = 1 / this.weapon.fireRate;
        if (this.burstLeft <= 0) {
          this.burstPause = (this.weapon.auto ? 0.28 : 0.2) + this.rng() * 0.3;
          this.shotsInBurst = 0;
        }
      }
    }
    return held;
  }

  /** Walk a path: to where an enemy was last seen, or else to somewhere on the map. */
  private travel(dt: number, self: PlayerController): number {
    const { nav, space } = this.map;
    const x = self.pos.x;
    const z = self.pos.z;
    if (this.path.length === 0) {
      let goal: Vec3 | null = this.chase > 0 ? this.lastKnown : null;
      if (!goal) {
        this.lastKnown = null;
        goal = this.spawns[Math.floor(this.rng() * this.spawns.length) % this.spawns.length];
      }
      this.path = findPath(nav, space, x, z, goal[0], goal[2]) ?? [];
      if (this.path.length === 0) {
        // nowhere to go from here this instant: look around and try again
        this.wantYaw = wrap(self.yaw + 1.2);
        return 0;
      }
    }
    // drop waypoints as they are reached
    while (this.path.length && Math.hypot(this.path[0][0] - x, this.path[0][1] - z) < 0.55) this.path.shift();
    if (this.path.length === 0) {
      this.chase = 0;
      return 0;
    }
    const [wx, wz] = this.path[0];
    this.wantYaw = Math.atan2(wx - x, wz - z);
    this.wantPitch = 0;

    // walking into something for a while means the path no longer fits: plan again
    if (self.speed < 0.6) this.stuck += dt;
    else this.stuck = 0;
    if (this.stuck > 0.9) {
      this.stuck = 0;
      this.path = [];
      this.chase = 0;
      return 0;
    }
    // turn first, then move, so corners are taken without scraping along the wall
    return Math.abs(wrap(this.wantYaw - self.yaw)) < 50 * DEG ? FORWARD : 0;
  }
}
