import { describe, expect, it } from 'vitest';
import { MAP_DEFINITIONS } from '../src/game/maps/registry';
import { buildMapData } from '../src/game/maps/MapData';
import { Bot, type BotContext } from '../src/game/bots/Bot';
import { DeathmatchBehavior } from '../src/game/bots/behaviors/DeathmatchBehavior';
import { CollisionWorld, COL_ALL } from '../src/game/physics/CollisionWorld';
import { PlayerController } from '../src/game/player/PlayerController';
import { DIFFICULTY_PRESETS } from '../src/settings/defaults';
import { WEAPONS } from '../src/game/weapons/weaponConfigs';
import type { Vec3 } from '../src/types';

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

function context(world: CollisionWorld, map: BotContext['map'], player: PlayerController, bots: Bot[], rng: () => number) {
  const shots: { bot: Bot; origin: Vec3; dir: Vec3 }[] = [];
  const ctx: BotContext = {
    time: 0,
    world,
    map,
    player,
    botsShootBack: true,
    bots,
    rng,
    botFire: (bot, origin, dir) => shots.push({ bot, origin, dir }),
    mayFire: () => true,
    graceUntil: 0,
    onBotFootstep: () => {},
  };
  return { ctx, shots };
}

describe('bot shooting', () => {
  function duel(distance: number, weapon = WEAPONS.vandal) {
    const world = new CollisionWorld();
    world.add({ minX: -100, minY: -1, minZ: -100, maxX: 100, maxY: 0, maxZ: 100, flags: COL_ALL, surface: 'ground' });
    const player = new PlayerController(world);
    player.spawn(0, 0, distance, 180);
    const bot = new Bot({ ...DIFFICULTY_PRESETS.hard }, null);
    bot.setWeapon(weapon);
    bot.place(0, 0, 0, 0);
    bot.wantsToShoot = true;
    bot.moveTarget = [0, 0];
    const { ctx, shots } = context(world, null as unknown as BotContext['map'], player, [bot], seeded(7));
    return { world, player, bot, ctx, shots };
  }

  it('empties the magazine, reloads for the gun’s reload time, then shoots again', () => {
    const { bot, ctx, shots } = duel(12);
    const dt = 1 / 120;
    let reloadStart = -1;
    let reloadEnd = -1;
    let shotsAtReload = 0;
    for (let i = 0; i < 120 * 40 && reloadEnd < 0; i++) {
      ctx.time += dt;
      bot.update(ctx, dt);
      expect(bot.ammo).toBeGreaterThanOrEqual(0);
      if (reloadStart < 0 && bot.reloading) {
        reloadStart = ctx.time;
        shotsAtReload = shots.length;
      } else if (reloadStart >= 0 && !bot.reloading) reloadEnd = ctx.time;
      if (bot.reloading) expect(shots.length).toBe(shotsAtReload);
    }
    expect(shotsAtReload).toBe(WEAPONS.vandal.magazine);
    expect(reloadEnd - reloadStart).toBeCloseTo(WEAPONS.vandal.reloadTime, 1);
    // (it may already have fired the first round of the new magazine in the same step)
    expect(bot.ammo).toBeGreaterThanOrEqual(WEAPONS.vandal.magazine - 1);
  });

  it('taps at long range and sprays up close', () => {
    const longest = (distance: number) => {
      const { bot, ctx, shots } = duel(distance);
      const dt = 1 / 120;
      let best = 0;
      let run = 0;
      let last = -1;
      let seen = 0;
      for (let i = 0; i < 120 * 6; i++) {
        ctx.time += dt;
        bot.update(ctx, dt);
        if (shots.length > seen) {
          // shots less than 1.5 fire intervals apart belong to the same burst
          run = last >= 0 && ctx.time - last < 1.5 / WEAPONS.vandal.fireRate ? run + 1 : 1;
          best = Math.max(best, run);
          last = ctx.time;
          seen = shots.length;
        }
      }
      return best;
    };
    expect(longest(45)).toBeLessThanOrEqual(2);
    expect(longest(5)).toBeGreaterThanOrEqual(8);
  });

  it('aims at the head when only the head shows over cover', () => {
    const { world, bot, ctx, shots } = duel(15);
    bot.tuning.headshotChance = 0; // always chooses the body…
    // …but a 1.3 m wall right in front of the player hides the chest
    world.add({ minX: -3, minY: 0, minZ: 13.5, maxX: 3, maxY: 1.3, maxZ: 14, flags: COL_ALL, surface: 'wall' });
    const dt = 1 / 120;
    for (let i = 0; i < 120 * 3 && shots.length === 0; i++) {
      ctx.time += dt;
      bot.update(ctx, dt);
    }
    expect(shots.length).toBeGreaterThan(0);
    // the aim is above the wall's top edge, not into the wall
    const [, oy] = shots[0].origin;
    const heightAtWall = oy + Math.tan(bot.aimPitch) * 13.5;
    expect(heightAtWall).toBeGreaterThan(1.3);
  });
});

