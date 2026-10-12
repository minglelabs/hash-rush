import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step } from '../src/sim/game.js';
import { createBot, DIFFICULTY } from '../src/ai/bot.js';
import { createPlanner } from '../src/ai/search.js';
import { COUNTDOWN, TICK_RATE } from '../src/sim/constants.js';
import { MAPS } from '../src/sim/map.js';

const game = (kinds, seed, map = MAPS.meadow) => {
  const g = createGame({ slots: kinds.map((k, i) => ({ name: `${k}${i}`, kind: 'bot' })), seed, map });
  const bots = kinds.map((difficulty, i) => createBot({ difficulty, seed: seed * 97 + i * 13 + 5 }));
  return { g, bots };
};

test('the top bot has the hard bot\'s hands and adds looking ahead', () => {
  const { search, ...hands } = DIFFICULTY.ace;
  assert.equal(search, true);
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
