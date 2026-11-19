// Where a trained policy wins and loses: plays it against the scripted bots in
// fixed line-ups and prints, per side, how the rounds ended and what each hamster
// did in a round (bonks, times bonked, seeds nibbled, seeds stolen, stops).
//   node rl/stats.js rl/runs/rl16/policy.json[@temperature] [rounds per line-up, 200]

import { readFileSync } from 'node:fs';
import { createEnvs, MAX_P, OBS } from './env.js';
import { readPolicy, seatViews } from './policy.js';

const policy = readPolicy(process.argv[2], readFileSync);
const ROUNDS = Number(process.argv[3] || 200);
const E = 24;
const RL = -1;
const NAMES = { [-1]: 'RL', 0: '초보', 1: '중수', 2: '고수', 3: '초고수' };
const solo = (levels) => levels.map((level) => ({ level, team: -1 }));
const sides = (a, b) => [...a.map((level) => ({ level, team: 0 })), ...b.map((level) => ({ level, team: 1 }))];
const LINEUPS = [
  ['RL 2 vs 고수 2', sides([RL, RL], [2, 2])],
  ['RL 2 vs 초고수 2', sides([RL, RL], [3, 3])],
  ['RL 3 vs 초고수 3', sides([RL, RL, RL], [3, 3, 3])],
  ['RL+고수 vs 초고수 2', sides([RL, 2], [3, 3])],
  ['고수 2 vs 초고수 2', sides([2, 2], [3, 3])],
  ['RL 2 + 초고수 2 (개인전)', solo([RL, RL, 3, 3])],
];

for (const [title, lineup] of LINEUPS) {
  // One group per kind of seat on each side: 'RL', '고수' ...
  const key = ({ level, team }) => `${team < 0 ? '' : `팀${team + 1} `}${NAMES[level]}`;
  const groups = new Map();
  const add = (k) => groups.get(k) || groups.set(k, { seats: 0, win: 0, kills: 0, deaths: 0, seeds: 0, steals: 0, robbed: 0, stops: 0, throws: 0, goals: 0 }).get(k);
  let played = 0;
  let timeouts = 0;
  let seconds = 0;
  const onOver = (g) => {
    if (played >= ROUNDS) return;
    played++;
    seconds += g.time;
    if (g.timeout) timeouts++;
    const steals = g.players.reduce((t, p) => t + p.steals, 0);
    lineup.forEach((seat, i) => {
      const p = g.players[i];
      const s = add(key(seat));
      s.seats++;
      s.win += g.winners.includes(p.id) ? 1 : 0;
      s.kills += p.kills;
      s.deaths += p.deaths;
      s.seeds += p.seeds;
      s.steals += p.steals;
      s.stops += p.stops;
      s.throws += p.throws;
      s.goals += !g.timeout && g.winner === p.id ? 1 : 0;
      // In a two-sided round, what the other side stole was taken from this one.
      if (seat.team >= 0) s.robbed += g.players.filter((q) => q.team !== p.team).reduce((t, q) => t + q.steals, 0) / g.players.filter((q) => q.team === p.team).length;
      else s.robbed += (steals - p.steals) / (g.players.length - 1);
    });
  };
  const envs = createEnvs({ envs: E, seed: 11, lineup, botEnv: 1, frameSkip: policy.meta.frameSkip || 4, onOver });
  seatViews(envs, MAX_P, () => policy);
  const actions = new Uint8Array(E * MAX_P * 3);
  while (played < ROUNDS) {
    for (let e = 0; e < E; e++) {
      lineup.forEach(({ level }, i) => {
        if (level >= 0) return;
        const at = (e * MAX_P + i) * OBS;
        actions.set(policy.act(envs.obs.subarray(at, at + OBS), policy.meta.temperature ?? 1), (e * MAX_P + i) * 3);
      });
    }
    envs.act(actions);
  }
  console.log(`\n${title}: ${played}판, 평균 ${(seconds / played).toFixed(0)}초, 시간 종료 ${((100 * timeouts) / played).toFixed(0)}%`);
  console.log('  자리          승률   골인  꿀밤  당함  씨  훔침 뺏김  저지 던짐   (한 판, 한 마리당)');
  for (const [k, s] of groups) {
    const per = (v) => (v / s.seats).toFixed(2).padStart(5);
    console.log(`  ${k.padEnd(10)} ${((100 * s.win) / s.seats).toFixed(0).padStart(4)}% ${per(s.goals)} ${per(s.kills)} ${per(s.deaths)} ${per(s.seeds)} ${per(s.steals)} ${per(s.robbed)} ${per(s.stops)} ${per(s.throws)}`);
  }
}
