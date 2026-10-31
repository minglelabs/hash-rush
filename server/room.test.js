import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room, LOBBY_WAIT_MS, RESULT_WAIT_MS, MIN_PLAYERS } from './room.js';

function fakeConn(peer) {
  const got = [];
  return { peer, open: true, got, send: (m) => got.push(m), fast: (m) => got.push(m), close() { this.open = false; }, last: (t) => [...got].reverse().find((m) => m.t === t) };
}

function setup() {
  let clock = 1_000_000;
  let seed = 1;
  const results = [];
  const room = new Room({ id: 'chan-1', now: () => clock, random: () => ((seed = (seed * 16807) % 2147483647) / 2147483647), onResult: (r) => results.push(r) });
  return { room, results, advance: (ms) => (clock += ms) };
}

test('a hello gets a seat and the lobby; a round starts after the wait with bots filling seats', () => {
  const { room, advance } = setup();
  const a = fakeConn('a');
  room.join(a);
  room.receive(a, { t: 'hello', name: 'Mia' });
  const lobby = a.last('lobby');
  assert.equal(lobby.you, 0);
  assert.equal(lobby.slots[0].kind, 'remote');
  assert.equal(lobby.slots[0].name, 'Mia');

  room.update();
  assert.equal(a.last('start'), undefined);
  advance(LOBBY_WAIT_MS);
  room.update();
  const start = a.last('start');
  assert.equal(start.you, 0);
  assert.equal(start.players.length, MIN_PLAYERS);
  assert.deepEqual(start.players.map((p) => p.kind), ['remote', 'bot:hard', 'bot:hard', 'bot:hard']);
});

test('inputs steer the seat and snapshots carry the acked input number', () => {
  const { room, advance } = setup();
  const a = fakeConn('a');
  room.join(a);
  room.receive(a, { t: 'hello', name: 'Mia' });
  advance(LOBBY_WAIT_MS);
  room.update();
  room.receive(a, { t: 'i', n: 3, mx: 5, my: -0.5, seq: 0 });
  room.receive(a, { t: 'i', n: 2, mx: 0, my: 0 }); // older, ignored
  assert.deepEqual([room.slots[0].input.mx, room.slots[0].input.my, room.slots[0].input.n], [1, -0.5, 3]);
  room.update(4);
  const snap = a.last('s');
  assert.equal(snap.ak[0], 3);
  assert.equal(snap.p.length, MIN_PLAYERS);
});

test('a ninth person watches, and someone leaving mid-round is replaced by a bot', () => {
  const { room, advance } = setup();
  const people = Array.from({ length: 9 }, (_, i) => fakeConn(`c${i}`));
  for (const [i, c] of people.entries()) {
    room.join(c);
    room.receive(c, { t: 'hello', name: `P${i}` });
  }
  assert.equal(room.watchers.length, 1);
  assert.equal(people[8].last('lobby').you, -1);
  advance(LOBBY_WAIT_MS);
  room.update();
  assert.equal(room.game.players.length, 8);
  room.leave(people[2]);
  assert.equal(room.slots[2].kind, 'open');
  room.update(10);
  assert.ok(room.game.tick >= 10);
});

test('a round plays to the end, reports one result, then goes back to the lobby and restarts', () => {
  const { room, results, advance } = setup();
  const a = fakeConn('a');
  room.join(a);
  room.receive(a, { t: 'hello', name: 'Mia' });
  advance(LOBBY_WAIT_MS);
  room.update();
  for (let k = 0; k < 60 * 400 && room.game.phase !== 'over'; k += 60) room.update(60);
  assert.equal(room.game.phase, 'over');
  assert.equal(results.length, 1);
  assert.equal(results[0].room, 'chan-1');
  assert.equal(results[0].players.length, MIN_PLAYERS);
  assert.ok(results[0].winners.length >= 1);

  advance(RESULT_WAIT_MS);
  room.update();
  assert.ok(a.got.some((m) => m.t === 'lobbyscreen'));
  assert.equal(room.game, null);
  advance(LOBBY_WAIT_MS);
  room.update();
  assert.equal(a.last('start').g, 2);
});

test('chat is cleaned, rate limited and stamped with the seat name', () => {
  const { room, advance } = setup();
  const a = fakeConn('a');
  room.join(a);
  room.receive(a, { t: 'hello', name: 'Mia' });
  room.receive(a, { t: 'chat', text: '  hi\n\nthere ' });
  room.receive(a, { t: 'chat', text: 'too fast' });
  advance(500);
  room.receive(a, { t: 'chat', text: 'x'.repeat(200) });
  const lines = a.got.filter((m) => m.t === 'chat' && !m.sys).map((m) => [m.name, m.text.length]);
  assert.deepEqual(lines, [['Mia', 8], ['Mia', 80]]);
});

test('nobody in the room means no round starts', () => {
  const { room, advance } = setup();
  const a = fakeConn('a');
  room.join(a);
  room.receive(a, { t: 'hello', name: 'Mia' });
  room.leave(a);
  advance(LOBBY_WAIT_MS);
  room.update();
  assert.equal(room.game, null);
  assert.ok(room.empty);
});
