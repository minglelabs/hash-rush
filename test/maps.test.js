import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step } from '../src/sim/game.js';
import { createBot, DIFFICULTY } from '../src/ai/bot.js';
import { getNav } from '../src/ai/nav.js';
import { HAZARD, SKY, gatesNow, kindsNow, iceNow, hazardCost } from '../src/sim/hazards.js';
import { COUNTDOWN, HAMSTER_R, ICE, SPEED, TICK_RATE } from '../src/sim/constants.js';
import { MAPS, MAP_IDS, MAP, gatesAt, isFree } from '../src/sim/map.js';

const IDLE = { mx: 0, my: 0, bonk: false };

// A game on `map` past the countdown, with the map's own trouble switched off
// unless asked for, so a test can stage exactly one thing.
function playing(map, count = 2, quiet = true) {
  const g = createGame({ slots: Array.from({ length: count }, (_, i) => ({ name: `p${i}`, kind: 'human' })), seed: 5, map });
  for (let i = 0; i < COUNTDOWN * TICK_RATE + 2 && g.phase === 'countdown'; i++) step(g, []);
  if (quiet) g.calm = true;
  return g;
}

const run = (g, seconds, inputs = []) => {
  for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) step(g, inputs);
};

test('the meadow is the default map and every map has its own lanes', () => {
  assert.equal(MAP, MAPS.meadow);
  assert.deepEqual(MAP_IDS, ['meadow', 'desert', 'factory', 'ice', 'beach', 'graveyard', 'sky']);
  const shapes = MAP_IDS.map((id) => MAPS[id].rects.map((r) => `${r.x},${r.y},${r.w},${r.h}`).join());
  assert.equal(new Set(shapes).size, MAP_IDS.length);
});

test('on every map the waypoints are walkable, the nests are free and each lane mouth leads to the flower', () => {
  for (const id of MAP_IDS) {
    const map = MAPS[id];
    const nav = getNav(map);
    for (const p of map.waypoints) assert.ok(isFree(map, p.x, p.y, 10), `${id} waypoint ${p.x},${p.y}`);
    for (const n of [...map.nests, ...map.bigNests]) assert.ok(isFree(map, n.x, n.y, HAMSTER_R), `${id} nest`);
    assert.ok(map.laneYs.length >= 3, `${id} has three ways in`);
    for (const y of map.laneYs) {
      const d = nav.distance({ x: 80, y }, map.gatherSpots[4]);
      assert.ok(d > 500 && d < 1300, `${id} from y=${y}: ${d}`);
    }
  }
});

test('a bot round runs to the end on every map, and what the map throws stays out of the burrow', () => {
  for (const id of MAP_IDS) {
    const map = MAPS[id];
    const g = createGame({ slots: Array.from({ length: 4 }, (_, i) => ({ name: `b${i}`, kind: 'bot' })), seed: 9, map });
    const bots = g.players.map((_, i) => createBot({ difficulty: 'normal', seed: 31 + i }));
    const most = {};
    while (g.phase !== 'over') {
      step(g, bots.map((b, i) => b.think(g, i)));
      for (const h of g.hazards) {
        assert.ok(h.x > map.home.x2 + 30, `${id}: ${h.kind} at x=${h.x}`);
        const now = g.hazards.filter((o) => o.kind === h.kind).length;
        most[h.kind] = Math.max(most[h.kind] || 0, now);
      }
    }
    assert.equal(g.phase, 'over');
    const kinds = map.cycle ? ['cannon', 'trap', 'wave'] : map.hazard ? [map.hazard] : [];
    assert.deepEqual(Object.keys(most).sort(), [...kinds].sort(), id);
    for (const kind of kinds) assert.ok(most[kind] <= HAZARD[kind].max, `${id}: ${most[kind]} ${kind}s at once`);
  }
});

