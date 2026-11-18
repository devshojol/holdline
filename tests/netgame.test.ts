import { isAgentId } from '../src/game/agents';
import { describe, expect, it } from 'vitest';
import { Match, type PlayerInfo } from '../server/Match';
import { buildMapData } from '../src/game/maps/MapData';
import { getMapDefinition } from '../src/game/maps/registry';
import { RemoteTrack, ServerClock } from '../src/game/net/Interpolation';
import { Prediction } from '../src/game/net/Prediction';
import { PlayerController, RUN_SPEED } from '../src/game/player/PlayerController';
import { actionBit, actionMask, type Command } from '../src/net/command';
import { INTERP_DELAY_MS, MAX_REWIND_MS, PF_ALIVE, PF_GROUNDED, PF_PROTECTED, type PlayerSnapshot, type SelfSnapshot, type ServerMessage, type ShotMessage } from '../src/net/protocol';
import { DEFAULT_ROOM_SETTINGS, type RoomSettings } from '../src/net/settings';
import type { Action } from '../src/game/core/actions';

/** A match with what it sent recorded: `sent` holds [recipient or null for everyone, message]. */
function newMatch(rng: () => number, settings: Partial<RoomSettings> = {}) {
  const sent: [string | null, ServerMessage][] = [];
  const match = new Match({ ...DEFAULT_ROOM_SETTINGS, ...settings }, (to, msg) => sent.push([to, msg]), rng);
  /** The match events sent to one player (including those sent to everyone). */
  const events = (id: string) => sent.filter(([to, m]) => (to === id || to === null) && m.t === 'event').map(([, m]) => (m as Extract<ServerMessage, { t: 'event' }>).event);
  return { match, sent, events };
}

function info(name: string, extra: Partial<PlayerInfo> = {}): PlayerInfo {
  return { name, team: null, loadout: { primary: 'vandal', secondary: 'classic' }, ping: 20, agent: 'ranger', ...extra };
}

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A client playing against the real server match over a connection with `latency` ms each way.
 * Time advances in 1/240 s steps; the client simulates at 120 Hz and sends at 60 Hz, the server
 * snapshots at 30 Hz. Returns what a player would notice.
 */
function play(seconds: number, latency: number, opts: { cheatSpeed?: number } = {}) {
  const rng = seeded(7);
  const match = newMatch(seeded(3)).match;
  const spawn = match.add('me', info('Me'), 0);
  const player = new PlayerController(buildMapData(getMapDefinition('vellora')).world);
  player.spawn(spawn.pos[0], spawn.pos[1], spawn.pos[2], spawn.yaw);
  const prediction = new Prediction();

  const toServer: { at: number; cmds: Command[] }[] = [];
  const toClient: { at: number; self: SelfSnapshot }[] = [];
  let outbox: Command[] = [];
  let held = actionBit('forward');
  let travelled = 0;
  let largestJump = 0;
  const moves: Action[] = ['forward', 'back', 'left', 'right', 'walk', 'crouch'];

  for (let tick = 1; tick <= seconds * 240; tick++) {
    const now = (tick * 1000) / 240;
    // messages that have arrived
    while (toServer.length && toServer[0].at <= now) match.input('me', toServer.shift()!.cmds, now);
    while (toClient.length && toClient[0].at <= now) {
      const moved = prediction.reconcile(player, toClient.shift()!.self);
      if (moved) largestJump = Math.max(largestJump, Math.hypot(...moved));
    }
    if (tick % 2 === 0) {
      // one 120 Hz client step
      if (rng() < 0.02) held = actionMask(moves.filter(() => rng() < 0.35));
      player.yaw += (rng() - 0.5) * 0.06;
      const before = { ...player.pos };
      const cmd = prediction.step(player, 1 / 120, held, rng() < 0.01 ? actionBit('jump') : 0);
      travelled += Math.hypot(player.pos.x - before.x, player.pos.z - before.z);
      outbox.push(opts.cheatSpeed ? { ...cmd, dt: cmd.dt * opts.cheatSpeed } : cmd);
    }
    if (tick % 4 === 0 && outbox.length) {
      toServer.push({ at: now + latency, cmds: outbox });
      outbox = [];
    }
    if (tick % 8 === 0) toClient.push({ at: now + latency, self: match.snapshot('me').self! });
  }
  const server = match.snapshot('me').self!;
  return { prediction, travelled, largestJump, player, server };
}

