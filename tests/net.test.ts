import { describe, expect, it } from 'vitest';
import { ACTIONS, type Action } from '../src/game/core/actions';
import { buildMapData } from '../src/game/maps/MapData';
import { MAP_DEFINITIONS, getMapDefinition } from '../src/game/maps/registry';
import { PlayerController } from '../src/game/player/PlayerController';
import { WEAPONS } from '../src/game/weapons/weaponConfigs';
import { CommandInput, MAX_COMMAND_DT, MAX_SPEED_MULT, actionBit, actionMask, applyCommand, captureMasks, sanitizeCommand, type Command } from '../src/net/command';
import { MAX_MESSAGE_SIZE, PROTOCOL_VERSION, decodeClient, decodeServer, encode, sanitizeName, type ClientMessage, type ServerMessage } from '../src/net/protocol';
import { ROOM_CODE_ALPHABET, generateRoomCode, normalizeRoomCode } from '../src/net/roomCode';
import { DEFAULT_ROOM_SETTINGS, applyRoomSettings, isWeaponAllowed } from '../src/net/settings';

/** Small deterministic generator, so a failing run can be repeated. */
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

/** A player wandering a map: keys change every so often, the view turns, the step length varies. */
function wander(count: number, seed: number): Command[] {
  const rng = seeded(seed);
  const moves: Action[] = ['forward', 'back', 'left', 'right', 'walk', 'crouch'];
  const cmds: Command[] = [];
  let held = actionBit('forward');
  let yaw = 0;
  for (let seq = 0; seq < count; seq++) {
    if (rng() < 0.03) held = actionMask(moves.filter(() => rng() < 0.35));
    yaw += (rng() - 0.3) * 0.08; // drifts past a full turn, as a real view does
    if (yaw > Math.PI * 4) yaw %= Math.PI * 2; // …and is wrapped the way PlayerController.applyLook wraps it
    cmds.push({
      seq,
      dt: 1 / (120 + rng() * 120), // 120–240 steps per second, as on a fast display
      held,
      pressed: rng() < 0.01 ? actionBit('jump') : 0,
      yaw,
      pitch: (rng() - 0.5) * 0.6,
      speed: rng() < 0.5 ? 1 : 0.76,
    });
  }
  return cmds;
}

describe('commands', () => {
  it('give every action its own bit', () => {
    expect(new Set(ACTIONS.map(actionBit)).size).toBe(ACTIONS.length);
    expect(actionMask(['forward', 'fire'])).toBe(actionBit('forward') | actionBit('fire'));
  });

  it('replay held keys and one-shot presses through CommandInput', () => {
    const input = new CommandInput();
    input.load({ seq: 0, dt: 1 / 120, held: actionMask(['forward', 'crouch']), pressed: actionBit('jump'), yaw: 0, pitch: 0, speed: 1 });
    expect(input.isDown('forward')).toBe(true);
    expect(input.isDown('back')).toBe(false);
    expect(input.consume('jump')).toBe(true);
    expect(input.consume('jump')).toBe(false);
  });

  it('are captured from a device without consuming its presses', () => {
    const device = { isDown: (a: Action) => a === 'left', isPressed: (a: Action) => a === 'reload' };
    expect(captureMasks(device)).toEqual({ held: actionBit('left'), pressed: actionBit('reload') });
  });

  it('are made safe when they come from the network', () => {
    const ok = { seq: 1, dt: 0.005, held: 0, pressed: 0, yaw: 7.25, pitch: 0.1, speed: 1 };
    expect(sanitizeCommand(ok)).toEqual(ok); // in range: untouched, so the server simulates the same numbers
    expect(sanitizeCommand(null)).toBeNull();
    expect(sanitizeCommand({ ...ok, dt: 'x' })).toBeNull();
    expect(sanitizeCommand({ ...ok, dt: NaN })).toBeNull();
    expect(sanitizeCommand({ ...ok, seq: -1 })).toBeNull();
    expect(sanitizeCommand({ ...ok, yaw: 1e6 })).toBeNull();
    expect(sanitizeCommand({ ...ok, speed: undefined })).toBeNull();
    const c = sanitizeCommand({ seq: 7, dt: 5, held: -1, pressed: 1 << 30, yaw: 1, pitch: 9, speed: 50 })!;
    expect(c.dt).toBe(MAX_COMMAND_DT); // can't claim more time than one step
    expect(c.speed).toBe(MAX_SPEED_MULT); // or more speed than the fastest gun gives
    expect(c.held).toBe((1 << ACTIONS.length) - 1);
    expect(c.pressed).toBe(0);
    expect(c.pitch).toBeLessThan(Math.PI / 2);
  });
});

