/**
 * One running match: every player's body, moved by the commands their client sends; the shots they
 * fire, decided here; and the snapshots and events that tell each client what happened.
 * See docs/multiplayer.md, section 6.
 *
 * The movement and hit code is the client's own (`PlayerController`, `CollisionWorld`, `rayHumanoid`,
 * the weapon tables), which is what lets a client predict its movement and be right, and makes a
 * hit on one screen a hit here.
 */
import { randomAgentId, type AgentId } from '../src/game/agents';
import type { Vec3, WeaponConfig, WeaponId } from '../src/types';
import { isHumanoidVisible } from '../src/game/bots/perception/visibility';
import { buildMapData, type MapData } from '../src/game/maps/MapData';
import { getMapDefinition } from '../src/game/maps/registry';
import { COL_BULLET, rayHumanoid, type HitZone } from '../src/game/physics/CollisionWorld';
import { PlayerController, STAND_EYE } from '../src/game/player/PlayerController';
import { WEAPONS, damageAt } from '../src/game/weapons/weaponConfigs';
import { CommandInput, applyCommand, sanitizeCommand } from '../src/net/command';
import {
  INTERP_DELAY_MS,
  MAX_REWIND_MS,
  PF_ALIVE,
  PF_CROUCHING,
  PF_GROUNDED,
  PF_PROTECTED,
  PF_WALKING,
  type Loadout,
  type MatchEvent,
  type PlayerSnapshot,
  type ScoreLine,
  type SelfSnapshot,
  type ServerMessage,
  type Team,
} from '../src/net/protocol';
import { isWeaponAllowed, type RoomSettings } from '../src/net/settings';
import { MatchBot, type BotTarget } from './MatchBot';

/** Seconds of movement a player may have in hand: covers a burst of commands arriving late together. */
const MAX_TIME_BUDGET = 0.5;
/** Most commands read from one input message. */
const MAX_COMMANDS_PER_MESSAGE = 64;
/** A spawn is kept at least this far from every other player when one can be found. */
const SPAWN_MIN_DISTANCE = 14;
/** How far a bullet travels. */
const SHOT_RANGE = 250;
/**
 * A shot's origin may be this far from where the server has the shooter's eye. The client is ahead of
 * the server by its connection delay, so a running player is legitimately a metre or so further on.
 */
const ORIGIN_TOLERANCE = 2;
/** A shot's direction may be this far (degrees) from the shooter's view: the most recoil and spread can add, with room to spare. */
const AIM_TOLERANCE_DEG = 25;
/** Shots a player may have saved up: covers a burst and a few bullets arriving together. */
const SHOT_BURST = 5;
/** Shots are allowed this much faster than the gun's fire rate, to absorb timing jitter. */
const FIRE_RATE_SLACK = 1.15;
/** Positions remembered per player, for rewinding (30 a second). */
const HISTORY_SAMPLES = 40;

interface MapEntry {
  data: MapData;
  /** Ground-level cells a player can stand on: feet positions. */
  spawns: Vec3[];
}

const maps = new Map<string, MapEntry>();

/** Maps are built once per process: they never change, and every match on a map shares its collision world. */
function mapEntry(id: string): MapEntry {
  let entry = maps.get(id);
  if (!entry) {
    const data = buildMapData(getMapDefinition(id));
    const { nav, space } = data;
    const spawns: Vec3[] = [];
    for (let r = 0; r < nav.rows; r++)
      for (let c = 0; c < nav.cols; c++) {
        const i = r * nav.cols + c;
        if (nav.walkable[i] && Math.abs(nav.height[i]) < 0.01) spawns.push([space.x(c), nav.height[i], space.z(r)]);
      }
    entry = { data, spawns };
    maps.set(id, entry);
  }
  return entry;
}

/**
 * The run-speed multipliers a loadout can really produce: the faster gun in hand at the top, the
 * slower one aimed down its sights at the bottom. A command's `speed` is held to this range.
 */
function speedRange(loadout: Loadout): [number, number] {
  const guns = [WEAPONS[loadout.primary], WEAPONS[loadout.secondary]];
  return [Math.min(...guns.map((w) => w.runSpeedMult * w.ads.moveSpeedMult)), Math.max(...guns.map((w) => w.runSpeedMult))];
}

