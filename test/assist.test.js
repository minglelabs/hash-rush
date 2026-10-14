import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step } from '../src/sim/game.js';
import { MAPS, MAP_IDS, buildMap } from '../src/sim/map.js';
import { HAZARD, iceNow } from '../src/sim/hazards.js';
import { SPEED, TICK_RATE } from '../src/sim/constants.js';
import { createLaneHelp } from '../src/client/assist.js';

const cellX = (c) => 210 + c * 40 + 20;
const cellY = (r) => 20 + r * 40 + 20;
// One long lane along row 6 with a turning down at column 6 and one up at column
// 9, between a lane along the top and one along the bottom.
const lanes = [[0, 6, 11, 6], [6, 6, 6, 12], [9, 0, 9, 6], [0, 0, 11, 0], [0, 12, 11, 12]];
const comb = buildMap({ id: 'comb', theme: MAPS.meadow.theme, lanes });
const TURN = cellX(6);
const LANE = cellY(6);

function start(at, map = comb) {
  const g = createGame({ map, slots: [{ name: 'a', kind: 'human' }, { name: 'b', kind: 'human' }], seed: 1 });
  while (g.phase !== 'playing') step(g, []);
  const me = g.players[0];
  Object.assign(me, at);
  Object.assign(g.players[1], { x: 60, y: 500 });
  return { g, me, help: createLaneHelp() };
}

// Plays `plan(me)`, a stick push per tick, until `done(me)`. Returns the ticks it
// took, or Infinity. `stick` says whether the push comes off the touch stick.
function play({ g, me, help }, plan, done, stick = true) {
  for (let t = 1; t <= 150; t++) {
    const [mx, my] = plan(me);
    step(g, [help(g, me, { mx, my, bonk: false, stick: stick && !!(mx || my) })]);
    if (done(me)) return t;
  }
  return Infinity;
}

// Pushes right along the lane, and switches to `push` once `early` pixels short of the turning.
const switchAt = (early, push) => {
  let on = false;
  return (me) => ((on ||= me.x >= TURN - early) ? push : [1, 0]);
};
const turned = (me) => me.y >= LANE + 70;
const fromLane = () => start({ x: TURN - 120, y: LANE });
// What the same run takes going square round the corner, and cutting it.
const SQUARE = (120 + 70) / (SPEED / TICK_RATE);

test('a keyboard needs its timing: down pressed too early stops at the hedge', () => {
  assert.equal(play(fromLane(), switchAt(60, [0, 1]), turned, false), Infinity);
  assert.ok(play(fromLane(), switchAt(20, [0, 1]), turned, false) < SQUARE);
});

test('a turn pushed early on the stick is kept until its opening comes', () => {
  for (const early of [60, 45, 30, 15, 0]) {
    const ticks = play(fromLane(), switchAt(early, [0, 1]), turned);
    assert.ok(ticks <= SQUARE + 1, `${early}px early took ${ticks} ticks`);
  }
});

test('a turn pushed a little late steps back to its opening', () => {
  assert.ok(play(fromLane(), switchAt(-20, [0, 1]), turned) < SQUARE + 12);
});

test('a slanted push runs the lane at full speed and takes the turning it leans to', () => {
  // The whole way on the slant: unhelped it scrapes along the hedge at 71%.
  const helped = play(fromLane(), () => [1, 1], turned);
  const raw = play(fromLane(), () => [1, 1], turned, false);
  assert.ok(helped <= SQUARE - 3, `helped took ${helped} ticks`);
  assert.ok(raw >= helped + 8, `unhelped took ${raw} ticks`);
});

test('a slant the other way passes the turning by and takes its own', () => {
  const s = fromLane();
  // Leaning up: the turning down at column 6 is not for it, the one up at column 9 is.
  const ticks = play(s, () => [1, -1], (me) => me.y <= LANE - 70);
  assert.ok(ticks < Infinity);
  assert.ok(Math.abs(s.me.x - cellX(9)) <= 5);
});

test('the push is followed exactly where nothing is in the way', () => {
  // Open ground in the burrow: a slant stays a slant, and a straight push straight.
  for (const [mx, my] of [[1, 1], [1, 0], [0, -1], [-1, 1]]) {
    const s = start({ x: 100, y: 280 });
    const inp = s.help(s.g, s.me, { mx, my, stick: true });
    assert.deepEqual([inp.mx, inp.my], [mx, my]);
  }
  // Along a lane.
  const s = fromLane();
  const inp = s.help(s.g, s.me, { mx: 1, my: 0, stick: true });
  assert.deepEqual([inp.mx, inp.my], [1, 0]);
});

test('a push at the hedge from open ground finds the lane mouth beside it', () => {
  // Against the hedge on the burrow side, to one side of the lane's mouth.
  for (const off of [18, -45]) {
    const s = start({ x: 190, y: LANE + off });
    assert.ok(play(s, () => [1, 0], (me) => me.x >= 260) < 45, `${off}px off`);
  }
  // Too far along the hedge for that to be the lane meant: the push stays a push.
  const far = start({ x: 190, y: LANE + 75 });
  for (let t = 0; t < 30; t++) {
    const inp = far.help(far.g, far.me, { mx: 1, my: 0, bonk: false, stick: true });
    assert.deepEqual([inp.mx, inp.my], [1, 0]);
    step(far.g, [inp]);
  }
  assert.ok(far.me.x < 200);
});