describe('prediction against the server', () => {
  it('never needs correcting on a normal connection, at any latency', () => {
    for (const latency of [0, 50, 150]) {
      const r = play(20, latency);
      expect(r.travelled, `${latency} ms`).toBeGreaterThan(30);
      expect(r.prediction.corrections, `${latency} ms`).toBe(0);
      // commands in flight are bounded by the round trip, not growing
      expect(r.prediction.unacked, `${latency} ms`).toBeLessThan(((latency * 2 + 60) / 1000) * 120 + 8);
    }
  });

  it('pulls a client that claims extra time back to where the server has it', () => {
    // the client tells the server each step lasted longer than it did: more ground covered per second
    const r = play(10, 50, { cheatSpeed: 1 });
    const cheat = play(10, 50, { cheatSpeed: 1.6 });
    expect(r.prediction.corrections).toBe(0);
    expect(cheat.prediction.corrections).toBeGreaterThan(0);
  });

  it('follows the server after being moved (a respawn), without drifting', () => {
    const match = newMatch(seeded(3)).match;
    match.add('me', info('Me'), 0);
    const player = new PlayerController(buildMapData(getMapDefinition('vellora')).world);
    player.spawn(0, 0, 0, 0); // the client believes it is somewhere else entirely
    const prediction = new Prediction();
    const cmds: Command[] = [];
    for (let i = 0; i < 12; i++) cmds.push(prediction.step(player, 1 / 120, actionBit('forward'), 0));
    match.input('me', cmds.slice(0, 6), 100);
    const moved = prediction.reconcile(player, match.snapshot('me').self!);
    expect(moved).not.toBeNull();
    expect(prediction.unacked).toBe(6);
    // the remaining commands were replayed from the server's position: when it catches up they agree
    match.input('me', cmds.slice(6), 200);
    expect(prediction.reconcile(player, match.snapshot('me').self!)).toBeNull();
    const s = match.snapshot('me').self!;
    expect(player.pos.x).toBeCloseTo(s.pos[0], 6);
    expect(player.pos.z).toBeCloseTo(s.pos[2], 6);
  });
});

describe('server match', () => {
  it('ignores repeated, malformed and out-of-budget commands', () => {
    const match = newMatch(seeded(1)).match;
    match.add('me', info('Me'), 0);
    const start = match.snapshot('me').self!;
    const cmd = (seq: number): Command => ({ seq, dt: 1 / 120, held: actionBit('forward'), pressed: 0, yaw: 0, pitch: 0, speed: 1 });
    match.input('me', [cmd(0), cmd(0), 'junk', { seq: 1 }, cmd(1)], 10);
    expect(match.snapshot('me').self!.ackSeq).toBe(1);
    // a flood claiming 5 seconds of movement in one message: only the budget's worth is run
    const flood = Array.from({ length: 600 }, (_, i) => cmd(2 + i));
    for (let i = 0; i < flood.length; i += 60) match.input('me', flood.slice(i, i + 60), 10);
    const end = match.snapshot('me').self!;
    const moved = Math.hypot(end.pos[0] - start.pos[0], end.pos[2] - start.pos[2]);
    expect(moved).toBeLessThan(RUN_SPEED * 1.04 * 0.5 + 0.1); // at most half a second at full speed
    expect(end.ackSeq).toBe(601);
    match.input('nobody', [cmd(0)], 10); // unknown player: no effect, no error
  });

  it('holds the speed multiplier to what the player’s guns allow', () => {
    const run = (speed: number, loadout: PlayerInfo['loadout']) => {
      const match = newMatch(seeded(1)).match;
      match.add('me', info('Me', { loadout }), 0);
      const start = match.snapshot('me').self!;
      const c = (match as unknown as { bodies: Map<string, { controller: PlayerController }> }).bodies.get('me')!.controller;
      c.spawn(start.pos[0], start.pos[1], start.pos[2], 0);
      for (let i = 0; i < 30; i++) match.input('me', [{ seq: i, dt: 1 / 120, held: actionBit('forward'), pressed: 0, yaw: 0, pitch: 0, speed }], 10 + i * 9);
      return c.speedMult;
    };
    expect(run(1.04, { primary: 'vandal', secondary: 'classic' })).toBe(1.04); // a sidearm out
    expect(run(1.04, { primary: 'vandal', secondary: 'sheriff' })).toBeLessThanOrEqual(1.04);
    expect(run(0.7, { primary: 'vandal', secondary: 'classic' })).toBeCloseTo(0.76, 5); // slowest real state: the rifle aimed
    expect(run(0.7, { primary: 'operator', secondary: 'classic' })).toBeCloseTo(0.95 * 0.76, 5);
  });

  it('spawns players apart and shows each the others, not themselves', () => {
    const match = newMatch(seeded(5)).match;
    const a = match.add('a', info('A'), 0);
    const b = match.add('b', info('B', { loadout: { primary: 'vandal', secondary: 'sheriff' } }), 0);
    expect(Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2])).toBeGreaterThan(10);
    const seenByA = match.snapshot('a');
    expect(seenByA.players.map((p) => [p.id, p.weapon])).toEqual([['b', 'vandal']]);
    expect(seenByA.self!.pos).toEqual(a.pos);
    match.remove('b');
    expect(match.snapshot('a').players).toEqual([]);
    expect(match.snapshot('b').self).toBeNull();
  });
});

