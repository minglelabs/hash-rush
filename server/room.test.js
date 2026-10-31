import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room, LOBBY_WAIT_MS, RESULT_WAIT_MS, MIN_PLAYERS, TITLE_WINS, TITLE_LEAD, TITLE_WAIT_MS } from './room.js';

function fakeConn(peer) {
  const got = [];
  return { peer, open: true, got, send: (m) => got.push(m), fast: (m) => got.push(m), close() { this.open = false; }, last: (t) => [...got].reverse().find((m) => m.t === t) };
}

function setup(options = {}) {
  let clock = 1_000_000;
  let seed = 1;
  const results = [];
  const room = new Room({ id: 'chan-1', ...options, now: () => clock, random: () => ((seed = (seed * 16807) % 2147483647) / 2147483647), onResult: (r) => results.push(r) });
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

test("a mingle ticket's chat name is the name: the page can neither replace it nor rename it", () => {
  const { room } = setup();
  const a = fakeConn('a');
  a.ticket = { room: 'chan-1', userId: 'u1', name: 'Mia' };
  room.join(a);
  room.receive(a, { t: 'hello', name: 'Other' });
  assert.equal(a.last('lobby').slots[0].name, 'Mia');
  room.receive(a, { t: 'name', name: 'Zed' });
  assert.equal(a.last('lobby').slots[0].name, 'Mia');
  assert.equal(a.last('rename'), undefined);

  // Without a ticket's name, a player still renames as before.
  const b = fakeConn('b');
  room.join(b);
  room.receive(b, { t: 'hello', name: 'Bo' });
  room.receive(b, { t: 'name', name: 'Bea' });
  assert.equal(b.last('lobby').slots[1].name, 'Bea');
  assert.equal(b.last('rename').name, 'Bea');
});

test("each lobby seat carries its mingle user from the ticket, '' without one, and loses it with the seat", () => {
  const { room } = setup();
  const a = fakeConn('a');
  a.ticket = { room: 'chan-1', userId: 'u1', name: 'Mia' };
  const b = fakeConn('b');
  room.join(a);
  room.receive(a, { t: 'hello', name: 'Mia' });
  room.join(b);
  room.receive(b, { t: 'hello', name: 'Bo' });
  const seats = () => b.last('lobby').slots;
  assert.deepEqual(seats().map((s) => s.userId), ['u1', '', '', '', '', '', '', '']);
  // The rest of each seat is as it was.
  assert.deepEqual(Object.keys(seats()[0]).sort(), ['kind', 'name', 'pid', 'team', 'userId']);
  assert.deepEqual([seats()[0].kind, seats()[0].name], ['remote', 'Mia']);

  // Standing up to watch gives the seat up; sitting down again brings the ticket's user along.
  room.receive(a, { t: 'stand' });
  assert.equal(seats()[0].userId, '');
  assert.equal(seats()[0].kind, 'open');
  room.receive(a, { t: 'sit' });
  assert.equal(seats()[0].userId, 'u1');

  room.leave(a);
  assert.ok(seats().every((s) => s.userId === ''));
});

// ---------- records, the title and the room's own clock ----------

const ticketed = (peer, userId, name) => Object.assign(fakeConn(peer), { ticket: { room: 'chan-1', userId, name } });

function joinAs(room, conn, name = conn.ticket?.name || conn.peer) {
  room.join(conn);
  room.receive(conn, { t: 'hello', name });
  return conn;
}

// Ends the round now with `winners` (hamster ids), as the simulation would.
function endRound(room, winners, { timeout = false } = {}) {
  const g = room.game;
  g.phase = 'over';
  g.winners = winners;
  g.winner = winners[0] ?? null;
  g.timeout = timeout;
  room.finishRound();
}

function playRound(room, advance, winners, options) {
  advance(LOBBY_WAIT_MS);
  room.update();
  assert.ok(room.game, 'a round started');
  endRound(room, winners, options);
  advance(room.crowned ? TITLE_WAIT_MS : RESULT_WAIT_MS);
  room.update();
  assert.equal(room.game, null, 'back in the lobby');
}

test('the lobby says when the next round starts, by itself: none while nobody sits, -1 during a round, the result and lobby waits after one', () => {
  const { room, advance } = setup();
  const watcher = fakeConn('w');
  room.join(watcher);
  room.receive(watcher, { t: 'hello', name: 'Wes', watch: true });
  // Only somebody watching: no round is coming.
  assert.equal(watcher.last('lobby').nx, -1);
  assert.equal(room.nextAt, 0);

  const a = joinAs(room, ticketed('a', 'u1', 'Mia'));
  assert.equal(a.last('lobby').nx, LOBBY_WAIT_MS);
  assert.equal(a.last('lobby').fill, MIN_PLAYERS);
  assert.deepEqual(a.last('lobby').title, { wins: TITLE_WINS, lead: TITLE_LEAD });
  advance(3000);
  room.receive(watcher, { t: 'sit' });
  assert.equal(watcher.last('lobby').nx, LOBBY_WAIT_MS - 3000);

  advance(LOBBY_WAIT_MS);
  room.update();
  assert.ok(a.last('start'));
  // Somebody coming in mid-round hears that no lobby countdown is running.
  const late = joinAs(room, ticketed('late', 'u9', 'Lou'));
  assert.equal(late.last('lobby').nx, -1);

  endRound(room, [0]);
  const over = a.last('over');
  assert.equal(over.nx, RESULT_WAIT_MS + LOBBY_WAIT_MS);
  advance(4000);
  const during = joinAs(room, ticketed('d', 'u3', 'Dee'));
  assert.equal(during.last('lobby').nx, RESULT_WAIT_MS - 4000 + LOBBY_WAIT_MS);

  advance(RESULT_WAIT_MS);
  room.update();
  assert.equal(a.last('lobby').nx, LOBBY_WAIT_MS);
});

test('nobody left in a seat stops the countdown at once', () => {
  const { room, advance } = setup();
  const a = joinAs(room, ticketed('a', 'u1', 'Mia'));
  advance(1000);
  room.receive(a, { t: 'stand' });
  assert.equal(room.nextAt, 0);
  assert.equal(a.last('lobby').nx, -1);
  room.receive(a, { t: 'sit' });
  assert.equal(a.last('lobby').nx, LOBBY_WAIT_MS);
  room.leave(a);
  assert.equal(room.nextAt, 0);
});

test('a finished round sends over right after its last snapshot: wins, every total and the rounds played', () => {
  const { room, advance } = setup();
  const a = joinAs(room, ticketed('a', 'u1', 'Mia'));
  advance(LOBBY_WAIT_MS);
  room.update();
  const g = room.game;
  Object.assign(g.players[0], { kills: 3, deaths: 1, seeds: 2, supers: 1, throws: 1, stops: 2 });
  Object.assign(g.players[1], { kills: 1, deaths: 4, seeds: 0, supers: 0, throws: 0, stops: 0 });
  endRound(room, [0]);
  const over = a.last('over');
  assert.equal(over.g, 1);
  assert.equal(over.rd, 1);
  assert.equal(over.champ, false);
  assert.equal(over.wins[0], 1);
  // [bonks, bonked, seeds, goals, supers, throws, stops, played]
  assert.deepEqual(over.tot[0], [3, 1, 2, 1, 1, 1, 2, 1]);
  assert.deepEqual(over.tot[1], [1, 4, 0, 0, 0, 0, 0, 1]);
  // Seats nobody played in this round played nothing.
  assert.deepEqual(over.tot[5], [0, 0, 0, 0, 0, 0, 0, 0]);
  // A round that ran out of time has no goal.
  playRound(room, advance, [], {});
  advance(LOBBY_WAIT_MS);
  room.update();
  endRound(room, [1], { timeout: true });
  assert.equal(a.last('over').tot[1][3], 0);
  assert.equal(a.last('over').wins[1], 1);
  // A whole round played by the simulation sends exactly one over, after its last snapshot.
  const b = joinAs(room, ticketed('b', 'u2', 'Bo'));
  advance(RESULT_WAIT_MS);
  room.update();
  advance(LOBBY_WAIT_MS);
  room.update();
  assert.ok(room.game);
  b.got.length = 0;
  for (let k = 0; k < 60 * 400 && room.game.phase !== 'over'; k += 60) room.update(60);
  const kinds = b.got.filter((m) => m.t === 's' || m.t === 'over').map((m) => m.t);
  assert.equal(kinds.filter((t) => t === 'over').length, 1);
  assert.equal(kinds.at(-1), 'over');
  assert.equal(b.got.filter((m) => m.t === 's').at(-1).ph, 'over');
});

test('wins and totals go with the person: back again they get them, a newcomer starts from nothing', () => {
  const { room, advance } = setup();
  const a = joinAs(room, ticketed('a', 'u1', 'Mia'));
  joinAs(room, ticketed('b', 'u2', 'Bo'));
  playRound(room, advance, [0]);
  playRound(room, advance, [0]);
  assert.equal(room.wins[0], 2);
  room.leave(a);
  // Somebody new takes a seat nobody's record is in, not Mia's.
  const c = joinAs(room, ticketed('c', 'u3', 'Cy'));
  assert.equal(c.last('lobby').you, 2);
  assert.equal(c.last('lobby').wins[2], 0);
  // Mia back: her own seat, her own record.
  const a2 = joinAs(room, ticketed('a2', 'u1', 'Mia'));
  const lobby = a2.last('lobby');
  assert.equal(lobby.you, 0);
  assert.equal(lobby.wins[0], 2);
  assert.equal(lobby.tot[0][7], 2);
});

test("a person's record is put away when somebody else needs their seat, and comes back with them", () => {
  const { room, advance } = setup();
  const people = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'].map((id, i) => joinAs(room, ticketed(`c${i}`, id, `P${i}`)));
  playRound(room, advance, [0]);
  assert.equal(room.wins[0], 1);
  room.leave(people[0]);
  // The room is full but for P0's seat: the newcomer takes it, with a record of their own.
  const newcomer = joinAs(room, ticketed('n', 'u9', 'Nia'));
  assert.equal(newcomer.last('lobby').you, 0);
  assert.equal(newcomer.last('lobby').wins[0], 0);
  room.leave(people[3]);
  // P0 back, in the seat that was P3's: P0's own record comes out again.
  const back = joinAs(room, ticketed('b', 'u1', 'P0'));
  assert.equal(back.last('lobby').you, 3);
  assert.equal(back.last('lobby').wins[3], 1);
});

test("a computer filling the seat of someone gone plays on its own record, and theirs waits for them", () => {
  const { room, advance } = setup();
  const a = joinAs(room, ticketed('a', 'u1', 'Mia'));
  const b = joinAs(room, ticketed('b', 'u2', 'Bo'));
  playRound(room, advance, [1]);
  assert.equal(room.wins[1], 1);
  room.leave(b);
  // The next round's computers take seats 1, 2 and 3; Bo's wins are put away.
  playRound(room, advance, [0]);
  assert.equal(room.wins[1], 0);
  assert.equal(room.owners[1], '');
  const back = joinAs(room, ticketed('b2', 'u2', 'Bo'));
  const lobby = back.last('lobby');
  assert.equal(lobby.wins[lobby.you], 1);
  assert.equal(a.last('lobby').wins[0], 1);
});

test('standing up to watch and sitting down again keeps the record', () => {
  const { room, advance } = setup();
  const a = joinAs(room, ticketed('a', 'u1', 'Mia'));
  joinAs(room, ticketed('b', 'u2', 'Bo'));
  playRound(room, advance, [0]);
  room.receive(a, { t: 'stand' });
  assert.equal(a.last('lobby').you, -1);
  assert.deepEqual(a.last('lobby').spect, ['Mia']);
  room.receive(a, { t: 'sit' });
  assert.equal(a.last('lobby').you, 0);
  assert.equal(a.last('lobby').wins[0], 1);
});

test('ten wins two clear take the title: its card stays up longer, then the record starts over and the title is kept', () => {
  const { room, advance } = setup();
  const a = joinAs(room, ticketed('a', 'u1', 'Mia'));
  advance(LOBBY_WAIT_MS);
  room.update();
  room.wins[0] = TITLE_WINS - 1;
  room.wins[1] = TITLE_WINS - 3;
  room.rounds = 17;
  endRound(room, [0]);
  const over = a.last('over');
  assert.equal(over.champ, true);
  assert.equal(over.wins[0], TITLE_WINS);
  assert.equal(over.nx, TITLE_WAIT_MS + LOBBY_WAIT_MS);
  // The title card is still up after the usual result wait.
  advance(RESULT_WAIT_MS);
  room.update();
  assert.ok(room.game);
  advance(TITLE_WAIT_MS - RESULT_WAIT_MS);
  room.update();
  assert.equal(room.game, null);
  const lobby = a.last('lobby');
  assert.ok(lobby.wins.every((n) => n === 0));
  assert.equal(lobby.rd, 0);
  assert.ok(lobby.tot.every((row) => row.every((n) => n === 0)));
  assert.equal(lobby.hist.length, 1);
  assert.equal(lobby.hist[0].games, 18);
  assert.deepEqual(lobby.hist[0].rows[0], { name: 'Mia', look: 0, wins: TITLE_WINS, champ: true });
  assert.equal(lobby.hist[0].rows.filter((r) => r.champ).length, 1);
  // The next title race starts at the next round, with the past one kept.
  playRound(room, advance, [0]);
  assert.equal(a.last('lobby').hist.length, 1);
  assert.equal(a.last('lobby').wins[0], 1);
});

test('level near the top is deuce: no title until one side is two clear', () => {
  const { room, advance } = setup();
  const a = joinAs(room, ticketed('a', 'u1', 'Mia'));
  advance(LOBBY_WAIT_MS);
  room.update();
  room.wins[0] = TITLE_WINS - 1;
  room.wins[1] = TITLE_WINS - 1;
  endRound(room, [0]);
  assert.equal(a.last('over').champ, false);
  assert.equal(a.last('over').nx, RESULT_WAIT_MS + LOBBY_WAIT_MS);
  // Eleven to nine is two clear.
  advance(RESULT_WAIT_MS);
  room.update();
  advance(LOBBY_WAIT_MS);
  room.update();
  endRound(room, [0]);
  assert.equal(a.last('over').champ, true);
});

test('two sides level at the top is no title, however many wins they have', () => {
  const { room, advance } = setup();
  const a = joinAs(room, ticketed('a', 'u1', 'Mia'));
  advance(LOBBY_WAIT_MS);
  room.update();
  room.wins[0] = TITLE_WINS - 1;
  room.wins[1] = TITLE_WINS - 1;
  // A round that ran out of time with both on top: both get the win, still level.
  endRound(room, [0, 1], { timeout: true });
  assert.deepEqual(a.last('over').wins.slice(0, 2), [TITLE_WINS, TITLE_WINS]);
  assert.equal(a.last('over').champ, false);
});

test('team-mates level at the top of the winning side share the title', () => {
  const { room, advance } = setup({ teams: true });
  const a = joinAs(room, ticketed('a', 'u1', 'Mia'));
  advance(LOBBY_WAIT_MS);
  room.update();
  const players = room.game.players;
  const mate = players.find((p) => p.id !== 0 && p.team === players[0].team);
  const rival = players.find((p) => p.team !== players[0].team);
  assert.ok(mate && rival);
  room.wins[0] = TITLE_WINS - 1;
  room.wins[mate.seat] = TITLE_WINS - 1;
  room.wins[rival.seat] = TITLE_WINS - 3;
  endRound(room, [0, mate.id]);
  assert.equal(a.last('over').champ, true);
  advance(TITLE_WAIT_MS);
  room.update();
  const rows = a.last('lobby').hist[0].rows;
  assert.deepEqual(rows.filter((r) => r.champ).map((r) => r.look).sort(), [0, mate.seat].sort());
});
