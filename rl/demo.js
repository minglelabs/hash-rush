// Records the scripted bots playing each other, for rl/pretrain.py to learn from:
// what each bot saw, what it did (in the policy's own actions), the discounted
// reward that followed, and whether it won the round.
//   node rl/demo.js <out prefix> <samples> <seed> <gamma> <frameSkip> [policy.json share [levels teams]]
// With a policy, that share of the seats is played by the policy instead, still
// labelled with what the bot there would have done (DAgger), so the learner is
// taught how to get out of the spots only it gets itself into. `levels` picks the
// bots to copy ("1,2" normal and hard, "3" the ace), `teams` the share of team rounds.
// Writes <prefix>.obs (float32), .act (uint8 x3), .ret (float32), .win (uint8).

import { readFileSync, writeFileSync } from 'node:fs';
import { createEnvs, MAX_P, OBS } from './env.js';
import { loadPolicy } from './policy.js';

const [out, want = '100000', seed = '1', gamma = '0.997', frameSkip = '4', policyPath = '', share = '0.5', levels = '1,2', teams = '0.5'] = process.argv.slice(2);
const policy = policyPath ? loadPolicy(JSON.parse(readFileSync(policyPath, 'utf8'))) : null;
const N = Number(want);
const G = Number(gamma);
const E = 16;
const envs = createEnvs({ envs: E, seed: Number(seed), allBots: true, botEnv: 1, botSeat: 1, botLevels: levels.split(',').map(Number), teams: Number(teams), frameSkip: Number(frameSkip) });

const obs = new Float32Array(N * OBS);
const act = new Uint8Array(N * 3);
const ret = new Float32Array(N);
const win = new Uint8Array(N);
let n = 0;
// Per seat, the rows it has filled this round and the reward after each.
const rows = Array.from({ length: E * MAX_P }, () => []);
const rews = Array.from({ length: E * MAX_P }, () => []);

const actions = new Uint8Array(E * MAX_P * 3);
const cast = (e) => {
  for (let i = 0; i < MAX_P; i++) envs.steer[e * MAX_P + i] = policy && Math.random() < Number(share) ? 1 : 0;
};
for (let e = 0; e < E; e++) cast(e);

while (n < N) {
  const seen = envs.obs.slice();
  const roles = envs.role.slice();
  for (let s = 0; s < E * MAX_P; s++) {
    if (envs.steer[s] && roles[s] >= 2) actions.set(policy.act(seen.subarray(s * OBS, (s + 1) * OBS), 1), s * 3);
  }
  envs.act(actions);
  for (let s = 0; s < E * MAX_P && n < N; s++) {
    if (roles[s] < 2) continue;
    obs.set(seen.subarray(s * OBS, (s + 1) * OBS), n * OBS);
    act.set(envs.botAct.subarray(s * 3, s * 3 + 3), n * 3);
    rows[s].push(n++);
    rews[s].push(envs.reward[s]);
  }
  for (let e = 0; e < E; e++) {
    for (let i = 0; i < MAX_P; i++) {
      const s = e * MAX_P + i;
      if (!envs.done[e] && n < N) continue;
      let g = 0;
      for (let t = rows[s].length - 1; t >= 0; t--) {
        g = rews[s][t] + G * g;
        ret[rows[s][t]] = g;
        win[rows[s][t]] = envs.done[e] ? envs.win[s] : 0;
      }
      rows[s] = [];
      rews[s] = [];
    }
    if (envs.done[e]) cast(e);
  }
}

for (const [ext, a] of [['obs', obs], ['act', act], ['ret', ret], ['win', win]]) writeFileSync(`${out}.${ext}`, Buffer.from(a.buffer, 0, a.byteLength));
