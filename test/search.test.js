import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step } from '../src/sim/game.js';
import { createBot, DIFFICULTY } from '../src/ai/bot.js';
import { createPlanner } from '../src/ai/search.js';
import { getNav } from '../src/ai/nav.js';
import { BONK, COUNTDOWN, TICK_RATE } from '../src/sim/constants.js';
import { MAPS } from '../src/sim/map.js';

const f0 = MAPS.meadow.flower;
const g0 = MAPS.meadow;

const game = (kinds, seed, map = MAPS.meadow) => {
  const g = createGame({ slots: kinds.map((k, i) => ({ name: `${k}${i}`, kind: 'bot' })), seed, map });
  const bots = kinds.map((difficulty, i) => createBot({ difficulty, seed: seed * 97 + i * 13 + 5 }));
  return { g, bots };
};

test('the top bot has the hard bot\'s hands and adds looking ahead and footwork', () => {
  const { search, dance, poach, wary, clock, boxed, toss, trail, lure, ...hands } = DIFFICULTY.ace;
  assert.ok(trail > BONK.reach + BONK.windup * 166, 'it follows from beyond where a turn and a swing would reach');
  assert.ok(lure > BONK.reach, 'the dash at a nibbling rival turns back outside its reach');
  assert.ok(clock > 0);
  assert.ok(boxed > 0);
  assert.equal(toss, 0, 'no seed gambled on a single rival');
  delete hands.toss;
  const { toss: hardToss, ...hardHands } = DIFFICULTY.hard;
  assert.ok(hardToss > 0);
  assert.equal(search, true);
  assert.equal(dance, true);
  assert.equal(poach, 2);
  assert.ok(wary > 0);
  assert.deepEqual(hands, hardHands);
});

test('thinking ahead leaves the real game untouched', () => {
  const warm = () => {
    const { g, bots } = game(['hard', 'hard', 'hard', 'hard'], 4);
    for (let i = 0; i < (COUNTDOWN + 6) * TICK_RATE; i++) step(g, bots.map((b, k) => b.think(g, k)));
    return g;
  };
  const frozen = (g) => JSON.stringify({ ...g, map: null, rng: null });
  // Two identical games; one of them has a bot think ahead.
  const plain = warm();
  const thought = warm();
  const rules = { mode: 'gather', targetId: -1, path: null, entryY: -1 };
  const idea = createPlanner({ seed: 0 }).choose(thought, 0, () => 0, rules);
  assert.ok(idea && typeof idea.mode === 'string');
  assert.equal(frozen(thought), frozen(plain));
  assert.deepEqual([thought.rng(), thought.rng()], [plain.rng(), plain.rng()], "the game's own dice are not rolled by a daydream");
});

test('a round with thinking bots runs to the end and comes out the same every time', () => {
  const play = () => {
    const { g, bots } = game(['ace', 'hard', 'ace', 'hard'], 6, MAPS.sky);
    while (g.phase !== 'over') step(g, bots.map((b, k) => b.think(g, k)));
    return `${g.winner}:${g.tick}:${g.players.map((p) => `${p.kills}/${p.deaths}/${p.seeds}`).join()}`;
  };
  assert.equal(play(), play());
});

