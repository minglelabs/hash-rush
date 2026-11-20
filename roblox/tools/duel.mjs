// Two of one kind of bot against two of another, in the Roblox sim: the pairings
// a team Elo table hides, because it rates mixed pairs by the mean of the two.
//   node roblox/tools/duel.mjs [rounds per pairing, 200]
// Needs the `luau` command line. Rounds are played by roblox/test/elo.luau.

import { spawn, spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROUNDS = Number(process.argv[2] || 200);
const POOL = ['초보', '중수', '고수', '초고수', 'RL'];
const PER_JOB = 8;

const wrapped = spawnSync(process.execPath, [join(here, 'wrap.mjs')], { stdio: 'inherit' });
if (wrapped.status !== 0) process.exit(1);

function play(a, b) {
  const jobs = Math.ceil(ROUNDS / PER_JOB);
  const workers = Math.min(availableParallelism(), jobs);
  return Promise.all(
    Array.from({ length: workers }, (_, w) => {
      const mine = Math.floor(jobs / workers) + (w < jobs % workers ? 1 : 0);
      // Sides swap seats from worker to worker, so neither always has the first seat.
      const lineup = w % 2 ? [b, a, b, a] : [a, b, a, b];
      return new Promise((resolve, reject) => {
        let text = '';
        const args = ['--codegen', join(here, '..', 'test', 'elo.luau'), '-a', 'team', String(77 + w * 1000003 + a * 31 + b), String(mine), String(PER_JOB), lineup.map((x) => x + 1).join(',')];
        const p = spawn('luau', args, { stdio: ['ignore', 'pipe', 'inherit'] });
        p.stdout.on('data', (d) => (text += d));
        p.on('close', (code) => (code === 0 ? resolve({ text, first: lineup[0] }) : reject(new Error(`a worker stopped with ${code}`))));
      });
    }),
  ).then((parts) => {
    let wins = 0;
    let total = 0;
    for (const { text, first } of parts) {
      for (const line of text.split('\n')) {
        const [, , won] = line.split(' ');
        if (!won) continue;
        total++;
        // Seat 1 is `first`'s side; a level timeout gives both the round.
        const firstWon = won[0] === '1';
        const otherWon = won[2] === '1';
        if (firstWon && otherWon) wins += 0.5;
        else if ((first === a) === firstWon) wins++;
      }
    }
    return { wins, total };
  });
}

console.log(`2 대 2, 같은 종류끼리 한 편 (각 ${ROUNDS}판쯤)`);
for (let a = POOL.length - 1; a > 0; a--) {
  for (let b = a - 1; b >= 0; b--) {
    const { wins, total } = await play(a, b);
    console.log(`${POOL[a]} 2 대 ${POOL[b]} 2\t${((100 * wins) / total).toFixed(0)}%\t(${wins} / ${total})`);
  }
}
