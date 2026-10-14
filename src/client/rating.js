// Elo ratings without a server or a login. Each browser makes itself a signing key
// and that key is the player: its id is a hash of the public half. When a round
// ends, every person in it signs the same result and puts the signature on the
// public broker. A result counts once every person in it has signed it, and
// everyone works the ratings out for themselves from the same signed results.
//
// Computers are rated too, one entry per level: every hard bot is "the hard bot".
// A round with only one person in it is that person's word alone, so those count
// for less: a few a day at most.
//
// Nothing here touches the page or the network: it runs in Node for the tests.

export const ELO = { start: 1000, k: 32 };
// The same people playing each other over and over count this many times a day.
// Past that, a pair of accounts cannot farm points off each other.
export const DAILY = 5;
// Rounds a day that count for one person playing only against computers.
export const SOLO_DAILY = 10;
// The computers' entries in a result and in the table.
export const BOT_LEVELS = ['easy', 'normal', 'hard', 'ace', 'rl'];
export const isBot = (id) => typeof id === 'string' && id.startsWith('bot:') && BOT_LEVELS.includes(id.slice(4));

const subtle = () => globalThis.crypto.subtle;
const ALGO = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

const toB64 = (bytes) => {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64 = (text) => {
  const s = atob(String(text).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};
const utf8 = (text) => new TextEncoder().encode(text);

// A player's id: the first 16 characters of the hash of its public key.
export async function pidOf(pub) {
  return toB64(await subtle().digest('SHA-256', fromB64(pub))).slice(0, 16);
}

// A new identity, and what has to be kept to have it again (plain JSON).
export async function newIdentity() {
  const keys = await subtle().generateKey(ALGO, true, ['sign', 'verify']);
  const saved = { priv: await subtle().exportKey('jwk', keys.privateKey), pub: toB64(await subtle().exportKey('raw', keys.publicKey)) };
  return { saved, identity: await openIdentity(saved) };
}

// An identity from what was kept. Throws if it is not one.
export async function openIdentity(saved) {
  const key = await subtle().importKey('jwk', saved.priv, ALGO, false, ['sign']);
  const pub = String(saved.pub);
  return {
    pub,
    pid: await pidOf(pub),
    sign: async (text) => toB64(await subtle().sign(SIGN, key, utf8(text))),
  };
}

export async function verify(pub, text, sig) {
  try {
    const key = await subtle().importKey('raw', fromB64(pub), ALGO, false, ['verify']);
    return await subtle().verify(SIGN, key, fromB64(sig), utf8(text));
  } catch {
    return false;
  }
}

const PID = /^[A-Za-z0-9_-]{16}$/;
const PUB = /^[A-Za-z0-9_-]{80,100}$/;
const MID = /^[a-z0-9]{8,20}$/;

// The text everybody in a round signs. `players` are who took part: { pid, pub, won }
// for a person, { pid: 'bot:hard', won } for a computer. Computers of one level
// are one entry, which won if any of them did.
export function resultText({ id, at, map, team, players }) {
  const merged = new Map();
  for (const q of players) {
    const was = merged.get(q.pid);
    merged.set(q.pid, { pid: q.pid, pub: isBot(q.pid) ? '' : q.pub, won: !!q.won || !!was?.won });
  }
  const p = [...merged.values()].sort((a, b) => (a.pid < b.pid ? -1 : 1)).map((q) => [q.pid, q.pub, q.won ? 1 : 0]);
  return JSON.stringify({ v: 1, id, at: Math.round(at), map: String(map), team: team ? 1 : 0, p });
}

// A result as read back, or null if it is not one.
export function readResult(text) {
  let r;
  try {
    r = JSON.parse(text);
  } catch {
    return null;
  }
  if (!r || r.v !== 1 || !MID.test(r.id) || !Number.isFinite(r.at) || !Array.isArray(r.p)) return null;
  if (r.p.length < 2 || r.p.length > 8) return null;
  const ok = (q) => Array.isArray(q) && (q[2] === 0 || q[2] === 1) && ((PID.test(q[0]) && PUB.test(q[1])) || (isBot(q[0]) && q[1] === ''));
  if (!r.p.every(ok) || !r.p.some((q) => !isBot(q[0]))) return null;
  if (new Set(r.p.map((q) => q[0])).size !== r.p.length) return null;
  // It has to be exactly the text that was signed.
  if (resultText({ id: r.id, at: r.at, map: r.map, team: r.team, players: r.p.map(([pid, pub, won]) => ({ pid, pub, won })) }) !== text) return null;
  return { id: r.id, at: r.at, map: r.map, team: !!r.team, players: r.p.map(([pid, pub, won]) => ({ pid, pub, won: !!won })) };
}

// Signatures as they come off the broker, { mid, pid, text, sig }, to the results
// that everybody in them has signed. Anything forged, partial or odd is left out.
export async function signedResults(sigs, now = Date.now()) {
  const byMatch = new Map();
  for (const s of sigs) {
    if (!byMatch.has(s.mid)) byMatch.set(s.mid, []);
    byMatch.get(s.mid).push(s);
  }
  const out = [];
  for (const [mid, list] of byMatch) {
    const r = readResult(list[0].text);
    // From the future by more than a clock can be off: made up.
    if (!r || r.id !== mid || r.at > now + 60 * 60 * 1000) continue;
    let ok = true;
    for (const p of r.players) {
      if (isBot(p.pid)) continue;
      if ((await pidOf(p.pub)) !== p.pid) {
        ok = false;
        break;
      }
      const mine = list.find((s) => s.pid === p.pid && s.text === list[0].text);
      if (!mine || !(await verify(p.pub, mine.text, mine.sig))) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(r);
  }
  return out;
}

// Ratings from signed results, oldest first. Every winner gains against every
// loser in the round, on the usual Elo sum, scaled so a round is worth about one
// game whatever the number of people in it. A round everybody won (time ran out
// level) changes nothing but the count of games.
export function rate(results) {
  const table = new Map();
  const row = (pid, at) => {
    // `since` is when it first turned up: the order the ranking numbers repeated names in.
    if (!table.has(pid)) table.set(pid, { pid, elo: ELO.start, games: 0, wins: 0, since: at, bot: isBot(pid) });
    return table.get(pid);
  };
  const seen = new Map();
  const sorted = [...results].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  for (const r of sorted) {
    const day = Math.floor(r.at / 86400000);
    const key = `${day}:${r.players.map((p) => p.pid).sort().join(',')}`;
    seen.set(key, (seen.get(key) || 0) + 1);
    if (seen.get(key) > DAILY) continue;
    const people = r.players.filter((p) => !isBot(p.pid));
    if (people.length === 1) {
      const solo = `${day}:solo:${people[0].pid}`;
      seen.set(solo, (seen.get(solo) || 0) + 1);
      if (seen.get(solo) > SOLO_DAILY) continue;
    }
    const winners = r.players.filter((p) => p.won).map((p) => row(p.pid, r.at));
    const losers = r.players.filter((p) => !p.won).map((p) => row(p.pid, r.at));
    for (const p of [...winners, ...losers]) p.games++;
    for (const p of winners) p.wins++;
    if (!winners.length || !losers.length) continue;
    // Each winner and loser trade points as in a one-on-one, divided by the number
    // of others in the round: what one gains another loses.
    const before = new Map([...winners, ...losers].map((p) => [p, p.elo]));
    const share = ELO.k / (r.players.length - 1);
    for (const w of winners) {
      for (const l of losers) {
        const step = share * (1 - 1 / (1 + 10 ** ((before.get(l) - before.get(w)) / 400)));
        w.elo += step;
        l.elo -= step;
      }
    }
  }
  return [...table.values()].map((p) => ({ ...p, elo: Math.round(p.elo) })).sort((a, b) => b.elo - a.elo || b.games - a.games);
}
