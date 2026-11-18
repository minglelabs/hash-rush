import test from 'node:test';
import assert from 'node:assert/strict';
import { stickDir, holdSwing, swipeDir, padKey, KEYS } from '../src/client/input.js';
import { createGame } from '../src/sim/game.js';
import { BONK, HAMSTER_R } from '../src/sim/constants.js';

const at = (deg, r = 30) => [Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r];

const deg = (d) => Math.round((Math.atan2(d.y, d.x) * 180) / Math.PI);

test('the touch pad points one of 16 ways at full speed, past a dead middle', () => {
  assert.deepEqual(stickDir(5, 0), { x: 0, y: 0 });
  assert.deepEqual(stickDir(46, 0), { x: 1, y: 0 });
  assert.equal(deg(stickDir(...at(20))), 23);
  assert.equal(deg(stickDir(...at(-80))), -90);
  assert.ok(Math.abs(Math.hypot(stickDir(...at(30)).x, stickDir(...at(30)).y) - 1) < 1e-3);
});

test('a thumb wobbling on a boundary keeps its heading', () => {
  const right = stickDir(...at(0));
  assert.equal(stickDir(...at(15), right), right);
  assert.equal(deg(stickDir(...at(20), right)), 23);
});

test('the pad lights one key along a lane and two next to a diagonal', () => {
  const lit = (d) => [padKey(d.x), padKey(d.y)];
  assert.deepEqual(lit(stickDir(...at(20))), [1, 0]);
  assert.deepEqual(lit(stickDir(...at(45))), [1, 1]);
  assert.deepEqual(lit(stickDir(...at(-110))), [0, -1]);
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

import { gamepadInput } from '../src/client/input.js';
import { nearestWay, padWay } from '../src/client/padnav.js';

const pad = (pressed = [], axes = [0, 0]) => ({
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
});

test('a controller steers with the D-pad or the left stick, bonks with A and throws with B', () => {
  assert.deepEqual(gamepadInput(pad()), { x: 0, y: 0, stick: false, bonk: false, throw: false });
  assert.deepEqual(gamepadInput(pad([12, 15])), { x: 1, y: -1, stick: false, bonk: false, throw: false });
  const s = gamepadInput(pad([0], [0.9, 0]));
  assert.equal(s.x, 1);
  assert.equal(s.y, 0);
  assert.equal(s.stick, true);
  assert.equal(s.bonk, true);
  assert.equal(gamepadInput(pad([1])).throw, true);
  // A stick barely off the middle is no move.
  assert.equal(gamepadInput(pad([], [0.2, 0.1])).x, 0);
});

test('the menus move to the nearest button the way the controller points', () => {
  const r = (left, top) => ({ left, top, width: 10, height: 10 });
  const from = r(0, 0);
  const rects = [r(100, 0), r(0, 50), r(30, 40), r(-80, 0)];
  assert.equal(nearestWay(from, rects, 1, 0), 0);
  assert.equal(nearestWay(from, rects, 0, 1), 1);
  assert.equal(nearestWay(from, rects, -1, 0), 3);
  assert.equal(nearestWay(from, rects, 0, -1), -1);
  assert.deepEqual(padWay(pad([13])), [0, 1]);
  assert.deepEqual(padWay(pad([], [-0.8, 0.3])), [-1, 0]);
  assert.equal(padWay(pad([], [0.2, 0.2])), null);
});
