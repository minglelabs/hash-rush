import test from 'node:test';
import assert from 'node:assert/strict';
import { ELO, DAILY, SOLO_DAILY, newIdentity, openIdentity, pidOf, verify, resultText, readResult, signedResults, rate } from '../src/client/rating.js';

const people = async (n) => Promise.all(Array.from({ length: n }, async () => (await newIdentity()).identity));

// Everybody in the round signs it, the way each browser does at the end of a round.
async function round(id, at, who, winners, { signers = who } = {}) {
  const text = resultText({ id, at, map: 'meadow', team: false, players: who.map((p) => ({ pid: p.pid, pub: p.pub, won: winners.includes(p) })) });
  return Promise.all(signers.map(async (p) => ({ mid: id, pid: p.pid, text, sig: await p.sign(text) })));
}

test('an identity is a key pair; what is kept opens the same identity again', async () => {
  const { saved, identity } = await newIdentity();
  const again = await openIdentity(JSON.parse(JSON.stringify(saved)));
  assert.equal(again.pid, identity.pid);
  assert.equal(identity.pid, await pidOf(identity.pub));
  const sig = await again.sign('hello');
  assert.ok(await verify(identity.pub, 'hello', sig));
  assert.equal(await verify(identity.pub, 'hellO', sig), false);
});

test('a result counts only once everybody in it has signed that very text', async () => {
  const [a, b, c] = await people(3);
  const full = await round('match0001', 1000, [a, b], [a]);
  assert.equal((await signedResults(full)).length, 1);
  // The loser never signed: the winner alone cannot make it count.
  const alone = await round('match0002', 2000, [a, b], [a], { signers: [a] });
  assert.equal((await signedResults(alone)).length, 0);
  // Somebody signs for someone else: the signature does not match that key.
  const forged = await round('match0003', 3000, [a, b], [a]);
  forged[1] = { ...forged[1], sig: await c.sign(forged[1].text) };
  assert.equal((await signedResults(forged)).length, 0);
  // A text changed after signing is not the same result.
  const edited = await round('match0004', 4000, [a, b], [a]);
  edited[1] = { ...edited[1], text: edited[1].text.replace('"meadow"', '"desert"') };
  assert.equal((await signedResults(edited)).length, 0);
  assert.equal(readResult('{"v":1}'), null);
});

test('Elo: the winner takes points off the loser, more for an upset, and a level round changes nothing', async () => {
  const [a, b, c, d] = await people(4);
  const one = rate(await signedResults(await round('match0101', 1, [a, b], [a])));
  const ra = one.find((p) => p.pid === a.pid);
  const rb = one.find((p) => p.pid === b.pid);
  assert.equal(ra.elo, ELO.start + ELO.k / 2);
  assert.equal(rb.elo, ELO.start - ELO.k / 2);
  assert.deepEqual([ra.games, ra.wins, rb.games, rb.wins], [1, 1, 1, 0]);

  // b beats a after a has won twice: b gets more than half the pot back.
  const sigs = [...(await round('match0102', 1, [a, b], [a])), ...(await round('match0103', 2, [a, b], [a])), ...(await round('match0104', 3, [a, b], [b]))];
  const after = rate(await signedResults(sigs));
  const gain = after.find((p) => p.pid === b.pid).elo - (ELO.start - ELO.k);
  assert.ok(gain > ELO.k / 2, `upset worth ${gain}`);

  // Everybody won (time ran out level): only the count of games moves.
  const level = rate(await signedResults(await round('match0105', 1, [a, b, c], [a, b, c])));
  for (const p of level) assert.deepEqual([p.elo, p.games], [ELO.start, 1]);

  // Four people, one winner: what it gains the others lose, and it is one game's worth.
  const four = rate(await signedResults(await round('match0106', 1, [a, b, c, d], [a])));
  assert.ok(Math.abs(four.reduce((s, p) => s + p.elo, 0) - 4 * ELO.start) <= 2, 'apart from rounding');
  assert.equal(four[0].pid, a.pid);
  assert.equal(four[0].elo, ELO.start + ELO.k / 2);
});

test('the same people beating each other all day stop counting after a few rounds', async () => {
  const [a, b] = await people(2);
  const sigs = [];
  for (let i = 0; i < DAILY + 5; i++) sigs.push(...(await round(`farm${String(i).padStart(5, '0')}`, 1000 + i, [a, b], [a])));
  const table = rate(await signedResults(sigs));
  assert.equal(table.find((p) => p.pid === a.pid).games, DAILY);
});

test('computers are rated as one entry per level, and one person alone against them counts a few times a day', async () => {
  const [a] = await people(1);
  const solo = async (id, at, wonByMe, other = 'bot:easy') => {
    const text = resultText({ id, at, map: 'meadow', team: false, players: [{ pid: a.pid, pub: a.pub, won: wonByMe }, { pid: 'bot:hard', won: !wonByMe }, { pid: 'bot:hard', won: false }, { pid: other, won: false }] });
    return [{ mid: id, pid: a.pid, text, sig: await a.sign(text) }];
  };
  const one = rate(await signedResults(await solo('solo00001', 1, true)));
  // Two hard bots in the round are one entry: three rows, not four.
  assert.deepEqual(one.map((p) => p.pid).sort(), [a.pid, 'bot:easy', 'bot:hard'].sort());
  assert.ok(one.find((p) => p.pid === a.pid).elo > ELO.start);
  assert.ok(one.find((p) => p.pid === 'bot:hard').bot);
  // A result naming only computers, or a computer with a key, is not one.
  assert.equal(readResult(resultText({ id: 'nobody001', at: 1, map: 'meadow', team: false, players: [{ pid: 'bot:hard', won: true }, { pid: 'bot:easy', won: false }] })), null);
  const many = [];
  // Different line-ups, so the cap on the same people meeting again is not what stops it.
  const others = ['bot:easy', 'bot:normal', 'bot:ace', 'bot:rl'];
  for (let i = 0; i < SOLO_DAILY + 6; i++) many.push(...(await solo(`solo${String(i + 10).padStart(5, '0')}`, 100 + i, i % 2 === 0, others[i % 4])));
  assert.equal(rate(await signedResults(many)).find((p) => p.pid === a.pid).games, SOLO_DAILY);
});