describe('deathmatch brain', () => {
  const def = MAP_DEFINITIONS[0];
  const data = buildMapData(def);

  function cells() {
    const out: [number, number][] = [];
    const { nav, space } = data;
    for (let r = 0; r < nav.rows; r++)
      for (let c = 0; c < nav.cols; c++) {
        const i = r * nav.cols + c;
        if (nav.walkable[i] && Math.abs(nav.height[i]) < 0.01) out.push([space.x(c), space.z(r)]);
      }
    return out;
  }

  it('roams, fights, reloads and searches without getting stuck or leaving the map', () => {
    const rng = seeded(42);
    const ground = cells();
    const player = new PlayerController(data.world);
    const [px, pz] = ground[Math.floor(ground.length / 2)];
    player.spawn(px, 0, pz, 0);
    const bots: Bot[] = [];
    const { ctx, shots } = context(data.world, data, player, bots, rng);
    for (let i = 0; i < 5; i++) {
      const bot = new Bot({ ...DIFFICULTY_PRESETS.hard }, null);
      bot.setWeapon(WEAPONS.vandal);
      bot.brain = new DeathmatchBehavior();
      const [x, z] = ground[Math.floor(rng() * ground.length)];
      bot.place(x, 0, z, 0);
      bots.push(bot);
    }
    const states = new Set<string>();
    const dt = 1 / 60;
    const travelled = bots.map(() => 0);
    let stacked = 0;
    for (let i = 0; i < 60 * 90; i++) {
      ctx.time += dt;
      // the player "runs around": hops to a new place every 12 s and makes noise there
      if (i % (60 * 12) === 60 * 6) {
        const [x, z] = ground[Math.floor(rng() * ground.length)];
        player.spawn(x, 0, z, 0);
        for (const b of bots) b.brain?.hear?.(b, ctx, x, z);
      }
      bots.forEach((b, k) => {
        const ox = b.x;
        const oz = b.z;
        b.update(ctx, dt);
        travelled[k] += Math.hypot(b.x - ox, b.z - oz);
        expect(Number.isFinite(b.x + b.y + b.z + b.yaw + b.aimPitch)).toBe(true);
        states.add(b.brain!.describe());
      });
      if (i % 30 === 0) {
        for (let a = 0; a < bots.length; a++)
          for (let b = a + 1; b < bots.length; b++) if (Math.hypot(bots[a].x - bots[b].x, bots[a].z - bots[b].z) < 0.3) stacked++;
      }
    }
    for (const s of ['patrol', 'engage', 'chase', 'search']) expect(states, `never entered ${s}`).toContain(s);
    expect(shots.length).toBeGreaterThan(20);
    // every bot kept moving through the map, on the ground
    for (const d of travelled) expect(d).toBeGreaterThan(40);
    for (const b of bots) expect(b.y).toBeGreaterThan(-0.5);
    // bots don't stand inside each other for long
    expect(stacked).toBeLessThan(10);
  });

  it('a bot shot from behind turns on the shooter', () => {
    const world = new CollisionWorld();
    world.add({ minX: -100, minY: -1, minZ: -100, maxX: 100, maxY: 0, maxZ: 100, flags: COL_ALL, surface: 'ground' });
    const player = new PlayerController(world);
    player.spawn(0, 0, -15, 0);
    const bot = new Bot({ ...DIFFICULTY_PRESETS.normal }, null);
    const brain = new DeathmatchBehavior();
    bot.brain = brain;
    bot.place(0, 0, 0, 0); // facing +Z, away from the player
    const { ctx, shots } = context(world, data, player, [bot], seeded(3));
    const dt = 1 / 60;
    brain.state = 'hold';
    bot.update(ctx, dt);
    expect(bot.seesPlayer).toBe(false);
    bot.damage(20);
    brain.onDamaged(bot, ctx);
    for (let i = 0; i < 60 * 3 && shots.length === 0; i++) {
      ctx.time += dt;
      bot.update(ctx, dt);
    }
    expect(bot.seesPlayer).toBe(true);
    expect(brain.describe()).toBe('engage');
    expect(shots.length).toBeGreaterThan(0);
  });
});

