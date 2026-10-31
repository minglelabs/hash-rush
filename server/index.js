// Hash Rush game server (G2). Runs rooms on the server so no player's browser is
// the host. WebSocket over HTTP(S) only, so it runs on Railway as is.
//
//   GET  /health                -> { ok, rooms, players }
//   WS   /rooms/<roomId>        -> the same messages a player's room speaks
//
// Env: PORT, ALLOWED_ORIGINS (comma list, empty = any), MAX_ROOMS,
//      RESULTS_URL + RESULTS_SECRET (optional: where finished rounds are POSTed).

import http from 'node:http';
import { WebSocketServer } from 'ws';
import { Room, TICK_MS } from './room.js';
import { verifyTicket } from './ticket.js';

const PORT = Number(process.env.PORT) || 8080;
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 500;
const MAX_MESSAGE_BYTES = 4096;
const MAX_MESSAGES_PER_SEC = 120;
const EMPTY_ROOM_TTL_MS = 60_000;
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const RESULTS_URL = (process.env.RESULTS_URL || '').trim();
const RESULTS_SECRET = (process.env.RESULTS_SECRET || '').trim();
const ROOM_ID = /^[a-z0-9][a-z0-9_-]{2,63}$/i;
// Same secret as the mingle app's HASH_RUSH_TICKET_SECRET. Unset = open rooms.
const TICKET_SECRET = (process.env.HASH_RUSH_TICKET_SECRET || '').trim();

const rooms = new Map();

function reportResult(result) {
  console.log(`[result] ${JSON.stringify(result)}`);
  if (!RESULTS_URL || !RESULTS_SECRET) return;
  fetch(RESULTS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hash-rush-secret': RESULTS_SECRET },
    body: JSON.stringify(result),
  }).catch((error) => console.warn(`[result] post failed: ${error?.message ?? error}`));
}

function roomFor(id, query) {
  let room = rooms.get(id);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) return null;
    room = new Room({ id, map: query.get('map') || 'meadow', teams: query.get('teams') === '1', onResult: reportResult });
    room.emptySince = 0;
    rooms.set(id, room);
  }
  return room;
}

let nextPeer = 1;

function wrap(ws) {
  const conn = {
    peer: `p${nextPeer++}`,
    open: true,
    send(msg) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
    // Snapshots: skipped when the socket is backed up, the next one replaces it.
    fast(msg) {
      if (ws.readyState === ws.OPEN && ws.bufferedAmount < 64 * 1024) ws.send(JSON.stringify(msg));
    },
    close() {
      conn.open = false;
      ws.close();
    },
  };
  return conn;
}

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    let players = 0;
    for (const room of rooms.values()) players += room.humans.length;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, rooms: rooms.size, players }));
    return;
  }
  response.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, 'http://local');
  const match = /^\/rooms\/([^/]+)$/.exec(url.pathname);
  const origin = request.headers.origin || '';
  if (!match || !ROOM_ID.test(match[1]) || (ALLOWED.length && !ALLOWED.includes(origin))) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  // With a ticket secret set, only holders of an app ticket for this room get in.
  let ticket = null;
  if (TICKET_SECRET) {
    ticket = verifyTicket(url.searchParams.get('ticket'), TICKET_SECRET);
    if (!ticket || ticket.room !== match[1]) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
  }
  const room = roomFor(match[1], url.searchParams);
  if (!room) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    const conn = wrap(ws);
    conn.ticket = ticket;
    room.join(conn);
    room.emptySince = 0;
    let windowStart = Date.now();
    let count = 0;
    ws.on('message', (data) => {
      const at = Date.now();
      if (at - windowStart > 1000) {
        windowStart = at;
        count = 0;
      }
      if (++count > MAX_MESSAGES_PER_SEC) return;
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg && msg.t === 'ping') return conn.send({ t: 'pong', at: msg.at });
      room.receive(conn, msg);
    });
    ws.on('close', () => {
      conn.open = false;
      room.leave(conn);
    });
    ws.on('error', () => ws.close());
  });
});

// One clock for every room. Ticks that fell behind are caught up (at most 5).
let last = performance.now();
let carry = 0;
const clock = setInterval(() => {
  const now = performance.now();
  carry += now - last;
  last = now;
  const ticks = Math.min(5, Math.floor(carry / TICK_MS));
  carry = ticks === 5 ? 0 : carry - ticks * TICK_MS;
  const wall = Date.now();
  for (const [id, room] of rooms) {
    room.update(Math.max(1, ticks));
    if (room.empty) {
      room.emptySince ||= wall;
      if (wall - room.emptySince > EMPTY_ROOM_TTL_MS) rooms.delete(id);
    }
  }
}, TICK_MS);

function shutdown() {
  clearInterval(clock);
  for (const client of wss.clients) client.close(1012, 'restarting');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, '0.0.0.0', () => console.log(`[hash-rush] game server on :${PORT}`));