test('ice takes time to get going on, to stop on and to turn round on; ordinary floor does not', () => {
  const map = MAPS.ice;
  const rink = map.ice[0];
  const g = playing(map, 1);
  const p = g.players[0];
  p.x = rink.x + 30;
  p.y = rink.y + rink.h / 2;
  run(g, ICE.ramp / 2, [{ mx: 1, my: 0, bonk: false }]);
  assert.ok(Math.abs(p.vx - SPEED / 2) < 8, `half speed half way up: ${p.vx}`);
  run(g, ICE.ramp / 2 + 0.05, [{ mx: 1, my: 0, bonk: false }]);
  assert.ok(Math.abs(p.vx - SPEED) < 1, `full speed: ${p.vx}`);
  // Steering back the other way: it is still sliding forwards a moment later.
  p.x = rink.x + 30;
  run(g, 0.2, [{ mx: -1, my: 0, bonk: false }]);
  assert.ok(p.vx > 0, `still going forwards: ${p.vx}`);
  // Letting go: it coasts to a stop rather than stopping dead.
  p.x = rink.x + 30;
  p.vx = SPEED;
  run(g, 0.2);
  assert.ok(p.vx > 0 && p.vx < SPEED);
  run(g, ICE.ramp);
  assert.equal(p.vx, 0);

  // Off the ice it is instant, as on every other map.
  p.x = 60;
  p.y = 280;
  step(g, [{ mx: 1, my: 0, bonk: false }]);
  assert.equal(p.vx, SPEED);
  step(g, []);
  assert.equal(p.vx, 0);
});

test('a mole pit warns first, then takes whoever steps on it and is gone; nobody is credited', () => {
  const g = playing(MAPS.desert, 2);
  const [a, b] = g.players;
  const spot = MAPS.desert.cells.find((c) => c.x > 400);
  a.x = spot.x;
  a.y = spot.y;
  b.x = 60;
  g.hazards.push({ kind: 'trap', x: spot.x, y: spot.y, age: 0 });
  run(g, HAZARD.trap.warn - 0.1);
  assert.equal(a.deaths, 0, 'safe while it is still being dug');
  run(g, 0.2);
  assert.equal(a.deaths, 1);
  assert.equal(b.kills, 0);
  assert.equal(g.hazards.length, 0, 'sprung pits disappear');

  // Left alone, it caves in by itself.
  g.hazards.push({ kind: 'trap', x: spot.x, y: spot.y, age: 0 });
  run(g, HAZARD.trap.warn + HAZARD.trap.live + 0.1);
  assert.equal(g.hazards.length, 0);
  assert.equal(a.deaths, 1);
});

test('a cannon warns first, then knocks out everyone in its line of fire and nobody beside it', () => {
  const map = MAPS.factory;
  const g = playing(map, 4);
  const [a, b, c, d] = g.players;
  // Firing east along a straight passage: the run across the middle of the floor.
  const y = map.rowYs[6];
  const x0 = 390;
  const h = { kind: 'cannon', x: x0, y, dx: 1, dy: 0, age: 0 };
  a.x = x0 + 30;
  b.x = x0 + HAZARD.cannon.range - 5;
  c.x = x0 + HAZARD.cannon.range + 40;
  for (const p of [a, b, c]) p.y = y;
  d.x = 60;
  d.y = 280;
  g.hazards.push(h);
  run(g, HAZARD.cannon.warn - 0.1);
  assert.deepEqual(g.players.map((p) => p.deaths), [0, 0, 0, 0]);
  // The seed takes each hamster as it reaches it: the near one first.
  const order = [];
  for (let i = 0; i < 0.6 * TICK_RATE; i++) {
    step(g, []);
    for (const e of g.events) if (e.type === 'zap') order.push(e.id);
  }
  assert.deepEqual(order, [0, 1]);
  assert.deepEqual(g.players.map((p) => p.deaths), [1, 1, 0, 0]);
  assert.equal(g.hazards.length, 0, 'the cannon is gone once its seed has landed');

  // Stepping into the line behind the seed is safe; standing where it has yet to
  // get to is not.
  const g2 = playing(map, 2);
  const [late, ahead] = g2.players;
  late.x = 60;
  ahead.x = x0 + HAZARD.cannon.range - 10;
  ahead.y = y;
  g2.hazards.push({ kind: 'cannon', x: x0, y, dx: 1, dy: 0, age: 0 });
  run(g2, HAZARD.cannon.warn + 0.12);
  assert.equal(ahead.deaths, 0, 'the seed has not got that far yet');
  late.x = x0 + 20;
  late.y = y;
  run(g2, 0.4);
  assert.equal(late.deaths, 0, 'it had already gone past');
  assert.equal(ahead.deaths, 1);
});

