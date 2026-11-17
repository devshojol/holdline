/**
 * Headless test players: join a room and run around the map once a match starts. They speak the real
 * protocol and move with the real movement code, so they are also a check on the server.
 *
 *   npm run mp:bot -- K7M2QX        one bot joins room K7M2QX
 *   npm run mp:bot -- K7M2QX 4      four bots
 *   npm run mp:bot -- K7M2QX 4 shoot   four bots that stop and shoot at anyone they can see
 *   npm run mp:bot -- quick 3          three bots search for a quick match on any map, and search again after each one
 *   npm run mp:bot -- quick 50 shoot   a load test: fifty bots fill five matches (watch the server's health page)
 *   MP_SERVER=wss://host MP_ORIGIN=https://your-site.example npm run mp:bot -- K7M2QX
 *                                      another server; MP_ORIGIN when it only accepts one website
 *
 * Without `shoot` they only run around: something to look at, to shoot at, and a source of load.
 * With it they are poor shots on purpose (a few degrees of error, about two bullets a second).
 */
import WebSocket from 'ws';
import { buildMapData } from '../../src/game/maps/MapData';
import { getMapDefinition } from '../../src/game/maps/registry';
import { PlayerController } from '../../src/game/player/PlayerController';
import { CommandInput, actionBit, actionMask, applyCommand, type Command } from '../../src/net/command';
import { INPUT_RATE, PF_ALIVE, PROTOCOL_VERSION, decodeServer, encode, type ClientMessage, type PlayerSnapshot } from '../../src/net/protocol';

const [code, countArg, mode] = process.argv.slice(2);
const shoots = mode === 'shoot';
const quick = code?.toLowerCase() === 'quick';
if (!code) {
  console.error('Usage: npm run mp:bot -- <room code | quick> [number of bots] [shoot]');
  process.exit(1);
}
const url = process.env.MP_SERVER ?? 'ws://localhost:8787';
// a room holds 10, so at most 9 bots join one; the quick-match queue takes any number (a load test)
const count = Math.max(1, Math.min(quick ? 500 : 9, Number(countArg) || 1));
const NAMES = ['Brim', 'Cypher', 'Raze', 'Killjoy', 'Skye', 'Yoru', 'Astra', 'Neon', 'Fade'];
const STEP = 1 / 120;