describe('interpolation', () => {
  const snap = (x: number, yaw = 0): PlayerSnapshot => ({ id: 'p', pos: [x, 0, 0], yaw, pitch: 0, crouch: 0, flags: PF_ALIVE | PF_GROUNDED, weapon: 'vandal' });

  it('blends between the snapshots either side of the requested time', () => {
    const track = new RemoteTrack();
    expect(track.at(0)).toBeNull();
    track.push(1000, snap(0));
    track.push(1033, snap(0.2));
    track.push(1066, snap(0.4));
    const mid = track.at(1049.5)!;
    expect(mid.x).toBeCloseTo(0.3, 5);
    expect(mid.speed).toBeCloseTo(0.2 / 0.033, 3);
    expect(track.at(900)!.x).toBe(0); // before the first: the first
    expect(track.at(5000)!.x).toBe(0.4); // long after the last: held there, standing
    expect(track.at(5000)!.speed).toBe(0);
    track.push(1050, snap(99)); // older than the newest: ignored
    expect(track.at(1066)!.x).toBe(0.4);
  });

  it('turns the short way round', () => {
    const track = new RemoteTrack();
    track.push(0, snap(0, 3.1));
    track.push(100, snap(0, -3.1));
    const yaw = track.at(50)!.yaw;
    expect(Math.abs(Math.abs(yaw) - Math.PI)).toBeLessThan(0.05); // through ±π, not back through 0
  });

  it('keeps a steady clock when packets arrive unevenly', () => {
    const clock = new ServerClock();
    const rng = seeded(9);
    let worst = 0;
    for (let i = 0; i < 300; i++) {
      const sent = i * 33.3;
      const arrived = sent + 50 + rng() * 30; // 50–80 ms on the way
      clock.observe(sent + 100_000, arrived);
      if (i > 30) worst = Math.max(worst, Math.abs(clock.time(arrived) - (arrived + 100_000 - 65)));
    }
    expect(worst).toBeLessThan(12); // within a few ms of the average delay, not swinging by the full jitter
  });
});