test('up close the top bot feints: it dashes in, turns back before a swing can land, and goes in once the rival has swung', () => {
  const g = createGame({ slots: [{ name: 'ace', kind: 'bot' }, { name: 'dummy', kind: 'bot' }], seed: 2 });
  for (let i = 0; i < COUNTDOWN * TICK_RATE + 2; i++) step(g, []);
  const [me, rival] = g.players;
  const bot = createBot({ difficulty: 'ace', seed: 9 });
  // The rival stands still in the open near the flower, in the bot's way to it.
  // The bot must come close and back off at least once without ever standing
  // inside the rival's reach.
  const y = 150;
  const hold = () => {
    rival.x = 730;
    rival.y = y;
  };
  me.x = 872;
  me.y = y;
  hold();
  let closest = Infinity;
  let turned = 0;
  let wasNearing = false;
  for (let i = 0; i < 2.2 * TICK_RATE; i++) {
    const before = Math.hypot(me.x - rival.x, me.y - rival.y);
    const inp = bot.think(g, 0);
    step(g, [{ ...inp, bonk: false }, { mx: 0, my: 0, bonk: false }]);
    hold();
    const d = Math.hypot(me.x - rival.x, me.y - rival.y);
    // How near it came on the first dash, before it turned.
    if (!turned) closest = Math.min(closest, d);
    if (wasNearing && d > before + 0.5) turned++;
    if (d < before - 0.5) wasNearing = true;
    else if (d > before + 0.5) wasNearing = false;
  }
  assert.ok(turned >= 1, 'it turned back at least once');
  assert.ok(closest > BONK.reach + 6 && closest < 80, `the first dash stopped just short of the rival's reach: ${closest}`);
});

test('in a free-for-all the top bot leaves a far-off seed to rivals better placed to stop it, and goes for a second one', () => {
  // Four on their own. One rival is carrying a seed through the maze, the other
  // two are by the burrow, between it and home, and the bot is out by the flower.
  const endsUp = (difficulty) => {
    const g = createGame({ slots: Array.from({ length: 4 }, (_, i) => ({ name: `p${i}`, kind: 'bot' })), seed: 2 });
    for (let i = 0; i < COUNTDOWN * TICK_RATE + 2; i++) step(g, []);
    const [me, carrier, a, b] = g.players;
    const f = g.map.flower;
    const set = () => {
      Object.assign(carrier, { x: 520, y: g.map.rowYs[1], carrying: true });
      Object.assign(a, { x: 190, y: g.map.laneYs[1] });
      Object.assign(b, { x: 190, y: g.map.laneYs[0] });
    };
    // By the flower and well away from both tunnels, so there is no quick way home.
    Object.assign(me, { x: f.x + 75, y: f.y + 10 });
    set();
    const bot = createBot({ difficulty, seed: 5 });
    for (let i = 0; i < 1.2 * TICK_RATE; i++) {
      step(g, [{ ...bot.think(g, 0), bonk: false }]);
      set();
    }
    return Math.hypot(me.x - f.x, me.y - f.y);
  };
  assert.ok(endsUp('ace') <= f0.gatherR, `the top bot is at the flower: ${endsUp('ace')}`);
  assert.ok(endsUp('hard') > f0.gatherR + 60, `the hard bot went after the seed instead: ${endsUp('hard')}`);
});

// Someone who plays the way a person does up close: body in, step back, and when
// the bot has swung at thin air, back in for the hit.
function juker() {
  const seen = [];
  let out = false;
  let until = 0;
  return (g, me, e) => {
    seen.push(!!e.swing);
    const sawSwing = seen.length > 12 ? seen.shift() : false; // a fifth of a second to notice
    const dx = e.x - me.x;
    const dy = e.y - me.y;
    const d = Math.hypot(dx, dy) || 1;
    const move = { mx: dx / d, my: dy / d, bonk: false, ax: dx / d, ay: dy / d };
    if (sawSwing) {
      out = false;
      move.bonk = d <= BONK.reach - 2 && !me.swing && me.cooldown <= 0;
      return move;
    }
    if (!out && d <= 33) {
      out = true;
      until = g.time + 0.28;
    } else if (out && g.time >= until) out = false;
    return out ? { ...move, mx: -move.mx, my: -move.my } : move;
  };
}

