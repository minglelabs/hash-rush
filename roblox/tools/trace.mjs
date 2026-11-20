// Plays meadow free-for-all rounds in the web game and writes down what the
// learned bot saw and chose, for roblox/test/crosscheck.luau to replay in the
// Roblox sim and compare. Also writes the web game's map, tuning values and
// walking distances for roblox/test/parity.luau.
//   node roblox/tools/trace.mjs
// It lives here and not in test/ because `node --test` runs every script in a
// folder called test.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, step, inHome, lastStretch } from '../../src/sim/game.js';
import { MAPS, MAP_IDS, WORLD } from '../../src/sim/map.js';
import * as constants from '../../src/sim/constants.js';
import { mulberry32 } from '../../src/sim/rng.js';
import { OBS, DIRS, REACTION_TICKS, observe, snapshot, fields } from '../../src/ai/observe.js';
import { decodePolicy, loadPolicy } from '../../src/ai/policy.js';
import { createRLBot, loadRLPolicy } from '../../src/ai/rl-bot.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'test', 'out');
mkdirSync(out, { recursive: true });
const MAP = MAPS.meadow;

// The web bot fetches its weights; here they come off the disk.
globalThis.fetch = async (url) => {
  const b = readFileSync(fileURLToPath(url));
  return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
};
const bin = readFileSync(join(here, '..', '..', 'src', 'ai', 'rl-solo.bin'));
const policy = loadPolicy(decodePolicy(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length)));

// A JSON value as a Luau literal.
const KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);
function lua(v) {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v !== 'object') return String(v);
  if (Array.isArray(v)) return `{ ${v.map(lua).join(', ')} }`;
  return `{ ${Object.entries(v).map(([k, x]) => `${/^[A-Za-z_]\w*$/.test(k) && !KEYWORDS.has(k) ? k : `[${JSON.stringify(k)}]`} = ${lua(x)}`).join(', ')} }`;
}
const base64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');

// ---------- the web game's map and numbers ----------

{
  const F = fields(MAP);
  const { gatherTime, pickTime, ...numbers } = constants;
  const web = {
    world: WORLD,
    mapIndex: MAP_IDS.indexOf(MAP.id),
    maps: MAP_IDS.length,
    constants: numbers,
    gatherTime: [[2, 0], [4, 0], [5, 30], [8, 55], [8, 80], [3, 104]].map(([n, t]) => [n, t, gatherTime(n, t), pickTime(n, t)]),
    map: { bounds: MAP.bounds, home: MAP.home, flower: MAP.flower, warps: MAP.warps, nests: MAP.nests, bigNests: MAP.bigNests, rects: MAP.rects, corner: MAP.corner, hazard: MAP.hazard, ice: MAP.ice, gates: MAP.gates, cycle: MAP.cycle },
    dirs: DIRS,
    reaction: REACTION_TICKS,
    obs: OBS,
    fields: { cols: F.cols, rows: F.rows, free: Array.from(F.free).join(''), flower: base64(F.flower), home: base64(F.home), warp: base64(F.warp) },
  };
  writeFileSync(join(out, 'web.luau'), `return ${lua(web)}\n`);
}

// ---------- rounds ----------

// A seat that wanders: holds a direction for a while, swings and winds up a
// throw now and then. It is here to be seen by the learned bots, not to win.
function wanderer(seed) {
  const random = mulberry32(seed);
  let dir = 0;
  let left = 0;
  let hold = 0;
  return () => {
    if (left-- <= 0) {
      dir = Math.floor(random() * 9);
      left = 5 + Math.floor(random() * 50);
    }
    if (hold > 0) hold--;
    else if (random() < 0.02) hold = 10 + Math.floor(random() * 110);
    return { dir, bonk: random() < 0.04, throw: hold > 0 };
  };
}

// rl-bot.js again, with the late view kept here so that a seat can leave the
// round (the web game has no such thing; see `leave`). Where nobody leaves it is
// checked against the real createRLBot, choice by choice.
function mirror(seed) {
  const random = mulberry32(seed);
  const every = policy.meta.frameSkip || 4;
  const mine = new Float32Array(8 * OBS);
  let choice = null;
  let tick = 0;
  return (g, id, then) => {
    const fresh = tick++ % every === 0;
    if (fresh || !choice) {
      observe(g, mine, 0, then, id);
      choice = policy.act(mine.subarray(id * OBS, (id + 1) * OBS), policy.meta.temperature ?? 1, random);
    }
    return { dir: choice[0], bonk: fresh && choice[1] === 1, throw: choice[2] === 1 };
  };
}

