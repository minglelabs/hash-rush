import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEnvs, MAX_P, OBS } from '../rl/env.js';
import { loadPolicy } from '../rl/policy.js';
import { MAP_IDS, MAPS, WORLD } from '../src/sim/map.js';
import { createGame, step } from '../src/sim/game.js';
import { observe, snapshot } from '../src/ai/observe.js';
import { PICK } from '../src/sim/constants.js';

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

test('rounds vary: every head count, free-for-all and two to four teams, every map', () => {
  const seen = { players: new Set(), teams: new Set(), maps: new Set() };
  const envs = createEnvs({ envs: 64, seed: 9, botEnv: 0 });
  const actions = new Uint8Array(64 * MAX_P * 3);
  const read = () => {
    for (let e = 0; e < 64; e++) {
      const seats = [...envs.role.subarray(e * MAX_P, (e + 1) * MAX_P)].filter(Boolean).length;
      seen.players.add(seats);
      const at = e * MAX_P * OBS;
      // Seat 0's view: after itself come the round's facts, then one flag per map.
      seen.teams.add(Math.round(envs.obs[at + 19 + 8] * 4));
      const flags = [...envs.obs.subarray(at + 19 + 11, at + 19 + 11 + MAP_IDS.length)];
      assert.equal(flags.filter(Boolean).length, 1);
      seen.maps.add(flags.indexOf(1));
    }
  };
  read();
  for (let s = 0; s < 40; s++) {
    for (let i = 0; i < actions.length; i += 3) actions[i] = (s + i) % 9;
    envs.act(actions);
    for (const v of envs.obs) assert.ok(Number.isFinite(v) && Math.abs(v) <= 1.5, `obs ${v}`);
  }
  assert.deepEqual([...seen.players].sort(), [2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...seen.teams].sort(), [0, 2, 3, 4]);
  assert.equal(seen.maps.size, MAP_IDS.length);
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

test('a policy sees itself as it is now and the other hamsters as they were', () => {
  const g = createGame({ slots: [{ name: 'a', kind: 'human' }, { name: 'b', kind: 'human' }], map: MAPS.meadow, seed: 3 });
  while (g.phase === 'countdown') step(g, []);
  const walk = [{ mx: 1, my: 0 }, { mx: 1, my: 0.4 }];
  for (let t = 0; t < 30; t++) step(g, walk);
  const past = snapshot(g);
  for (let t = 0; t < 9; t++) step(g, walk);
  const [me, other] = g.players;
  const was = past.players[1];
  assert.ok(Math.hypot(other.x - was.x, other.y - was.y) > 10, 'the other one has moved on since');
  const late = new Float32Array(MAX_P * OBS);
  const now = new Float32Array(MAX_P * OBS);
  observe(g, late, 0, past);
  observe(g, now);
  // Itself: where it is now, in both.
  assert.ok(Math.abs(late[0] - me.x / WORLD.w) < 1e-6);
  assert.equal(late[0], now[0]);
  // The other one, the first of the rows about everyone else: from where it was.
  const others = 19 + 11 + MAP_IDS.length + 9 + 8 + 4 * 12 + 2 * 3;
  assert.equal(late[others], 1);
  assert.ok(Math.abs(late[others + 1] - (was.x - me.x) / WORLD.w) < 1e-6);
  assert.ok(Math.abs(now[others + 1] - (other.x - me.x) / WORLD.w) < 1e-6);
  // One seat alone fills only its own row.
  const one = new Float32Array(MAX_P * OBS);
  observe(g, one, 0, past, 1);
  assert.ok(one.subarray(0, OBS).every((v) => v === 0));
  assert.deepEqual([...one.subarray(OBS, 2 * OBS)], [...late.subarray(OBS, 2 * OBS)]);
});

test('a seat flagged stale sees itself late too, as the policies before rl17 learned', () => {
  const make = () => createEnvs({ envs: 1, seed: 4, lineup: [{ level: -1, team: -1 }, { level: -1, team: -1 }], maps: ['meadow'], frameSkip: 2 });
  const fresh = make();
  const old = make();
  old.stale.fill(1);
  const actions = new Uint8Array(MAX_P * 3);
  actions[0] = actions[3] = 1; // both walk right, away from home
  for (let s = 0; s < 20; s++) {
    fresh.act(actions);
    old.act(actions);
  }
  // 9 ticks of walking apart, give or take.
  const gap = (fresh.obs[0] - old.obs[0]) * WORLD.w;
  assert.ok(gap > 20 && gap < 35, `own x differs by ${gap}`);
  // The other one walks at the same pace: the old view has both late, the new one
  // only the other, which so falls behind by what the seat has walked since.
  const others = 19 + 11 + MAP_IDS.length + 9 + 8 + 4 * 12 + 2 * 3;
  const apart = (envs) => envs.obs[others + 1] * WORLD.w;
  assert.ok(Math.abs(apart(fresh) - (apart(old) - gap)) < 1, `the other one is seen late: ${apart(fresh)} against ${apart(old)}`);
});

test('practice starts put a carrier on its way home with a rival in reach of its seed', () => {
  let found = 0;
  const envs = createEnvs({ envs: 32, seed: 6, tail: 1, botEnv: 0, reaction: 0 });
  for (let e = 0; e < 32; e++) {
    for (let i = 0; i < MAX_P; i++) {
      const at = (e * MAX_P + i) * OBS;
      // Carrying, and the nearest rival carrier's row empty for it; the rival sees it within reach.
      const d = envs.obs[at + OBS - 5 - 1];
      if (d > 0 && d * 8 * PICK.reach <= PICK.reach + 0.5) found++;
    }
  }
  assert.ok(found >= 16, `rounds starting with a rival in reach: ${found}`);
});

test('the RL bot plays a round with the weights the game ships', async () => {
  // The browser fetches the weights; here they come off the disk.
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const b = readFileSync(fileURLToPath(url));
    return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  };
  try {
    const { createRLBot } = await import('../src/ai/rl-bot.js');
    const bots = [createRLBot({ seed: 1 }), createRLBot({ seed: 2 })];
    await new Promise((done) => setTimeout(done, 300));
    const g = createGame({ slots: [{ name: 'a', kind: 'bot' }, { name: 'b', kind: 'bot' }], map: MAPS.meadow, seed: 5 });
    while (g.phase === 'countdown') step(g, []);
    let moves = 0;
    for (let t = 0; t < 60 * 30 && g.phase !== 'over'; t++) {
      const inputs = bots.map((bot, id) => bot.think(g, id));
      for (const inp of inputs) if (inp.mx || inp.my) moves++;
      step(g, inputs);
    }
    assert.ok(moves > 200, `ticks with a move: ${moves}`);
    assert.ok(g.players.some((p) => p.seeds + p.kills > 0), 'someone nibbled a seed or landed a bonk within half a minute');
  } finally {
    globalThis.fetch = real;
  }
});
