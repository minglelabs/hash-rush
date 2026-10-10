// Peer-to-peer rooms over WebRTC, using PeerJS and its free public broker to
// introduce the browsers to each other. There is no game server: the host's
// browser runs the simulation and guests send inputs and receive snapshots.

const PEER_SRC = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const PREFIX = 'hashrush-';

// STUN lets two browsers find a direct route. That fails on some networks, mobile
// carriers above all, and then only a TURN relay can carry the traffic. PeerJS's
// own free relays no longer exist, so there is none here yet: add a
// { urls, username, credential } entry from a TURN provider to TURN_SERVERS.
const TURN_SERVERS = [];
const CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    ...TURN_SERVERS,
  ],
};
let loading = null;

function loadPeer() {
  if (window.Peer) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PEER_SRC;
      s.onload = resolve;
      s.onerror = () => {
        loading = null;
        reject(new Error('could not load PeerJS'));
      };
      document.head.append(s);
    });
  }
  return loading;
}

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