/** Where a player was at a moment in the past. */
interface Pose {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  crouch: number;
  alive: boolean;
}

export interface PlayerInfo {
  name: string;
  team: Team | null;
  loadout: Loadout;
  ping: number;
  agent: AgentId;
}

/** A player's standing in the match. It outlives their body: a dropped player keeps their score. */
interface Score {
  name: string;
  team: Team | null;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  ping: number;
  bot: boolean;
  agent: AgentId;
}

/** The guns a bot may be given, most likely first; the room's weapon rule narrows the list. */
const BOT_GUNS: WeaponId[] = ['vandal', 'phantom', 'vandal', 'phantom', 'spectre', 'guardian', 'sheriff', 'ghost', 'classic'];
const BOT_NAMES = ['Viper', 'Rook', 'Kestrel', 'Onyx', 'Wraith', 'Ember', 'Nova', 'Talon', 'Jinx', 'Sable', 'Vex', 'Pyre'];

interface Body {
  id: string;
  controller: PlayerController;
  input: CommandInput;
  loadout: Loadout;
  /** The gun last fired (what others see in their hands). */
  weapon: WeaponId;
  team: Team | null;
  /** The last command applied (or refused): what the client's prediction is checked against. */
  ackSeq: number;
  /** Seconds of movement this player may still use; refilled by real time passing. */
  budget: number;
  budgetAt: number;
  /** Shots this player may fire right now; refilled at the gun's fire rate. */
  shots: number;
  shotsAt: number;
  history: Pose[];
  /** Server time the spawn protection ends (0 = none). */
  protectedUntil: number;
  /** Server time this dead player comes back (0 while alive). */
  respawnAt: number;
  /** Everyone who has hurt this player since they last spawned. */
  hurtBy: Set<string>;
  /** Server time the player last did something: pressed a key, moved their view, fired. */
  activeAt: number;
  /** The view of the last command received, to tell a player who is looking around from one who is away. */
  lastView: [number, number] | null;
  /** A loadout chosen mid-life, waiting for the next respawn. */
  pendingLoadout: Loadout | null;
  /** The mind of a bot (null for a person). */
  bot: MatchBot | null;
}

export class Match {
  private readonly map: MapEntry;
  private readonly bodies = new Map<string, Body>();
  private readonly scores = new Map<string, Score>();
  private now = 0;
  private lastTick = 0;
  private botSerial = 0;
  /** Set once the kill limit is reached: the room ends the match. */
  over = false;

  /**
   * @param emit sends a message to one player, or to everyone in the match when `to` is null.
   */
  constructor(
    private readonly settings: RoomSettings,
    private readonly emit: (to: string | null, msg: ServerMessage) => void,
    private readonly rng: () => number = Math.random,
  ) {
    this.map = mapEntry(settings.mapId);
  }

  has(id: string) {
    return this.bodies.has(id);
  }

  /** Put a player into the world at a spawn away from everyone else. Returns where. */
  add(id: string, info: PlayerInfo, now: number): { pos: Vec3; yaw: number } {
    this.now = now;
    const { pos, yaw } = this.place(id, info.team, info.loadout, null, now);
    // someone coming back keeps the score they had
    const score = this.scores.get(id);
    if (score) Object.assign(score, { name: info.name, team: info.team, ping: info.ping, agent: info.agent });
    else this.scores.set(id, { name: info.name, team: info.team, kills: 0, deaths: 0, assists: 0, headshots: 0, ping: info.ping, bot: false, agent: info.agent });
    this.emit(null, { t: 'scores', scores: this.scoreboard() });
    return { pos, yaw };
  }

