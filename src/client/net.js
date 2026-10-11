// Peer-to-peer rooms over WebRTC, using PeerJS and its free public broker to
// introduce the browsers to each other. There is no game server: the host's
// browser runs the simulation and guests send inputs and receive snapshots.

const PEER_SRC = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const PREFIX = 'hashrush-';

// The room list rides on a free public MQTT broker. Each open room keeps one
// retained message on its own topic; the broker hands every retained message to
// whoever subscribes, and wipes a room's message itself (the "last will") when the
// host's connection drops. Anyone can publish there, so everything read back is
// checked before it is shown.
const MQTT_SRC = 'https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js';
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const ROOMS_TOPIC = 'minglelabs/hash-rush/v1/rooms';
const ROOM_ID = /^[a-z0-9]{6}$/;
// A host refreshes its entry every minute; one not heard from in three is gone.
const REFRESH = 60 * 1000;
const STALE = 3 * 60 * 1000;

// STUN lets two browsers find a direct route. That fails on some networks, mobile
// carriers above all, and then only a TURN relay can carry the traffic. PeerJS's
// own free relays no longer exist, so this uses a free ExpressTURN account. The
// login has to ship with the page, so anyone can read it: it is a free-tier
// account and nothing else. TCP is listed too for networks that block UDP.
const TURN_SERVERS = [
  {
    urls: ['turn:free.expressturn.com:3478', 'turn:free.expressturn.com:3478?transport=tcp'],
    username: '000000002106995672',
    credential: '3SnEhz/cael7QWplFsqafCb/Kxc=',
  },
];
const CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    ...TURN_SERVERS,
  ],
};
const loading = {};

function loadScript(src, global) {
  if (window[global]) return Promise.resolve();
  if (!loading[src]) {
    loading[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => {
        delete loading[src];
        reject(new Error(`could not load ${src}`));
      };
      document.head.append(s);
    });
  }
  return loading[src];
}

const loadPeer = () => loadScript(PEER_SRC, 'Peer');

function randomRoom() {
  const letters = 'abcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += letters[Math.floor(Math.random() * letters.length)];
  return id;
}

// Opens a room. `on.join(conn)`, `on.data(conn, msg)` and `on.leave(conn)` are
// called as guests come and go. Resolves with { room, close }.
export async function hostRoom(on) {
  await loadPeer();
  const room = randomRoom();
  const peer = new window.Peer(PREFIX + room, { config: CONFIG });
  await new Promise((resolve, reject) => {
    peer.on('open', resolve);
    peer.on('error', reject);
  });
  peer.on('connection', (conn) => {
    conn.on('open', () => on.join(conn));
    conn.on('data', (msg) => on.data(conn, msg));
    conn.on('close', () => on.leave(conn));
    conn.on('error', () => on.leave(conn));
  });
  // The broker connection can drop without affecting guests already connected.
  peer.on('disconnected', () => peer.reconnect());
  // A phone drops that connection as soon as the host switches apps to send the
  // link, and the room then looks as if it did not exist. Re-register on return.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && peer.disconnected && !peer.destroyed) peer.reconnect();
  });
  return { room, close: () => peer.destroy() };
}

// Joins a room. `on.data(msg)` receives host messages and `on.close()` fires if
// the host goes away. Resolves with { send, close } once connected.
export async function joinRoom(room, on) {
  await loadPeer();
  const peer = new window.Peer({ config: CONFIG });
  await new Promise((resolve, reject) => {
    peer.on('open', resolve);
    peer.on('error', reject);
  });
  const conn = peer.connect(PREFIX + room, { reliable: true });
  try {
    await new Promise((resolve, reject) => {
      conn.on('open', resolve);
      // The broker answers "peer-unavailable" when no such room exists; anything
      // else, including silence, means the two browsers could not reach each other.
      peer.on('error', (err) => reject(Object.assign(new Error('join failed'), { noRoom: err && err.type === 'peer-unavailable' })));
      setTimeout(() => reject(new Error('timed out')), 15000);
    });
  } catch (err) {
    peer.destroy();
    throw err;
  }
  conn.on('data', (msg) => on.data(msg));
  conn.on('close', () => on.close());
  conn.on('error', () => on.close());
  return { send: (msg) => conn.open && conn.send(msg), close: () => peer.destroy() };
}

// ---------- room list ----------

// Connects to the first broker that answers.
async function connectBroker(options) {
  await loadScript(MQTT_SRC, 'mqtt');
  for (const url of BROKERS) {
    const client = window.mqtt.connect(url, { connectTimeout: 6000, ...options });
    try {
      await new Promise((resolve, reject) => {
        client.once('connect', resolve);
        client.once('error', reject);
        client.once('offline', reject);
      });
      return client;
    } catch {
      client.end(true);
    }
  }
  throw new Error('no broker');
}

// Lists a room. `update(info)` replaces what the list shows (null hides it) and
// `close()` takes it off. Rejects if no broker can be reached.
export async function announceRoom(room) {
  const topic = `${ROOMS_TOPIC}/${room}`;
  const client = await connectBroker({ will: { topic, payload: '', retain: true, qos: 1 } });
  let info = null;
  const send = () => client.publish(topic, info ? JSON.stringify({ ...info, at: Date.now() }) : '', { retain: true, qos: 1 });
  const timer = setInterval(() => info && send(), REFRESH);
  // After a dropped connection the broker has already run the last will.
  client.on('connect', send);
  return {
    update(next) {
      info = next;
      send();
    },
    close() {
      clearInterval(timer);
      info = null;
      client.publish(topic, '', { retain: true, qos: 1 }, () => client.end());
    },
  };
}

const count = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v)) || 0));

function readRoom(room, text) {
  let info;
  try {
    info = JSON.parse(text);
  } catch {
    return null;
  }
  if (!info || typeof info !== 'object') return null;
  return {
    room,
    name: String(info.name || '').slice(0, 8),
    humans: count(info.humans, 8),
    bots: count(info.bots, 8),
    open: count(info.open, 8),
    playing: info.state === 'playing',
    at: Number(info.at) || 0,
  };
}

// Calls `onChange(rooms)` with the open rooms, newest first, whenever the list
// changes. Resolves with a function that stops watching.
export async function watchRooms(onChange) {
  const rooms = new Map();
  const client = await connectBroker({});
  const emit = () => {
    const now = Date.now();
    onChange([...rooms.values()].filter((r) => now - r.at < STALE).sort((a, b) => b.at - a.at));
  };
  client.on('message', (topic, payload) => {
    const room = topic.slice(ROOMS_TOPIC.length + 1);
    if (!ROOM_ID.test(room)) return;
    const info = payload.length ? readRoom(room, payload.toString()) : null;
    if (info) rooms.set(room, info);
    else rooms.delete(room);
    emit();
  });
  // Retained messages arrive right after the subscription; give them a moment
  // before reporting an empty list.
  client.subscribe(`${ROOMS_TOPIC}/+`, () => setTimeout(emit, 800));
  const timer = setInterval(emit, 15000);
  return () => {
    clearInterval(timer);
    client.end(true);
  };
}
