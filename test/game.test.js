import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, inHome, timeoutReason } from '../src/sim/game.js';
import { createBot, predictSwing } from '../src/ai/bot.js';
import { getNav, blockCost } from '../src/ai/nav.js';
import { THROW, BONK, CARRY_SPEED, COUNTDOWN, GATHER_TIME, gatherTime, HAMSTER_R, LAST_STRETCH, OVERTIME, SPEED, TICK_RATE } from '../src/sim/constants.js';
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
  const lane = MAP.laneYs[0];
  place(p, 250, lane);
  run(g, 1, [{ mx: 0, my: 1, bonk: false }]);
  assert.ok(Math.abs(p.y - lane) <= MAP.laneWidth / 2 - HAMSTER_R + 0.01, `held inside the lane, y=${p.y}`);
  place(p, 740, 100);
  run(g, 2, [{ mx: 0, my: -1, bonk: false }]);
  assert.ok(Math.abs(p.y - (MAP.bounds.y1 + HAMSTER_R)) < 0.01);
});

test('a rounded lane mouth funnels a hamster in', () => {
  const g = started(1);
  const p = g.players[0];
  place(p, 180, MAP.laneYs[1] - 12);
  run(g, 2, [{ mx: 1, my: 0, bonk: false }]);
  assert.ok(p.x > 300, `walked into the lane, x=${p.x}`);
});

test('nobody can squeeze past a hamster standing in a lane', () => {
  const g = started();
  const [a, b] = g.players;
  const y = MAP.laneYs[1];
  place(a, 230, y);
  place(b, 300, y);
  run(g, 2, [{ mx: 1, my: 0, bonk: false }, IDLE]);
  assert.ok(Math.abs(b.x - 300) < 0.01, 'the blocker is not shoved along');
  assert.ok(a.x <= b.x - 2 * HAMSTER_R + 0.01, `stopped behind the blocker, x=${a.x}`);
});

test('two hamsters meeting head-on in a lane stop each other', () => {
  const g = started();
  const [a, b] = g.players;
  const y = MAP.laneYs[1];
  place(a, 220, y);
  place(b, 360, y);
  run(g, 2, [
    { mx: 1, my: 0, bonk: false },
    { mx: -1, my: 0, bonk: false },
  ]);
  assert.ok(b.x - a.x >= 2 * HAMSTER_R - 0.01, 'they do not overlap');
  assert.ok(Math.abs((a.x + b.x) / 2 - 290) < 2, 'neither pushes the other back');
});

test('one bonk sends the victim back to its nest empty-handed', () => {
  const g = started();
  const [a, b] = g.players;
  place(a, 740, 100);
  place(b, 775, 100);
  b.carrying = true;
  step(g, [{ mx: 0, my: 0, bonk: true }, IDLE]);
  assert.ok(a.swing, 'swing started');
  run(g, BONK.windup + 0.05);
  assert.equal(a.kills, 1);
  assert.equal(a.stops, 1, 'it had the seed, so that is a stop as well');
  assert.equal(b.deaths, 1);
  assert.equal(b.carrying, false);
  assert.deepEqual([b.x, b.y], [b.nest.x, b.nest.y]);
});

test('a bonk only reaches a hamster right next to the attacker', () => {
  const g = started();
  const [a, b] = g.players;
  place(a, 740, 100);
  place(b, 740 + BONK.reach + 4, 100);
  step(g, [{ mx: 0, my: 0, bonk: true }, IDLE]);
  run(g, BONK.windup + 0.05);
  assert.equal(b.deaths, 0);
  assert.equal(a.x, 740, 'the attacker does not lunge');
});

test('a bonk lands on one hamster only, the nearest', () => {
  const g = started(3);
  const [a, b, c] = g.players;
  place(a, 740, 100);
  place(b, 772, 100);
  place(c, 740, 136);
  step(g, [{ mx: 0, my: 0, bonk: true, ax: 0.7, ay: 0.7 }, IDLE, IDLE]);
  run(g, BONK.windup + 0.05);
  assert.equal(a.kills, 1);
  assert.equal(b.deaths, 1);
  assert.equal(c.deaths, 0);
});

test('two hits landing on the same tick knock out only one hamster', () => {
  const g = started();
  const [a, b] = g.players;
  place(a, 740, 100);
  place(b, 776, 100);
  step(g, [{ mx: 0, my: 0, bonk: true }, { mx: 0, my: 0, bonk: true }]);
  run(g, BONK.windup + 0.05);
  assert.equal(a.deaths + b.deaths, 1);
  assert.equal(a.kills + b.kills, 1);
});