  /** Create a body at a fresh spawn. */
  private place(id: string, team: Team | null, loadout: Loadout, bot: MatchBot | null, now: number) {
    const pos = this.pickSpawn(id, team);
    const yaw = this.rng() * 360;
    const controller = new PlayerController(this.map.data.world);
    controller.spawn(pos[0], pos[1], pos[2], yaw);
    bot?.reset((yaw * Math.PI) / 180);
    this.bodies.set(id, {
      id,
      controller,
      input: new CommandInput(),
      loadout,
      weapon: bot ? bot.weapon.id : loadout.primary,
      team,
      ackSeq: -1,
      budget: MAX_TIME_BUDGET / 2,
      budgetAt: now,
      shots: SHOT_BURST,
      shotsAt: now,
      history: [],
      protectedUntil: this.protection(now),
      respawnAt: 0,
      hurtBy: new Set(),
      activeAt: now,
      lastView: null,
      pendingLoadout: null,
      bot,
    });
    return { pos, yaw };
  }

  /* ------------------------------------------------------------------ */
  /* Bots                                                                */
  /* ------------------------------------------------------------------ */

  /** How many bots are playing. */
  get botCount() {
    let n = 0;
    for (const b of this.bodies.values()) if (b.bot) n++;
    return n;
  }

  /** Bring the number of bots to `count`: new ones spawn in, surplus ones (the lowest scorers) leave. */
  setBotCount(count: number, now: number) {
    this.now = now;
    let changed = false;
    while (this.botCount < count) {
      this.addBot(now);
      changed = true;
    }
    while (this.botCount > count) {
      const bots = [...this.bodies.values()].filter((b) => b.bot);
      bots.sort((a, b) => (this.scores.get(a.id)?.kills ?? 0) - (this.scores.get(b.id)?.kills ?? 0));
      this.bodies.delete(bots[0].id);
      this.scores.delete(bots[0].id);
      changed = true;
    }
    if (changed) this.emit(null, { t: 'scores', scores: this.scoreboard() });
  }

  private addBot(now: number) {
    const id = `bot-${++this.botSerial}`;
    const taken = new Set([...this.scores.values()].map((s) => s.name));
    const free = BOT_NAMES.filter((n) => !taken.has(n));
    const name = free.length ? free[Math.floor(this.rng() * free.length) % free.length] : `Bot ${this.botSerial}`;
    // teams stay even: a bot joins the smaller one
    let team: Team | null = null;
    if (this.settings.mode === 'team-deathmatch') {
      const a = [...this.bodies.values()].filter((b) => b.team === 'a').length;
      team = a <= this.bodies.size - a ? 'a' : 'b';
    }
    const allowed = BOT_GUNS.filter((g) => isWeaponAllowed(this.settings, WEAPONS[g]));
    const gun = WEAPONS[allowed.length ? allowed[Math.floor(this.rng() * allowed.length) % allowed.length] : this.settings.singleWeapon];
    const loadout: Loadout = { primary: gun.slot === 'primary' ? gun.id : 'vandal', secondary: gun.slot === 'secondary' ? gun.id : 'classic' };
    const bot = new MatchBot(this.map.data, this.map.spawns, gun, this.settings.botDifficulty, this.rng);
    this.place(id, team, loadout, bot, now);
    const agent = randomAgentId(this.rng, [...this.scores.values()].map((s) => s.agent));
    this.scores.set(id, { name, team, kills: 0, deaths: 0, assists: 0, headshots: 0, ping: 0, bot: true, agent });
  }

  /** Let every living bot decide and act for the time since the last tick. */
  private runBots(dt: number) {
    for (const body of this.bodies.values()) {
      const bot = body.bot;
      if (!bot || !body.controller.alive) continue;
      const others: BotTarget[] = [];
      for (const o of this.bodies.values()) {
        if (o === body || (body.team !== null && o.team === body.team)) continue;
        others.push({ id: o.id, controller: o.controller, protected: this.isProtected(o) });
      }
      const cmds = bot.think(dt, body.controller, others, (origin, dir) => {
        body.protectedUntil = 0;
        this.resolveShot(body, bot.weapon, { seq: 0, weapon: bot.weapon.id, origin, dir, viewTime: this.now }, this.now);
      });
      for (const cmd of cmds) applyCommand(body.controller, body.input, cmd);
    }
  }

  /** Take a player's body out of the world. `forget` also drops their score (they left the room). */
  remove(id: string, forget = false) {
    this.bodies.delete(id);
    if (forget && this.scores.delete(id)) this.emit(null, { t: 'scores', scores: this.scoreboard() });
  }