describe('site clear', () => {
  it('posts defenders away from the spawn, ends the round when all are down and starts a new one', async () => {
    const { PracticeDirector } = await import('../src/game/practice/PracticeDirector');
    const { SessionTracker } = await import('../src/game/practice/SessionTracker');
    const { DEFAULT_PRACTICE } = await import('../src/settings/defaults');
    const def = MAP_DEFINITIONS[0];
    const map = buildMapData(def);
    const config = { ...DEFAULT_PRACTICE, mapId: def.id, locationId: def.locations[0].id, side: 'attack' as const, mode: 'site-clear' as const, botCount: 3, playerSpawnId: '', enemySpotIds: [] };
    const tracker = new SessionTracker(config);
    const director = new PracticeDirector({ map, location: def.locations[0], config, tracker, createVisual: null, rng: seeded(3) });
    const player = new PlayerController(map.world);
    const sp = director.playerSpawn;
    player.spawn(sp.pos[0], sp.pos[1], sp.pos[2], sp.yaw);
    const { ctx } = context(map.world, map, player, director.bots, seeded(5));
    director.start(ctx);
    expect(director.bots).toHaveLength(3);
    expect(director.bots.every((b) => b.alive && b.brain!.describe() === 'guard')).toBe(true);
    for (const b of director.bots) expect(Math.hypot(b.x - sp.pos[0], b.z - sp.pos[2])).toBeGreaterThanOrEqual(9);
    expect(new Set(director.bots.map((b) => `${b.x},${b.z}`)).size).toBe(3);
    expect(director.statusLabel).toContain('Round 1');

    // kill everyone: the round is recorded and a new one starts shortly after, with the player back at the spawn
    ctx.time = 12;
    for (const b of director.bots) {
      b.damage(1000);
      director.onBotKilled(b, ctx);
    }
    expect(tracker.stats.clear).toEqual({ rounds: 1, cleared: 1, times: [12] });
    let respawns = 0;
    ctx.time = 15;
    director.update(ctx, 1 / 60, () => respawns++);
    expect(respawns).toBe(1);
    expect(director.bots.every((b) => b.alive)).toBe(true);
    expect(tracker.stats.clear!.rounds).toBe(2);

    // dying restarts the round without counting a clear
    director.onPlayerDeath(ctx);
    ctx.time = 20;
    director.update(ctx, 1 / 60, () => respawns++);
    expect(respawns).toBe(2);
    expect(tracker.stats.clear).toMatchObject({ rounds: 3, cleared: 1 });
  });
});

describe('retake', () => {
  it('plants a spike near the defenders, defuses on a 5-second hold and detonates when the fuse runs out', async () => {
    const { PracticeDirector, SPIKE_FUSE } = await import('../src/game/practice/PracticeDirector');
    const { SessionTracker } = await import('../src/game/practice/SessionTracker');
    const { DEFAULT_PRACTICE } = await import('../src/settings/defaults');
    const def = MAP_DEFINITIONS[0];
    const map = buildMapData(def);
    const config = { ...DEFAULT_PRACTICE, mapId: def.id, locationId: def.locations[0].id, side: 'attack' as const, mode: 'retake' as const, botCount: 2, playerSpawnId: '', enemySpotIds: [] };
    const tracker = new SessionTracker(config);
    const director = new PracticeDirector({ map, location: def.locations[0], config, tracker, createVisual: null, rng: seeded(3) });
    const player = new PlayerController(map.world);
    const sp = director.playerSpawn;
    player.spawn(sp.pos[0], sp.pos[1], sp.pos[2], sp.yaw);
    const { ctx } = context(map.world, map, player, director.bots, seeded(5));
    ctx.botsShootBack = false;
    director.start(ctx);
    const spike = director.spike!;
    expect(spike).toBeTruthy();
    // the spike stands on walkable ground
    const i = map.space.row(spike.z) * map.nav.cols + map.space.col(spike.x);
    expect(map.nav.walkable[i]).toBe(1);
    expect(director.bots).toHaveLength(2);

    const step = (seconds: number) => {
      for (let t = 0; t < seconds; t += 1 / 30) {
        ctx.time += 1 / 30;
        director.update(ctx, 1 / 30, (x, y, z, yaw) => player.spawn(x, y, z, yaw));
      }
    };
    // away from the spike, holding the key does nothing
    director.useHeld = true;
    step(1);
    expect(spike.progress).toBe(0);
    expect(spike.fuse).toBeLessThan(SPIKE_FUSE);
    // next to it: letting go resets, a full hold defuses
    player.spawn(spike.x + 1, spike.y, spike.z, 0);
    step(2);
    expect(spike.progress).toBeGreaterThan(0.3);
    director.useHeld = false;
    step(0.1);
    expect(spike.progress).toBe(0);
    director.useHeld = true;
    step(5.1);
    expect(spike.state).toBe('defused');
    expect(tracker.stats.clear).toMatchObject({ rounds: 1, cleared: 1 });
    // a new round re-arms it; left alone it detonates and the round is not counted as won
    director.useHeld = false;
    step(3);
    expect(spike.state).toBe('armed');
    expect(tracker.stats.clear!.rounds).toBe(2);
    step(SPIKE_FUSE);
    expect(spike.state).toBe('exploded');
    step(4);
    expect(tracker.stats.clear).toMatchObject({ cleared: 1 });
    expect(tracker.stats.clear!.rounds).toBeGreaterThanOrEqual(3);
  });
});
