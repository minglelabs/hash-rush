import test from 'node:test';
import assert from 'node:assert/strict';
import { stickDir, holdSwing, swipeDir, KEYS } from '../src/client/input.js';
import { createGame } from '../src/sim/game.js';
import { BONK, HAMSTER_R } from '../src/sim/constants.js';

const at = (deg, r = 30) => [Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r];

test('the touch pad is all or nothing, like an arrow key', () => {
  assert.deepEqual(stickDir(5, 0), { x: 0, y: 0 });
  assert.deepEqual(stickDir(9, 0), { x: 1, y: 0 });
  assert.deepEqual(stickDir(46, 0), { x: 1, y: 0 });
});

test('a crooked push still runs straight, and only a clear diagonal is diagonal', () => {
  const cases = { 0: [1, 0], 25: [1, 0], 45: [1, 1], 58: [1, 1], 65: [0, 1], 90: [0, 1], 135: [-1, 1], 180: [-1, 0], '-90': [0, -1], '-155': [-1, 0] };
  for (const [deg, [x, y]] of Object.entries(cases)) assert.deepEqual(stickDir(...at(+deg)), { x, y }, `${deg}°`);
});

test('a thumb wobbling on a boundary keeps its heading', () => {
  const right = stickDir(...at(0));
  assert.equal(stickDir(...at(34), right), right);
  assert.deepEqual(stickDir(...at(40), right), { x: 1, y: 1 });
  const diagonal = stickDir(...at(45));
  assert.equal(stickDir(...at(26), diagonal), diagonal);
  assert.deepEqual(stickDir(...at(20), diagonal), { x: 1, y: 0 });
});

test('sliding the thumb across the pad changes key without lifting it', () => {
  // From the right key straight across the middle to the left key.
  let dir = stickDir(40, 0);
  const seen = [];
  for (let x = 40; x >= -40; x -= 4) {
    dir = stickDir(x, 2, dir);
    seen.push(`${dir.x},${dir.y}`);
  }
  assert.deepEqual([...new Set(seen)], ['1,0', '0,0', '-1,0']);
  // From the right key round to the up key: the corner between them is the diagonal.
  dir = stickDir(40, 0);
  const round = [];
  for (let deg = 0; deg >= -90; deg -= 5) {
    dir = stickDir(...at(deg, 40), dir);
    round.push(`${dir.x},${dir.y}`);
  }
  assert.deepEqual([...new Set(round)], ['1,0', '1,-1', '0,-1']);
});

test('a swipe points one of 16 ways once it is long and slow enough', () => {
  // Too short, or too quick: a tap, not a swipe.
  assert.equal(swipeDir(20, 0, 120), null);
  assert.equal(swipeDir(60, 0, 30), null);
  assert.deepEqual(swipeDir(60, 5, 60), { x: 1, y: 0 });
  assert.deepEqual(swipeDir(-3, -40, 80), { x: 0, y: -1 });
  // A slant keeps its slant, to the nearest sixteenth of a turn.
  const d = swipeDir(40, 40, 60);
  assert.ok(Math.abs(d.x - Math.SQRT1_2) < 1e-3 && Math.abs(d.y - Math.SQRT1_2) < 1e-3);
  const e = swipeDir(40, 15, 60);
  assert.ok(Math.abs(Math.atan2(e.y, e.x) - Math.PI / 8) < 1e-3);
});

function duel(gap) {
  const g = createGame({ slots: [{ name: 'a', kind: 'human', look: 0 }, { name: 'b', kind: 'human', look: 1 }], seed: 1 });
  const [me, foe] = g.players;
  // Open ground beside the flower, clear of the burrow and the hedges.
  Object.assign(me, { x: 700, y: 180 });
  Object.assign(foe, { x: 700 + gap, y: 180 });
  return { g, me, foe };
}

test('a held bonk button waits for a hit that connects', () => {
  const far = duel(BONK.reach + 20);
  assert.equal(holdSwing(far.g, far.me, true), null);

  const close = duel(2 * HAMSTER_R + 2);
  const aim = holdSwing(close.g, close.me, false);
  assert.ok(aim.ax > 0.99);

  // Walking away fast enough to be out of reach when the swing lands.
  close.foe.vx = 185;
  assert.equal(holdSwing(close.g, close.me, false), null);
});

test('a held bonk button ignores a team-mate', () => {
  const { g, me, foe } = duel(2 * HAMSTER_R + 2);
  me.team = foe.team = 0;
  assert.equal(holdSwing(g, me, false), null);
});

test('with nobody around a fresh press still swings, a held one does not', () => {
  const { g, me } = duel(BONK.assist + 40);
  assert.deepEqual(holdSwing(g, me, true), { ax: 0, ay: 0, dist: 0 });
  assert.equal(holdSwing(g, me, false), null);
});

test('no swing is asked for while one cannot start', () => {
  const { g, me } = duel(2 * HAMSTER_R + 2);
  me.cooldown = 0.3;
  assert.equal(holdSwing(g, me, true), null);
});

test('throwing has keys of its own, so holding the bonk key only ever bonks', () => {
  assert.ok(KEYS.throw.length > 0);
  for (const key of KEYS.throw) assert.ok(!KEYS.bonk.includes(key), `${key} is not a bonk key too`);
  const all = Object.values(KEYS).flat();
  assert.equal(new Set(all).size, all.length, 'no key does two things');
});
