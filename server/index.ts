/**
 * The multiplayer game server: one process, every room in memory. See docs/multiplayer.md, section 5.
 *
 *   npm run server                 start on port 8787
 *   PORT=9000 npm run server       another port
 *   ALLOWED_ORIGINS=https://example.com,https://www.example.com npm run server
 *                                  only accept browsers on these sites (anything is accepted when unset);
 *                                  an entry *.example.com also allows every subdomain of example.com
 *   CLIENT_IP_HEADER=cf-connecting-ip,x-forwarded-for npm run server
 *                                  behind a proxy: the request headers that carry the visitor's address,
 *                                  most trusted first
 */
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_MESSAGE_SIZE, SNAPSHOT_RATE } from '../src/net/protocol';
import { Lobby, type Connection } from './Lobby';

const PORT = Number(process.env.PORT) || 8787;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
/**
 * Behind a host's proxy every connection arrives from the proxy's own address, which would make the
 * per-address limits count all players as one. The proxy passes the visitor's address in a header;
 * naming it here makes the server use it (several can be listed: the first one present is used). Only set this when a proxy you trust sets the header on
 * every request: a server reached directly would be taking the visitor's word for who they are.
 */
const CLIENT_IP_HEADERS = (process.env.CLIENT_IP_HEADER ?? '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
/** Which of those headers the latest connection carried ('none': the socket's own address was used). Shown on the health page. */
let addressSource = 'none';
/** Most sockets one address may hold open. */
const MAX_PER_ADDRESS = Number(process.env.MAX_PER_ADDRESS) || 20;
/** One tick per snapshot: timers advance and every running match sends its players the world. */
const TICK_MS = 1000 / SNAPSHOT_RATE;
const HEARTBEAT_MS = 15_000;
/** A socket with this much unsent data queued has stopped reading and is dropped. */
const MAX_BUFFERED_BYTES = 1024 * 1024;

const lobby = new Lobby();
const perAddress = new Map<string, number>();

/** How the last few seconds went: what the load test and the host's monitoring read. */
const stats = { ticks: 0, tickMs: 0, worstTickMs: 0, bytesOut: 0, messagesIn: 0, since: Date.now() };
let report = { avgTickMs: 0, worstTickMs: 0, ticksPerSec: 0, kbOutPerSec: 0, messagesInPerSec: 0 };
const STATS_WINDOW_MS = 5000;

const http = createServer((req, res) => {
  // a plain request is a health check
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      ok: true,
      rooms: lobby.roomCount,
      players: lobby.playerCount,
      searching: lobby.queueLength,
      connections: wss.clients.size,
      addresses: perAddress.size,
      addressSource,
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      uptimeSec: Math.round(process.uptime()),
      ...report,
    }),
  );
});

/** May a page on `origin` connect? An entry `*.example.com` allows example.com and every subdomain, over https. */
function originAllowed(origin?: string): boolean {
  if (ALLOWED_ORIGINS.length === 0) return true;
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return ALLOWED_ORIGINS.some((entry) => entry.startsWith('*.') && (url.hostname === entry.slice(2) || url.hostname.endsWith(entry.slice(1))));
}

const wss = new WebSocketServer({
  server: http,
  maxPayload: MAX_MESSAGE_SIZE * 4, // bytes; a character is at most 4
  verifyClient: ({ origin }: { origin?: string }) => originAllowed(origin),
});

wss.on('connection', (ws: WebSocket & { alive?: boolean }, req) => {
  let address = req.socket.remoteAddress ?? 'unknown';
  addressSource = 'none';
  for (const name of CLIENT_IP_HEADERS) {
    const header = req.headers[name];
    const value = (Array.isArray(header) ? header[0] : header)?.split(',')[0].trim();
    if (!value) continue;
    address = value;
    addressSource = name;
    break;
  }
  const open = (perAddress.get(address) ?? 0) + 1;
  if (open > MAX_PER_ADDRESS) {
    ws.close(1013, 'Too many connections');
    return;
  }
  perAddress.set(address, open);

  const conn: Connection = {
    send: (data) => {
      if (ws.readyState !== ws.OPEN) return;
      // a client that has stopped reading must not make the server hold its messages without limit
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
        ws.terminate();
        return;
      }
      stats.bytesOut += data.length;
      ws.send(data);
    },
    close: () => ws.close(),
    address,
  };
  ws.alive = true;
  lobby.connect(conn);

  ws.on('pong', () => {
    ws.alive = true;
  });
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    stats.messagesIn++;
    try {
      lobby.receive(conn, data.toString());
    } catch (err) {
      console.error('message failed', err);
    }
  });
  ws.on('close', () => {
    lobby.disconnect(conn);
    const left = (perAddress.get(address) ?? 1) - 1;
    if (left <= 0) perAddress.delete(address);
    else perAddress.set(address, left);
  });
  ws.on('error', () => ws.terminate());
});

setInterval(() => {
  const start = performance.now();
  try {
    lobby.tick(Date.now());
  } catch (err) {
    console.error('tick failed', err);
  }
  const ms = performance.now() - start;
  stats.ticks++;
  stats.tickMs += ms;
  stats.worstTickMs = Math.max(stats.worstTickMs, ms);
  const elapsed = Date.now() - stats.since;
  if (elapsed >= STATS_WINDOW_MS) {
    const sec = elapsed / 1000;
    report = {
      avgTickMs: Math.round((stats.tickMs / stats.ticks) * 100) / 100,
      worstTickMs: Math.round(stats.worstTickMs * 100) / 100,
      ticksPerSec: Math.round((stats.ticks / sec) * 10) / 10,
      kbOutPerSec: Math.round(stats.bytesOut / 1024 / sec),
      messagesInPerSec: Math.round(stats.messagesIn / sec),
    };
    Object.assign(stats, { ticks: 0, tickMs: 0, worstTickMs: 0, bytesOut: 0, messagesIn: 0, since: Date.now() });
  }
}, TICK_MS);

// drop sockets that stopped answering (a closed laptop, a lost network) so their players are marked as gone
setInterval(() => {
  for (const ws of wss.clients as Set<WebSocket & { alive?: boolean }>) {
    if (ws.alive === false) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

lobby.tick(Date.now());
http.listen(PORT, () => console.log(`Game server listening on port ${PORT}`));

// A deploy or restart: close every socket so clients learn at once (they show "connection lost" and
// can reconnect to the new process), then exit. Rooms live in memory, so they end with the process.
function shutdown(signal: string) {
  console.log(`${signal}: shutting down`);
  for (const ws of wss.clients) ws.close(1012, 'Server restarting');
  wss.close();
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => console.error('uncaught exception', err));
process.on('unhandledRejection', (err) => console.error('unhandled rejection', err));