function duelJuker(difficulty, rounds) {
  let botHits = 0;
  let jukerHits = 0;
  for (let n = 0; n < rounds; n++) {
    const g = createGame({ slots: [{ name: 'bot', kind: 'bot' }, { name: 'me', kind: 'human' }], seed: n + 1 });
    for (let i = 0; i < COUNTDOWN * TICK_RATE + 2; i++) step(g, []);
    const [bot, me] = g.players;
    const brain = createBot({ difficulty, seed: n + 3 });
    const person = juker();
    const put = () => {
      Object.assign(bot, { x: 800, y: 150 });
      Object.assign(me, { x: 730, y: 420 });
    };
    put();
    for (let i = 0; i < 12 * TICK_RATE; i++) {
      const before = [bot.deaths, me.deaths];
      step(g, [brain.think(g, 0), person(g, me, bot)]);
      if (bot.deaths > before[0]) jukerHits++;
      if (me.deaths > before[1]) botHits++;
      if (bot.deaths > before[0] || me.deaths > before[1]) put();
    }
  }
  return { botHits, jukerHits };
}

test('the top bot learns not to be baited: against someone who feints and counters it holds its own far better than the hard bot', () => {
  const hard = duelJuker('hard', 16);
  const ace = duelJuker('ace', 16);
  const share = (r) => r.botHits / (r.botHits + r.jukerHits);
  assert.ok(share(hard) < 0.4, `the hard bot keeps falling for it: ${JSON.stringify(hard)}`);
  assert.ok(share(ace) > share(hard) + 0.08, `the top bot does clearly better: ${JSON.stringify(ace)} against ${JSON.stringify(hard)}`);
  assert.ok(ace.jukerHits < hard.jukerHits, 'and is caught less often');
});

test('the top bot does not stand and watch a rival nibble: it goes straight in', () => {
  for (let n = 0; n < 10; n++) {
    const g = createGame({ slots: Array.from({ length: 4 }, (_, i) => ({ name: `p${i}`, kind: 'bot' })), seed: n + 1 });
    for (let i = 0; i < COUNTDOWN * TICK_RATE + 2; i++) step(g, []);
    const [bot, rival] = g.players;
    const f = g.map.flower;
    const a = (n / 10) * Math.PI * 2;
    Object.assign(rival, { x: f.x + Math.cos(a) * 55, y: f.y + Math.sin(a) * 55 });
    Object.assign(bot, { x: 60, y: 60 });
    for (let i = 0; i < 6; i++) step(g, []);
    // The rival has its head down; the bot is just outside the ring, a quarter turn round.
    Object.assign(bot, { x: f.x + Math.cos(a + 1.5) * 95, y: f.y + Math.sin(a + 1.5) * 95 });
    const brain = createBot({ difficulty: 'ace', seed: n + 3 });
    for (let i = 0; i < 4 * TICK_RATE && !rival.deaths && !rival.carrying; i++) step(g, [brain.think(g, 0)]);
    assert.equal(rival.carrying, false, `round ${n}: the rival got its seed`);
    assert.equal(rival.deaths, 1, `round ${n}: the rival was never bonked`);
  }
});

test('the top bot at the flower is not drawn into a wasted swing by someone running in and straight back out', () => {
  // As recorded from a real round: the bot is nibbling, a person runs in until
  // they touch, steps back, and waits to hit the bot once it has swung at air.
  let baited = 0;
  let whiffs = 0;
  for (let n = 0; n < 24; n++) {
    const g = createGame({ slots: Array.from({ length: 4 }, (_, i) => ({ name: `p${i}`, kind: 'bot' })), seed: n + 1 });
    for (let i = 0; i < COUNTDOWN * TICK_RATE + 2; i++) step(g, []);
    const [bot, me] = g.players;
    const f = g.map.flower;
    const a = (n / 24) * Math.PI * 2;
    Object.assign(bot, { x: f.x + Math.cos(a) * 55, y: f.y + Math.sin(a) * 55 });
    Object.assign(me, { x: f.x + Math.cos(a + 0.9) * 150, y: f.y + Math.sin(a + 0.9) * 150 });
    const brain = createBot({ difficulty: 'ace', seed: n + 3 });
    const person = juker();
    for (let i = 0; i < 5 * TICK_RATE && !bot.deaths && !me.deaths && !bot.carrying; i++) {
      step(g, [brain.think(g, 0), person(g, me, bot)]);
      whiffs += g.events.filter((ev) => ev.type === 'impact' && ev.id === 0 && !ev.hit).length;
    }
    baited += bot.deaths;
  }
  assert.equal(baited, 0, 'it was never bonked for a wasted swing');
  assert.equal(whiffs, 0, 'and never swung at air');
});