test('a swing at thin air leaves the attacker stuck in recovery', () => {
  const g = started();
  const [a, b] = g.players;
  place(a, 740, 100);
  place(b, 740, 440);
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
  place(b, 135, 300);
  a.cooldown = 0;
  a.swing = null;
  step(g, [IDLE, IDLE]);
  step(g, [{ mx: 0, my: 0, bonk: true }, IDLE]);
  assert.equal(a.swing, null, 'cannot swing inside');
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

test('only the first hamster in the ring nibbles; the next waits its turn', () => {
  const g = started();
  const [a, b] = g.players;
  const f = MAP.flower;
  place(b, f.x, f.y + 50);
  step(g, []);
  place(a, f.x - 50, f.y);
  run(g, 1);
  assert.equal(g.nibbler, b.id);
  assert.ok(b.gather > 0.9);
  assert.equal(a.gather, 0, 'the latecomer makes no progress');
  run(g, GATHER_TIME);
  assert.equal(b.carrying, true);
  assert.equal(g.nibbler, a.id, 'then it is the next one\'s turn');
});

test('walking or bonking throws away nibbling progress', () => {
  const g = started();
  const [a, b] = g.players;
  const f = MAP.flower;
  place(a, f.x - 50, f.y);
  place(b, f.x - 50, 440);
  run(g, 1);
  assert.ok(a.gather > 0.9);
  step(g, [{ mx: 0, my: 1, bonk: false }]);
  assert.equal(a.gather, 0, 'walking resets it');
  run(g, 1);
  assert.ok(a.gather > 0.9);
  place(b, f.x + 50, f.y);
  step(g, []);
  step(g, [{ mx: 0, my: 0, bonk: true }]);
  assert.equal(a.gather, 0, 'bonking resets it');
  run(g, BONK.windup + BONK.recovery + 0.1);
  assert.equal(g.nibbler, b.id, 'and gives up the turn');
});

test('in overtime the burrow edge creeps towards the flower', () => {
  const g = started(1);
  g.time = OVERTIME.start;
  run(g, 10);
  assert.ok(Math.abs(g.homeX - (MAP.home.x2 + 10 * OVERTIME.speed)) < 1);
  assert.ok(inHome(g, { x: MAP.home.x2 + 20 }));
});

test('a seed slows its carrier, and slows it more on the last stretch home', () => {
  const g = started(2);
  const [a, b] = g.players;
  const y = MAP.rowYs[0];
  const pace = (p, x, carrying) => {
    place(p, x, y);
    p.carrying = carrying;
    place(p === a ? b : a, 600, MAP.rowYs[2]);
    step(g, p === a ? [{ mx: -1, my: 0, bonk: false }] : [IDLE, { mx: -1, my: 0, bonk: false }]);
    return -p.vx / SPEED;
  };
  assert.equal(pace(a, g.homeX + LAST_STRETCH.range + 40, false), 1);
  assert.equal(pace(a, g.homeX + LAST_STRETCH.range + 40, true), CARRY_SPEED);
  assert.equal(pace(b, g.homeX + LAST_STRETCH.range - 10, true), LAST_STRETCH.speed);
  assert.equal(pace(b, g.homeX + LAST_STRETCH.range - 10, false), 1);
  assert.equal(CARRY_SPEED, 0.85);
  assert.equal(LAST_STRETCH.speed, 0.7);
  // Wet fur takes another fifth of full speed off, on top: the shares add up.
  const wet = (p, x, carrying) => {
    p.wet = 2;
    const v = pace(p, x, carrying);
    p.wet = 0;
    return v;
  };
  const near = (v, want) => assert.ok(Math.abs(v - want) < 1e-9, `${v} is not ${want}`);
  near(wet(a, g.homeX + LAST_STRETCH.range + 40, false), 0.8);
  near(wet(a, g.homeX + LAST_STRETCH.range + 40, true), 0.65);
  near(wet(b, g.homeX + LAST_STRETCH.range - 10, true), 0.5);
});

test('a tunnel sends an empty-handed hamster home, but not one carrying a seed', () => {
  const g = started();
  const [a, b] = g.players;
  const w = MAP.warps[0];
  place(a, w.x, w.y + 5);
  place(b, w.x, MAP.warps[1].y);
  b.carrying = true;
  step(g, []);
  assert.deepEqual([a.x, a.y], [a.nest.x, a.nest.y]);
  assert.equal(a.deaths, 0, 'it is not a knock-out');
  assert.equal(b.y, MAP.warps[1].y, 'the carrier stays put');
  assert.equal(g.phase, 'playing');
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

test('eight hamsters start on separate nests and a bot game still finishes', () => {
  const g = createGame({ slots: Array.from({ length: 8 }, (_, i) => ({ name: `b${i}`, kind: 'bot' })), seed: 3 });
  for (let i = 0; i < 8; i++) {
    const p = g.players[i];
    assert.ok(inHome(g, p) && isFree(MAP, p.x, p.y, HAMSTER_R), `nest ${i}`);
    for (let j = i + 1; j < 8; j++) assert.ok(Math.hypot(p.x - g.players[j].x, p.y - g.players[j].y) >= 2 * HAMSTER_R);
  }
  const bots = g.players.map((_, i) => createBot({ difficulty: 'hard', seed: 50 + i }));
  for (let i = 0; i < 240 * TICK_RATE && g.phase !== 'over'; i++) step(g, bots.map((b, id) => b.think(g, id)));
  assert.equal(g.phase, 'over');
});

test('every waypoint is walkable and the graph connects home to the flower', () => {
  const nav = getNav(MAP);
  for (const w of MAP.waypoints) assert.ok(isFree(MAP, w.x, w.y, HAMSTER_R), `waypoint ${w.x},${w.y}`);
  for (const nest of [...MAP.nests, ...MAP.bigNests]) {
    for (const spot of MAP.gatherSpots) assert.ok(Number.isFinite(nav.distance(nest, spot)));
  }
});

test('a path goes around a lane that someone is standing in', () => {
  const nav = getNav(MAP);
  const y = MAP.laneYs[1];
  const from = { x: 170, y };
  const to = { x: 730, y };
  const open = nav.findPath(from, to).points;
  assert.ok(Math.abs(open[0].y - y) < 1, 'into the middle lane when it is free');
  const blocker = [{ x: 290, y, vx: 0, vy: 0 }];
  const around = nav.findPath(from, to, blockCost(MAP, blocker)).points;
  assert.ok(Math.abs(around[0].y - y) > 100, 'heads for another lane mouth instead');
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

function teamGame(teams) {
  const g = createGame({ slots: teams.map((team, i) => ({ name: `p${i}`, kind: 'human', team })), seed: 7 });
  for (let i = 0; i < COUNTDOWN * TICK_RATE + 2 && g.phase === 'countdown'; i++) step(g, []);
  return g;
}

test('team-mates walk through each other and cannot bonk each other', () => {
  const g = teamGame([0, 0, 1]);
  const [a, b, c] = g.players;
  const y = MAP.laneYs[1];
  place(a, 230, y);
  place(b, 300, y);
  place(c, 700, 100);
  run(g, 1, [{ mx: 1, my: 0, bonk: false }, IDLE, IDLE]);
  assert.ok(a.x > b.x + 2 * HAMSTER_R, `walked past the team-mate, x=${a.x}`);
  place(a, 300, y);
  place(b, 300 + 2 * HAMSTER_R, y);
  run(g, 0.5, [{ mx: 0, my: 0, bonk: true, ax: 1, ay: 0 }, IDLE, IDLE]);
  assert.equal(b.deaths, 0);
  assert.equal(a.kills, 0);
});

test('a rival is still solid and can be bonked in a team game', () => {
  const g = teamGame([0, 0, 1]);
  const [a, , c] = g.players;
  const y = MAP.laneYs[1];
  place(a, 230, y);
  place(c, 300, y);
  run(g, 1, [{ mx: 1, my: 0, bonk: false }, IDLE, IDLE]);
  assert.ok(a.x <= c.x - 2 * HAMSTER_R + 0.01, 'stopped behind the rival');
  run(g, 0.5, [{ mx: 0, my: 0, bonk: true, ax: 1, ay: 0 }, IDLE, IDLE]);
  assert.equal(c.deaths, 1);
});

test('one hamster bringing a seed home wins it for the team', () => {
  const g = teamGame([0, 0, 0, 1, 1]);
  const p = g.players[4];
  p.carrying = true;
  place(p, MAP.home.x2 - 30, MAP.laneYs[1]);
  step(g, []);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 4);
  assert.deepEqual(g.events.at(-1), { type: 'win', id: 4, team: 1 });
});

test('nests are dealt at random, team-mates included', () => {
  const orders = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const teams = [0, 1, 0, 1, 0];
    const g = createGame({ slots: teams.map((team, i) => ({ name: `p${i}`, kind: 'bot', team })), seed });
    orders.add([...g.players].sort((a, b) => a.nest.y - b.nest.y).map((p) => p.team).join(''));
    assert.equal(new Set(g.players.map((p) => p.nest)).size, 5);
  }
  // Not just the two line-ups that keep a team together.
  assert.ok(orders.size > 4, [...orders].join());
});

test('an uneven three against two bot game finishes', () => {
  const teams = [0, 0, 0, 1, 1];
  const g = createGame({ slots: teams.map((team, i) => ({ name: `p${i}`, kind: 'bot', team })), seed: 3 });
  const bots = teams.map((_, i) => createBot({ difficulty: 'hard', seed: 40 + i }));
  while (g.phase !== 'over' && g.tick < 400 * TICK_RATE) step(g, bots.map((b, i) => b.think(g, i)));
  assert.equal(g.phase, 'over');
});

test('late in overtime the burrow rushes to the flower, and a seed nibbled inside it wins on the spot', () => {
  const g = started(2);
  const [a, b] = g.players;
  const f = MAP.flower;
  const seen = [];
  // The rush is announced once, and from then on the edge comes on much faster.
  const g2 = started(1);
  g2.time = OVERTIME.rush - 0.1;
  for (let i = 0; i < 30; i++) {
    step(g2, []);
    seen.push(...g2.events.filter((ev) => ev.type === 'rush'));
  }
  assert.equal(seen.length, 1);
  const at = (t) => {
    const h = started(1);
    h.time = t;
    step(h, []);
    return h.homeX;
  };
  assert.ok(Math.abs(at(OVERTIME.rush + 5) - at(OVERTIME.rush) - 5 * OVERTIME.rushSpeed) < 1);
  assert.ok(OVERTIME.rushSpeed > 2 * OVERTIME.speed);
  // It is over the flower well before time is called.
  const arrives = OVERTIME.rush + (f.x - at(OVERTIME.rush)) / OVERTIME.rushSpeed;
  assert.ok(arrives < OVERTIME.end - 8, `the edge reaches the flower at ${arrives.toFixed(1)} s`);
  assert.equal(at(OVERTIME.end - 1), f.x, 'and stops there');
  // Standing on the burrow's side of the ring then: nobody can bonk it, and the
  // seed is home the moment it comes loose.
  g.time = OVERTIME.end - 6;
  place(a, f.x - 55, f.y);
  place(b, f.x - 55 - 32, f.y);
  step(g, []);
  assert.ok(inHome(g, a));
  const need = gatherTime(2, g.time);
  run(g, need - 0.2, [IDLE, { mx: 1, my: 0, bonk: true, ax: 1, ay: 0 }]);
  assert.equal(g.phase, 'playing');
  assert.equal(a.deaths, 0, 'no bonk lands inside the burrow');
  run(g, 0.4);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, a.id);
  assert.equal(g.timeout, false);
});

test('in overtime a seed comes loose quicker and quicker', () => {
  assert.equal(gatherTime(4, OVERTIME.start), GATHER_TIME);
  assert.ok(gatherTime(4, (OVERTIME.start + OVERTIME.rush) / 2) < GATHER_TIME * 0.8);
  assert.ok(Math.abs(gatherTime(4, OVERTIME.rush) - GATHER_TIME * OVERTIME.nibble) < 1e-9);
  assert.ok(Math.abs(gatherTime(4, OVERTIME.end) - GATHER_TIME * OVERTIME.nibble) < 1e-9, 'and no quicker after that');
  assert.ok(Math.abs(gatherTime(8, OVERTIME.rush) - (GATHER_TIME * OVERTIME.nibble) / 2) < 1e-9, 'on top of the crowd');
  assert.ok(GATHER_TIME * OVERTIME.nibble >= 0.9, 'never so quick that nobody can get there to stop it');
});

test('in overtime a knocked-out hamster sits dazed at its nest; before overtime it is off at once', () => {
  const bonked = (time) => {
    const g = started(2);
    const [a, b] = g.players;
    g.time = time;
    place(a, 740, 100);
    place(b, 740 + 2 * HAMSTER_R + 2, 100);
    step(g, [{ mx: 0, my: 0, bonk: true, ax: 1, ay: 0 }, IDLE]);
    run(g, BONK.windup + 0.05, [IDLE, IDLE]);
    assert.equal(b.deaths, 1);
    return { g, b };
  };
  const early = bonked(10);
  assert.equal(early.b.dazed, 0);
  const x0 = early.b.x;
  run(early.g, 0.3, [IDLE, { mx: 1, my: 0, bonk: false }]);
  assert.ok(early.b.x > x0 + 20, 'before overtime it walks straight off');

  const late = bonked(OVERTIME.start + 5);
  assert.ok(late.b.dazed > OVERTIME.daze - 0.1);
  const x1 = late.b.x;
  run(late.g, OVERTIME.daze - 0.15, [IDLE, { mx: 1, my: 0, bonk: true, ax: 1, ay: 0 }]);
  assert.equal(late.b.x, x1, 'dazed: it does not move');
  assert.equal(late.b.swing, null, 'and does not swing');
  run(late.g, 0.5, [IDLE, { mx: 1, my: 0, bonk: false }]);
  assert.ok(late.b.x > x1 + 20, 'then it is off again');
  assert.equal(late.b.dazed, 0);
});

test('more hamsters nibble a seed loose faster', () => {
  assert.equal(gatherTime(2), GATHER_TIME);
  assert.equal(gatherTime(4), GATHER_TIME);
  assert.ok(Math.abs(gatherTime(6) - (GATHER_TIME * 2) / 3) < 1e-9);
  assert.equal(gatherTime(8), GATHER_TIME / 2);
});

test('when time runs out the most bonks win, then fewest deaths, then seeds, then a shared win', () => {
  const end = (edit) => {
    const g = createGame({ slots: Array.from({ length: 4 }, (_, i) => ({ name: `p${i}`, kind: 'bot' })), seed: 3 });
    run(g, COUNTDOWN + 0.1);
    edit(g.players);
    g.time = OVERTIME.end;
    step(g, g.players.map(() => ({ mx: 0, my: 0, bonk: false })));
    assert.equal(g.phase, 'over');
    assert.equal(g.timeout, true);
    return g.winners;
  };
  assert.deepEqual(end((p) => { p[2].kills = 3; p[1].kills = 2; }), [2]);
  assert.deepEqual(end((p) => { p[2].kills = 3; p[1].kills = 3; p[2].deaths = 1; }), [1]);
  assert.deepEqual(end((p) => { p[0].seeds = 1; p[3].seeds = 2; }), [3]);
  assert.deepEqual(end(() => {}), [0, 1, 2, 3]);
  assert.deepEqual(end((p) => { p[0].kills = 1; p[3].kills = 1; }), [0, 3]);
});

test('a round that ran out of time says what settled it', () => {
  const side = (kills, deaths = 0, seeds = 0, throws = 0) => ({ id: 0, team: -1, kills, deaths, seeds, throws });
  const reason = (...players) => timeoutReason(players.map((p, id) => ({ ...p, id })));
  assert.deepEqual(reason(side(3), side(2)), { by: 'bonks', n: 3 });
  // A thrown seed counts as a bonk.
  assert.deepEqual(reason(side(1, 0, 0, 3), side(3)), { by: 'bonks', n: 4 });
  assert.deepEqual(reason(side(3, 2), side(3, 1)), { by: 'bonked', n: 1 });
  assert.deepEqual(reason(side(3, 1, 1), side(3, 1, 2)), { by: 'seeds', n: 2 });
  assert.equal(reason(side(3, 1, 1), side(3, 1, 1)).by, 'tie');
  // A team is one side.
  assert.deepEqual(reason({ ...side(2), team: 0 }, { ...side(2), team: 0 }, { ...side(3), team: 1 }), { by: 'bonks', n: 4 });
});

test('a bonk on overlapping team-mates takes the whole clump, but not one standing apart', () => {
  const g = teamGame([0, 0, 0, 1]);
  const [a, b, c, d] = g.players;
  const y = MAP.laneYs[1];
  place(d, 230, y);
  place(a, 230 + 2 * HAMSTER_R + 2, y);
  place(b, 230 + 2 * HAMSTER_R + 12, y);
  place(c, 230 + 5 * HAMSTER_R, y);
  run(g, 0.5, [IDLE, IDLE, IDLE, { mx: 0, my: 0, bonk: true, ax: 1, ay: 0 }]);
  assert.deepEqual([a.deaths, b.deaths, c.deaths], [1, 1, 0]);
  assert.equal(d.kills, 2);
});

test('several hamsters down in one swing is reported, and so is a seed stopped near home', () => {
  const seen = [];
  const swing = (g, n) => {
    for (let i = 0; i < 0.5 * TICK_RATE; i++) {
      step(g, [...Array(n - 1).fill(IDLE), { mx: 0, my: 0, bonk: true, ax: 1, ay: 0 }]);
      seen.push(...g.events.map((e) => ({ ...e })));
    }
  };
  const g = teamGame([0, 0, 0, 1]);
  const [a, b, c, d] = g.players;
  const y = MAP.laneYs[1];
  place(d, 230, y);
  for (const p of [a, b, c]) place(p, 230 + 2 * HAMSTER_R + 2, y);
  a.carrying = true;
  swing(g, 4);
  assert.deepEqual(seen.filter((e) => e.type === 'multi'), [{ type: 'multi', by: 3, n: 3 }]);
  assert.equal(d.supers, 1, 'three at once that also stops a seed is still one super play');
  // Only the one with the seed counts as stopped at the door.
  assert.deepEqual(seen.filter((e) => e.type === 'bonk' && e.close).map((e) => e.id), [0]);

  // One rival carrying a seed far from home: an ordinary bonk.
  seen.length = 0;
  const far = teamGame([0, 1]);
  place(far.players[1], 720, 200);
  place(far.players[0], 720 + 2 * HAMSTER_R + 2, 200);
  far.players[0].carrying = true;
  swing(far, 2);
  assert.deepEqual(seen.filter((e) => e.type === 'bonk').map((e) => e.close), [false]);
  assert.equal(seen.filter((e) => e.type === 'multi').length, 0);
});

test('a bot does not follow a seed carrier into a tunnel, and bonks it from the rim', () => {
  for (const [spot, difficulty] of [[[0, 0], 'hard'], [[0, -18], 'hard'], [[20, 6], 'normal'], [[-12, 14], 'easy']]) {
    for (const w of MAP.warps) {
      const g = started(2);
      const [bot, carrier] = g.players;
      const brain = createBot({ difficulty, seed: 3 });
      const inward = w.y < MAP.flower.y ? 1 : -1;
      place(bot, w.x - 10, w.y + inward * 110);
      place(carrier, w.x + spot[0], w.y + inward * spot[1]);
      carrier.carrying = true;
      const warped = [];
      for (let i = 0; i < 8 * TICK_RATE && !carrier.deaths; i++) {
        step(g, [brain.think(g, 0), IDLE]);
        warped.push(...g.events.filter((ev) => ev.type === 'warp'));
      }
      assert.equal(warped.length, 0, `${difficulty} bot walked into the tunnel`);
      // Easier bots sometimes let a carrier go, which is their choice to make.
      if (difficulty === 'hard') assert.equal(carrier.deaths, 1, `bot never reached the carrier at ${spot}`);
    }
  }
});

test('a bot is not drawn into a tunnel round its far side, where the map edge leaves no way past', () => {
  // A carrier tucked into the part of the tunnel nearest the map's edge, and a bot
  // coming at it from the side: the short way round is along the edge, and there
  // is no room there.
  for (const difficulty of ['hard', 'ace']) {
    for (const w of MAP.warps) {
      const edge = w.y < MAP.flower.y ? -1 : 1;
      for (const [cx, cy, bx] of [[22, 18, -90], [-22, 18, 90], [28, 8, -90], [-28, 8, 90], [0, 26, 90], [14, 25, -90]]) {
        const g = started(2);
        const [bot, carrier] = g.players;
        const brain = createBot({ difficulty, seed: 3 });
        place(bot, w.x + bx, w.y);
        place(carrier, w.x + cx, w.y + edge * cy);
        carrier.carrying = true;
        let warped = 0;
        for (let i = 0; i < 8 * TICK_RATE && !carrier.deaths; i++) {
          step(g, [brain.think(g, 0), IDLE]);
          warped += g.events.filter((ev) => ev.type === 'warp' && ev.id === 0).length;
        }
        assert.equal(warped, 0, `${difficulty} bot went in after a carrier at ${cx},${cy}`);
      }
    }
  }
});

test('a bot swings at a hamster pressing into it, not away from it', () => {
  const me = { x: 300, y: 260 };
  // Touching and charging: carried on at full speed it would be 16px behind me.
  const charging = { x: 300 + 2 * HAMSTER_R, y: 260, vx: -185, vy: 0, swing: null };
  const p = predictSwing(me, charging, 0.25);
  assert.ok(p.ax > 0.99, `aims at it, ax=${p.ax}`);
  assert.ok(p.dist <= 2 * HAMSTER_R + 0.01);
  // One still on its way in is led as before.
  const far = predictSwing(me, { x: 400, y: 260, vx: -185, vy: 0, swing: null }, 0.25);
  assert.ok(Math.abs(far.dist - (100 - 185 * 0.25)) < 0.01);
});

test('two hard bots that meet in a lane do not stand there swinging at thin air', () => {
  let clinched = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const g = createGame({ slots: Array.from({ length: 6 }, (_, i) => ({ name: `b${i}`, kind: 'bot' })), seed });
    const bots = g.players.map((_, i) => createBot({ difficulty: 'hard', seed: seed * 97 + i * 13 + 5 }));
    const close = new Map();
    while (g.phase !== 'over') {
      step(g, bots.map((b, i) => b.think(g, i)));
      for (const a of g.players) {
        for (const b of g.players) {
          if (a.id >= b.id) continue;
          const key = a.id * 10 + b.id;
          const near = Math.hypot(a.x - b.x, a.y - b.y) < BONK.reach + 4 && !inHome(g, a) && !inHome(g, b);
          close.set(key, near ? (close.get(key) || 0) + 1 : 0);
          if (close.get(key) === 2 * TICK_RATE) clinched++;
        }
      }
    }
  }
  assert.equal(clinched, 0);
});

test('a bot sometimes fetches a second seed while a team-mate carries one, and sometimes escorts', () => {
  const teams = [0, 0, 1, 1];
  let both = 0;
  let escorted = 0;
  for (let n = 0; n < 12; n++) {
    const g = createGame({ slots: teams.map((team, i) => ({ name: `b${i}`, kind: 'bot', team })), seed: n + 1 });
    const bots = teams.map((_, i) => createBot({ difficulty: 'hard', seed: n * 97 + i * 13 + 5 }));
    let pair = false;
    while (g.phase !== 'over' && g.tick < 200 * TICK_RATE) {
      step(g, bots.map((b, i) => b.think(g, i)));
      pair ||= [0, 1].some((team) => g.players.filter((p) => p.team === team && p.carrying).length === 2);
    }
    if (pair) both++;
    else escorted++;
  }
  assert.ok(both > 0, 'no team ever carried two seeds at once');
  assert.ok(escorted > 0, 'every game had a team carrying two seeds');
});

test('bonks in quick succession chain into a double and a triple, and a pause or a knock-out ends the chain', () => {
  const g = started(4);
  const [a, b, c, d] = g.players;
  const multis = [];
  const bonk = (victim, wait) => {
    run(g, wait);
    place(a, 720, 200);
    place(victim, 720 + 2 * HAMSTER_R + 2, 200);
    for (let i = 0; i < 0.3 * TICK_RATE; i++) {
      step(g, [{ mx: 0, my: 0, bonk: i === 0, ax: 1, ay: 0 }]);
      multis.push(...g.events.filter((e) => e.type === 'multi').map((e) => e.n));
    }
  };
  bonk(b, 0);
  bonk(c, BONK.cooldown - 0.25);
  bonk(d, BONK.cooldown - 0.25);
  assert.deepEqual(multis, [2, 3]);
  assert.equal(a.kills, 3);
  assert.equal(a.supers, 1, 'the triple is a super play');
  bonk(b, BONK.chain + 0.5);
  assert.deepEqual(multis, [2, 3], 'too late to carry on the chain');
  bonk(c, BONK.cooldown - 0.25);
  assert.deepEqual(multis, [2, 3, 2]);
});

test('a held and released throw sends the seed along the way the hamster faces, taking every rival in its path', () => {
  const HOLD = { mx: 0, my: 0, bonk: false, throw: true };
  const setup = (teams) => {
    const g = teamGame(teams);
    const [a, b, c, d, e] = g.players;
    place(a, 720, 200);
    a.fx = 1;
    a.fy = 0;
    a.carrying = true;
    place(b, 720 + 2 * HAMSTER_R + 4, 200);
    place(c, 720 + THROW.range - 4, 204);
    place(d, 720 + THROW.range + 2 * HAMSTER_R, 200);
    place(e, 780, 200 + THROW.width + 2 * HAMSTER_R);
    return g;
  };

  // Let go too early and nothing happens.
  let g = setup([-1, -1, -1, -1, -1]);
  run(g, THROW.charge - 0.1, [HOLD]);
  run(g, 0.1);
  assert.equal(g.players[0].carrying, true);
  assert.equal(g.players[1].deaths, 0);

  g = setup([-1, -1, -1, -1, -1]);
  run(g, THROW.charge + 0.05, [HOLD]);
  assert.ok(g.players[0].charge >= THROW.charge, 'wound up while held');
  step(g, []);
  assert.deepEqual(g.events.find((ev) => ev.type === 'throw'), { type: 'throw', id: 0, x: 720, y: 200, dx: 1, dy: 0, hit: 2 });
  assert.deepEqual(g.events.filter((ev) => ev.type === 'multi'), [{ type: 'multi', by: 0, n: 2 }]);
  assert.equal(g.players[0].carrying, false, 'the seed is gone');
  assert.deepEqual(g.players.map((p) => p.deaths), [0, 1, 1, 0, 0], 'out of range and off to the side are safe');
  assert.equal(g.players[0].throws, 2, 'counted as throws');
  assert.equal(g.players[0].kills, 0, 'and not as bonks');

  // A team-mate standing in the path is not hurt.
  g = setup([0, 0, 1, 1, 1]);
  run(g, THROW.charge + 0.05, [HOLD]);
  step(g, []);
  assert.deepEqual(g.players.map((p) => p.deaths), [0, 0, 1, 0, 0]);
});

test('a throw does not reach into the burrow', () => {
  const g = started(3);
  const [a, b, c] = g.players;
  const y = MAP.laneYs[1];
  place(a, MAP.home.x2 + 40, y);
  a.fx = -1;
  a.fy = 0;
  a.carrying = true;
  place(b, MAP.home.x2 - 30, y);
  place(c, 700, 200);
  run(g, THROW.charge + 0.05, [{ mx: 0, my: 0, bonk: false, throw: true }]);
  step(g, []);
  assert.equal(a.carrying, false);
  assert.equal(b.deaths, 0, 'safe inside the burrow');
});

test('a hamster winding up a throw turns freely, and the seed goes the way it faces when it leaves', () => {
  const thrown = (g) => {
    for (let i = 0; i < 3 * TICK_RATE; i++) {
      const ev = g.events.find((e) => e.type === 'throw');
      if (ev) return ev;
      step(g, []);
    }
    return g.events.find((e) => e.type === 'throw');
  };
  const carrier = () => {
    const g = started(1);
    const a = g.players[0];
    place(a, 760, 120);
    a.fx = 1;
    a.fy = 0;
    a.carrying = true;
    return g;
  };

  // The press swings first, as the keyboard does, and the hamster still turns during it.
  let g = carrier();
  run(g, 0.2, [{ mx: 0, my: 0, bonk: true, throw: true }]);
  run(g, 0.3, [{ mx: 0, my: -1, bonk: true, throw: true }]);
  assert.ok(g.players[0].swing, 'still inside the swing');
  run(g, 0.1, [{ mx: -1, my: 0, bonk: true, throw: true }]);
  const ev = thrown(g);
  assert.deepEqual([ev.dx, ev.dy], [-1, 0], 'thrown the last way it turned');

  // Held all the way, it lets go by itself, facing wherever it faces then.
  g = carrier();
  run(g, THROW.max - 0.2, [{ mx: 0, my: 0, bonk: false, throw: true }]);
  assert.equal(g.players[0].carrying, true);
  let auto = null;
  for (let i = 0; i < 0.3 * TICK_RATE && !auto; i++) {
    step(g, [{ mx: 0, my: 1, bonk: false, throw: true }]);
    auto = g.events.find((e) => e.type === 'throw');
  }
  assert.deepEqual([auto.dx, auto.dy], [0, 1]);
  assert.equal(g.players[0].carrying, false);
  run(g, 0.5, [{ mx: 0, my: 1, bonk: false, throw: true }]);
  assert.equal(g.players[0].charge, 0, 'nothing left to wind up');
});

test('a hard bot carrying a seed throws it at two rivals lined up in its way', () => {
  const g = started(3);
  const [bot, a, b] = g.players;
  const brain = createBot({ difficulty: 'hard', seed: 5 });
  // In the top lane on the way home, still well out from the burrow, with both
  // rivals further down the same lane.
  const y = MAP.rowYs[1];
  place(bot, 560, y);
  bot.carrying = true;
  place(a, 485, y);
  place(b, 450, y);
  const thrown = [];
  for (let i = 0; i < 3 * TICK_RATE && !thrown.length; i++) {
    step(g, [brain.think(g, 0), IDLE, IDLE]);
    thrown.push(...g.events.filter((ev) => ev.type === 'throw'));
  }
  assert.equal(thrown.length, 1);
  assert.equal(thrown[0].hit, 2);
  assert.equal(a.deaths + b.deaths, 2);
  assert.equal(bot.deaths, 0);
});

test('a bot whose throw target gets away keeps its seed', () => {
  const g = started(2);
  const [bot, a] = g.players;
  const brain = createBot({ difficulty: 'hard', seed: 5 });
  const y = MAP.rowYs[1];
  let wound = 0;
  for (let tries = 0; tries < 40 && !wound; tries++) {
    place(bot, 560, y);
    bot.carrying = true;
    place(a, 475, y);
    for (let i = 0; i < 0.3 * TICK_RATE; i++) step(g, [brain.think(g, 0), IDLE]);
    wound = bot.charge;
  }
  assert.ok(wound > 0.1, 'the bot started winding up a throw at the blocker');
  // The blocker vanishes into its nest.
  place(a, a.nest.x, a.nest.y);
  const thrown = [];
  for (let i = 0; i < 2.5 * TICK_RATE; i++) {
    step(g, [brain.think(g, 0), IDLE]);
    thrown.push(...g.events.filter((ev) => ev.type === 'throw'));
  }
  assert.equal(thrown.length, 0);
  assert.equal(bot.carrying, true);
});
