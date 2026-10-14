// Elo ratings for the scripted bots and any trained policies, one table for
// free-for-all and one for teams. Every round draws its seats at random from the
// pool (repeats allowed) on a random map, and the ratings are the standard Elo
// scale fitted to all results at once (the steady state Elo updates settle to),
// with the easy bot pinned at 1000. 400 points apart is 10 to 1 odds.
//   node rl/elo.js [rounds per mode, 1600] RL1=rl/runs/long/policy.json RL2=rl/runs/team/policy.json
// Free-for-all: four seats, the winner beats each of the others. Teams: two
// against two, a team rated as the mean of its members.

import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEnvs, MAX_P, OBS } from './env.js';
import { loadPolicy } from './policy.js';

const args = process.argv.slice(2);
const ROUNDS = Number(args.find((a) => /^\d+$/.test(a)) || 1600);
const named = args.filter((a) => a.includes('=')).map((a) => a.split('='));
const BOTS = [
  ['초보', 0],
  ['중수', 1],
  ['고수', 2],
  ['초고수', 3],
];
// The pool: bots by level, policies as -1, -2, ... (a policy seat in env.js).
const POOL = [...BOTS, ...named.map(([name], k) => [name, -1 - k])];
const PER_JOB = 8;

function pick(rnd) {
  return Math.floor(rnd() * POOL.length);
}

// One job: one random line-up, PER_JOB rounds of it on random maps.
function job(policies, mode, seed) {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const ids = [pick(rnd), pick(rnd), pick(rnd), pick(rnd)];
  const lineup = ids.map((id, i) => ({ level: POOL[id][1], team: mode === 'team' ? i % 2 : -1 }));
  const envs = createEnvs({ envs: PER_JOB, seed, lineup, botEnv: 1 });
  const actions = new Uint8Array(PER_JOB * MAX_P * 3);
  const results = [];
  const done = new Array(PER_JOB).fill(false);
  while (done.includes(false)) {
    for (let e = 0; e < PER_JOB; e++) {
      lineup.forEach(({ level }, i) => {
        if (level >= 0) return;
        const at = (e * MAX_P + i) * OBS;
        actions.set(policies[-1 - level].act(envs.obs.subarray(at, at + OBS)), (e * MAX_P + i) * 3);
      });
    }
    envs.act(actions);
    for (let e = 0; e < PER_JOB; e++) {
      if (!envs.done[e] || done[e]) continue;
      done[e] = true;
      results.push({ mode, ids, won: ids.map((_, i) => envs.win[e * MAX_P + i]) });
    }
  }
  return results;
}

// Fits ratings to every result by gradient ascent on the Elo win probability.
function fit(results) {
  const pairs = [];
  for (const { mode, ids, won } of results) {
    if (mode === 'team') {
      const a = [ids[0], ids[2]];
      const b = [ids[1], ids[3]];
      pairs.push({ win: won[0] ? a : b, lose: won[0] ? b : a, w: 1 });
      continue;
    }
    const winners = ids.filter((_, i) => won[i]);
    const losers = ids.filter((_, i) => !won[i]);
    for (const x of winners) for (const y of losers) if (x !== y) pairs.push({ win: [x], lose: [y], w: 1 / (ids.length - 1) });
  }
  const r = new Float64Array(POOL.length);
  const mean = (team) => team.reduce((t, i) => t + r[i], 0) / team.length;
  const k = Math.LN10 / 400;
  for (let step = 0; step < 3000; step++) {
    const grad = new Float64Array(POOL.length);
    for (const { win, lose, w } of pairs) {
      const p = 1 / (1 + Math.exp(-k * (mean(win) - mean(lose))));
      const g = w * (1 - p);
      for (const i of win) grad[i] += g / win.length;
      for (const i of lose) grad[i] -= g / lose.length;
    }
    for (let i = 0; i < r.length; i++) r[i] += (40 * grad[i]) / Math.max(1, pairs.length / POOL.length) - 0.0001 * r[i];
    const shift = 1000 - r[0];
    for (let i = 0; i < r.length; i++) r[i] += shift;
  }
  const games = POOL.map((_, i) => results.filter((x) => x.ids.includes(i)).length);
  return POOL.map(([name], i) => ({ name, elo: Math.round(r[i]), games: games[i] })).sort((a, b) => b.elo - a.elo);
}

if (process.env.ELO_JOBS) {
  const policies = named.map(([, path]) => loadPolicy(JSON.parse(readFileSync(path, 'utf8'))));
  const out = [];
  for (const spec of JSON.parse(process.env.ELO_JOBS)) out.push(...job(policies, spec.mode, spec.seed));
  process.stdout.write(JSON.stringify(out));
} else {
  const specs = [];
  for (const mode of ['solo', 'team']) for (let j = 0; j < Math.ceil(ROUNDS / PER_JOB); j++) specs.push({ mode, seed: 7919 * specs.length + 13 });
  const workers = Math.min(availableParallelism(), specs.length);
  const t0 = Date.now();
  const parts = await Promise.all(
    Array.from({ length: workers }, (_, w) => {
      const mine = specs.filter((_, i) => i % workers === w);
      return new Promise((resolve) => {
        let text = '';
        const p = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ELO_JOBS: JSON.stringify(mine) } });
        p.stdout.on('data', (d) => (text += d));
        p.on('close', () => resolve(JSON.parse(text)));
      });
    }),
  );
  const all = parts.flat();
  for (const [mode, title] of [['solo', '개인전 Elo (4인)'], ['team', '팀전 Elo (2 대 2)']]) {
    const rows = fit(all.filter((x) => x.mode === mode));
    console.log(`\n${title}  ${all.filter((x) => x.mode === mode).length}판`);
    for (const { name, elo, games } of rows) console.log(`${name.padEnd(6)}\t${games ? elo : '-'}\t(${games}판 출전)`);
  }
  console.log(`\n${((Date.now() - t0) / 60000).toFixed(1)}분`);
}