test('when a seed has to be stopped, looking ahead only chooses how, never whether', () => {
  // Rounds of five top bots: every time the rule book says "stop that seed", the
  // plan that comes out of the look-ahead is still about that seed.
  const g = createGame({ slots: Array.from({ length: 5 }, (_, i) => ({ name: `p${i}`, kind: 'bot' })), seed: 8 });
  for (let i = 0; i < (COUNTDOWN + 1) * TICK_RATE; i++) step(g, []);
  const [me, carrier, a, b, c] = g.players;
  const f = g.map.flower;
  Object.assign(carrier, { x: 600, y: g.map.rowYs[3], carrying: true });
  Object.assign(me, { x: f.x - 60, y: f.y - 40 });
  Object.assign(a, { x: f.x + 40, y: f.y + 70 });
  Object.assign(b, { x: f.x + 60, y: f.y - 60 });
  Object.assign(c, { x: f.x - 10, y: f.y + 110 });
  const planner = createPlanner({ seed: 3 });
  const rules = { mode: 'deny', targetId: carrier.id, path: null, entryY: -1 };
  for (let k = 0; k < 12; k++) {
    g.time += 0.31;
    const idea = planner.choose(g, 0, () => 0, rules);
    assert.equal(idea.mode, 'deny', 'it stays on the seed');
    assert.equal(idea.targetId, carrier.id);
  }
});

test('in a free-for-all the best placed defend: the top bot nearest home goes to stop a seed even with others about', () => {
  const g = createGame({ slots: Array.from({ length: 4 }, (_, i) => ({ name: `p${i}`, kind: 'bot' })), seed: 2 });
  for (let i = 0; i < COUNTDOWN * TICK_RATE + 2; i++) step(g, []);
  const [me, carrier, a, b] = g.players;
  const f = g.map.flower;
  const set = () => {
    Object.assign(carrier, { x: 620, y: g.map.rowYs[7], carrying: true });
    Object.assign(a, { x: f.x + 30, y: f.y + 80 });
    Object.assign(b, { x: f.x + 50, y: f.y - 70 });
  };
  // The bot stands at a lane mouth by the burrow; the other two are out by the flower.
  Object.assign(me, { x: 185, y: g.map.laneYs[1] });
  set();
  const bot = createBot({ difficulty: 'ace', seed: 5 });
  const start = Math.hypot(me.x - f.x, me.y - f.y);
  let towardsFlower = 0;
  for (let i = 0; i < 1.5 * TICK_RATE; i++) {
    step(g, [{ ...bot.think(g, 0), bonk: false }]);
    set();
  }
  towardsFlower = start - Math.hypot(me.x - f.x, me.y - f.y);
  const toCarrier = Math.hypot(me.x - carrier.x, me.y - carrier.y);
  assert.ok(toCarrier < 440 || towardsFlower < 120, `it went to meet the seed rather than off to the flower: ${Math.round(toCarrier)} from the carrier`);
  assert.ok(Math.hypot(me.x - f.x, me.y - f.y) > 330, 'and is nowhere near the flower');
});