describe('combat', () => {
  /**
   * Two players standing still in the open, `shooter` looking straight at `target` from 10 m.
   * Spawn protection is off unless a test turns it on. Time starts at 1000 and the match has ticked.
   */
  function duel(settings: Partial<RoomSettings> = {}) {
    const m = newMatch(seeded(11), { spawnProtectionSec: 0, ...settings });
    m.match.add('shooter', info('Shooter', { team: settings.mode === 'team-deathmatch' ? 'a' : null }), 0);
    m.match.add('target', info('Target', { team: settings.mode === 'team-deathmatch' ? 'b' : null }), 0);
    const place = (id: string, x: number, z: number) => {
      const c = (m.match as unknown as { bodies: Map<string, { controller: PlayerController }> }).bodies.get(id)!.controller;
      c.spawn(x, 0, z, 0);
      return c;
    };
    // a clear lane on Vellora: find two ground cells 10 m apart along +z with nothing between them
    const world = buildMapData(getMapDefinition('vellora')).world;
    let at: [number, number] | null = null;
    for (let x = -40; x <= 40 && !at; x += 1.5)
      for (let z = -40; z <= 30 && !at; z += 1.5) {
        const free = (zz: number) => !world.overlap(x, 0.01, zz, 0.3, 1.8) && world.raycast(x, 1, zz, 0, -1, 0, 1.5) !== null;
        if (free(z) && free(z + 10) && world.segmentClear(x, 1.6, z, x, 1.6, z + 10) && world.segmentClear(x, 0.3, z, x, 0.3, z + 10)) at = [x, z];
      }
    if (!at) throw new Error('no clear lane found');
    const shooter = place('shooter', at[0], at[1]);
    const target = place('target', at[0], at[1] + 10);
    let now = 1000;
    m.match.tick(now);
    /** Fire along +z at a height: 1.62 is the target's head, 1.1 the body, 0.4 the legs. */
    const fire = (height = 1.1, extra: Partial<ShotMessage> = {}, weapon: ShotMessage['weapon'] = 'vandal') => {
      const origin: [number, number, number] = [shooter.pos.x, shooter.pos.y + shooter.eyeHeight, shooter.pos.z];
      const dy = height - origin[1];
      const len = Math.hypot(dy, 10);
      m.match.shot('shooter', { seq: 1, weapon, origin, dir: [0, dy / len, 10 / len], viewTime: now, ...extra }, now);
    };
    /** Let time pass, ticking at the snapshot rate. */
    const wait = (ms: number) => {
      for (const end = now + ms; now < end; ) {
        now = Math.min(end, now + 33);
        m.match.tick(now);
      }
    };
    const health = (id: string) => {
      const s = m.match.snapshot(id).self!;
      return s.health + s.armor;
    };
    return { ...m, shooter, target, fire, wait, health, now: () => now };
  }

  it('deals the weapon’s damage for the zone hit and tells shooter, victim and bystanders', () => {
    const d = duel();
    d.fire(1.1); // body: 40 from a Vandal
    expect(d.health('target')).toBe(150 - 40);
    expect(d.events('shooter')).toEqual([{ type: 'hit', seq: 1, victim: 'target', zone: 'body', damage: 40, killed: false }]);
    const seen = d.events('target');
    expect(seen.map((e) => e.type)).toEqual(['shot', 'damage']);
    expect(seen[1]).toMatchObject({ by: 'shooter', zone: 'body', damage: 40 });
    d.wait(200);
    d.fire(0.4); // legs: 34
    expect(d.health('target')).toBe(150 - 40 - 34);
  });

  it('kills with a headshot, scores it, and brings the victim back after the respawn delay', () => {
    const d = duel({ respawnDelaySec: 3 });
    d.fire(1.62); // head: 160 against 100 health + 50 armour
    expect(d.events('shooter')[0]).toMatchObject({ type: 'hit', zone: 'head', killed: true });
    expect(d.events('target').at(-1)).toEqual({ type: 'kill', killer: 'shooter', victim: 'target', weapon: 'vandal', headshot: true, assists: [] });
    expect(d.match.scoreboard().map((s) => [s.name, s.kills, s.deaths, s.headshots])).toEqual([
      ['Shooter', 1, 0, 1],
      ['Target', 0, 1, 0],
    ]);
    expect(d.match.winner()).toBe('shooter');
    expect(d.match.snapshot('target').self!.flags & PF_ALIVE).toBe(0);
    d.wait(200);
    d.fire(1.1); // the dead can't be shot
    expect(d.events('shooter').filter((e) => e.type === 'hit')).toHaveLength(1);
    d.wait(2700);
    expect(d.match.snapshot('target').self!.flags & PF_ALIVE).toBe(0);
    d.wait(200);
    const back = d.match.snapshot('target').self!;
    expect(back.flags & PF_ALIVE).toBe(PF_ALIVE);
    expect(back.health + back.armor).toBe(150);
    expect(d.events('shooter').at(-1)).toMatchObject({ type: 'respawn', id: 'target' });
  });

  it('stops a bullet at a wall', () => {
    const d = duel();
    // straight down into the floor in front of the shooter
    d.match.shot('shooter', { seq: 1, weapon: 'vandal', origin: [d.shooter.pos.x, 1.62, d.shooter.pos.z], dir: [0, -0.3, 0.954], viewTime: d.now() }, d.now());
    expect(d.health('target')).toBe(150);
    // the target hears the shot and sees it end on the floor, well short of them
    const seen = d.events('target');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: 'shot', by: 'shooter' });
    const end = (seen[0] as { end: [number, number, number] }).end;
    expect(end[1]).toBeCloseTo(0, 2);
    expect(end[2]).toBeLessThan(d.target.pos.z - 3);
    // a shot fired straight up, far from where the shooter is looking, is not a shot at all
    d.match.shot('shooter', { seq: 2, weapon: 'vandal', origin: [d.shooter.pos.x, 1.62, d.shooter.pos.z], dir: [0, 1, 0], viewTime: d.now() }, d.now());
    expect(d.events('target')).toHaveLength(1);
  });

  it('judges a shot against where the target was when the shooter saw them', () => {
    const d = duel();
    d.wait(100);
    const sawAt = d.now();
    // the target steps 3 m to the side
    d.target.pos.x += 3;
    d.wait(100);
    d.fire(1.1, { viewTime: d.now() }); // aimed at the old spot, claiming to see the present: a miss
    expect(d.health('target')).toBe(150);
    d.wait(100);
    d.fire(1.1, { viewTime: sawAt }); // the same aim, at the moment the shooter was looking at: a hit
    expect(d.health('target')).toBe(110);
  });

  it('limits how far back a shot can reach', () => {
    const d = duel();
    const sawAt = d.now();
    d.target.pos.x += 3;
    d.wait(INTERP_DELAY_MS + MAX_REWIND_MS + 200);
    d.fire(1.1, { viewTime: sawAt }); // half a second ago: too old to be honoured
    expect(d.health('target')).toBe(150);
  });

  it('refuses shots from the wrong place, the wrong gun or a gun fired too fast', () => {
    const d = duel();
    d.fire(1.1, { origin: [d.target.pos.x, 1.6, d.target.pos.z - 1] }); // from right next to the target
    d.fire(1.1, {}, 'operator'); // not carried
    d.match.shot('shooter', 'junk', d.now());
    d.match.shot('shooter', { seq: 1, weapon: 'vandal', origin: [0, 0, 0], dir: [0, 0, 0], viewTime: 0 }, d.now());
    expect(d.health('target')).toBe(150);
    // 30 Vandal bullets in the same instant: only the few a burst allows get through (40 each)
    for (let i = 0; i < 30; i++) d.fire(0.4);
    const dealt = 150 - d.health('target');
    expect(dealt).toBeGreaterThan(0);
    expect(dealt).toBeLessThanOrEqual(34 * 5);
    // …while firing at the gun's real rate, every bullet counts (five leg shots kill: 34 each against 150)
    const d2 = duel();
    for (let i = 0; i < 5; i++) {
      d2.wait(103);
      d2.fire(0.4);
    }
    expect(d2.events('shooter').filter((e) => e.type === 'hit')).toHaveLength(5);
    expect(d2.events('shooter').at(-2)).toMatchObject({ type: 'hit', killed: true });
  });

  it('applies headshots-only and the weapon rule', () => {
    const hs = duel({ headshotsOnly: true });
    hs.fire(1.1);
    expect(hs.health('target')).toBe(150);
    hs.wait(200);
    hs.fire(1.62);
    expect(hs.events('shooter').at(-1)).toMatchObject({ type: 'kill' });
    const pistols = duel({ weapons: 'sidearms' });
    pistols.fire(1.62); // the Vandal is not allowed in this room
    expect(pistols.health('target')).toBe(150);
    pistols.fire(1.1, {}, 'classic');
    expect(pistols.health('target')).toBeLessThan(150);
  });

  it('protects a fresh spawn until time runs out or they fire', () => {
    const d = duel({ spawnProtectionSec: 2 });
    d.match.remove('target');
    d.match.add('target', info('Target'), d.now());
    const t = (d.match as unknown as { bodies: Map<string, { controller: PlayerController }> }).bodies.get('target')!.controller;
    t.spawn(d.shooter.pos.x, 0, d.shooter.pos.z + 10, 180);
    d.wait(100);
    expect(d.match.snapshot('target').self!.flags & PF_PROTECTED).toBe(PF_PROTECTED);
    d.fire(1.1);
    expect(d.health('target')).toBe(150);
    // the protected player shoots back: that ends their protection
    d.match.shot('target', { seq: 1, weapon: 'vandal', origin: [t.pos.x, 1.62, t.pos.z], dir: [0, -0.052, -0.9986], viewTime: d.now() }, d.now());
    expect(d.health('shooter')).toBe(110); // a body shot
    d.wait(200);
    d.fire(1.1);
    expect(d.health('target')).toBe(110);
  });

  it('spares teammates unless friendly fire is on', () => {
    const d = duel({ mode: 'team-deathmatch' });
    (d.match as unknown as { bodies: Map<string, { team: string }> }).bodies.get('target')!.team = 'a';
    d.fire(1.1);
    expect(d.health('target')).toBe(150);
    const ff = duel({ mode: 'team-deathmatch', friendlyFire: true });
    (ff.match as unknown as { bodies: Map<string, { team: string }> }).bodies.get('target')!.team = 'a';
    ff.fire(1.62);
    expect(ff.events('target').at(-1)).toMatchObject({ type: 'kill' });
    expect(ff.match.scoreboard().find((s) => s.id === 'shooter')!.kills).toBe(-1); // a team kill costs one
  });

  it('ends the match at the kill limit and names the winner', () => {
    const d = duel({ killLimit: 20, respawnDelaySec: 1 });
    let kills = 0;
    for (let i = 0; i < 40 && !d.match.over; i++) {
      // wherever the target respawned, bring them back in front of the shooter
      if (d.match.snapshot('target').self!.flags & PF_ALIVE) {
        d.target.pos.x = d.shooter.pos.x;
        d.target.pos.y = 0;
        d.target.pos.z = d.shooter.pos.z + 10;
        d.wait(400); // long enough for the remembered positions to be the new ones
        d.fire(1.62);
        kills++;
      }
      d.wait(1100);
    }
    expect(kills).toBe(20);
    expect(d.match.over).toBe(true);
    expect(d.match.winner()).toBe('shooter');
    expect(d.match.scoreboard()[0]).toMatchObject({ id: 'shooter', kills: 20, headshots: 20 });
    d.fire(1.62); // nothing counts after the end
    expect(d.match.scoreboard()[0].kills).toBe(20);
  });

  it('credits assists and keeps a returning player’s score', () => {
    const d = duel();
    d.match.add('third', info('Third'), d.now());
    const third = (d.match as unknown as { bodies: Map<string, { controller: PlayerController }> }).bodies.get('third')!.controller;
    third.spawn(d.shooter.pos.x, 0, d.shooter.pos.z + 2, 0); // two metres in front of the shooter, facing the target
    d.wait(100);
    d.match.shot('third', { seq: 1, weapon: 'vandal', origin: [third.pos.x, 1.62, third.pos.z], dir: [0, -0.065, 0.9979], viewTime: d.now() }, d.now());
    expect(d.health('target')).toBe(110);
    // the shooter's own bullet would hit the player standing in front of them, so they step aside first
    third.pos.x += 3;
    d.wait(400);
    d.fire(1.62);
    expect(d.events('target').at(-1)).toMatchObject({ type: 'kill', killer: 'shooter', assists: ['third'] });
    expect(d.match.scoreboard().find((s) => s.id === 'third')!.assists).toBe(1);
    // the shooter drops and comes back: the kill is still theirs
    d.match.remove('shooter');
    d.match.add('shooter', info('Shooter'), d.now());
    expect(d.match.scoreboard().find((s) => s.id === 'shooter')!.kills).toBe(1);
    d.match.remove('shooter', true); // left the room for good
    expect(d.match.scoreboard().some((s) => s.id === 'shooter')).toBe(false);
  });
});

