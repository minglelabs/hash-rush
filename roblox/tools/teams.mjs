// Team rounds of the web game's own bots, with the tables roblox/test/bots.luau
// prints for the Roblox port: the same line-ups and the same seeds, to be read
// side by side. The two do not play tick for tick alike, so it is the totals
// that should agree: who wins, how often a seed gets home, bonks, round length.
// It lives here and not in test/ because `node --test` runs every script in a
// folder called test.
//   node roblox/tools/teams.mjs [rounds, 10]

import { createGame, step, allied } from '../../src/sim/game.js';
import { createBot } from '../../src/ai/bot.js';
import { TICK_RATE, OVERTIME } from '../../src/sim/constants.js';

const ROUNDS = Number(process.argv[2] || 10);
const LEVELS = ['easy', 'normal', 'hard', 'ace'];
const pad = (v, n) => String(v).padStart(n);
const fix = (v, n, d = 1) => v.toFixed(d).padStart(n);

let failures = 0;
function check(ok, what) {
  if (ok) return;
  failures++;
  console.log(`FAIL  ${what}`);
}

const cost = Object.fromEntries(LEVELS.map((l) => [l, { n: 0, sum: 0, max: 0 }]));

// One round, seats alternating sides. The Roblox port numbers its seats from 1,
// and seeds each bot by that number.
function play(levels, seed, what) {
  const g = createGame({ slots: levels.map((level, i) => ({ name: `seat ${i + 1}`, kind: 'bot', team: i % 2 })), seed });
  const bots = levels.map((difficulty, i) => createBot({ difficulty, seed: seed * 100 + i + 1 }));
  const s = { seeds: 0, bonks: 0, throws: 0, steals: 0, time: 0, timeout: false, winners: [], side: null };
  while (g.phase !== 'over') {
    const inputs = bots.map((bot, i) => {
      const t = performance.now();
      const input = bot.think(g, i);
      const c = cost[levels[i]];
      const took = performance.now() - t;
      c.n++;
      c.sum += took;
      c.max = Math.max(c.max, took);
      return input;
    });
    step(g, inputs);
    for (const ev of g.events) {
      if (ev.type === 'seed') s.seeds++;
      else if (ev.type === 'throw') s.throws++;
      else if (ev.type === 'steal') s.steals++;
      else if (ev.type === 'bonk') {
        s.bonks++;
        check(!allied(g.players[ev.by], g.players[ev.id]), `${what} round ${seed}: seat ${ev.by + 1} does not knock out its team-mate ${ev.id + 1}`);
      }
    }
    if (g.tick > 200 * TICK_RATE) throw new Error('a round never ends');
  }
  const half = levels.length / 2;
  const won = [0, 1].map((team) => g.winners.filter((id) => g.players[id].team === team).length);
  const whole = (won[0] === half && won[1] === 0) || (won[0] === 0 && won[1] === half);
  const shared = g.timeout && won[0] === half && won[1] === half;
  check(whole || shared, `${what} round ${seed}: the winners are one whole team`);
  s.time = g.time;
  s.timeout = g.timeout;
  s.winners = g.winners;
  s.side = !whole ? null : won[0] > 0 ? 0 : 1;
  return s;
}

console.log(`web bots in teams, ${ROUNDS} rounds each; a round is called on bonks at ${OVERTIME.end} s`);
console.log('');
console.log('the same difficulty on both sides');
console.log('level   teams  seed home  timeout  avg s   seeds  bonks  throws  steals');
for (const level of LEVELS) {
  for (const size of [2, 4]) {
    const t = { home: 0, seeds: 0, bonks: 0, throws: 0, steals: 0, time: 0 };
    for (let round = 1; round <= ROUNDS; round++) {
      const s = play(new Array(2 * size).fill(level), 3000 + round, `${level} ${size}v${size}`);
      t.home += s.timeout ? 0 : 1;
      for (const k of ['seeds', 'bonks', 'throws', 'steals', 'time']) t[k] += s[k];
    }
    const n = ROUNDS;
    console.log(`${level.padEnd(7)} ${size}v${size}    ${fix((100 * t.home) / n, 8, 0)}%  ${fix((100 * (n - t.home)) / n, 6, 0)}%  ${fix(t.time / n, 5)}  ${fix(t.seeds / n, 5)}  ${fix(t.bonks / n, 5)}  ${fix(t.throws / n, 6)}  ${fix(t.steals / n, 6)}`);
  }
}

