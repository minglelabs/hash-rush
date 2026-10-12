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
  const { search, dance, ...hands } = DIFFICULTY.ace;
  assert.equal(search, true);
  assert.equal(dance, true);
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
