import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step } from '../src/sim/game.js';
import { createBot, DIFFICULTY } from '../src/ai/bot.js';
import { createPlanner } from '../src/ai/search.js';
import { BONK, COUNTDOWN, TICK_RATE } from '../src/sim/constants.js';
import { MAPS } from '../src/sim/map.js';

const game = (kinds, seed, map = MAPS.meadow) => {
  const g = createGame({ slots: kinds.map((k, i) => ({ name: `${k}${i}`, kind: 'bot' })), seed, map });
  const bots = kinds.map((difficulty, i) => createBot({ difficulty, seed: seed * 97 + i * 13 + 5 }));
  return { g, bots };
};

test('the top bot has the hard bot\'s hands and adds looking ahead and footwork', () => {
  const { search, dance, poach, wary, ...hands } = DIFFICULTY.ace;
  assert.equal(search, true);
  assert.equal(dance, true);
  assert.equal(poach, 2);
  assert.ok(wary > 0);
  assert.deepEqual(hands, DIFFICULTY.hard);
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
  // The rival stands still in the open with a seed, which makes it worth going
  // for. The bot must come close and back off at least once without ever standing
  // inside the rival's reach.
  const y = 150;
  const hold = () => {
    rival.x = 730;
    rival.y = y;
    rival.carrying = true;
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

test('in a free-for-all the top bot leaves a far-off seed to the others and goes for a second one', () => {
  // Four on their own. One rival is carrying a seed a long way off, the other two
  // stand near it, and the bot is by the flower.
  const heading = (difficulty) => {
    const g = createGame({ slots: Array.from({ length: 4 }, (_, i) => ({ name: `p${i}`, kind: 'bot' })), seed: 2 });
    for (let i = 0; i < COUNTDOWN * TICK_RATE + 2; i++) step(g, []);
    const [me, carrier, a, b] = g.players;
    const f = g.map.flower;
    const lane = g.map.laneYs[0];
    const set = () => {
      Object.assign(carrier, { x: 520, y: g.map.rowYs[1], carrying: true });
      Object.assign(a, { x: 420, y: g.map.rowYs[1] });
      Object.assign(b, { x: 250, y: lane });
    };
    Object.assign(me, { x: f.x - 20, y: f.y - 150 });
    set();
    const bot = createBot({ difficulty, seed: 5 });
    const start = Math.hypot(me.x - f.x, me.y - f.y);
    for (let i = 0; i < 1.2 * TICK_RATE; i++) {
      step(g, [{ ...bot.think(g, 0), bonk: false }]);
      set();
    }
    return Math.hypot(me.x - f.x, me.y - f.y) - start;
  };
  assert.ok(heading('ace') < -40, `the top bot closed in on the flower: ${heading('ace')}`);
  assert.ok(heading('hard') > 40, `the hard bot went after the seed instead: ${heading('hard')}`);
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