test('near home the hard and top bots keep their seed however many rivals stand in the way', () => {
  // A carrier coming down the middle lane with two rivals lined up ahead of it:
  // the picture a throw is made for. Far from home it may take it. Close to home
  // the seed is the win and stays where it is.
  const throwsFrom = (difficulty, x, seed) => {
    const g = createGame({ slots: Array.from({ length: 3 }, (_, i) => ({ name: `p${i}`, kind: 'bot' })), seed });
    for (let i = 0; i < COUNTDOWN * TICK_RATE + 2; i++) step(g, []);
    const [me, a, b] = g.players;
    const y = g.map.rowYs[5];
    Object.assign(me, { x, y, carrying: true, fx: -1, fy: 0 });
    const bot = createBot({ difficulty, seed: seed + 11 });
    let thrown = 0;
    for (let i = 0; i < 3 * TICK_RATE && me.carrying && g.phase === 'playing'; i++) {
      Object.assign(a, { x: me.x - 62, y });
      Object.assign(b, { x: me.x - 96, y });
      step(g, [{ ...bot.think(g, 0), bonk: false }]);
      thrown += g.events.filter((ev) => ev.type === 'throw' && ev.id === 0).length;
    }
    return thrown;
  };
  for (const difficulty of ['hard', 'ace']) {
    let near = 0;
    let far = 0;
    for (let seed = 1; seed <= 8; seed++) {
      near += throwsFrom(difficulty, g0.home.x2 + 150, seed);
      far += throwsFrom(difficulty, 310, seed);
    }
    assert.equal(DIFFICULTY[difficulty].thrifty, 330);
    assert.equal(near, 0, `${difficulty} threw its seed away ${near} times by the door`);
  }
  assert.equal(DIFFICULTY.normal.thrifty, undefined, 'the weaker bots may still do it');
});

test('the top bot nibbles on without budging while nobody can reach it in time', () => {
  // Alone at the flower, the rivals pinned in their nests, far further away than a
  // seed takes: it has to stand still from the first tick to the seed.
  const g = createGame({ slots: Array.from({ length: 4 }, (_, i) => ({ name: `p${i}`, kind: 'bot' })), seed: 3 });
  for (let i = 0; i < COUNTDOWN * TICK_RATE + 2; i++) step(g, []);
  const me = g.players[0];
  const spot = g.map.gatherSpots[0];
  Object.assign(me, { x: spot.x, y: spot.y, vx: 0, vy: 0 });
  const bot = createBot({ difficulty: 'ace', seed: 9 });
  const nests = g.players.map((p) => ({ x: p.nest.x, y: p.nest.y }));
  let moved = 0;
  for (let i = 0; i < 2.5 * TICK_RATE && !me.carrying; i++) {
    for (const p of g.players) if (p !== me) Object.assign(p, nests[p.id], { vx: 0, vy: 0 });
    const input = bot.think(g, 0);
    if (input.mx || input.my || input.bonk) moved++;
    step(g, [input]);
  }
  assert.equal(moved, 0, `it fidgeted on ${moved} ticks`);
  assert.ok(me.carrying, 'and has its seed');
});

test('the top bot draws the swing of a rival nibbling at the flower instead of walking into it', () => {
  // The rival stands at the flower with its head down and swings the moment the
  // bot is near enough for that swing to land on anyone who keeps coming.
  const meet = (difficulty, n) => {
    const g = createGame({ slots: Array.from({ length: 4 }, (_, i) => ({ name: `p${i}`, kind: i ? 'human' : 'bot' })), seed: n + 1 });
    for (let i = 0; i < COUNTDOWN * TICK_RATE + 2; i++) step(g, []);
    g.calm = true;
    const [bot, nib] = g.players;
    const f = g.map.flower;
    const a = (n / 24) * Math.PI * 2;
    Object.assign(nib, { x: f.x + Math.cos(a) * 55, y: f.y + Math.sin(a) * 55 });
    const far = 150 + (n % 4) * 30;
    Object.assign(bot, { x: f.x + Math.cos(a + 0.9) * far, y: f.y + Math.sin(a + 0.9) * far });
    const brain = createBot({ difficulty, seed: n + 3 });
    const trigger = 58 + ((n * 7) % 10);
    for (let t = 0; t < 5 * TICK_RATE && !nib.carrying; t++) {
      const d = Math.hypot(bot.x - nib.x, bot.y - nib.y);
      const swing = d <= trigger && !nib.swing && nib.cooldown <= 0;
      step(g, [brain.think(g, 0), { mx: 0, my: 0, bonk: swing, ax: (bot.x - nib.x) / d, ay: (bot.y - nib.y) / d }]);
      if (bot.deaths) return 'bonked';
      if (nib.deaths) return 'won';
    }
    return 'neither';
  };
  const tally = (difficulty) => {
    const r = { bonked: 0, won: 0, neither: 0 };
    for (let n = 0; n < 24; n++) r[meet(difficulty, n)]++;
    return r;
  };
  const hard = tally('hard');
  const ace = tally('ace');
  assert.ok(hard.bonked >= 15, `the hard bot walks into it: ${JSON.stringify(hard)}`);
  assert.ok(ace.bonked <= 3, `the top bot was bonked ${ace.bonked} times in 24`);
  assert.ok(ace.won >= 14, `and wins most of them: ${JSON.stringify(ace)}`);
});

