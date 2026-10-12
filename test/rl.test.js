import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnvs, MAX_P, OBS } from '../rl/env.js';
import { loadPolicy } from '../rl/policy.js';

test('the training environment plays real rounds and reports them', () => {
  const envs = createEnvs({ envs: 4, seed: 5, players: [4], teams: 0, botEnv: 1, botSeat: 1, botLevels: [0], win: 30 });
  assert.equal(envs.obs.length, 4 * MAX_P * OBS);
  // Seat 0 is the policy's, the other three are bots, the rest are empty.
  assert.deepEqual([...envs.role.subarray(0, MAX_P)], [1, 2, 2, 2, 0, 0, 0, 0]);
  const actions = new Uint8Array(4 * MAX_P * 3);
  let rounds = 0;
  let prize = 0;
  for (let s = 0; s < 1700 && rounds < 4; s++) {
    envs.act(actions);
    for (const v of envs.obs) assert.ok(Number.isFinite(v) && Math.abs(v) <= 1.5, `obs ${v}`);
    for (let e = 0; e < 4; e++) {
      if (!envs.done[e]) continue;
      rounds++;
      const winners = [...envs.win.subarray(e * MAX_P, (e + 1) * MAX_P)];
      assert.ok(winners.some(Boolean), 'somebody wins every round');
      winners.forEach((won, i) => won && (prize += envs.reward[e * MAX_P + i] >= 30 ? 1 : 0));
    }
  }
  assert.ok(rounds >= 4, `rounds finished: ${rounds}`);
  assert.ok(prize > 0, 'winners are paid the win bonus');
});

test('an exported policy picks one option per head', () => {
  const zeros = (n) => Array(n).fill(0);
  const width = 4;
  const json = {
    meta: { obs: OBS, width, blocks: 1, iter: 0, decisions: 0 },
    heads: [9, 2, 2],
    mean: zeros(OBS), var: Array(OBS).fill(1), count: 1,
    'inp.weight': zeros(width * OBS), 'inp.bias': zeros(width),
    'blocks.0.norm.weight': Array(width).fill(1), 'blocks.0.norm.bias': zeros(width),
    'blocks.0.up.weight': zeros(width * 2 * width), 'blocks.0.up.bias': zeros(width * 2),
    'blocks.0.down.weight': zeros(width * width * 2), 'blocks.0.down.bias': zeros(width),
    'norm.weight': Array(width).fill(1), 'norm.bias': zeros(width),
    // Bias the heads: move 3, bonk on, throw off.
    'pi.weight': zeros(13 * width), 'pi.bias': [0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 5, 5, 0],
  };
  assert.deepEqual(loadPolicy(json).act(new Float32Array(OBS), 0), [3, 1, 0]);
});