describe('bots in a match', () => {
  /** A match of bots only, run for `seconds` at the snapshot rate. */
  function botMatch(count: number, seconds: number, settings: Partial<RoomSettings> = {}) {
    const m = newMatch(seeded(21), { spawnProtectionSec: 0, respawnDelaySec: 1, killLimit: 0, ...settings });
    let now = 1000;
    m.match.tick(now);
    m.match.setBotCount(count, now);
    const start = new Map(m.match.snapshot('nobody').players.map((p) => [p.id, p.pos]));
    for (const end = now + seconds * 1000; now < end; ) {
      now += 1000 / 30;
      m.match.tick(now);
    }
    return { ...m, start, now };
  }

  it('walk the map, find each other and fight', () => {
    const m = botMatch(6, 60);
    const board = m.match.scoreboard();
    expect(board).toHaveLength(6);
    expect(board.every((p) => p.bot)).toBe(true);
    expect(new Set(board.map((p) => p.name)).size).toBe(6);
    // they moved from where they spawned…
    const moved = m.match.snapshot('nobody').players.filter((p) => Math.hypot(p.pos[0] - m.start.get(p.id)![0], p.pos[2] - m.start.get(p.id)![2]) > 3).length;
    expect(moved).toBeGreaterThanOrEqual(4);
    // …and a minute of six bots produces kills, deaths to match, and respawns
    const kills = board.reduce((n, p) => n + p.kills, 0);
    expect(kills).toBeGreaterThanOrEqual(3);
    expect(board.reduce((n, p) => n + p.deaths, 0)).toBe(kills);
    expect(m.sent.some(([, msg]) => msg.t === 'event' && msg.event.type === 'respawn')).toBe(true);
  });

  it('are better shots when harder', () => {
    const kills = (botDifficulty: RoomSettings['botDifficulty']) =>
      botMatch(6, 90, { botDifficulty })
        .match.scoreboard()
        .reduce((n, p) => n + p.kills, 0);
    expect(kills('hard')).toBeGreaterThan(kills('easy'));
  });

  it('stay off their own team and carry only guns the room allows', () => {
    const teams = botMatch(6, 45, { mode: 'team-deathmatch' });
    const board = teams.match.scoreboard();
    expect(board.filter((p) => p.team === 'a')).toHaveLength(3);
    expect(board.filter((p) => p.team === 'b')).toHaveLength(3);
    expect(board.every((p) => p.kills >= 0)).toBe(true); // a team kill would have cost a kill
    const pistols = botMatch(4, 1, { weapons: 'sidearms' });
    expect(pistols.match.snapshot('nobody').players.every((p) => ['classic', 'ghost', 'sheriff'].includes(p.weapon))).toBe(true);
  });

  it('come and go to keep the match at its number', () => {
    const m = botMatch(5, 1);
    m.match.setBotCount(2, m.now);
    expect(m.match.botCount).toBe(2);
    expect(m.match.scoreboard()).toHaveLength(2);
    m.match.setBotCount(0, m.now);
    expect(m.match.snapshot('nobody').players).toEqual([]);
  });

  it('each play a random agent, different ones while there are enough', () => {
    const m = botMatch(6, 1);
    const agents = m.match.scoreboard().map((s) => s.agent);
    expect(agents.every((a) => isAgentId(a))).toBe(true);
    expect(new Set(agents).size).toBe(agents.length);
  });
});

