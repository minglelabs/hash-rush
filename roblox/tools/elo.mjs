// Elo ratings for the bots as they play in the Roblox version: the scripted
// levels and the learned bot, one table for free-for-all and one for teams. The
// same idea and the same fit as rl/elo.js has for the web game: every round draws
// its four seats at random from the pool (repeats allowed), and the ratings are
// the Elo scale fitted to all results at once, with the easy bot pinned at 1000.
// 400 points apart is 10 to 1 odds. Free-for-all: the winner beats each of the
// others. Teams: two against two, a team rated as the mean of its members.
//   node roblox/tools/elo.mjs [rounds per mode, 600] [solo|team ...]
// Needs the `luau` command line. Rounds are played by roblox/test/elo.luau.

import { spawn, spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const ROUNDS = Number(args.find((a) => /^\d+$/.test(a)) || 600);
const MODES = args.filter((a) => a === 'solo' || a === 'team');
if (!MODES.length) MODES.push('solo', 'team');
const POOL = ['초보', '중수', '고수', '초고수', 'RL'];
const PER_JOB = 8;

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
  return POOL.map((name, i) => ({ name, elo: Math.round(r[i]), games: games[i] })).sort((a, b) => b.elo - a.elo);
}

// The game's modules, wrapped so they load outside Roblox.
const wrapped = spawnSync(process.execPath, [join(here, 'wrap.mjs')], { stdio: 'inherit' });
if (wrapped.status !== 0) process.exit(1);

const t0 = Date.now();
const jobs = Math.ceil(ROUNDS / PER_JOB);
const workers = Math.min(availableParallelism(), jobs);
const all = [];
for (const mode of MODES) {
  const parts = await Promise.all(
    Array.from({ length: workers }, (_, w) => {
      const mine = Math.floor(jobs / workers) + (w < jobs % workers ? 1 : 0);
      // Seeds far enough apart that no two workers draw the same line-up.
      const first = (mode === 'team' ? 500009 : 13) + w * 1000003;
      return new Promise((resolve, reject) => {
        let text = '';
        const p = spawn('luau', ['--codegen', join(here, '..', 'test', 'elo.luau'), '-a', mode, String(first), String(mine), String(PER_JOB)], { stdio: ['ignore', 'pipe', 'inherit'] });
        p.stdout.on('data', (d) => (text += d));
        p.on('close', (code) => (code === 0 ? resolve(text) : reject(new Error(`a worker stopped with ${code}`))));
      });
    }),
  );
  for (const line of parts.join('').split('\n')) {
    const [m, ids, won, how] = line.split(' ');
    if (how) all.push({ mode: m, ids: ids.split(',').map((x) => x - 1), won: won.split(',').map(Number), timeout: how === 'timeout' });
  }
}

for (const [mode, title] of [['solo', '개인전 Elo (4인)'], ['team', '팀전 Elo (2 대 2)']]) {
  const rounds = all.filter((x) => x.mode === mode);
  if (!rounds.length) continue;
  const timeouts = rounds.filter((x) => x.timeout).length;
  console.log(`\n${title}  ${rounds.length}판 (시간 종료 ${timeouts}판)`);
  for (const { name, elo, games } of fit(rounds)) console.log(`${name.padEnd(6)}\t${games ? elo : '-'}\t(${games}판 출전)`);
}
console.log(`\n${((Date.now() - t0) / 60000).toFixed(1)}분`);
