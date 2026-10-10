import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, inHome } from '../src/sim/game.js';
import { createBot } from '../src/ai/bot.js';
import { getNav } from '../src/ai/nav.js';
import { BONK, COUNTDOWN, GATHER_TIME, HAMSTER_R, OVERTIME, TICK_RATE } from '../src/sim/constants.js';
import { MAP, isFree } from '../src/sim/map.js';

const IDLE = { mx: 0, my: 0, bonk: false };

function started(count = 2) {
  const g = createGame({ slots: Array.from({ length: count }, (_, i) => ({ name: `p${i}`, kind: 'human' })), seed: 7 });
  for (let i = 0; i < COUNTDOWN * TICK_RATE + 2 && g.phase === 'countdown'; i++) step(g, []);
  assert.equal(g.phase, 'playing');
  return g;
}

function place(p, x, y) {
  p.x = x;
  p.y = y;
}

function run(g, seconds, inputs = []) {
  for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) step(g, typeof inputs === 'function' ? inputs(g) : inputs);
}

test('nobody moves during the countdown', () => {
  const g = createGame({ slots: [{ name: 'a', kind: 'human' }], seed: 1 });
  const { x } = g.players[0];
  step(g, [{ mx: 1, my: 0, bonk: false }]);
  assert.equal(g.phase, 'countdown');
  assert.equal(g.players[0].x, x);
});

test('hedges and the map edge are solid', () => {
  const g = started(1);
  const p = g.players[0];
  place(p, 300, 120);
  run(g, 2, [{ mx: 0, my: 1, bonk: false }]);
  assert.ok(p.y <= MAP.rects[0].y - HAMSTER_R + 0.01, `stopped by the hedge, y=${p.y}`);
  run(g, 4, [{ mx: 0, my: -1, bonk: false }]);
  assert.ok(Math.abs(p.y - (MAP.bounds.y1 + HAMSTER_R)) < 0.01);
});

test('one bonk sends the victim back to its nest empty-handed', () => {
  const g = started();
  const [a, b] = g.players;
  place(a, 400, 100);
  place(b, 440, 100);
  b.carrying = true;
  step(g, [{ mx: 0, my: 0, bonk: true }, IDLE]);
  assert.ok(a.swing, 'swing started');
  run(g, BONK.windup + 0.05);
  assert.equal(a.kills, 1);
  assert.equal(b.deaths, 1);
  assert.equal(b.carrying, false);
  assert.deepEqual([b.x, b.y], [b.nest.x, b.nest.y]);
});

test('two hits landing on the same tick knock out both hamsters', () => {
  const g = started();
  const [a, b] = g.players;
  place(a, 400, 100);
  place(b, 450, 100);
  step(g, [{ mx: 0, my: 0, bonk: true }, { mx: 0, my: 0, bonk: true }]);
  run(g, BONK.windup + 0.05);
  assert.equal(a.deaths, 1);
  assert.equal(b.deaths, 1);
});

test('a swing at thin air leaves the attacker stuck in recovery', () => {
  const g = started();
  const [a, b] = g.players;
  place(a, 400, 100);
  place(b, 400, 600);
  step(g, [{ mx: 1, my: 0, bonk: true }, IDLE]);
  run(g, BONK.windup + 0.05, [{ mx: 1, my: 0, bonk: false }, IDLE]);
  assert.equal(a.swing.phase, 'recovery');
  const x = a.x;
  run(g, 0.2, [{ mx: 1, my: 0, bonk: false }, IDLE]);
  assert.ok(a.x - x < 10, 'barely moves while recovering');
  assert.equal(b.deaths, 0);
});

test('the burrow is a safe zone', () => {
  const g = started();
  const [a, b] = g.players;
  place(a, g.homeX + 20, 360);
  place(b, g.homeX - 10, 360);
  step(g, [{ mx: 0, my: 0, bonk: true, ax: -1, ay: 0 }, IDLE]);
  run(g, BONK.windup + 0.05);
  assert.equal(b.deaths, 0, 'cannot be hit inside');
  place(a, 100, 300);
  place(b, 120, 300);
  a.cooldown = 0;
  a.swing = null;
  step(g, [IDLE, IDLE]);
  step(g, [{ mx: 0, my: 0, bonk: true }, IDLE]);
  assert.equal(a.swing, null, 'cannot swing inside');
});

test('hits do not pass through the flower', () => {
  const g = started();
  const [a, b] = g.players;
  const f = MAP.flower;
  place(a, f.x - 46, f.y);
  place(b, f.x + 46, f.y);
  step(g, [{ mx: 0, my: 0, bonk: true, ax: 1, ay: 0 }, IDLE]);
  run(g, BONK.windup + 0.05);
  assert.equal(b.deaths, 0);
});

test('nibbling the flower yields a seed, and bringing it home wins', () => {
  const g = started();
  const [a] = g.players;
  const f = MAP.flower;
  place(a, f.x - 50, f.y);
  run(g, GATHER_TIME - 0.1);
  assert.equal(a.carrying, false);
  run(g, 0.2);
  assert.equal(a.carrying, true);
  place(a, g.homeX + 30, 360);
  run(g, 1, [{ mx: -1, my: 0, bonk: false }, IDLE]);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 0);
});

test('leaving the flower resets nibbling progress', () => {
  const g = started();
  const [a] = g.players;
  const f = MAP.flower;
  place(a, f.x - 50, f.y);
  run(g, 1);
  assert.ok(a.gather > 0.9);
  place(a, f.x - 200, f.y);
  step(g, []);
  assert.equal(a.gather, 0);
});

test('in overtime the burrow edge creeps towards the flower', () => {
  const g = started(1);
  g.time = OVERTIME.start;
  run(g, 10);
  assert.ok(Math.abs(g.homeX - (MAP.home.x2 + 10 * OVERTIME.speed)) < 1);
  assert.ok(inHome(g, { x: MAP.home.x2 + 20 }));
});

test('the simulation is deterministic', () => {
  const play = () => {
    const g = createGame({ slots: [0, 1, 2, 3].map((i) => ({ name: `b${i}`, kind: 'bot' })), seed: 42 });
    const bots = [0, 1, 2, 3].map((i) => createBot({ difficulty: 'normal', seed: 100 + i }));
    for (let i = 0; i < 20 * TICK_RATE && g.phase !== 'over'; i++) step(g, bots.map((b, id) => b.think(g, id)));
    return JSON.stringify(g.players.map((p) => [p.x, p.y, p.kills, p.deaths, p.seeds]));
  };
  assert.equal(play(), play());
});

test('every waypoint is walkable and the graph connects home to the flower', () => {
  const nav = getNav(MAP);
  for (const w of MAP.waypoints) assert.ok(isFree(MAP, w.x, w.y, HAMSTER_R), `waypoint ${w.x},${w.y}`);
  for (const nest of MAP.nests) {
    for (const spot of MAP.gatherSpots) assert.ok(Number.isFinite(nav.distance(nest, spot)));
  }
});

test('bots of every level finish a match', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    for (let n = 0; n < 4; n++) {
      const g = createGame({ slots: [0, 1, 2, 3].map((i) => ({ name: `b${i}`, kind: 'bot' })), seed: n + 1 });
      const bots = [0, 1, 2, 3].map((i) => createBot({ difficulty, seed: n * 31 + i }));
      for (let i = 0; i < 300 * TICK_RATE && g.phase !== 'over'; i++) step(g, bots.map((b, id) => b.think(g, id)));
      assert.equal(g.phase, 'over', `${difficulty} game ${n} ended`);
    }
  }
});
