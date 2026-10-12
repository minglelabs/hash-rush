import test from 'node:test';
import assert from 'node:assert/strict';
import { stickDir, stickStart, stickMove, holdSwing } from '../src/client/input.js';
import { createGame } from '../src/sim/game.js';
import { BONK, HAMSTER_R } from '../src/sim/constants.js';

const at = (deg, r = 30) => [Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r];

test('the joystick is all or nothing, like an arrow key', () => {
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

// A thumb sliding from point to point at `speed` pixels a second, sampled the way a
// phone reports it. Returns each heading the stick took and how far the thumb had
// travelled since the last point of the path when it did.
function slide(points, speed = 400) {
  const s = stickStart(...points[0], 800, 800, 0);
  const took = [];
  let t = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.ceil((len / speed) * 120);
    for (let k = 1; k <= steps; k++) {
      t += len / speed / steps;
      const was = `${s.x},${s.y}`;
      stickMove(s, ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps, t);
      if (`${s.x},${s.y}` !== was) took.push({ x: s.x, y: s.y, last: i === points.length - 1, after: (len * k) / steps });
    }
  }
  return { s, took };
}

test('a thumb resting where it landed does not move the hamster', () => {
  const { s } = slide([[400, 400], [404, 403]]);
  assert.deepEqual([s.x, s.y], [0, 0]);
});

test('turning takes a short slide of the thumb, not a trip across the stick', () => {
  // Pushing right, then sliding straight up: the lean shows first, then the turn.
  const up = slide([[400, 400], [480, 400], [480, 320]]).took.filter((h) => h.last);
  assert.deepEqual(up.map((h) => [h.x, h.y]), [[1, -1], [0, -1]]);
  assert.ok(up[0].after < 24, `leans after ${up[0].after}px`);
  assert.ok(up[1].after < 45, `turns after ${up[1].after}px`);

  // Sliding straight back: a stop, then the other way.
  const back = slide([[400, 400], [480, 400], [400, 400]]).took.filter((h) => h.last);
  assert.deepEqual(back.map((h) => [h.x, h.y]), [[0, 0], [-1, 0]]);
  assert.ok(back[0].after < 20, `stops after ${back[0].after}px`);
  assert.ok(back[1].after < 36, `turns back after ${back[1].after}px`);
});

test('a thumb creeping sideways on a long push keeps its heading', () => {
  const s = stickStart(400, 400, 800, 800, 0);
  let t = 0;
  for (let i = 1; i <= 24; i++) stickMove(s, 400 + i * 2.5, 400, (t += 1 / 120));
  // Two seconds of holding on, drifting 25px to one side on the way.
  for (let i = 1; i <= 240; i++) {
    stickMove(s, 460 + i * 0.05, 400 - (25 * i) / 240, (t += 1 / 120));
    assert.deepEqual([s.x, s.y], [1, 0]);
  }
  // The same 25px moved on purpose is a turn.
  for (let i = 1; i <= 8; i++) stickMove(s, 472, 375 - i * 3.2, (t += 1 / 120));
  assert.deepEqual([s.x, s.y], [1, -1]);
});

test('a thumb easing back on a long push does not stop the hamster, a pull back does', () => {
  const hold = () => {
    const s = stickStart(400, 400, 800, 800, 0);
    let t = 0;
    for (let i = 1; i <= 24; i++) stickMove(s, 400 + i * 2.5, 400, (t += 1 / 120));
    return { s, t };
  };
  // Two seconds of holding on while the thumb slips 18px back.
  const eased = hold();
  for (let i = 1; i <= 240; i++) {
    stickMove(eased.s, 460 - (18 * i) / 240, 400, (eased.t += 1 / 120));
    assert.deepEqual([eased.s.x, eased.s.y], [1, 0]);
  }
  // The same 18px pulled back in a twentieth of a second.
  const pulled = hold();
  for (let i = 1; i <= 6; i++) stickMove(pulled.s, 460 - 3 * i, 400, (pulled.t += 1 / 120));
  assert.deepEqual([pulled.s.x, pulled.s.y], [0, 0]);
});

test('a turn settles: the thumb has to come well back to undo it', () => {
  const { s } = slide([[400, 400], [460, 400], [460, 382]]);
  assert.deepEqual([s.x, s.y], [1, -1]);
  let t = 10;
  stickMove(s, 460, 386, (t += 0.01));
  assert.deepEqual([s.x, s.y], [1, -1]);
});

test('at the screen edge the stick still pushes every way at once', () => {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1], [0, 1]]) {
    const s = stickStart(6, 400, 800, 800, 0);
    for (let i = 1; i <= 10; i++) stickMove(s, 6 + dx * i, 400 + dy * i, i / 120);
    assert.deepEqual([s.x, s.y], [dx, dy], `${dx},${dy}`);
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
