// Pits a trained policy against the game's scripted bots and prints how often it wins.
//   node rl/play.js rl/runs/first/policy.json [rounds per level] [players]
// One seat is the policy, the rest are bots of one level. With four players an
// even match is a 25% win rate.

import { readFileSync } from 'node:fs';
import { createEnvs, MAX_P, OBS } from './env.js';
import { loadPolicy } from './policy.js';

const policy = loadPolicy(JSON.parse(readFileSync(process.argv[2], 'utf8')));
const rounds = Number(process.argv[3] || 100);
const players = Number(process.argv[4] || 4);
const E = 16;

console.log(`policy from iteration ${policy.meta.iter}, ${(policy.meta.decisions / 1e6).toFixed(1)}M decisions; ${players} players, even match = ${(100 / players).toFixed(0)}%`);
for (const [level, name] of [[0, 'easy'], [1, 'normal'], [2, 'hard']]) {
  const envs = createEnvs({ envs: E, seed: 7 + level, players: [players], teams: 0, botEnv: 1, botSeat: 1, botLevels: [level] });
  const actions = new Uint8Array(E * MAX_P * 3);
  let played = 0;
  let wins = 0;
  let score = 0;
  let decisions = 0;
  while (played < rounds) {
    for (let e = 0; e < E; e++) {
      const at = e * MAX_P * OBS;
      actions.set(policy.act(envs.obs.subarray(at, at + OBS)), e * MAX_P * 3);
    }
    envs.act(actions);
    decisions += E;
    for (let e = 0; e < E; e++) {
      if (!envs.done[e]) continue;
      played++;
      wins += envs.win[e * MAX_P];
      score += envs.final[e * MAX_P];
    }
  }
  console.log(`vs ${name.padEnd(6)} wins ${((100 * wins) / played).toFixed(0).padStart(3)}%   score per round ${(score / played).toFixed(1)}   round length ${(decisions / played / 15).toFixed(0)}s   (${played} rounds)`);
}