console.log('');
console.log('two against two, one difficulty a side');
console.log('pair              wins     shared  seed home  avg s   seeds  bonks');
const pairWins = Object.fromEntries(LEVELS.map((l) => [l, 0]));
let pairRounds = 0;
for (let a = 1; a <= LEVELS.length; a++) {
  for (let b = a + 1; b <= LEVELS.length; b++) {
    const one = LEVELS[a - 1];
    const other = LEVELS[b - 1];
    const wins = { [one]: 0, [other]: 0 };
    const t = { home: 0, seeds: 0, bonks: 0, time: 0 };
    for (let round = 1; round <= ROUNDS; round++) {
      const first = round % 2 === 1 ? one : other;
      const second = round % 2 === 1 ? other : one;
      const s = play([first, second, first, second], 4000 + 100 * (a * 4 + b) + round, `${one} v ${other}`);
      if (s.side !== null) wins[s.side === 0 ? first : second]++;
      t.home += s.timeout ? 0 : 1;
      for (const k of ['seeds', 'bonks', 'time']) t[k] += s[k];
    }
    const n = ROUNDS;
    pairWins[one] += wins[one];
    pairWins[other] += wins[other];
    pairRounds += n;
    console.log(`${one.padEnd(6)} v ${other.padEnd(6)}  ${pad(wins[one], 3)} - ${String(wins[other]).padEnd(3)}  ${pad(n - wins[one] - wins[other], 5)}  ${fix((100 * t.home) / n, 8, 0)}%  ${fix(t.time / n, 5)}  ${fix(t.seeds / n, 5)}  ${fix(t.bonks / n, 5)}`);
  }
}
for (const level of LEVELS) console.log(`${level.padEnd(7)} wins ${pad(pairWins[level], 3)} of ${pairRounds / 2}`);

console.log('');
console.log('mixed teams, one of each difficulty in a round');
{
  const SPLITS = [[1, 2, 3, 4], [1, 3, 2, 4], [1, 2, 4, 3]];
  const wins = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  const t = { home: 0, seeds: 0, bonks: 0, time: 0 };
  const rounds = ROUNDS * SPLITS.length;
  for (let round = 1; round <= rounds; round++) {
    const split = SPLITS[round % SPLITS.length];
    const levels = [1, 2, 3, 4].map((seat) => LEVELS[split[(seat + Math.floor(round / SPLITS.length)) % 4] - 1]);
    const s = play(levels, 6000 + round, 'mixed teams');
    for (const id of s.winners) wins[levels[id]]++;
    t.home += s.timeout ? 0 : 1;
    for (const k of ['seeds', 'bonks', 'time']) t[k] += s[k];
  }
  for (const level of LEVELS) console.log(`${level.padEnd(7)} on the winning side ${pad(wins[level], 3)} of ${rounds}`);
  console.log(`seed home ${((100 * t.home) / rounds).toFixed(0)}%   avg ${(t.time / rounds).toFixed(1)} s   seeds ${(t.seeds / rounds).toFixed(1)}   bonks ${(t.bonks / rounds).toFixed(1)}`);
}

console.log('');
console.log('cost of one think (one bot, one tick), in teams');
for (const level of LEVELS) {
  const c = cost[level];
  console.log(`${level.padEnd(7)} avg ${(c.sum / c.n).toFixed(4)} ms   worst ${c.max.toFixed(2)} ms   (${c.n} thinks)`);
}

console.log('');
if (failures) {
  console.log(`${failures} checks failed`);
  process.exit(1);
}
console.log('all checks passed');
