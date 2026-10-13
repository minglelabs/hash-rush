import test from 'node:test';
import assert from 'node:assert/strict';
import { stickDir, holdSwing, nearestGround, KEYS } from '../src/client/input.js';
import { createGame } from '../src/sim/game.js';
import { MAPS, isFree } from '../src/sim/map.js';
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

test('a tap in a hedge, on the flower or off the map means the nearest ground to it', () => {
  const map = MAPS.meadow;
  const R = HAMSTER_R;
  // Open ground is taken as it is.
  assert.deepEqual(nearestGround(map, 100, 280), { x: 100, y: 280 });
  // Every wall cell, the flower and points well off the map land somewhere a hamster fits.
  const spots = [...map.walls, map.flower, { x: -200, y: 300 }, { x: 2000, y: -50 }, { x: 450, y: 900 }];
  for (const p of spots) {
    const to = nearestGround(map, p.x, p.y);
    assert.ok(isFree(map, to.x, to.y, R - 0.01), `(${p.x}, ${p.y}) -> (${to.x}, ${to.y})`);
    assert.ok(to.x >= map.bounds.x1 + R && to.x <= map.bounds.x2 - R && to.y >= map.bounds.y1 + R && to.y <= map.bounds.y2 - R);
  }
  // And not far: a wall cell is never more than a few cells from a lane.
  for (const p of map.walls) {
    const to = nearestGround(map, p.x, p.y);
    assert.ok(Math.hypot(to.x - p.x, to.y - p.y) < 130, `(${p.x}, ${p.y})`);
  }
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
