// The browser's side of the ratings (see rating.js): its own signing key and match
// history in local storage, and the signed results and names on the public broker.

import { newIdentity, openIdentity, resultText, signedResults, rate, verify, pidOf, ELO } from './rating.js';
import { openBroker } from './net.js';

const KEY_STORE = 'hashrush.identity';
const HISTORY_STORE = 'hashrush.history';
const RATING_STORE = 'hashrush.rating';
const TOPIC = 'minglelabs/hash-rush/v1/rank';
const HISTORY_MAX = 200;
const PID = /^[A-Za-z0-9_-]{16}$/;

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the record just is not kept.
  }
};

// This browser's identity, made the first time and kept from then on. Null where
// the browser cannot sign (no WebCrypto, e.g. a page not served over https).
let identityPromise = null;
export function identity() {
  identityPromise ||= (async () => {
    try {
      const saved = read(KEY_STORE, null);
      if (saved) return await openIdentity(saved);
    } catch {
      // A broken key is replaced below.
    }
    try {
      const made = await newIdentity();
      write(KEY_STORE, made.saved);
      return made.identity;
    } catch {
      return null;
    }
  })();
  return identityPromise;
}

// ---------- this browser's record ----------

export const history = () => read(HISTORY_STORE, []);

// One finished round as this player saw it: { at, map, team, won, rated, with: [names] }.
export function remember(entry) {
  write(HISTORY_STORE, [entry, ...history()].slice(0, HISTORY_MAX));
}

// The rating as last worked out, for showing before the broker answers.
export const lastRating = () => read(RATING_STORE, { elo: ELO.start, games: 0, wins: 0 });

// ---------- the broker ----------

async function publish(topic, payload) {
  const client = await openBroker();
  await new Promise((resolve) => client.publish(topic, payload, { retain: true, qos: 1 }, resolve));
  client.end();
}

// Puts this player's current name up, signed, so the ranking shows it. A new name
// replaces the old one; the record stays with the key.
let nameTimer = 0;
let lastName = null;
export function shareName(name) {
  const clean = String(name || '').trim().slice(0, 8);
  if (!clean || clean === lastName) return;
  clearTimeout(nameTimer);
  nameTimer = setTimeout(async () => {
    const me = await identity();
    if (!me) return;
    const body = JSON.stringify({ pid: me.pid, pub: me.pub, name: clean, at: Date.now() });
    try {
      await publish(`${TOPIC}/p/${me.pid}`, JSON.stringify({ b: body, s: await me.sign(body) }));
      lastName = clean;
    } catch {
      // Tried again next time the name is set.
    }
  }, 1500);
}

// Signs a finished round and puts the signature up. `players` are the people in
// it: { pid, pub, won }. It counts once all of them have done the same.
export async function signResult(match) {
  const me = await identity();
  if (!me || !match.players.some((p) => p.pid === me.pid)) return;
  const text = resultText(match);
  try {
    await publish(`${TOPIC}/m/${match.id}/${me.pid}`, JSON.stringify({ r: text, s: await me.sign(text) }));
  } catch {
    // Without the broker this round goes unrated.
  }
}

// Everything on the broker, checked and worked out: the table, best first, with
// names, and this player's own row. Rejects if no broker can be reached.
export async function loadRanking() {
  const client = await openBroker();
  const sigs = [];
  const names = new Map();
  client.on('message', (topic, payload) => {
    const parts = topic.slice(TOPIC.length + 1).split('/');
    let data;
    try {
      data = JSON.parse(payload.toString());
    } catch {
      return;
    }
    if (parts[0] === 'm' && parts.length === 3 && typeof data.r === 'string' && typeof data.s === 'string') {
      sigs.push({ mid: parts[1], pid: parts[2], text: data.r, sig: data.s });
    } else if (parts[0] === 'p' && PID.test(parts[1]) && typeof data.b === 'string') {
      names.set(parts[1], data);
    }
  });
  // Retained messages arrive right after subscribing; give them time to come in.
  await new Promise((resolve) => client.subscribe([`${TOPIC}/m/+/+`, `${TOPIC}/p/+`], () => setTimeout(resolve, 2500)));
  client.end(true);

  const table = rate(await signedResults(sigs));
  // A name counts if the key it belongs to signed it.
  const named = new Map();
  for (const [pid, { b, s }] of names) {
    let body;
    try {
      body = JSON.parse(b);
    } catch {
      continue;
    }
    if (body.pid !== pid || typeof body.name !== 'string' || typeof body.pub !== 'string') continue;
    if ((await pidOf(body.pub)) !== pid || !(await verify(body.pub, b, s))) continue;
    named.set(pid, body.name.slice(0, 8));
  }
  const me = await identity();
  // People go by their newest name. Two keys with the same name are told apart by
  // number, in the order they first turned up: Nam, Nam2, Nam3. Computers go by level.
  const taken = new Map();
  const label = new Map();
  for (const p of [...table].filter((q) => !q.bot).sort((a, b) => a.since - b.since)) {
    const name = named.get(p.pid) || '?';
    const n = (taken.get(name) || 0) + 1;
    taken.set(name, n);
    label.set(p.pid, n > 1 ? `${name}${n}` : name);
  }
  const rows = table.map((p, i) => ({ ...p, rank: i + 1, level: p.bot ? p.pid.slice(4) : '', name: p.bot ? '' : label.get(p.pid), me: !!me && p.pid === me.pid }));
  const mine = rows.find((r) => r.me) || null;
  if (mine) write(RATING_STORE, { elo: mine.elo, games: mine.games, wins: mine.wins });
  return { rows, mine };
}
