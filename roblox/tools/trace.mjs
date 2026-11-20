// Plays meadow rounds in the web game, free-for-all and in teams, and writes
// down what the learned bot saw and chose, for roblox/test/crosscheck.luau to replay in the
// Roblox sim and compare. Also writes the web game's map, tuning values and
// walking distances for roblox/test/parity.luau.
//   node roblox/tools/trace.mjs
// It lives here and not in test/ because `node --test` runs every script in a
// folder called test.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, step, inHome, lastStretch, allied } from '../../src/sim/game.js';
import { MAPS, MAP_IDS, WORLD, segmentClear, isFree } from '../../src/sim/map.js';
import * as constants from '../../src/sim/constants.js';
import { mulberry32 } from '../../src/sim/rng.js';
import { OBS, DIRS, REACTION_TICKS, observe, snapshot, fields, jobs } from '../../src/ai/observe.js';
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
const weights = (file) => {
  const bin = readFileSync(join(here, '..', '..', 'src', 'ai', file));
  return loadPolicy(decodePolicy(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length)));
};
// As rl-bot.js picks them: the team weights for a hamster in a team.
const policies = { solo: weights('rl-solo.bin'), team: weights('rl-team.bin') };
const policyOf = (p) => (p.team >= 0 ? policies.team : policies.solo);

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

// Does what seat `id` sees hang on a rounding? Two rivals pressed against the
// flower are as near it as each other, and which of them a guard watches is
// settled by the last bit of where they stand. The Roblox sim stands them a
// rounding elsewhere (it counts in studs), so there it can fall the other way.
// The seat is shown the round again with everyone nudged a billionth of a pixel:
// if a number moves by more than that explains, it hangs on one. Hamsters on
// their nests are left be: the Roblox bot knows those places to the bit.
const noise = mulberry32(20261120);
const nudged = new Float32Array(8 * OBS);
function fickle(g, then, id, view) {
  const nudge = (p) => (p.x === p.nest.x && p.y === p.nest.y ? p : { ...p, x: p.x + (noise() - 0.5) * 2e-9, y: p.y + (noise() - 0.5) * 2e-9 });
  for (let trial = 0; trial < 6; trial++) {
    observe({ ...g, players: g.players.map(nudge) }, nudged, 0, { ...then, players: then.players.map(nudge) }, id);
    for (let k = 0; k < OBS; k++) if (Math.abs(nudged[id * OBS + k] - view[k]) > 1e-6) return true;
  }
  return false;
}

