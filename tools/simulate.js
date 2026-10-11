// Runs bot-only matches headlessly to check balance and game length.
//   node tools/simulate.js [games] [difficulties, comma separated] [teams, comma separated, e.g. 0,0,0,1,1]
import { createGame, step } from '../src/sim/game.js';
import { createBot } from '../src/ai/bot.js';
import { TICK_RATE } from '../src/sim/constants.js';

const games = Number(process.argv[2] || 100);
const levels = (process.argv[3] || 'normal,normal,normal,normal').split(',');
const teams = process.argv[4] ? process.argv[4].split(',').map(Number) : null;
const LIMIT = 600 * TICK_RATE;

const lengths = [];
const wins = levels.map(() => 0);
const teamWins = {};
const totals = { kills: 0, seeds: 0, timeouts: 0 };

for (let n = 0; n < games; n++) {
  const g = createGame({ slots: levels.map((d, i) => ({ name: `${d}${i}`, kind: 'bot', team: teams ? teams[i] : -1 })), seed: n + 1 });
  const bots = levels.map((difficulty, i) => createBot({ difficulty, seed: n * 97 + i * 13 + 5 }));
  while (g.phase !== 'over' && g.tick < LIMIT) {
    step(
      g,
      bots.map((b, i) => b.think(g, i)),
    );
  }
  if (g.phase === 'over') {
    wins[g.winner]++;
    if (teams) teamWins[teams[g.winner]] = (teamWins[teams[g.winner]] || 0) + 1;
    lengths.push(g.time);
  } else {
    totals.timeouts++;
  }
  for (const p of g.players) {
    totals.kills += p.kills;
    totals.seeds += p.seeds;
  }
}

lengths.sort((a, b) => a - b);
const pick = (q) => (lengths.length ? lengths[Math.min(lengths.length - 1, Math.floor(q * lengths.length))].toFixed(1) : '-');
console.log(`games ${games}  finished ${lengths.length}  timeouts ${totals.timeouts}`);
console.log(`length s  min ${pick(0)}  p25 ${pick(0.25)}  median ${pick(0.5)}  p75 ${pick(0.75)}  p95 ${pick(0.95)}  max ${pick(0.999)}`);
console.log(`per game  bonks ${(totals.kills / games).toFixed(1)}  seeds ${(totals.seeds / games).toFixed(1)}`);
console.log('wins by slot', levels.map((d, i) => `${d}:${wins[i]}`).join('  '));
if (teams) console.log('wins by team', Object.entries(teamWins).map(([k, n]) => `team ${k}:${n}`).join('  '));