describe('loadout and held gun', () => {
  it('changes guns at the next respawn, or at once while protected', () => {
    const m = newMatch(seeded(4), { spawnProtectionSec: 2, respawnDelaySec: 1 });
    m.match.add('me', info('Me'), 0);
    m.match.tick(1000);
    const mine = () => m.events('me').filter((e) => e.type === 'loadout');
    // still protected: the new guns are theirs straight away
    m.match.setLoadout('me', { primary: 'phantom', secondary: 'ghost' }, 1000);
    expect(mine()).toEqual([{ type: 'loadout', loadout: { primary: 'phantom', secondary: 'ghost' } }]);
    // protection over: the next change waits
    m.match.tick(4000);
    m.match.setLoadout('me', { primary: 'operator', secondary: 'sheriff' }, 4000);
    expect(mine()).toHaveLength(1);
    const body = (m.match as unknown as { bodies: Map<string, { controller: PlayerController; respawnAt: number }> }).bodies.get('me')!;
    body.controller.damage(999);
    body.respawnAt = 5000;
    m.match.tick(5000);
    expect(mine().at(-1)).toEqual({ type: 'loadout', loadout: { primary: 'operator', secondary: 'sheriff' } });
  });

  it('shows others the gun a player holds, if it is one of theirs', () => {
    const m = newMatch(seeded(4));
    m.match.add('a', info('A'), 0);
    m.match.add('b', info('B'), 0);
    const held = () => m.match.snapshot('b').players[0].weapon;
    expect(held()).toBe('vandal');
    m.match.setHeld('a', 'classic');
    expect(held()).toBe('classic');
    m.match.setHeld('a', 'operator'); // not carried
    m.match.setHeld('a', 42);
    expect(held()).toBe('classic');
  });
});