describe('headless simulation', () => {
  it('builds every map without a browser', () => {
    for (const def of MAP_DEFINITIONS) {
      const map = buildMapData(def);
      expect(map.boxes.length, def.id).toBeGreaterThan(10);
    }
  });

  it('moves a client and a server copy of a player identically from the same commands', () => {
    const def = getMapDefinition('vellora');
    const spawn = def.locations[0].sides.attack.playerSpawns[0];
    // each side builds its own world, as two machines would
    const client = new PlayerController(buildMapData(def).world);
    const server = new PlayerController(buildMapData(def).world);
    client.spawn(spawn.pos[0], spawn.pos[1], spawn.pos[2], spawn.yaw);
    server.spawn(spawn.pos[0], spawn.pos[1], spawn.pos[2], spawn.yaw);
    const clientInput = new CommandInput();
    const serverInput = new CommandInput();

    const cmds = wander(6000, 42);
    let travelled = 0;
    let jumped = false;
    for (let i = 0; i < cmds.length; i += 4) {
      const batch = cmds.slice(i, i + 4);
      const before = { ...client.pos };
      for (const cmd of batch) applyCommand(client, clientInput, cmd);
      travelled += Math.hypot(client.pos.x - before.x, client.pos.z - before.z);
      if (!client.grounded) jumped = true;

      // the server sees the commands only after a trip over the wire
      const msg = decodeClient(encode({ t: 'input', cmds: batch })) as Extract<ClientMessage, { t: 'input' }>;
      for (const raw of msg.cmds) applyCommand(server, serverInput, sanitizeCommand(raw)!);

      expect(server.pos).toEqual(client.pos);
      expect(server.vel).toEqual(client.vel);
      expect(server.crouch).toBe(client.crouch);
    }
    // the walk has to have been a real one for the comparison to mean anything
    expect(travelled).toBeGreaterThan(40);
    expect(jumped).toBe(true);
  });
});

describe('room settings', () => {
  it('accept listed values and keep the current one otherwise', () => {
    const s = applyRoomSettings(DEFAULT_ROOM_SETTINGS, { mapId: 'kitsune', timeLimitMin: 15, killLimit: 0, headshotsOnly: true, maxPlayers: 4 });
    expect(s).toMatchObject({ mapId: 'kitsune', timeLimitMin: 15, killLimit: 0, headshotsOnly: true, maxPlayers: 4 });
    const bad = applyRoomSettings(s, { mapId: 'nowhere', timeLimitMin: 999, killLimit: -5, headshotsOnly: 'yes', maxPlayers: 50, mode: 'ctf', singleWeapon: 'bfg' });
    expect(bad).toEqual({ ...s, maxPlayers: 10 });
    expect(applyRoomSettings(s, 'junk')).toBe(s);
    expect(applyRoomSettings(s, { maxPlayers: 1 }).maxPlayers).toBe(2);
  });

  it('apply the weapon rule', () => {
    const allowed = (weapons: typeof DEFAULT_ROOM_SETTINGS.weapons) =>
      Object.values(WEAPONS)
        .filter((w) => isWeaponAllowed({ weapons, singleWeapon: 'sheriff' }, w))
        .map((w) => w.id)
        .sort();
    expect(allowed('all')).toHaveLength(8);
    expect(allowed('rifles')).toEqual(['classic', 'ghost', 'guardian', 'phantom', 'sheriff', 'vandal']);
    expect(allowed('sidearms')).toEqual(['classic', 'ghost', 'sheriff']);
    expect(allowed('no-operator')).not.toContain('operator');
    expect(allowed('single')).toEqual(['sheriff']);
  });
});

