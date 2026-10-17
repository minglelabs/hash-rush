// The browser's side of the ratings (see rating.js): its own signing key and match
// history in local storage, and the signed results and names on the public broker.

import { newIdentity, openIdentity, resultText, signedResults, rate, verify, pidOf, ELO } from './rating.js';
import { openBrokers } from './net.js';

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

export async function publish(topic, payload) {
  const clients = await openBrokers();
  await Promise.all(clients.map((c) => new Promise((resolve) => c.publish(topic, payload, { retain: true, qos: 1 }, resolve))));
  for (const c of clients) c.end();
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

const stamp = (data) => {
  try {
    return Number(JSON.parse(data.b).at) || 0;
  } catch {
    return 0;
  }
};

// What this browser has seen on the brokers, kept as it came: { topic: payload }.
// A public broker may forget everything it holds (one did), and either may be out
// of reach for a while; whatever any one browser kept, it puts back.
const SEEN_STORE = 'hashrush.seen';
const SEEN_MAX = 4000;

// Everything on the brokers and in this browser, checked and worked out: the
// table, best first, with names, and this player's own row. Whatever checked out
// and a broker was missing is put back on it. Rejects if no broker can be reached.
export async function loadRanking() {
  const clients = await openBrokers();
  const sigs = new Map();
  const names = new Map();
  const raw = new Map();
  const had = clients.map(() => new Map());
  const heard = (topic, payload) => {
    if (!topic.startsWith(`${TOPIC}/`)) return;
    const parts = topic.slice(TOPIC.length + 1).split('/');
    const text = payload.toString();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return;
    }
    if (parts[0] === 'm' && parts.length === 3 && typeof data.r === 'string' && typeof data.s === 'string') {
      // The same signature off two brokers is one signature.
      sigs.set(topic, { mid: parts[1], pid: parts[2], text: data.r, sig: data.s });
      raw.set(topic, text);
    } else if (parts[0] === 'p' && parts.length === 2 && PID.test(parts[1]) && typeof data.b === 'string') {
      // Two brokers may hold different versions of a name: the newest counts.
      const was = names.get(parts[1]);
      if (!was || stamp(data) > stamp(was)) {
        names.set(parts[1], data);
        raw.set(topic, text);
      }
    }
  };
  for (const [topic, payload] of Object.entries(read(SEEN_STORE, {}))) heard(topic, payload);
  // Retained messages arrive right after subscribing; give them time to come in.
  await Promise.all(
    clients.map((c, i) => {
      c.on('message', (topic, payload) => {
        had[i].set(topic, payload.toString());
        heard(topic, payload);
      });
      return new Promise((resolve) => c.subscribe([`${TOPIC}/m/+/+`, `${TOPIC}/p/+`], () => setTimeout(resolve, 2500)));
    }),
  );

  const results = await signedResults([...sigs.values()]);
  const table = rate(results);
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
  // What checked out is kept here and put back where it is missing: every
  // signature of a counted round, and every name its own key signed.
  const counted = new Set(results.map((r) => r.id));
  const good = [...raw.keys()].filter((topic) => {
    const parts = topic.slice(TOPIC.length + 1).split('/');
    return parts[0] === 'm' ? counted.has(parts[1]) : named.has(parts[1]);
  });
  write(SEEN_STORE, Object.fromEntries(good.slice(-SEEN_MAX).map((topic) => [topic, raw.get(topic)])));
  heal(clients, had, good.map((topic) => [topic, raw.get(topic)]));

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

// Puts back on each broker what it was missing, then lets go of it. A few hundred
// at most per visit; whoever comes next carries on.
const HEAL_MAX = 300;
function heal(clients, had, good) {
  clients.forEach((c, i) => {
    // Missing, or holding an older name than the one that counts.
    const missing = good.filter(([topic, payload]) => had[i].get(topic) !== payload).slice(0, HEAL_MAX);
    Promise.all(missing.map(([topic, payload]) => new Promise((resolve) => c.publish(topic, payload, { retain: true, qos: 1 }, resolve)))).finally(() => c.end());
  });
}
