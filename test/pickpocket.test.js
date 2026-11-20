import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step } from '../src/sim/game.js';
import { COUNTDOWN, OVERTIME, PICK, TICK_RATE, pickTime } from '../src/sim/constants.js';
import { MAP } from '../src/sim/map.js';
import { createBot } from '../src/ai/bot.js';

const IDLE = { mx: 0, my: 0, bonk: false };
const LEFT = { mx: -1, my: 0, bonk: false };

function started(slots) {
  const g = createGame({ slots: slots.map((s, i) => ({ name: `p${i}`, kind: 'human', ...s })), seed: 7 });
  for (let i = 0; i < COUNTDOWN * TICK_RATE + 2 && g.phase === 'countdown'; i++) step(g, []);
  return g;
}

function run(g, seconds, inputs) {
  for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) step(g, inputs);
}

test('pickpocketing takes the same time however many are in the round, and less in overtime', () => {
  assert.equal(pickTime(2, 0), PICK.time);
  assert.equal(pickTime(8, 0), PICK.time);
  assert.equal(pickTime(4, OVERTIME.start), PICK.time);
  assert.ok(Math.abs(pickTime(8, OVERTIME.rush) - PICK.time * OVERTIME.nibble) < 1e-9);
  assert.ok(pickTime(4, (OVERTIME.start + OVERTIME.rush) / 2) < PICK.time);
});

test('rubbing up against a carrier that is standing still takes its seed', () => {
  const g = started([{}, {}]);
  const [a, b] = g.players;
  Object.assign(a, { x: 700, y: 100 });
  Object.assign(b, { x: 730, y: 100, carrying: true });
  const need = pickTime(2, g.time);
  run(g, need - 0.1, [IDLE, IDLE]);
  assert.ok(a.pick > 0 && b.carrying, 'gauge filling, seed not gone yet');
  run(g, 0.15, [IDLE, IDLE]);
  assert.equal(a.carrying, true);
  assert.equal(b.carrying, false);
  assert.equal(a.steals, 1);
  assert.equal(b.deaths, 0, 'nobody is knocked out by it');
});

test('a chaser pressed against a running carrier takes the seed on the move', () => {
  // Eight in the round make it quick enough to happen on the open stretch of the
  // middle lane before the carrier is home.
  const g = started(Array.from({ length: 8 }, () => ({})));
  const [a, b] = g.players;
  const y = MAP.laneYs[1];
  Object.assign(b, { x: 310, y, carrying: true });
  Object.assign(a, { x: 310 + 2 * 15 + 2, y });
  const steals = [];
  for (let i = 0; i < 2 * TICK_RATE && !a.carrying && g.phase === 'playing'; i++) {
    step(g, [LEFT, LEFT]);
    steals.push(...g.events.filter((e) => e.type === 'steal'));
  }
  assert.equal(a.carrying, true, `stolen on the run, gap ${b.x - a.x}`);
  assert.deepEqual(steals.map((e) => [e.by, e.id]), [[0, 1]]);
});

test('losing touch empties the gauge', () => {
  const g = started([{}, {}]);
  const [a, b] = g.players;
  Object.assign(a, { x: 700, y: 100 });
  Object.assign(b, { x: 730, y: 100, carrying: true });
  run(g, 0.3, [IDLE, IDLE]);
  assert.ok(a.pick > 0);
  b.x = 730 + PICK.reach + 20;
  step(g, [IDLE, IDLE]);
  assert.equal(a.pick, 0);
});

test('team-mates never pickpocket each other', () => {
  const g = started([{ team: 0 }, { team: 0 }]);
  const [a, b] = g.players;
  Object.assign(a, { x: 700, y: 100 });
  Object.assign(b, { x: 730, y: 100, carrying: true });
  run(g, 3, [IDLE, IDLE]);
  assert.equal(b.carrying, true);
  assert.equal(a.pick, 0);
});

test('the one robbed cannot take it straight back, but the thief can be robbed again', () => {
  const g = started([{}, {}, {}]);
  const [a, b, c] = g.players;
  Object.assign(a, { x: 720, y: 100 });
  Object.assign(b, { x: 750, y: 100, carrying: true });
  Object.assign(c, { x: 820, y: 400 });
  run(g, pickTime(3, g.time) + 0.05, [IDLE, IDLE, IDLE]);
  assert.equal(a.carrying, true);
  assert.ok(b.pickBlock > 0);
  // The one it was taken from is right there, and gets nowhere for a while.
  run(g, PICK.block - 0.2, [IDLE, IDLE, IDLE]);
  assert.equal(a.carrying, true);
  assert.equal(b.pick, 0);
  // Somebody else walks up and takes it off the thief.
  Object.assign(b, { x: 820, y: 300 });
  Object.assign(c, { x: a.x + 30, y: a.y });
  run(g, pickTime(3, g.time) + 0.05, [IDLE, IDLE, IDLE]);
  assert.equal(c.carrying, true);
  assert.equal(a.carrying, false);
});

test('two at once: only the one furthest along keeps going', () => {
  const g = started([{}, {}, {}]);
  const [a, b, c] = g.players;
  Object.assign(b, { x: 600, y: 300, carrying: true });
  Object.assign(a, { x: 570, y: 300 });
  run(g, 0.2, [IDLE, IDLE, IDLE]);
  Object.assign(c, { x: 630, y: 300 });
  run(g, 0.2, [IDLE, IDLE, IDLE]);
  assert.ok(a.pick > 0.3);
  assert.equal(c.pick, 0);
});

test('a top bot carrying a seed swings at a rival rubbing up against it', () => {
  for (const difficulty of ['hard', 'ace']) {
    const g = started(Array.from({ length: 4 }, () => ({})));
    const [bot, thief] = g.players;
    const brain = createBot({ difficulty, seed: 5 });
    const y = MAP.laneYs[1];
    Object.assign(bot, { x: 800, y, carrying: true });
    Object.assign(thief, { x: 800 + 2 * 15 + 2, y });
    for (let i = 0; i < 2 * TICK_RATE && bot.carrying && !thief.deaths; i++) step(g, [brain.think(g, 0), LEFT, IDLE, IDLE]);
    assert.equal(thief.steals, 0, `${difficulty} bot let its seed be taken`);
    assert.equal(thief.deaths, 1, `${difficulty} bot never swung at the thief`);
  }
});

test('the ace takes the seed off a carrier that runs on without ever turning', () => {
  const g = started(Array.from({ length: 4 }, () => ({})));
  const [bot, carrier] = g.players;
  const brain = createBot({ difficulty: 'ace', seed: 5 });
  const y = MAP.laneYs[1];
  Object.assign(carrier, { x: 1150, y, carrying: true });
  Object.assign(bot, { x: 1150 + 90, y });
  for (let i = 0; i < 6 * TICK_RATE && carrier.carrying && g.phase === 'playing'; i++) step(g, [brain.think(g, 0), LEFT, IDLE, IDLE]);
  assert.equal(bot.steals, 1, `carrier got to ${Math.round(carrier.x - g.homeX)} px from home with its seed`);
});