  /**
   * A player chose other guns. While they are still under spawn protection (or dead) the change is
   * immediate; otherwise it waits for their next respawn, so nobody swaps guns in the middle of a fight.
   */
  setLoadout(id: string, loadout: Loadout, now: number) {
    const body = this.bodies.get(id);
    if (!body) return;
    this.now = now;
    if (!body.controller.alive || this.isProtected(body)) this.applyLoadout(body, loadout);
    else body.pendingLoadout = loadout;
  }

  private applyLoadout(body: Body, loadout: Loadout) {
    body.loadout = loadout;
    body.pendingLoadout = null;
    if (body.weapon !== loadout.primary && body.weapon !== loadout.secondary) body.weapon = loadout.primary;
    this.send(body.id, { type: 'loadout', loadout });
  }

  /** Which of their guns a player has in their hands, so the others see the right one. */
  setHeld(id: string, weapon: unknown) {
    const body = this.bodies.get(id);
    if (body && (weapon === body.loadout.primary || weapon === body.loadout.secondary)) body.weapon = weapon as WeaponId;
  }

  setPing(id: string, ping: number) {
    const score = this.scores.get(id);
    if (score) score.ping = ping;
  }

  /** How long (ms) a player in the match has done nothing at all; 0 for someone not in it. */
  idleFor(id: string, now: number) {
    const body = this.bodies.get(id);
    return body ? now - body.activeAt : 0;
  }

  /** The most kills anyone (or, in Team Deathmatch, either team) has: how close the match is to its kill limit. */
  leadingKills() {
    if (this.settings.mode === 'team-deathmatch') return Math.max(this.teamKills('a'), this.teamKills('b'));
    let best = 0;
    for (const s of this.scores.values()) best = Math.max(best, s.kills);
    return best;
  }