test('a wave leaves hamsters wet and a tenth slower for a while', () => {
  const g = playing(MAPS.beach, 2);
  const [a, b] = g.players;
  a.x = 780;
  a.y = 120;
  b.x = 780;
  b.y = 440;
  g.hazards.push({ kind: 'wave', x: 780, y: 120, age: 0 });
  run(g, HAZARD.wave.warn - 0.1, [{ mx: 0, my: 0, bonk: false }]);
  assert.equal(a.wet, 0, 'dry until it lands');
  run(g, 0.3);
  assert.ok(Math.abs(a.wet - HAZARD.wave.wet) < 0.02, 'wet for the full five seconds while in the water');
  assert.equal(HAZARD.wave.wet, 5);
  assert.equal(HAZARD.wave.slow, 0.2);
  assert.equal(b.wet, 0);
  step(g, [{ mx: 0, my: -1, bonk: false }, { mx: 0, my: 1, bonk: false }]);
  assert.ok(Math.abs(Math.abs(a.vy) - SPEED * (1 - HAZARD.wave.slow)) < 1e-6, `wet speed ${a.vy}`);
  assert.ok(Math.abs(b.vy - SPEED) < 1e-6);
  // Out of the water it lasts five more seconds, not for ever.
  run(g, HAZARD.wave.live);
  assert.equal(g.hazards.length, 0);
  const left = a.wet;
  run(g, left - 0.2);
  assert.ok(a.wet > 0);
  run(g, 0.4);
  assert.equal(a.wet, 0, 'dries off');
});

test('a gate slides only along its own length, and nobody walks or bonks through it while it is shut', () => {
  const map = MAPS.graveyard;
  for (let time = 0; time < 20; time += 0.37) {
    gatesAt(map, time).forEach((r, i) => {
      const def = map.gates[i];
      assert.equal(def.h > def.w ? 'y' : 'x', def.axis, 'a tall gate moves up and down, a wide one sideways');
      if (def.axis === 'y') assert.equal(r.x, def.x);
      else assert.equal(r.y, def.y);
    });
  }
  // The first door across the avenue is shut at the start of its cycle.
  const door = map.gates[2];
  const g = playing(map, 2);
  g.time = door.period - door.offset + 0.01 - 1 / TICK_RATE;
  const [a, b] = g.players;
  const y = door.y + door.h / 2;
  a.x = door.x - 40;
  a.y = y;
  b.x = door.x + door.w + HAMSTER_R + 2;
  b.y = y;
  run(g, 1.2, [{ mx: 1, my: 0, bonk: false }]);
  assert.ok(a.x <= door.x - HAMSTER_R + 0.5, `held at the gate: x=${a.x}`);
  run(g, 0.4, [{ mx: 0, my: 0, bonk: true, ax: 1, ay: 0 }]);
  assert.equal(b.deaths, 0, 'no bonking through the bars');
  // Once it has slid away, the way is open.
  g.time = door.period - door.offset + door.period / 2 + 0.3;
  b.x = 60;
  b.y = 60;
  run(g, 0.6, [{ mx: 1, my: 0, bonk: false }]);
  assert.ok(a.x > door.x + door.w, `through: x=${a.x}`);
});

