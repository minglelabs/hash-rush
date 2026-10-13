// The balance table, with the trained policy (RL) in the top seats: every line-up
// on every map, one Node process per line-up at once.
//   node rl/report.js rl/runs/team/policy.json [rounds per map] [rl/runs/long/policy.json]
// Free-for-all rows give the win rate per seat, RL / the hard (or ace) bot. Team rows give the
// RL side's win rate. A seat's share in an even free-for-all is 100 / players.
// With a second policy (RL'), rows of the two against each other are added, and
// their free-for-all rows give RL / RL'.

import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEnvs, MAX_P, OBS } from './env.js';
import { MAP_IDS } from '../src/sim/map.js';
import { loadPolicy } from './policy.js';

const [path, roundsArg = '30', vsPath] = process.argv.slice(2);
const only = process.env.REPORT_ONLY;
const ROUNDS = Number(roundsArg);
const RL = -1;
const RIVAL = -2; // the second policy
const [EASY, NORMAL, HARD, ACE] = [0, 1, 2, 3];
const MAP_NAMES = { meadow: '초원', desert: '사막', factory: '공장', ice: '얼음', beach: '해변', graveyard: '묘지', sky: '하늘' };

const solo = (levels) => levels.map((level) => ({ level, team: -1 }));
const sides = (a, b) => [...a.map((level) => ({ level, team: 0 })), ...b.map((level) => ({ level, team: 1 }))];
const LINEUPS = [
  ['RL 1 + 고수 3', solo([RL, HARD, HARD, HARD])],
  ['RL 2 + 고수 2', solo([RL, RL, HARD, HARD])],
  ['RL 3 + 고수 1', solo([RL, RL, RL, HARD])],
  ['RL 3 + 고수 3 (6인)', solo([RL, RL, RL, HARD, HARD, HARD])],
  ['RL·고수·중수 2', solo([RL, HARD, NORMAL, NORMAL])],
  ['초보·중수·고수·RL', solo([EASY, NORMAL, HARD, RL])],
  ['RL 1 + 초고수 3', solo([RL, ACE, ACE, ACE])],
  ['RL 2 + 초고수 2', solo([RL, RL, ACE, ACE])],
  ['RL 2 vs 고수 2', sides([RL, RL], [HARD, HARD])],
  ['RL 3 vs 고수 3', sides([RL, RL, RL], [HARD, HARD, HARD])],
  ['RL 2 vs 고수 3', sides([RL, RL], [HARD, HARD, HARD])],
  ['RL+중수 vs 고수+중수', sides([RL, NORMAL], [HARD, NORMAL])],
  ['RL+초보 vs 고수+초보', sides([RL, EASY], [HARD, EASY])],
  ['RL+중수+초보 vs 고수+중수+초보', sides([RL, NORMAL, EASY], [HARD, NORMAL, EASY])],
  ['RL+초보 vs 고수+중수', sides([RL, EASY], [HARD, NORMAL])],
  ['RL+초보 vs 고수 2', sides([RL, EASY], [HARD, HARD])],
  ['RL 2 vs 초고수 2', sides([RL, RL], [ACE, ACE])],
];
if (vsPath) {
  LINEUPS.push(
    ["RL 1 + RL' 3", solo([RL, RIVAL, RIVAL, RIVAL])],
    ["RL 2 + RL' 2", solo([RL, RL, RIVAL, RIVAL])],
    ["RL·RL'·고수 2", solo([RL, RIVAL, HARD, HARD])],
    ["RL·RL'·초고수 2", solo([RL, RIVAL, ACE, ACE])],
    ["RL 2 + RL' 2 + 고수 2 (6인)", solo([RL, RL, RIVAL, RIVAL, HARD, HARD])],
    ["RL 2 vs RL' 2", sides([RL, RL], [RIVAL, RIVAL])],
    ["RL 3 vs RL' 3", sides([RL, RL, RL], [RIVAL, RIVAL, RIVAL])],
    ["RL+초보 vs RL'+초보", sides([RL, EASY], [RIVAL, EASY])],
    ["RL+고수 vs RL'+고수", sides([RL, HARD], [RIVAL, HARD])],
    ["RL+RL' vs 초고수 2", sides([RL, RIVAL], [ACE, ACE])],
  );
}