function startBot(name: string) {
  // a server that only accepts its own website's pages checks this header; a browser sets it by itself
  const ws = new WebSocket(url, process.env.MP_ORIGIN ? { origin: process.env.MP_ORIGIN } : {});
  const send = (msg: ClientMessage) => ws.readyState === WebSocket.OPEN && ws.send(encode(msg));
  let loop: ReturnType<typeof setInterval> | undefined;
  let view: { time: number; players: PlayerSnapshot[]; alive: boolean; player: PlayerController } | null = null;

  ws.on('open', () => send({ t: 'hello', version: PROTOCOL_VERSION, playerId: '', name }));
  ws.on('close', () => {
    clearInterval(loop);
    console.log(`${name}: disconnected`);
  });
  ws.on('error', (err) => console.error(`${name}: ${err.message}`));
  ws.on('message', (data) => {
    const msg = decodeServer(data.toString());
    if (!msg) return;
    switch (msg.t) {
      case 'welcome':
        if (quick) send({ t: 'queue.join', maps: [] });
        else {
          send({ t: 'room.join', code });
          send({ t: 'room.ready', ready: true });
        }
        break;
      case 'error':
        console.error(`${name}: ${msg.message}`);
        break;
      case 'room.left':
        clearInterval(loop);
        // a quick match's room closes when it ends: look for the next one
        if (quick && msg.reason === 'closed') send({ t: 'queue.join', maps: [] });
        else ws.close();
        break;
      case 'snapshot':
        if (view && msg.self) {
          view.time = msg.time;
          view.players = msg.players;
          view.alive = (msg.self.flags & PF_ALIVE) !== 0;
          // a respawn moves the body on the server: follow it
          const p = view.player;
          if (Math.hypot(p.pos.x - msg.self.pos[0], p.pos.z - msg.self.pos[2]) > 1.5) p.spawn(msg.self.pos[0], msg.self.pos[1], msg.self.pos[2], (p.yaw * 180) / Math.PI);
        }
        break;
      case 'match.end':
        clearInterval(loop);
        send({ t: 'room.ready', ready: true });
        break;
      case 'match.start': {
        console.log(`${name}: playing on ${msg.settings.mapId}`);
        clearInterval(loop);
        // the bot predicts its own movement exactly as a browser does, to know where it is
        const world = buildMapData(getMapDefinition(msg.settings.mapId)).world;
        const player = new PlayerController(world);
        player.spawn(msg.spawn.pos[0], msg.spawn.pos[1], msg.spawn.pos[2], msg.spawn.yaw);
        const input = new CommandInput();
        // what the last snapshot said: where the others are, and whether we are alive
        view = { time: msg.serverTime, players: [], alive: true, player };
        let sinceShot = 0;
        let seq = 0;
        let turn = 0;
        let stuck = 0;
        let crouchUntil = 0;
        loop = setInterval(() => {
          const cmds: Command[] = [];
          // someone in plain sight: stop, face them and shoot
          const eye: [number, number, number] = [player.pos.x, player.pos.y + player.eyeHeight, player.pos.z];
          const seen = shoots && view?.alive ? view.players.find((p) => p.flags & PF_ALIVE && world.segmentClear(eye[0], eye[1], eye[2], p.pos[0], p.pos[1] + 1.2, p.pos[2])) : undefined;
          if (seen) {
            const dx = seen.pos[0] - eye[0];
            const dy = seen.pos[1] + 1.15 - eye[1];
            const dz = seen.pos[2] - eye[2];
            const aimYaw = Math.atan2(dx, dz);
            const aimPitch = Math.atan2(dy, Math.hypot(dx, dz));
            for (let i = 0; i < Math.round(1 / INPUT_RATE / STEP); i++) {
              const cmd: Command = { seq: seq++, dt: STEP, held: 0, pressed: 0, yaw: aimYaw, pitch: aimPitch, speed: 1 };
              applyCommand(player, input, cmd);
              cmds.push(cmd);
            }
            send({ t: 'input', cmds });
            sinceShot += 1 / INPUT_RATE;
            if (sinceShot >= 0.45) {
              sinceShot = 0;
              // a few degrees off, so they can be beaten
              const yaw = aimYaw + (Math.random() - 0.5) * 0.09;
              const pitch = aimPitch + (Math.random() - 0.5) * 0.09;
              const cp = Math.cos(pitch);
              send({ t: 'shot', shot: { seq: seq - 1, weapon: 'vandal', origin: eye, dir: [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp], viewTime: view!.time } });
            }
            return;
          }
          for (let i = 0; i < Math.round(1 / INPUT_RATE / STEP); i++) {
            // run forward; turn away when a wall stops us, and wander a little otherwise
            if (player.speed < 1) stuck += STEP;
            else stuck = 0;
            if (stuck > 0.25) {
              turn = (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 1.5);
              stuck = 0;
            }
            if (Math.random() < 0.004) turn = (Math.random() - 0.5) * 1.6;
            if (Math.random() < 0.001) crouchUntil = seq + 120;
            const dYaw = Math.max(-4 * STEP, Math.min(4 * STEP, turn));
            turn -= dYaw;
            const cmd: Command = {
              seq: seq++,
              dt: STEP,
              held: actionMask(seq < crouchUntil ? ['forward', 'crouch'] : ['forward']),
              pressed: Math.random() < 0.002 ? actionBit('jump') : 0,
              yaw: (player.yaw + dYaw) % (Math.PI * 2),
              pitch: 0,
              speed: 1,
            };
            applyCommand(player, input, cmd);
            cmds.push(cmd);
          }
          send({ t: 'input', cmds });
        }, 1000 / INPUT_RATE);
        break;
      }
    }
  });
}

for (let i = 0; i < count; i++) startBot(`${NAMES[i % NAMES.length]}${i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : ''} (bot)`);
console.log(`${count} bot${count > 1 ? 's' : ''} ${quick ? 'searching for a quick match' : `joining room ${code.toUpperCase()}`} on ${url}. Ctrl+C to stop.`);