describe('room codes', () => {
  it('are 6 characters with no look-alikes', () => {
    const rng = seeded(1);
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode(rng);
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      expect(normalizeRoomCode(code)).toBe(code);
    }
    expect(ROOM_CODE_ALPHABET).toHaveLength(32);
    expect(generateRoomCode(() => 0.999999999)).toBe('999999');
  });

  it('are read from what a player types', () => {
    expect(normalizeRoomCode(' k7m-2qx ')).toBe('K7M2QX');
    expect(normalizeRoomCode('K7M2Q')).toBeNull();
    expect(normalizeRoomCode('K7M2Q0')).toBeNull(); // 0 is not in the alphabet
    expect(normalizeRoomCode(42)).toBeNull();
  });
});

describe('message codec', () => {
  it('round-trips messages in both directions', () => {
    const hello: ClientMessage = { t: 'hello', version: PROTOCOL_VERSION, name: 'Jett' };
    expect(decodeClient(encode(hello))).toEqual(hello);
    const pong = { t: 'pong', time: 1, serverTime: 2 } as const;
    expect(decodeServer(encode(pong))).toEqual(pong);
  });

  it('packs snapshots and inputs small, and unpacks them unchanged', () => {
    const snapshot = {
      t: 'snapshot',
      time: 123456,
      self: { pos: [1.25, 0, -3.5], vel: [0.1, -0.2, 5.85], crouch: 0.5, flags: 3, health: 82, armor: 14, ackSeq: 4012 },
      players: [
        { id: 'abc123def456', pos: [10.125, 0.4, -22.75], yaw: 1.571, pitch: -0.2, crouch: 0, flags: 7, weapon: 'vandal' },
        { id: 'fedcba654321', pos: [-4, 0, 9], yaw: -3.1, pitch: 0, crouch: 1, flags: 1, weapon: 'sheriff' },
      ],
    } as const;
    const wire = encode(snapshot as unknown as ServerMessage);
    expect(decodeServer(wire)).toEqual(snapshot);
    expect(wire.length).toBeLessThan(JSON.stringify(snapshot).length * 0.6);
    expect(decodeServer(encode({ t: 'snapshot', time: 1, self: null, players: [] }))).toEqual({ t: 'snapshot', time: 1, self: null, players: [] });

    const input = { t: 'input', cmds: [{ seq: 9, dt: 1 / 144, held: 33, pressed: 64, yaw: 7.123456789012345, pitch: -0.25, speed: 0.76 }] } as const;
    expect(decodeClient(encode(input as unknown as ClientMessage))).toEqual(input); // exact: the server must simulate the same numbers
    // junk in a packed input becomes commands that fail their own check, never an exception
    const junk = decodeClient('{"t":"i","c":[7,null,["x"],[1,2]]}') as Extract<ClientMessage, { t: 'input' }>;
    expect(junk.cmds).toHaveLength(4);
    expect(junk.cmds.every((c) => sanitizeCommand(c) === null)).toBe(true);
    expect((decodeClient('{"t":"i"}') as Extract<ClientMessage, { t: 'input' }>).cmds).toEqual([]);
  });

  it('rejects anything that is not a known message for that direction', () => {
    expect(decodeClient('not json')).toBeNull();
    expect(decodeClient('[]')).toBeNull();
    expect(decodeClient('{"t":"nope"}')).toBeNull();
    expect(decodeClient(encode({ t: 'pong', time: 1, serverTime: 2 }))).toBeNull(); // a server message
    expect(decodeServer(encode({ t: 'room.create' }))).toBeNull();
    expect(decodeClient(new Uint8Array(4))).toBeNull();
    expect(decodeClient(`{"t":"ping","time":1,"pad":"${'x'.repeat(MAX_MESSAGE_SIZE)}"}`)).toBeNull();
  });

  it('cleans display names', () => {
    expect(sanitizeName('  Jett   Main ​\n')).toBe('Jett Main');
    expect(sanitizeName('x'.repeat(40))).toHaveLength(16);
    expect(sanitizeName('   ')).toBeNull();
    expect(sanitizeName(7)).toBeNull();
  });
});