// One line-up on one map: RL seats' wins, hard seats' wins (or RL side's wins), timeouts.
function play(policy, rivalPolicy, lineup, map, seed) {
  const E = 8;
  const envs = createEnvs({ envs: E, seed, lineup, maps: [map], botEnv: 1 });
  const actions = new Uint8Array(E * MAX_P * 3);
  const rl = lineup.flatMap((s, i) => (s.level === RL ? [i] : []));
  const rival = lineup.flatMap((s, i) => (s.level === RIVAL ? [i] : []));
  // The seats RL is compared with: RL' when it plays, else the hard or ace bots.
  const hard = rival.length ? rival : lineup.flatMap((s, i) => (s.level >= HARD ? [i] : []));
  const out = { rounds: 0, rl: 0, hard: 0, timeouts: 0 };
  while (out.rounds < ROUNDS) {
    for (let e = 0; e < E; e++) {
      for (const [seats, p] of [[rl, policy], [rival, rivalPolicy]]) {
        for (const i of seats) {
          const at = (e * MAX_P + i) * OBS;
          actions.set(p.act(envs.obs.subarray(at, at + OBS)), (e * MAX_P + i) * 3);
        }
      }
    }
    envs.act(actions);
    for (let e = 0; e < E; e++) {
      if (!envs.done[e] || out.rounds >= ROUNDS) continue;
      out.rounds++;
      out.timeouts += envs.timedOut[e];
      out.rl += rl.reduce((n, i) => n + envs.win[e * MAX_P + i], 0) / rl.length;
      if (hard.length) out.hard += hard.reduce((n, i) => n + envs.win[e * MAX_P + i], 0) / hard.length;
    }
  }
  return out;
}

if (only !== undefined) {
  const load = (file) => (file ? loadPolicy(JSON.parse(readFileSync(file, 'utf8'))) : null);
  const policy = load(path);
  const rivalPolicy = load(vsPath);
  const [, lineup] = LINEUPS[Number(only)];
  const rows = MAP_IDS.map((map, k) => play(policy, rivalPolicy, lineup, map, 1000 * Number(only) + k + 1));
  process.stdout.write(JSON.stringify(rows));
} else {
  const self = fileURLToPath(import.meta.url);
  const results = new Array(LINEUPS.length);
  let next = 0;
  const run = () => {
    if (next >= LINEUPS.length) return Promise.resolve();
    const k = next++;
    return new Promise((done) => {
      let text = '';
      const p = spawn(process.execPath, [self, path, roundsArg, ...(vsPath ? [vsPath] : [])], {
        stdio: ['ignore', 'pipe', 'inherit'],
        env: { ...process.env, REPORT_ONLY: String(k) },
      });
      p.stdout.on('data', (d) => (text += d));
      p.on('close', () => {
        results[k] = JSON.parse(text);
        process.stderr.write(`  done: ${LINEUPS[k][0]}\n`);
        done();
      });
    }).then(run);
  };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.min(availableParallelism(), LINEUPS.length) }, run));

  const pct = (x) => Math.round(100 * x);
  const head = MAP_IDS.map((m) => MAP_NAMES[m] || m).join('\t');
  console.log(`\n개인전 (자리당 승률 %, RL / 고수·초고수, RL'이 있으면 RL / RL')  각 맵 ${ROUNDS}판`);
  console.log(`구성\t${head}\t전체\t타임오버`);
  LINEUPS.forEach(([name, lineup], k) => {
    if (lineup.some((s) => s.team >= 0)) return;
    const r = results[k];
    const sum = (f) => r.reduce((n, x) => n + f(x), 0);
    const all = sum((x) => x.rounds);
    const cells = r.map((x) => `${pct(x.rl / x.rounds)}/${pct(x.hard / x.rounds)}`);
    console.log(`${name}\t${cells.join('\t')}\t${pct(sum((x) => x.rl) / all)} / ${pct(sum((x) => x.hard) / all)}\t${pct(sum((x) => x.timeouts) / all)}%`);
  });
  console.log(`\n팀전 (RL 쪽 팀 승률 %)`);
  console.log(`구성\t${head}\t전체\t타임오버`);
  LINEUPS.forEach(([name, lineup], k) => {
    if (!lineup.some((s) => s.team >= 0)) return;
    const r = results[k];
    const all = r.reduce((n, x) => n + x.rounds, 0);
    const cells = r.map((x) => pct(x.rl / x.rounds));
    console.log(`${name}\t${cells.join('\t')}\t${pct(r.reduce((n, x) => n + x.rl, 0) / all)}\t${pct(r.reduce((n, x) => n + x.timeouts, 0) / all)}%`);
  });
  console.log(`\n${((Date.now() - t0) / 60000).toFixed(1)}분`);
}