// Takes seat `k` out of the round as Roblox's Sim.remove does. The web game
// counts on a hamster's id being its place in the list, so the rest move up.
function leave(g, past, k) {
  const renumber = (id) => (id === k ? -1 : id > k ? id - 1 : id);
  g.players.splice(k, 1);
  for (const p of g.players) {
    p.id = renumber(p.id);
    if (p.pickOn >= 0) p.pickOn = renumber(p.pickOn);
  }
  g.nibbler = g.nibbler >= 0 ? renumber(g.nibbler) : -1;
  // And nobody sees it any more, not even late.
  for (const then of past) {
    then.players = then.players.filter((p) => p.id !== k);
    for (const p of then.players) p.id = renumber(p.id);
    then.nibbler = then.nibbler >= 0 ? renumber(then.nibbler) : -1;
  }
}

// Seats: R a learned bot, w a wanderer. `events(t, g)` returns what happens
// before tick t: { time } sets the clock, { remove } takes a seat out. Rounds
// where seats leave are played by the mirror alone.
const first = (pick) => {
  let done = false;
  return (t, g) => {
    if (done || g.phase !== 'playing') return [];
    const k = pick(t, g);
    if (k < 0) return [];
    done = true;
    return [{ remove: k }];
  };
};
const at = (table) => (t) => table[t] || [];
const both = (...fs) => (t, g) => fs.flatMap((f) => f(t, g));
const ROUNDS = [
  { name: 'four learned bots', seed: 1, seats: 'RRRR' },
  { name: 'two learned bots', seed: 2, seats: 'RR' },
  { name: 'eight learned bots', seed: 3, seats: 'RRRRRRRR' },
  { name: 'three learned bots and two wanderers', seed: 4, seats: 'RwRRw' },
  { name: 'six, mostly wanderers', seed: 5, seats: 'wRwwRw' },
  { name: 'four, the clock set to just before overtime', seed: 6, seats: 'RRRR', events: at({ 260: [{ time: 39.5 }] }) },
  { name: 'five, the clock set to well into overtime', seed: 7, seats: 'RRwRR', events: at({ 300: [{ time: 55 }] }) },
  { name: 'six, the clock set to just before the rush', seed: 8, seats: 'RRRRRR', events: at({ 240: [{ time: 69.5 }] }) },
  { name: 'three, the clock set to the rush', seed: 9, seats: 'RRR', events: at({ 200: [{ time: 80 }] }) },
  { name: 'four wanderers until time runs out', seed: 10, seats: 'wwww', events: at({ 400: [{ time: 60 }], 900: [{ time: 101 }] }) },
  { name: 'five, two leave', seed: 11, leaves: true, seats: 'RRRRR', events: at({ 420: [{ remove: 1 }], 700: [{ remove: 0 }] }) },
  { name: 'eight, down to four', seed: 12, leaves: true, seats: 'RRRwRRwR', events: at({ 250: [{ remove: 7 }], 251: [{ remove: 2 }], 600: [{ remove: 0 }, { remove: 0 }] }) },
  { name: 'four, whoever is nibbling leaves', seed: 13, leaves: true, seats: 'RRRR', events: first((t, g) => g.nibbler) },
  { name: 'five, whoever has a seed leaves', seed: 14, leaves: true, seats: 'RRRRR', events: first((t, g) => g.players.findIndex((p) => p.carrying)) },
  { name: 'six, a pickpocket\'s mark leaves, in overtime', seed: 15, leaves: true, seats: 'RRRRRR', events: both(at({ 200: [{ time: 41 }] }), first((t, g) => Math.max(-1, ...g.players.map((p) => p.pickOn)))) },
  { name: 'four, a pickpocket leaves', seed: 16, leaves: true, seats: 'RRRR', events: first((t, g) => g.players.findIndex((p) => p.pickOn >= 0 && p.pick > 0.1)) },
];
const EVERY = 7;
const AFTER = 12;
const LIMIT = 8000;

const SITUATIONS = ['countdown', 'carrying', 'last stretch', 'winding up a swing', 'after a swing', 'charging a throw', 'throw ready', 'nibbling', 'queued at the flower', 'picking a pocket', 'pocket being picked', 'may not pick yet', 'dazed', 'in overtime', 'in the rush', 'at home', 'sees a seed carrier', 'after someone left'];
const seen = Object.fromEntries(SITUATIONS.map((s) => [s, 0]));
let samples = 0;
let decisions = 0;

// createRLBot stands still until its weights are in.
loadRLPolicy();
await new Promise((r) => setTimeout(r, 100));

