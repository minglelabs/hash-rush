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
// Knobs for the address bar, for trying out a bad connection at one desk. They act
// on the guest's side: `lag=300` makes every round trip that many ms longer,
// `loss=5` drops that percentage of what crosses the fast lane, and `relay` sends
// everything through the TURN relay even where a direct route exists.
const knobs = new URLSearchParams(location.search);
const LAG = Math.max(0, Number(knobs.get('lag')) || 0);
const LOSS = Math.max(0, Number(knobs.get('loss')) || 0) / 100;
const CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    ...TURN_SERVERS,
  ],
  ...(knobs.has('relay') ? { iceTransportPolicy: 'relay' } : {}),
};
const loading = {};

// PeerJS's own channel delivers everything, in order: a lost packet is sent again
// and whatever was sent after it waits for that. The lobby, chat and events need
// this. A snapshot or an input is out of date a frame later, though, and there the
// same care freezes the picture over one lost packet and lets a slow link fall
// further and further behind. So those ride a second channel on the same
// connection, one that never resends and never waits. Both ends open it under the
// same id, and it only counts once the other end has been heard on it, which a page
// from before this channel never is.
const FAST = { negotiated: true, id: 77, ordered: false, maxRetransmits: 0 };
// This much still waiting to go out (about two snapshots) means the link cannot keep
// up right now. Whatever joins a queue arrives late, so the message is skipped instead.
const FAST_BACKLOG = 1500;

// Opens the fast lane beside `conn` and returns its send function, which answers
// false while the lane cannot be used, so that the message can go the slow way.
// The guest says hello first and the host answers.
function fastLane(conn, onData, guest) {
  let ch;
  try {
    ch = conn.peerConnection.createDataChannel('fast', FAST);
  } catch {
    return () => false;
  }
  let heard = false;
  let tries = 20;
  const hello = () => ch.readyState === 'open' && ch.send('hi');
  const timer = guest && setInterval(() => (heard || --tries < 0 ? clearInterval(timer) : hello()), 500);
  ch.onclose = () => clearInterval(timer);
  ch.onmessage = (e) => {
    heard = true;
    if (e.data === 'hi') {
      if (!guest) hello();
      return;
    }
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    onData(msg);
  };
  return (msg) => {
    if (!heard || ch.readyState !== 'open') return false;
    if (ch.bufferedAmount < FAST_BACKLOG) ch.send(JSON.stringify(msg));
    return true;
  };
}

// How the traffic reaches the other side: `relay` when it goes through the TURN
// server instead of straight across, and the round trip in ms as the browser
// measures it. Null while that is not known.
async function route(conn) {
  let stats;
  try {
    stats = await conn.peerConnection.getStats();
  } catch {
    return null;
  }
  let pair = null;
  stats.forEach((s) => {
    if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId);
  });
  // Firefox has no transport entry; there the chosen pair says so itself.
  if (!pair) {
    stats.forEach((s) => {
      if (s.type === 'candidate-pair' && s.selected) pair = s;
    });
  }
  if (!pair) return null;
  const type = (id) => (stats.get(id) || {}).candidateType;
  return {
    relay: type(pair.localCandidateId) === 'relay' || type(pair.remoteCandidateId) === 'relay',
    ms: Math.round((pair.currentRoundTripTime || 0) * 1000) + LAG,
  };
}

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

export function randomRoom() {
  const letters = 'abcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += letters[Math.floor(Math.random() * letters.length)];
  return id;
}

// Opens a room. `on.join(conn)`, `on.data(conn, msg)` and `on.leave(conn)` are
// called as guests come and go. Resolves with { room, close }.
// `want` asks for a room id again, the one this tab hosted before it was reloaded
// or this browser's own, so the link friends already have still leads here.
export async function hostRoom(on, want) {
  await loadPeer();
  const open = (id) =>
    new Promise((resolve, reject) => {
      const peer = new window.Peer(PREFIX + id, { config: CONFIG });
      let up = false;
      peer.on('open', () => {
        up = true;
        resolve(peer);
      });
      peer.on('error', (err) => {
        if (up) return;
        peer.destroy();
        reject(err);
      });
    });
  let room = want || randomRoom();
  let peer = null;
  for (let tries = 0; !peer; tries++) {
    try {
      peer = await open(room);
    } catch (err) {
      if (room !== want || !err || err.type !== 'unavailable-id') throw err;
      // The broker still has the id down to the page that was just reloaded or
      // closed. It lets go within a few seconds; after that somebody else really
      // has it (another tab of this browser hosting too).
      if (tries < 7) await new Promise((r) => setTimeout(r, 1000));
      else room = randomRoom();
    }
  }
  peer.on('connection', (conn) => {
    conn.on('open', () => {
      conn.fast = fastLane(conn, (msg) => on.data(conn, msg), false);
      on.join(conn);
    });
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
// the host goes away. Resolves with { send, fast, route, close } once connected:
// `fast` is for what the next message makes worthless, `route` for how good the line is.
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
  // Half of the extra round trip on the way in, half on the way out.
  const late = (fn) => (LAG ? (msg) => setTimeout(() => fn(msg), LAG / 2) : fn);
  const lossy = (fn) => (LOSS ? (msg) => Math.random() < LOSS || fn(msg) : fn);
  conn.on('data', late(on.data));
  conn.on('close', () => on.close());
  conn.on('error', () => on.close());
  const send = late((msg) => conn.open && conn.send(msg));
  const lane = fastLane(conn, lossy(late(on.data)), true);
  const fast = lossy(late((msg) => lane(msg) || (conn.open && conn.send(msg))));
  return { send, fast, route: () => route(conn), close: () => peer.destroy() };
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

// A plain connection to the broker, for the ratings.
export const openBroker = () => connectBroker({});

// Connections to every broker that answers, for the ratings: results are put on
// all of them and read back from all of them, so one broker being down for a
// while loses nothing. A broker that does not answer gets a second try (HiveMQ
// now and then never answers a connection). Rejects only if none answers.
export async function openBrokers() {
  await loadScript(MQTT_SRC, 'mqtt');
  const attempt = (url) =>
    new Promise((resolve, reject) => {
      const client = window.mqtt.connect(url, { connectTimeout: 6000 });
      client.once('connect', () => resolve(client));
      const fail = () => {
        client.end(true);
        reject(new Error('no broker'));
      };
      client.once('error', fail);
      client.once('offline', fail);
    });
  const tries = BROKERS.map((url) => attempt(url).catch(() => attempt(url)));
  const open = (await Promise.allSettled(tries)).filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!open.length) throw new Error('no broker');
  return open;
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
    locked: !!info.locked,
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