  /** The scoreboard, best first. */
  scoreboard(): ScoreLine[] {
    return [...this.scores]
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name));
  }

  /** Who is ahead: a player's id, a team, or null for a tie (or an empty match). */
  winner(): string | Team | null {
    if (this.settings.mode === 'team-deathmatch') {
      const a = this.teamKills('a');
      const b = this.teamKills('b');
      return a === b ? null : a > b ? 'a' : 'b';
    }
    const board = this.scoreboard();
    if (board.length === 0 || (board.length > 1 && board[0].kills === board[1].kills)) return null;
    return board[0].id;
  }

  private teamKills(team: Team) {
    let n = 0;
    for (const s of this.scores.values()) if (s.team === team) n += s.kills;
    return n;
  }

  private protection(now: number) {
    return this.settings.spawnProtectionSec > 0 ? now + this.settings.spawnProtectionSec * 1000 : 0;
  }

  /* ------------------------------------------------------------------ */
  /* Movement                                                            */
  /* ------------------------------------------------------------------ */

  /** Apply the commands a client sent. Anything malformed, repeated or beyond the time budget is skipped. */
  input(id: string, cmds: unknown, now: number) {
    const body = this.bodies.get(id);
    if (!body || !Array.isArray(cmds)) return;
    // real time that has passed is time the player may move for
    body.budget = Math.min(MAX_TIME_BUDGET, body.budget + (now - body.budgetAt) / 1000);
    body.budgetAt = now;
    for (const raw of cmds.slice(0, MAX_COMMANDS_PER_MESSAGE)) {
      const cmd = sanitizeCommand(raw);
      if (!cmd || cmd.seq <= body.ackSeq) continue;
      body.ackSeq = cmd.seq;
      // doing something: a key, or a view that moved since the previous command
      if (cmd.held !== 0 || cmd.pressed !== 0 || (body.lastView !== null && (cmd.yaw !== body.lastView[0] || cmd.pitch !== body.lastView[1]))) body.activeAt = now;
      body.lastView = [cmd.yaw, cmd.pitch];
      // out of time: the command is acknowledged but not run, so the client is pulled back to where it really is
      if (cmd.dt > body.budget) continue;
      body.budget -= cmd.dt;
      const [slowest, fastest] = speedRange(body.loadout);
      cmd.speed = Math.max(slowest, Math.min(fastest, cmd.speed));
      applyCommand(body.controller, body.input, cmd);
    }
  }

  /**
   * Once per snapshot: bring back the dead whose time has come and remember where everyone is, so a
   * later shot can be judged against what its shooter was looking at.
   */
  tick(now: number) {
    const dt = this.lastTick > 0 ? Math.min(0.1, (now - this.lastTick) / 1000) : 0;
    this.lastTick = now;
    this.now = now;
    if (dt > 0 && !this.over) this.runBots(dt);
    for (const body of this.bodies.values()) {
      if (body.respawnAt > 0 && now >= body.respawnAt) this.respawn(body);
      const c = body.controller;
      body.history.push({ t: now, x: c.pos.x, y: c.pos.y, z: c.pos.z, yaw: c.yaw, crouch: c.crouch, alive: c.alive });
      if (body.history.length > HISTORY_SAMPLES) body.history.shift();
    }
  }

  private respawn(body: Body) {
    const pos = this.pickSpawn(body.id, body.team);
    const yaw = this.rng() * 360;
    body.controller.spawn(pos[0], pos[1], pos[2], yaw);
    body.bot?.reset((yaw * Math.PI) / 180);
    if (body.pendingLoadout) this.applyLoadout(body, body.pendingLoadout);
    body.respawnAt = 0;
    body.protectedUntil = this.protection(this.now);
    body.hurtBy.clear();
    body.history = []; // nobody may hit them where they died
    body.shots = SHOT_BURST;
    this.emit(null, { t: 'event', time: this.now, event: { type: 'respawn', id: body.id, pos, yaw } });
  }

  /** What one player is told: their own exact state, and everyone else as they appear. */
  snapshot(id: string): { self: SelfSnapshot | null; players: PlayerSnapshot[] } {
    const players: PlayerSnapshot[] = [];
    let self: SelfSnapshot | null = null;
    for (const body of this.bodies.values()) {
      const c = body.controller;
      if (body.id === id) {
        self = {
          pos: [c.pos.x, c.pos.y, c.pos.z],
          vel: [c.vel.x, c.vel.y, c.vel.z],
          crouch: c.crouch,
          flags: (c.alive ? PF_ALIVE : 0) | (c.grounded ? PF_GROUNDED : 0) | (c.crouching ? PF_CROUCHING : 0) | (this.isProtected(body) ? PF_PROTECTED : 0),
          health: c.health,
          armor: c.armor,
          ackSeq: body.ackSeq,
        };
        continue;
      }
      players.push({
        id: body.id,
        pos: [round(c.pos.x), round(c.pos.y), round(c.pos.z)],
        yaw: round(c.yaw),
        pitch: round(c.pitch),
        crouch: round(c.crouch),
        flags:
          (c.alive ? PF_ALIVE : 0) |
          (c.grounded ? PF_GROUNDED : 0) |
          (c.walking ? PF_WALKING : 0) |
          (c.crouching ? PF_CROUCHING : 0) |
          (this.isProtected(body) ? PF_PROTECTED : 0),
        weapon: body.weapon,
      });
    }
    return { self, players };
  }

  /* ------------------------------------------------------------------ */
  /* Combat                                                              */
  /* ------------------------------------------------------------------ */

  private isProtected(body: Body) {
    return body.protectedUntil > this.now;
  }

  /**
   * A client says it fired. Check that it could have, find what the bullet hit in the world the
   * shooter was looking at, and tell everyone concerned. A shot that fails a check is dropped silently:
   * an honest client never sends one.
   */
  shot(id: string, raw: unknown, now: number) {
    this.now = now;
    const body = this.bodies.get(id);
    const shot = readShot(raw);
    if (!body || !shot || !body.controller.alive || this.over) return;
    const weapon = WEAPONS[shot.weapon];
    if (shot.weapon !== body.loadout.primary && shot.weapon !== body.loadout.secondary) return;
    if (!isWeaponAllowed(this.settings, weapon)) return;

    // fire rate: shots are earned at the gun's rate, with a few saved up for bursts and late packets
    const rate = (weapon.burst ? Math.max(weapon.fireRate, 1 / weapon.burst.interval) : weapon.fireRate) * FIRE_RATE_SLACK;
    body.shots = Math.min(SHOT_BURST, body.shots + ((now - body.shotsAt) / 1000) * rate);
    body.shotsAt = now;
    if (body.shots < 1) return;
    body.shots -= 1;

    // the bullet has to start at the shooter's eye and leave along their view
    const c = body.controller;
    const eye: Vec3 = [c.pos.x, c.pos.y + c.eyeHeight, c.pos.z];
    const [ox, oy, oz] = shot.origin;
    if (Math.hypot(ox - eye[0], oy - eye[1], oz - eye[2]) > ORIGIN_TOLERANCE) return;
    const [dx, dy, dz] = shot.dir;
    const cp = Math.cos(c.pitch);
    const along = dx * Math.sin(c.yaw) * cp + dy * Math.sin(c.pitch) + dz * Math.cos(c.yaw) * cp;
    if (along < Math.cos((AIM_TOLERANCE_DEG * Math.PI) / 180)) return;

    body.weapon = shot.weapon;
    body.activeAt = now;
    body.protectedUntil = 0; // firing gives up spawn protection
    this.resolveShot(body, weapon, shot, now);
  }

  /** Find what a bullet hit, in the world its shooter was looking at, and tell everyone concerned. */
  private resolveShot(body: Body, weapon: WeaponConfig, shot: Shot, now: number) {
    const id = body.id;
    const c = body.controller;
    const eye: Vec3 = [c.pos.x, c.pos.y + c.eyeHeight, c.pos.z];
    const [ox, oy, oz] = shot.origin;
    const [dx, dy, dz] = shot.dir;

    // Lag compensation: put everyone else where the shooter saw them. What a client draws is the world
    // as it was one interpolation delay plus its own connection delay ago; the rewind is capped so a
    // very poor connection can't shoot far into the past.
    const viewTime = Math.max(now - INTERP_DELAY_MS - MAX_REWIND_MS, Math.min(now, shot.viewTime));

    const wall = this.map.data.world.raycast(ox, oy, oz, dx, dy, dz, SHOT_RANGE, COL_BULLET);
    let best: { victim: Body; t: number; zone: HitZone } | null = null;
    for (const other of this.bodies.values()) {
      if (other === body || !other.controller.alive) continue;
      const pose = poseAt(other, viewTime);
      if (!pose || !pose.alive) continue;
      const h = rayHumanoid(ox, oy, oz, dx, dy, dz, pose.x, pose.y, pose.z, pose.yaw, pose.crouch, best ? best.t : wall ? wall.t : SHOT_RANGE);
      if (h) best = { victim: other, t: h.t, zone: h.zone };
    }

    const reach = best ? best.t : wall ? wall.t : SHOT_RANGE;
    const end: Vec3 = [round(ox + dx * reach), round(oy + dy * reach), round(oz + dz * reach)];
    const fired: MatchEvent = { type: 'shot', by: id, weapon: shot.weapon, origin: shot.origin, end };
    for (const other of this.bodies.keys()) if (other !== id) this.send(other, fired);
    if (!best) return;

    const { victim, t, zone } = best;
    const sameTeam = body.team !== null && body.team === victim.team;
    if ((sameTeam && !this.settings.friendlyFire) || this.isProtected(victim)) return;
    if (this.settings.headshotsOnly && zone !== 'head') return;
    const damage = damageAt(weapon, t)[zone];
    const killed = victim.controller.damage(damage);
    victim.hurtBy.add(id);
    this.send(id, { type: 'hit', seq: shot.seq, victim: victim.id, zone, damage, killed });
    this.send(victim.id, { type: 'damage', by: id, from: [round(eye[0]), round(eye[1]), round(eye[2])], zone, damage });
    victim.bot?.onDamaged(eye);
    if (killed) this.kill(body, victim, shot.weapon, zone === 'head', sameTeam);
  }

  private kill(killer: Body, victim: Body, weapon: WeaponId, headshot: boolean, teamKill: boolean) {
    victim.respawnAt = this.now + this.settings.respawnDelaySec * 1000;
    const assists = [...victim.hurtBy].filter((a) => a !== killer.id && this.scores.has(a));
    const k = this.scores.get(killer.id);
    const v = this.scores.get(victim.id);
    if (k) {
      // killing a teammate costs a kill instead of earning one
      k.kills += teamKill ? -1 : 1;
      if (headshot && !teamKill) k.headshots++;
    }
    if (v) v.deaths++;
    if (!teamKill) for (const a of assists) this.scores.get(a)!.assists++;
    this.emit(null, { t: 'event', time: this.now, event: { type: 'kill', killer: killer.id, victim: victim.id, weapon, headshot, assists } });
    this.emit(null, { t: 'scores', scores: this.scoreboard() });

    const limit = this.settings.killLimit;
    if (limit > 0) {
      const reached = this.settings.mode === 'team-deathmatch' ? Math.max(this.teamKills('a'), this.teamKills('b')) : (k?.kills ?? 0);
      if (reached >= limit) this.over = true;
    }
  }

  private send(to: string, event: MatchEvent) {
    this.emit(to, { t: 'event', time: this.now, event });
  }

  /* ------------------------------------------------------------------ */
  /* Spawns                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * A ground cell far from, and out of sight of, every living opponent (as far as one exists).
   * Teammates don't count against a cell.
   */
  private pickSpawn(forId: string, team: Team | null): Vec3 {
    const { spawns, data } = this.map;
    const others = [...this.bodies.values()].filter((b) => b.id !== forId && b.controller.alive && !(team !== null && b.team === team)).map((b) => b.controller);
    let best = spawns[Math.floor(this.rng() * spawns.length)];
    let bestScore = -Infinity;
    for (let i = 0; i < 40; i++) {
      const c = spawns[Math.floor(this.rng() * spawns.length)];
      let nearest = Infinity;
      let seen = false;
      for (const o of others) {
        nearest = Math.min(nearest, Math.hypot(o.pos.x - c[0], o.pos.z - c[2]));
        if (!seen && isHumanoidVisible(data.world, o.pos.x, o.pos.y + STAND_EYE, o.pos.z, c[0], c[1], c[2], 0)) seen = true;
      }
      if (!seen && nearest >= SPAWN_MIN_DISTANCE) return c;
      // nothing ideal yet: prefer hidden, then far
      const score = (seen ? 0 : 1000) + Math.min(nearest, 100);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }
}