ROUNDS.forEach((round, index) => {
  const n = round.seats.length;
  const g = createGame({ slots: Array.from({ length: n }, (_, i) => ({ name: `h${i}`, kind: 'bot' })), map: MAP, seed: round.seed });
  const seats = [...round.seats].map((kind, i) => {
    const seed = round.seed * 100 + i;
    return kind === 'R' ? { kind, seed, think: mirror(seed), real: round.leaves ? null : createRLBot({ seed }) } : { kind, seed, think: wanderer(seed) };
  });
  const past = [];
  const ticks = [];
  const events = {};
  const parts = [];
  const put = (Type, values) => parts.push(Buffer.from(new Type(values).buffer));
  const row = new Float32Array(8 * OBS);
  let lastEvent = -Infinity;
  let left = false;
  let t = 0;
  for (; t < LIMIT && g.phase !== 'over'; t++) {
    const now = round.events ? round.events(t, g) : [];
    if (now.length) {
      events[t + 1] = now;
      lastEvent = t;
      for (const e of now) {
        if ('time' in e) g.time = e.time;
        else {
          leave(g, past, e.remove);
          seats.splice(e.remove, 1);
          left = true;
        }
      }
    }
    // The late view, as rl-bot.js keeps it.
    past.push(snapshot(g));
    if (past.length > REACTION_TICKS + 1) past.shift();
    const then = past[0];

    const inputs = [];
    let line = '';
    g.players.forEach((p, i) => {
      const seat = seats[i];
      const a = seat.kind === 'R' ? seat.think(g, i, then) : seat.think();
      if (seat.kind === 'R' && t % (policy.meta.frameSkip || 4) === 0) decisions++;
      if (seat.real) {
        const b = seat.real.think(g, i);
        if (b.mx !== DIRS[a.dir][0] || b.my !== DIRS[a.dir][1] || b.bonk !== a.bonk || b.throw !== a.throw) throw new Error(`round ${index + 1} tick ${t} seat ${i}: createRLBot chose otherwise`);
      }
      inputs[i] = { mx: DIRS[a.dir][0], my: DIRS[a.dir][1], bonk: a.bonk, throw: a.throw };
      line += String.fromCharCode(48 + a.dir + (a.bonk ? 9 : 0) + (a.throw ? 18 : 0));
    });

    const sampled = t % EVERY === 0 || t - lastEvent < AFTER;
    if (sampled) {
      put(Float64Array, [g.time, g.homeX]);
      g.players.forEach((p, i) => {
        observe(g, row, 0, then, i);
        const view = row.subarray(i * OBS, (i + 1) * OBS);
        put(Float64Array, [p.x, p.y]);
        put(Float32Array, view);
        put(Float32Array, policy.logits(view));
        samples++;
        const is = {
          countdown: g.phase === 'countdown',
          carrying: p.carrying,
          'last stretch': lastStretch(g, p),
          'winding up a swing': p.swing?.phase === 'windup',
          'after a swing': p.swing?.phase === 'recovery',
          'charging a throw': p.charge > 0,
          'throw ready': p.charge >= constants.THROW.charge,
          nibbling: g.nibbler === p.id,
          'queued at the flower': p.queued >= 0 && g.nibbler !== p.id,
          'picking a pocket': p.pick > 0,
          'pocket being picked': view[OBS - 9] > 0,
          'may not pick yet': p.pickBlock > 0,
          dazed: p.dazed > 0,
          'in overtime': g.time > constants.OVERTIME.start,
          'in the rush': g.time > constants.OVERTIME.rush,
          'at home': inHome(g, p),
          'sees a seed carrier': view[OBS - 26] > 0,
          'after someone left': left,
        };
        for (const s of SITUATIONS) if (is[s]) seen[s]++;
      });
    }
    ticks.push((sampled ? 'S' : '.') + line);
    step(g, inputs);
  }
  const trace = {
    name: round.name,
    seed: round.seed,
    seats: [...round.seats].map((kind, i) => ({ learned: kind === 'R', seed: round.seed * 100 + i })),
    events,
    ticks,
    last: { tick: g.tick, phase: g.phase, time: g.time, timeout: g.timeout, winners: [...g.winners].sort((a, b) => a - b), places: g.players.flatMap((p) => [p.x, p.y]) },
    samples: Buffer.concat(parts).toString('base64'),
  };
  writeFileSync(join(out, `round${String(index + 1).padStart(2, '0')}.luau`), `return ${lua(trace)}\n`);
  console.log(`round ${index + 1}: ${round.name}: ${t} ticks, ${g.timeout ? 'time ran out' : g.phase === 'over' ? `seat ${g.winner} home` : 'cut short'}, time ${g.time.toFixed(1)}`);
});

writeFileSync(join(out, 'rounds.luau'), `return ${ROUNDS.length}\n`);
console.log(`${ROUNDS.length} rounds, ${samples} observations to compare, ${decisions} choices by learned bots`);
console.log('what the compared observations cover:');
for (const s of SITUATIONS) console.log(`  ${String(seen[s]).padStart(6)}  ${s}`);