test('behind a rival that runs ahead and turns to swing, the top bot is out of reach and punishes it', () => {
  const chase = (difficulty, n) => {
    const g = createGame({ slots: Array.from({ length: 4 }, (_, i) => ({ name: `p${i}`, kind: i ? 'human' : 'bot' })), seed: n + 1 });
    for (let i = 0; i < COUNTDOWN * TICK_RATE + 2; i++) step(g, []);
    g.calm = true;
    const [bot, lead, x, y] = g.players;
    const b = g.map.bounds;
    Object.assign(x, { x: b.x2 - 30, y: b.y1 + 30 });
    Object.assign(y, { x: b.x2 - 30, y: b.y2 - 30 });
    const nav = getNav(g.map);
    const spot = [...g.map.gatherSpots].sort((p, q) => p.x - q.x)[n % 3];
    Object.assign(lead, { x: spot.x, y: spot.y, carrying: true });
    const path = nav.findPath(lead, { x: g.homeX - 14, y: g.map.rowYs[(n % 3) + 4] }).points;
    const first = nav.nextTarget(lead, path);
    const l = Math.hypot(first.x - lead.x, first.y - lead.y) || 1;
    const ux = (first.x - lead.x) / l;
    const uy = (first.y - lead.y) / l;
    const gap = 40 + (n % 4) * 10;
    Object.assign(bot, { x: lead.x - ux * gap, y: lead.y - uy * gap, vx: ux * 166, vy: uy * 166 });
    Object.assign(lead, { vx: ux * 166, vy: uy * 166 });
    const brain = createBot({ difficulty, seed: n + 3 });
    let next = 0.4 + ((n * 13) % 10) / 10;
    for (let t = 0; t < 7 * TICK_RATE && g.phase === 'playing'; t++) {
      const p = nav.nextTarget(lead, path);
      const pd = Math.hypot(p.x - lead.x, p.y - lead.y) || 1;
      const d = Math.hypot(bot.x - lead.x, bot.y - lead.y);
      // It turns and swings whenever the bot is close enough behind for that to land.
      const swing = t / TICK_RATE >= next && d <= 64 && !lead.swing && lead.cooldown <= 0;
      if (swing) next = t / TICK_RATE + 1 + ((n * 7 + t) % 10) / 10;
      step(g, [brain.think(g, 0), { mx: (p.x - lead.x) / pd, my: (p.y - lead.y) / pd, bonk: swing, ax: (bot.x - lead.x) / d, ay: (bot.y - lead.y) / d }]);
      if (bot.deaths) return 'bonked';
      if (lead.deaths) return 'won';
    }
    return 'neither';
  };
  const tally = (difficulty) => {
    const r = { bonked: 0, won: 0, neither: 0 };
    for (let n = 0; n < 24; n++) r[chase(difficulty, n)]++;
    return r;
  };
  const hard = tally('hard');
  const ace = tally('ace');
  assert.ok(ace.bonked <= 5, `the top bot was bonked ${ace.bonked} times in 24: ${JSON.stringify(ace)}`);
  assert.ok(ace.bonked < hard.bonked, `fewer than the hard bot: ${JSON.stringify(hard)}`);
  assert.ok(ace.won >= 17, `and it stops the seed: ${JSON.stringify(ace)}`);
});