test('a gate the burrow has grown over in overtime is gone', () => {
  const map = MAPS.graveyard;
  assert.equal(gatesNow(map, 3, map.home.x2).length, map.gates.length);
  const strip = map.gates[0];
  const grown = gatesNow(map, 3, strip.x + strip.w + 1);
  assert.equal(grown.length, map.gates.length - 2, 'both gates in front of the burrow are swallowed');
  assert.ok(grown.every((r) => r.x + r.w / 2 >= strip.x + strip.w + 1));
  // In a round: a hamster walks straight across where the gate was.
  const g = playing(map, 1);
  g.time = 60;
  const p = g.players[0];
  for (let i = 0; i < 20 * TICK_RATE && g.homeX < strip.x + strip.w + 20; i++) step(g, []);
  p.x = strip.x - 30;
  p.y = map.laneYs[2];
  run(g, 0.6, [{ mx: 1, my: 0, bonk: false }]);
  assert.ok(p.x > strip.x + strip.w + 20, `walked through: x=${p.x}`);
});

test('the sky has pits and waves by day, gates and ice by night, and cannons all the time', () => {
  const map = MAPS.sky;
  const day = SKY.night / 2;
  const night = SKY.night + 5;
  assert.deepEqual(kindsNow(map, day), ['cannon', 'trap', 'wave']);
  assert.deepEqual(kindsNow(map, night), ['cannon']);
  assert.deepEqual(kindsNow(map, SKY.period + day), ['cannon', 'trap', 'wave'], 'and round again');
  assert.equal(iceNow(map, day).length, 0);
  assert.equal(iceNow(map, night).length, map.ice.length);
  assert.equal(gatesNow(map, day, map.home.x2).length, 0);
  assert.equal(gatesNow(map, night, map.home.x2).length, map.gates.length);
  // Other maps keep theirs the whole time.
  assert.equal(iceNow(MAPS.ice, day).length, MAPS.ice.ice.length);
  assert.equal(gatesNow(MAPS.graveyard, day, 150).length, MAPS.graveyard.gates.length);

  // The same patch of floor: ordinary by day, slippery by night.
  const g = playing(map, 1);
  const p = g.players[0];
  const patch = map.ice[0];
  const stand = () => {
    p.x = patch.x + 60;
    p.y = patch.y + patch.h / 2;
    p.vx = 0;
  };
  stand();
  step(g, [{ mx: 1, my: 0, bonk: false }]);
  assert.equal(p.vx, SPEED);
  g.time = night;
  stand();
  step(g, [{ mx: 1, my: 0, bonk: false }]);
  assert.ok(p.vx > 0 && p.vx < SPEED / 4, `still getting going: ${p.vx}`);
});

test('the hard and top bots time a cannon: a line they can be through before it fires is no obstacle', () => {
  assert.equal(DIFFICULTY.hard.nerve, true);
  assert.equal(DIFFICULTY.ace.nerve, true);
  assert.equal(DIFFICULTY.normal.nerve, undefined, 'the weaker bots stop as soon as it shows');
  const map = MAPS.factory;
  const spot = map.cannonSpots[0];
  // A leg that comes into the cannon's line near its mouth.
  const mid = { x: spot.x + spot.dx * 20, y: spot.y + spot.dy * 20 };
  const p = { x: mid.x - spot.dy * 30, y: mid.y + spot.dx * 30 };
  const q = { x: mid.x + spot.dy * 30, y: mid.y - spot.dx * 30 };
  const cost = (age, pace) => hazardCost({ map, gates: [], hazards: [{ kind: 'cannon', ...spot, age }] }, pace)(p, q);
  const near = { x: p.x, y: p.y, v: SPEED };
  const far = { x: p.x - spot.dy * 600, y: p.y + spot.dx * 600, v: SPEED };
  assert.ok(cost(0) > 0, 'without timing, a warned line is trouble from the start');
  assert.equal(cost(0, near), 0, 'just warned and right beside it: through long before it fires');
  assert.ok(cost(HAZARD.cannon.warn - 0.3, near) > 0, 'about to fire: wait');
  assert.equal(cost(0.2, far), 0, 'too far off to matter: the seed has landed before it gets there');
});