// rl-bot.js again, with the late view kept here so that a seat can leave the
// round (the web game has no such thing; see `leave`). Where nobody leaves it is
// checked against the real createRLBot, choice by choice.
function mirror(seed) {
  const random = mulberry32(seed);
  const mine = new Float32Array(8 * OBS);
  let choice = null;
  let loose = false;
  let tick = 0;
  return (g, id, then) => {
    const policy = policyOf(g.players[id]);
    const fresh = tick++ % (policy.meta.frameSkip || 4) === 0;
    if (fresh || !choice) {
      observe(g, mine, 0, then, id);
      const view = mine.subarray(id * OBS, (id + 1) * OBS);
      choice = policy.act(view, policy.meta.temperature ?? 1, random);
      loose = fickle(g, then, id, view);
    }
    // `loose`: the choice was made on a view that hangs on a rounding.
    return { dir: choice[0], bonk: fresh && choice[1] === 1, throw: choice[2] === 1, loose };
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

// A clear stretch of meadow, 150 px from left to right, away from home, the
// flower and the tunnels: somewhere to stand hamsters in a row.
function stretch() {
  const clear = (x, y) => x > MAP.home.x2 + 40 && isFree(MAP, x, y, constants.HAMSTER_R + 4) && Math.hypot(x - MAP.flower.x, y - MAP.flower.y) > MAP.flower.gatherR + 20 && MAP.warps.every((w) => Math.hypot(x - w.x, y - w.y) > w.r + constants.HAMSTER_R + 5);
  for (let y = 40; y < WORLD.h - 40; y += 10) {
    for (let x = 40; x < WORLD.w - 190; x += 10) {
      let ok = true;
      for (let dx = -10; dx <= 140 && ok; dx += 5) for (const dy of [-12, 0, 12]) ok &&= clear(x + dx, y + dy);
      if (ok) return { x, y };
    }
  }
  throw new Error('the meadow has no clear stretch');
}
const ROW = stretch();
const stand = (...spots) => spots.map(([dx, dy], seat) => ({ place: [seat, ROW.x + dx, ROW.y + dy] }));

// Seats: R a learned bot, w a wanderer, p a puppet that presses what the round's
// `script(seat, t)` says. Teams: each seat's side, or - for a seat on its own;
// left out, the round is a free-for-all. `events(t, g)` returns what happens
// before tick t: { time } sets the clock, { remove } takes a seat out,
// { place } stands a seat somewhere and { seed } hands it a seed. Rounds where
// seats leave are played by the mirror alone.
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
  { name: 'teams: two against two', seed: 17, seats: 'RRRR', teams: '0011' },
  { name: 'teams: three against three', seed: 18, seats: 'RRRRRR', teams: '010101' },
  { name: 'teams: four against four', seed: 19, seats: 'RRRRRRRR', teams: '00110101' },
  { name: 'teams: two against one', seed: 20, seats: 'RRR', teams: '010' },
  { name: 'teams: three against two, two wanderers', seed: 21, seats: 'RwRRw', teams: '00101' },
  { name: 'teams: four against four, mostly wanderers', seed: 22, seats: 'wRwwRwRw', teams: '01100110' },
  { name: 'teams: three sides of two', seed: 23, seats: 'RRRRRR', teams: '012201' },
  // The web lobby deals everyone a side; the sim and the bot take this too.
  { name: 'teams: two against two and one on its own', seed: 24, seats: 'RRRRR', teams: '01-10' },
  { name: 'teams: 2v2, the clock set to just before overtime', seed: 25, seats: 'RRRR', teams: '0101', events: at({ 260: [{ time: 39.5 }] }) },
  { name: 'teams: 3v3, the clock set to well into overtime', seed: 26, seats: 'RRwRRR', teams: '001011', events: at({ 300: [{ time: 55 }] }) },
  { name: 'teams: 3v3, the clock set to just before the rush', seed: 27, seats: 'RRRRRR', teams: '011010', events: at({ 240: [{ time: 69.5 }] }) },
  { name: 'teams: 2v2, the clock set to the rush', seed: 28, seats: 'RRRR', teams: '0110', events: at({ 200: [{ time: 80 }] }) },
  { name: 'teams: 3v2 wanderers until time runs out', seed: 29, seats: 'wwwww', teams: '01010', events: at({ 400: [{ time: 60 }], 900: [{ time: 101 }] }) },
  { name: 'teams: 4v4 wanderers and bots until time runs out', seed: 30, seats: 'wRwwwwRw', teams: '00110011', events: at({ 300: [{ time: 50 }], 700: [{ time: 101.5 }] }) },
  { name: 'teams: 3v3, one of each side leaves', seed: 31, leaves: true, seats: 'RRRRRR', teams: '010101', events: at({ 420: [{ remove: 1 }], 700: [{ remove: 0 }] }) },
  { name: 'teams: 4v4, down to three against one', seed: 32, leaves: true, seats: 'RRRwRRwR', teams: '01010101', events: at({ 250: [{ remove: 7 }], 251: [{ remove: 3 }], 600: [{ remove: 1 }, { remove: 0 }] }) },
  { name: 'teams: 2v2, a seed carrier\'s team-mate leaves', seed: 33, leaves: true, seats: 'RRRR', teams: '0011', events: first((t, g) => g.players.findIndex((p) => g.players.some((q) => q !== p && q.carrying && allied(q, p)))) },
  { name: 'teams: 3v3, whoever has a seed leaves', seed: 34, leaves: true, seats: 'RRRRRR', teams: '001101', events: first((t, g) => g.players.findIndex((p) => p.carrying)) },
  { name: 'teams: 3v3, a carrier\'s marker leaves', seed: 35, leaves: true, seats: 'RRRRRR', teams: '010011', events: first((t, g) => jobs(g).findIndex((j) => j.job === 'mark')) },
  { name: 'teams: 3v3, a pickpocket\'s mark leaves, in overtime', seed: 36, leaves: true, seats: 'RRRRRR', teams: '011001', events: both(at({ 200: [{ time: 41 }] }), first((t, g) => Math.max(-1, ...g.players.map((p) => p.pickOn)))) },
  { name: 'teams: 2v2, whoever is nibbling leaves', seed: 37, leaves: true, seats: 'RRRR', teams: '0101', events: first((t, g) => g.nibbler) },
  // Seat 0 throws a seed down a row of its team-mate and two rivals, then bonks
  // the two rivals standing in each other, and its side takes the round on time.
  {
    name: 'teams: staged, a throw past a team-mate, a clump bonked',
    seed: 38,
    seats: 'pppp',
    teams: '0011',
    script: (seat, t) => ({ dir: 0, bonk: seat === 0 && t === 300, throw: seat === 0 && t >= 200 && t <= 230 }),
    events: at({
      200: [...stand([0, 0], [40, 0], [80, 0], [115, 0]), { seed: 0 }],
      300: stand([0, 0], [4, 0], [36, 0], [40, 8]),
      400: [{ time: 104.9 }],
    }),
  },
];
const EVERY = 7;
const AFTER = 12;
const LIMIT = 8000;

// Where the parts of an observation added for team play start (observe.js).
const TEAM = OBS - 31;
const MATE = OBS - 21;
const GUARD = OBS - 5;
const TEAM_SITUATIONS = ['in a team', 'on its own among teams', 'attack job', 'mark job', 'guard job', 'marking a rival with a seed', 'guarding against a rival', 'a team-mate has a seed', 'has a team-mate', 'left without a team-mate', 'standing inside a team-mate', 'team-mate after the same rival', 'a rival seed to cut off', 'a team-mate nearer that seed', 'a rival at a team-mate\'s pocket'];
const HAPPENINGS = ['bonks landed', 'bonks that took a clump of team-mates', 'hamsters down in those clumps', 'seeds thrown', 'seeds thrown past a team-mate on the line', 'rounds won by a team\'s seed', 'rounds a side took on time'];
const happened = Object.fromEntries(HAPPENINGS.map((s) => [s, 0]));
const SITUATIONS = ['countdown', 'carrying', 'last stretch', 'winding up a swing', 'after a swing', 'charging a throw', 'throw ready', 'nibbling', 'queued at the flower', 'picking a pocket', 'pocket being picked', 'may not pick yet', 'dazed', 'in overtime', 'in the rush', 'at home', 'sees a seed carrier', 'after someone left', ...TEAM_SITUATIONS];
const seen = Object.fromEntries(SITUATIONS.map((s) => [s, 0]));
let samples = 0;
let hanging = 0;
let decisions = 0;

// createRLBot stands still until its weights are in.
loadRLPolicy();
await new Promise((r) => setTimeout(r, 100));

ROUNDS.forEach((round, index) => {
  const n = round.seats.length;
  const side = (i) => (round.teams && round.teams[i] !== '-' ? Number(round.teams[i]) : -1);
  const g = createGame({ slots: Array.from({ length: n }, (_, i) => ({ name: `h${i}`, kind: 'bot', team: side(i) })), map: MAP, seed: round.seed });
  const seats = [...round.seats].map((kind, i) => {
    const seed = round.seed * 100 + i;
    if (kind === 'R') return { kind, seed, think: mirror(seed), real: round.leaves ? null : createRLBot({ seed }) };
    return { kind, seed, think: kind === 'p' ? (t) => round.script(i, t) : wanderer(seed) };
  });
  const past = [];
  const ticks = [];
  const events = {};
  const parts = [];
  const put = (Type, values) => parts.push(Buffer.from(new Type(values).buffer));
  const row = new Float32Array(8 * OBS);
  const sums = [];
  let clumps = 0;
  let felled = 0;
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
        else if ('place' in e) Object.assign(g.players[e.place[0]], { x: e.place[1], y: e.place[2] });
        else if ('seed' in e) g.players[e.seed].carrying = true;
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
      const a = seat.kind === 'R' ? seat.think(g, i, then) : seat.think(t);
      if (seat.kind === 'R' && t % (policyOf(p).meta.frameSkip || 4) === 0) decisions++;
      if (seat.real) {
        const b = seat.real.think(g, i);
        if (b.mx !== DIRS[a.dir][0] || b.my !== DIRS[a.dir][1] || b.bonk !== a.bonk || b.throw !== a.throw) throw new Error(`round ${index + 1} tick ${t} seat ${i}: createRLBot chose otherwise`);
      }
      inputs[i] = { mx: DIRS[a.dir][0], my: DIRS[a.dir][1], bonk: a.bonk, throw: a.throw };
      line += String.fromCharCode(48 + a.dir + (a.bonk ? 9 : 0) + (a.throw ? 18 : 0) + (a.loose ? 36 : 0));
    });

    const sampled = t % EVERY === 0 || t - lastEvent < AFTER;
    if (sampled) {
      put(Float64Array, [g.time, g.homeX]);
      g.players.forEach((p, i) => {
        observe(g, row, 0, then, i);
        const view = row.subarray(i * OBS, (i + 1) * OBS);
        const loose = fickle(g, then, i, view);
        if (loose) hanging++;
        put(Float64Array, [p.x, p.y, loose ? 1 : 0]);
        put(Float32Array, view);
        put(Float32Array, policyOf(p).logits(view));
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
          'in a team': p.team >= 0,
          'on its own among teams': p.team < 0 && !!round.teams,
          'attack job': view[TEAM] > 0,
          'mark job': view[TEAM + 1] > 0,
          'guard job': view[TEAM + 2] > 0,
          'marking a rival with a seed': view[TEAM + 1] > 0 && view[TEAM + 5] > 0,
          'guarding against a rival': view[TEAM + 2] > 0 && view[TEAM + 5] > 0,
          'a team-mate has a seed': view[TEAM + 3] > 0,
          'has a team-mate': view[MATE] > 0,
          'left without a team-mate': p.team >= 0 && view[MATE] === 0,
          'standing inside a team-mate': g.players.some((q) => q !== p && allied(q, p) && Math.hypot(q.x - p.x, q.y - p.y) < 2 * constants.HAMSTER_R),
          'team-mate after the same rival': view[MATE + 4] > 0,
          'a rival seed to cut off': p.team >= 0 && view[MATE + 7] > 0,
          'a team-mate nearer that seed': view[MATE + 8] > 0,
          'a rival at a team-mate\'s pocket': view[GUARD] > 0,
        };
        for (const s of SITUATIONS) if (is[s]) seen[s]++;
      });
    }
    ticks.push((sampled ? 'S' : '.') + line);
    // Where everyone is, in one number per tick: the two sims are held to it.
    sums.push(g.players.reduce((sum, p, i) => sum + (i + 1) * (p.x + 2 * p.y), 0));
    step(g, inputs);

    // What the tick did: a throw's bonks follow it, a swing's come before its impact.
    let thrown = 0;
    let run = 0;
    for (const e of g.events) {
      if (e.type === 'throw') {
        thrown = e.hit;
        happened['seeds thrown']++;
        const a = g.players[e.id];
        const through = (v) => {
          const along = (v.x - e.x) * e.dx + (v.y - e.y) * e.dy;
          return along >= 0 && along <= constants.THROW.range && Math.abs((v.x - e.x) * e.dy - (v.y - e.y) * e.dx) <= constants.THROW.width && segmentClear(g.map, e.x, e.y, v.x, v.y, 0);
        };
        if (g.players.some((v) => v !== a && allied(a, v) && !inHome(g, v) && through(v))) happened['seeds thrown past a team-mate on the line']++;
      } else if (e.type === 'bonk') {
        if (thrown > 0) thrown--;
        else run++;
      } else if (e.type === 'impact') {
        if (run > 0) happened['bonks landed']++;
        if (run > 1) {
          clumps++;
          felled += run;
        }
        run = 0;
      }
    }
  }
  happened['bonks that took a clump of team-mates'] += clumps;
  happened['hamsters down in those clumps'] += felled;
  if (round.teams && g.phase === 'over') happened[g.timeout ? 'rounds a side took on time' : 'rounds won by a team\'s seed']++;
  const trace = {
    name: round.name,
    seed: round.seed,
    seats: [...round.seats].map((kind, i) => ({ learned: kind === 'R', seed: round.seed * 100 + i, team: side(i) })),
    events,
    ticks,
    last: { tick: g.tick, phase: g.phase, time: g.time, timeout: g.timeout, winners: [...g.winners].sort((a, b) => a - b), places: g.players.flatMap((p) => [p.x, p.y]), tallies: g.players.flatMap((p) => [p.kills, p.throws, p.deaths, p.seeds, p.steals]), clumps, felled },
    sums: base64(new Float64Array(sums)),
    samples: Buffer.concat(parts).toString('base64'),
  };
  writeFileSync(join(out, `round${String(index + 1).padStart(2, '0')}.luau`), `return ${lua(trace)}\n`);
  console.log(`round ${index + 1}: ${round.name}: ${t} ticks, ${g.timeout ? `time ran out, seats ${g.winners.join(' ')} take it` : g.phase === 'over' ? `seat ${g.winner} home` : 'cut short'}, time ${g.time.toFixed(1)}`);
});

writeFileSync(join(out, 'rounds.luau'), `return ${ROUNDS.length}\n`);
console.log(`${ROUNDS.length} rounds, ${samples} observations to compare (${hanging} of them hang on a rounding), ${decisions} choices by learned bots`);
console.log('what the compared observations cover:');
for (const s of SITUATIONS) console.log(`  ${String(seen[s]).padStart(6)}  ${s}`);
console.log('what happened in the rounds:');
for (const s of HAPPENINGS) console.log(`  ${String(happened[s]).padStart(6)}  ${s}`);