/** Where a player was at server time `t`, blended between the two remembered positions around it. */
function poseAt(body: Body, t: number): Pose | null {
  const h = body.history;
  const c = body.controller;
  const current: Pose = { t: Infinity, x: c.pos.x, y: c.pos.y, z: c.pos.z, yaw: c.yaw, crouch: c.crouch, alive: c.alive };
  if (h.length === 0) return current;
  if (t >= h[h.length - 1].t) return h[h.length - 1];
  if (t <= h[0].t) return h[0];
  for (let i = h.length - 1; i > 0; i--) {
    const a = h[i - 1];
    const b = h[i];
    if (a.t > t) continue;
    const k = (t - a.t) / (b.t - a.t);
    return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, yaw: k < 0.5 ? a.yaw : b.yaw, crouch: a.crouch + (b.crouch - a.crouch) * k, alive: b.alive };
  }
  return current;
}

interface Shot {
  seq: number;
  weapon: WeaponId;
  origin: Vec3;
  dir: Vec3;
  viewTime: number;
}

function vec3(v: unknown): Vec3 | null {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (v as Vec3) : null;
}

/** Read a shot from the network: known weapon, finite numbers, a direction of unit length. */
function readShot(raw: unknown): Shot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const origin = vec3(s.origin);
  const d = vec3(s.dir);
  if (!origin || !d || typeof s.weapon !== 'string' || !(s.weapon in WEAPONS)) return null;
  if (typeof s.seq !== 'number' || !Number.isFinite(s.seq) || typeof s.viewTime !== 'number' || !Number.isFinite(s.viewTime)) return null;
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return null;
  return { seq: s.seq, weapon: s.weapon as WeaponId, origin, dir: [d[0] / len, d[1] / len, d[2] / len], viewTime: s.viewTime };
}

/** Other players' positions are for drawing, so millimetres are plenty and the messages stay small. */
function round(v: number) {
  return Math.round(v * 1000) / 1000;
}