test('inside the maze a hamster standing by a wall is not sent off down the lane', () => {
  // Standing 30px short of the turning and pushing at the hedge: too far to be meant.
  const s = start({ x: TURN - 30, y: LANE });
  const inp = s.help(s.g, s.me, { mx: 0, my: 1, bonk: false, stick: true });
  assert.deepEqual([inp.mx, inp.my], [0, 1]);
  // 15px short is near enough.
  const near = start({ x: TURN - 15, y: LANE });
  assert.ok(play(near, () => [0, 1], turned) < 40);
});

test('a push into a plain wall is left alone', () => {
  const s = fromLane();
  for (let t = 0; t < 30; t++) step(s.g, [s.help(s.g, s.me, { mx: 0, my: -1, bonk: false, stick: true })]);
  assert.ok(Math.abs(s.me.x - (TURN - 120)) < 1);
});

test('keys and clicks are never touched', () => {
  const s = fromLane();
  const inp = s.help(s.g, s.me, { mx: 1, my: 1, stick: false });
  assert.deepEqual([inp.mx, inp.my], [1, 1]);
});

test('the help does not carry a hamster into a pit', () => {
  const early = switchAt(55, [0, 1]);
  const s = fromLane();
  s.g.hazards.push({ kind: 'trap', x: TURN - 20, y: LANE, age: HAZARD.trap.warn + 1 });
  // A pit lies between here and the turning: the push into the hedge just stops.
  play(s, early, () => false);
  assert.ok(s.me.x < TURN - 40 && s.me.deaths === 0);
});

test('on ice the push goes through as it is', () => {
  const rink = buildMap({ id: 'rink', theme: MAPS.meadow.theme, lanes, ice: [[0, 6, 11, 6]] });
  const s = start({ x: TURN - 120, y: LANE }, rink);
  const inp = s.help(s.g, s.me, { mx: 1, my: 1, stick: true });
  assert.deepEqual([inp.mx, inp.my], [1, 1]);
});

test('every map: holding any push from any lane cell never dithers or wedges', () => {
  const pushes = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const id of MAP_IDS) {
    for (const cell of MAPS[id].cells) {
      for (const [mx, my] of pushes) {
        // A second of holding the push, with the help and without.
        const run = (stick, px = mx, py = my) => {
          const s = start({ x: cell.x + 4, y: cell.y - 4 }, MAPS[id]);
          s.g.calm = true;
          let changes = 0;
          let last = '';
          let ground = 0;
          for (let t = 0; t < 60 && !s.me.deaths; t++) {
            const inp = s.help(s.g, s.me, { mx: px, my: py, bonk: false, stick });
            if (`${inp.mx},${inp.my}` !== last) changes++;
            last = `${inp.mx},${inp.my}`;
            const { x, y } = s.me;
            step(s.g, [inp]);
            ground += Math.hypot(s.me.x - x, s.me.y - y);
          }
          return { changes, ground, went: (s.me.x - cell.x) * px + (s.me.y - cell.y) * py };
        };
        const helped = run(true);
        const where = `${id} (${cell.x}, ${cell.y}) push ${mx},${my}`;
        // Each change of mind is a real turning taken, a handful a second at most.
        assert.ok(helped.changes <= 8, `${where}: changed its mind ${helped.changes} times`);
        assert.ok(helped.ground >= run(false).ground - 25, `${where}: covered ${helped.ground.toFixed(0)}px`);
        // A slant with a lane open on both sides of it goes down one of them, where
        // a bare slant can stick square on the hedge corner in between. (Not on
        // ice, where a push is never read as anything but itself.)
        const icy = iceNow(MAPS[id], 0).some((r) => cell.x > r.x - 20 && cell.x < r.x + r.w + 20 && cell.y > r.y - 20 && cell.y < r.y + r.h + 20);
        if (mx && my && !icy && Math.min(run(false, mx, 0).went, run(false, 0, my).went) > 30) {
          assert.ok(helped.ground > 30, `${where}: stuck on a corner`);
        }
      }
    }
  }
});

test('a swipe drawn on a slant keeps its slant unless it only rubs the hedge beside the lane', () => {
  const s = Math.sin(Math.PI / 8);
  const c = Math.cos(Math.PI / 8);
  // In the long lane, leaning a little into the hedge: straightened to full speed along it.
  const lane = start({ x: cellX(2), y: LANE });
  assert.deepEqual(lane.help(lane.g, lane.me, { mx: c, my: s, stick: true }), { mx: 1, my: 0, stick: true });
  // On open ground the slant goes as drawn.
  const open = start({ x: 100, y: 300 });
  const out = open.help(open.g, open.me, { mx: c, my: -s, stick: true });
  assert.equal(out.mx, c);
  assert.equal(out.my, -s);
});
