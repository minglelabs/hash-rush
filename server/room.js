// One Hash Rush room run by the server instead of a player's browser (G2).
//
// The server plays the host's part of the existing protocol (src/client/main.js),
// so a browser joins exactly as it would join a player's room: it says `hello`,
// gets `lobby`, `start`, snapshots `s`, `chat` and `lobbyscreen`, and sends `i`
// inputs and `chat`. Nobody is the host, so nobody leaving stops the round, and
// no browser can make up the result.
//
// The room also keeps what the host's page keeps: each person's wins and totals
// (they go with the person, not the seat), the race to the title (10 wins, 2
// clear) and the past titles. As nobody can press "again", it says by itself
// when the next round starts (`nx` in `lobby` and `over`), and right after a
// round's last snapshot it sends `over`: the record with that round counted in,
// and whether it decided the title.

import { createGame, step } from '../src/sim/game.js';
import { DT } from '../src/sim/constants.js';
import { MAPS, MAP_IDS } from '../src/sim/map.js';
import { createBot } from '../src/ai/bot.js';
import { createLaneHelp } from '../src/client/assist.js';

export const MAX_SLOTS = 8;
// Seats a round fills with computers when fewer people are in.
export const MIN_PLAYERS = 4;
export const LOBBY_WAIT_MS = 8000;
export const RESULT_WAIT_MS = 9000;
// The first to this many wins takes the title, by this many clear of every other
// side (main.js TITLE_WINS, TITLE_LEAD). The title card stays up this long, as
// the host's page keeps it, and then the room starts over.
export const TITLE_WINS = 10;
export const TITLE_LEAD = 2;
export const TITLE_WAIT_MS = 22000;
const TITLE = Object.freeze({ wins: TITLE_WINS, lead: TITLE_LEAD });
const SEASONS_KEPT = 10;
// A seat's totals (main.js career): bonks, bonked, seeds, goals, supers, throws,
// stops, and the rounds played.
const blankCareer = () => [0, 0, 0, 0, 0, 0, 0, 0];
// Snapshots go out every other tick (30 a second) unless something happened.
const SNAPSHOT_EVERY = 2;
const CHAT_GAP_MS = 400;
// English default names; each browser shows them in its own language.
const NAMES = ['Me', 'Cloud', 'Choco', 'Dusty', 'Bean', 'Barley', 'Chestnut', 'Walnut'];
const IDLE = { mx: 0, my: 0, ax: 0, ay: 0, seq: 0, th: false, sk: false, n: 0 };

export const cleanChat = (raw) => String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 80);
const cleanName = (raw) => String(raw || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 8);
const validPid = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{16}$/.test(v) ? v : '');
const validPub = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{80,100}$/.test(v) ? v : '');
const clamp1 = (v) => Math.max(-1, Math.min(1, Number(v) || 0));

function seatName(i) {
  return i === 0 ? 'Player 1' : NAMES[i];
}

export class Room {
  // `now` and `random` are injectable so a test can play a whole round at once.
  constructor({ id, map = 'meadow', teams = false, botLevel = 'hard', now = Date.now, random = Math.random, onResult = null } = {}) {
    this.id = id;
    this.mapId = MAP_IDS.includes(map) ? map : 'meadow';
    this.teams = !!teams;
    this.botLevel = ['easy', 'normal', 'hard', 'ace'].includes(botLevel) ? botLevel : 'hard';
    this.now = now;
    this.random = random;
    this.onResult = onResult;
    this.slots = Array.from({ length: MAX_SLOTS }, (_, i) => ({ kind: 'open', name: seatName(i), team: i % 2, conn: null, input: IDLE, playerId: -1, pid: '', pub: '', userId: '' }));
    this.watchers = [];
    this.game = null;
    this.controllers = [];
    this.helpers = [];
    this.pending = [];
    this.round = 0;
    // Wins and totals by seat. A record goes with the person, not the seat (as on
    // the host's page): `owners` says whose each seat holds ('' for a computer),
    // and `records` keeps those of people not seated right now.
    this.wins = Array(MAX_SLOTS).fill(0);
    this.career = Array.from({ length: MAX_SLOTS }, blankCareer);
    this.owners = Array(MAX_SLOTS).fill('');
    this.records = new Map();
    this.rounds = 0;
    // Past titles, newest last, and one decided whose card is still up.
    this.hist = [];
    this.crowned = null;
    this.nextAt = 0; // when the next phase change is due (ms); 0 = nothing scheduled
    this.overAt = 0;
    this.match = null;
    this.ticks = 0;
  }

  // ---------- records ----------

  // Who a connection is, for the records: the mingle user of its ticket, else its
  // browser's id, else its name.
  ownerOf(conn, msg) {
    if (conn.ticket?.userId) return `u:${conn.ticket.userId}`;
    const pid = validPid(msg?.pid);
    return pid ? `p:${pid}` : `n:${cleanName(conn.ticket?.name || msg?.name)}`;
  }

  // Seat `i` is now `who`'s: the record that was there is put away, theirs comes out.
  seatRecord(i, who) {
    if (this.owners[i] === who) return;
    if (this.owners[i] && (this.wins[i] || this.career[i].some(Boolean))) this.records.set(this.owners[i], { wins: this.wins[i], career: [...this.career[i]] });
    const theirs = who ? this.records.get(who) : null;
    this.wins[i] = theirs ? theirs.wins : 0;
    this.career[i] = theirs ? [...theirs.career] : blankCareer();
    if (theirs) this.records.delete(who);
    this.owners[i] = who;
  }

  clearRecords() {
    this.wins.fill(0);
    this.career = Array.from({ length: MAX_SLOTS }, blankCareer);
    this.records.clear();
    this.rounds = 0;
  }

  // ---------- the title ----------

  // Each side's wins: a team's (its best seat, as team-mates win together) or one
  // hamster's own. Whoever has the most once somebody reaches the title, two clear
  // of the next, takes it; level at the top means it is shared (main.js champions()).
  champions(players) {
    const sideOf = (p) => (p.team >= 0 ? `t${p.team}` : `p${p.id}`);
    const sides = new Map();
    for (const p of players) sides.set(sideOf(p), Math.max(sides.get(sideOf(p)) ?? 0, this.wins[p.seat] || 0));
    const [top = 0, next = 0] = [...sides.values()].sort((a, b) => b - a);
    if (top < TITLE_WINS || top - next < TITLE_LEAD) return [];
    return players.filter((p) => sides.get(sideOf(p)) === top && this.wins[p.seat] === top);
  }

  // What goes into the past titles (main.js seasonOf()).
  seasonOf(players, champs) {
    return {
      games: this.rounds,
      rows: [...players]
        .sort((a, b) => (this.wins[b.seat] || 0) - (this.wins[a.seat] || 0))
        .map((p) => ({ name: p.name, look: p.seat, wins: this.wins[p.seat] || 0, champ: champs.includes(p) })),
    };
  }

  // How long until the room moves on (a round starts, or the lobby comes back), -1 for not at all.
  nextIn() {
    return this.nextAt ? Math.max(0, this.nextAt - this.now()) : -1;
  }

  // How long until the next round starts, -1 when none is coming: none while a
  // round is on, and after one the result's wait and then the lobby's.
  untilNextRound() {
    const until = this.nextIn();
    if (!this.game) return until;
    if (this.game.phase !== 'over' || until < 0 || !this.humans.length) return -1;
    return until + LOBBY_WAIT_MS;
  }

  get humans() {
    return this.slots.filter((s) => s.kind === 'remote' && s.conn);
  }

  get empty() {
    return this.humans.length === 0 && this.watchers.length === 0;
  }

  // ---------- connections ----------

  join(conn) {
    conn.room = this;
  }

  receive(conn, msg) {
    if (!msg || typeof msg !== 'object' || conn.kicked) return;
    if (msg.t === 'hello') {
      if (!this.slots.some((s) => s.conn === conn) && !this.watchers.includes(conn)) this.welcome(conn, msg);
      return;
    }
    const slot = this.slots.find((s) => s.conn === conn);
    if (msg.t === 'chat') {
      if (!slot && !this.watchers.includes(conn)) return;
      const at = this.now();
      if (at - (conn.lastChat || 0) < CHAT_GAP_MS) return;
      conn.lastChat = at;
      const text = cleanChat(msg.text);
      if (text) this.chat({ name: slot ? slot.name : conn.watchName, look: slot ? this.slots.indexOf(slot) : -1, text, who: conn.peer });
      return;
    }
    if (msg.t === 'sit') {
      const watching = this.watchers.indexOf(conn);
      if (watching < 0 || !this.slots.some((s) => s.kind === 'open')) return;
      this.watchers.splice(watching, 1);
      this.welcome(conn, { ...conn.hello, watch: false }, true);
      return;
    }
    if (!slot) return;
    if (msg.t === 'stand') {
      if (this.game && this.game.phase !== 'over') return;
      this.chat({ sys: 'leave', name: slot.name, look: -1, text: '', who: conn.peer });
      conn.watchName = slot.name;
      conn.hello = { name: slot.name, pid: slot.pid, pub: slot.pub };
      // The seat keeps their record: sitting down again, they get it back.
      this.freeSeat(slot);
      this.watchers.push(conn);
      this.cancelIfNobody();
      this.sendLobby();
      return;
    }
    if (msg.t === 'name') {
      // A mingle ticket's chat name is the player's name here: the page cannot change it.
      if (conn.ticket?.name) return;
      slot.name = this.uniqueName(slot, cleanName(msg.name));
      this.sendLobby();
      this.broadcast(() => ({ t: 'rename', who: conn.peer, name: slot.name }));
    } else if (msg.t === 'team') {
      if (!this.teams || !Number.isInteger(msg.team) || msg.team < 0 || msg.team > 3) return;
      slot.team = msg.team;
      this.sendLobby();
    } else if (msg.t === 'i') {
      const no = Number(msg.n) || 0;
      if (no && no <= slot.input.n) return;
      slot.input = { mx: clamp1(msg.mx), my: clamp1(msg.my), ax: clamp1(msg.ax), ay: clamp1(msg.ay), seq: Number(msg.seq) || 0, th: !!msg.th, sk: !!msg.sk, n: no };
    }
  }

  leave(conn) {
    const watching = this.watchers.indexOf(conn);
    if (watching >= 0) {
      this.watchers.splice(watching, 1);
      this.sendLobby();
      this.chat({ sys: 'leave', name: conn.watchName, look: -1, text: '', who: conn.peer });
      return;
    }
    const slot = this.slots.find((s) => s.conn === conn);
    if (!slot) return;
    this.chat({ sys: 'leave', name: slot.name, look: -1, text: '', who: conn.peer });
    const id = slot.playerId;
    this.freeSeat(slot);
    // Mid-round a computer takes the hamster over, so the round still ends.
    if (this.game && this.game.phase !== 'over' && id >= 0) {
      const bot = createBot({ difficulty: 'normal', seed: (this.random() * 2 ** 32) >>> 0 });
      this.controllers[id] = (g) => bot.think(g, id);
    }
    this.cancelIfNobody();
    this.sendLobby();
  }

  // In the lobby with nobody left in a seat, no round is coming: the countdown stops.
  cancelIfNobody() {
    if (!this.game && !this.humans.length) this.nextAt = 0;
  }

  freeSeat(slot) {
    slot.conn = null;
    slot.kind = 'open';
    slot.name = seatName(this.slots.indexOf(slot));
    slot.input = IDLE;
    slot.pid = slot.pub = slot.userId = '';
  }

  uniqueName(slot, name) {
    const i = this.slots.indexOf(slot);
    let base = name && !NAMES.slice(0, 1).includes(name) ? name : seatName(i);
    const taken = (n) => this.slots.some((s) => s !== slot && s.kind !== 'open' && s.name === n);
    if (!taken(base)) return base;
    for (let k = 2; k < 10; k++) if (!taken(`${base.slice(0, 7)}${k}`)) return `${base.slice(0, 7)}${k}`;
    return base;
  }

  welcome(conn, msg, sitting = false) {
    const pid = validPid(msg.pid);
    // The same browser back again before its old connection was noticed gone.
    if (pid) {
      for (const old of [...this.slots.filter((s) => s.conn && s.conn !== conn && s.pid === pid).map((s) => s.conn), ...this.watchers.filter((c) => c !== conn && c.hello?.pid === pid)]) {
        this.leave(old);
        old.kicked = true;
        old.close();
      }
    }
    // Back again, a person gets the seat that holds their record; a newcomer one
    // that holds nobody's, so somebody who just left finds theirs still there.
    const who = this.ownerOf(conn, msg);
    const free = msg.watch ? [] : this.slots.filter((s) => s.kind === 'open');
    const slot = free.find((s) => this.owners[this.slots.indexOf(s)] === who) || free.find((s) => !this.owners[this.slots.indexOf(s)]) || free[0];
    if (slot) {
      slot.kind = 'remote';
      slot.conn = conn;
      slot.pid = pid;
      slot.pub = validPub(msg.pub);
      slot.input = IDLE;
      slot.playerId = -1;
      if (this.teams) slot.team = this.smallerTeam();
      // A mingle ticket carries the chat name; it wins over what the page says.
      slot.name = this.uniqueName(slot, cleanName(conn.ticket?.name || msg.name));
      slot.userId = conn.ticket?.userId || '';
      // Their own wins and totals come with them.
      this.seatRecord(this.slots.indexOf(slot), who);
    } else {
      conn.watchName = cleanName(conn.ticket?.name || msg.name) || 'Watcher';
      conn.hello = msg;
      this.watchers.push(conn);
    }
    // Somebody in a seat and no round yet: the next one is on its way.
    if (!this.game && !this.nextAt && this.humans.length) this.nextAt = this.now() + LOBBY_WAIT_MS;
    this.sendLobby();
    this.chat({ sys: 'join', name: slot ? slot.name : conn.watchName, look: -1, text: '', who: conn.peer });
    if (sitting) return;
    if (this.game && this.game.phase !== 'over') conn.send(this.startMessage(-1));
  }

  smallerTeam() {
    const size = [0, 1].map((k) => this.slots.filter((s) => s.kind === 'remote' && s.team === k).length);
    return size[1] < size[0] ? 1 : 0;
  }

  // ---------- messages ----------

  broadcast(make) {
    this.slots.forEach((slot, i) => {
      if (slot.conn) slot.conn.send(make(slot, i));
    });
    for (const conn of this.watchers) conn.send(make({ playerId: -1 }, -1));
  }

  fastToAll(msg) {
    for (const slot of this.slots) if (slot.conn) slot.conn.fast(msg);
    for (const conn of this.watchers) conn.fast(msg);
  }

  chat(msg) {
    this.broadcast(() => ({ t: 'chat', ...msg, at: this.now() }));
  }

  // Each seat says which mingle user sits in it (from the app ticket, '' without
  // one), so the page inside the app knows over whose hamster their chat goes.
  lobbyView() {
    return this.slots.map((s) => ({ kind: s.kind, name: s.name, team: s.team, pid: s.kind === 'remote' ? s.pid : '', userId: s.kind === 'remote' ? s.userId || '' : '' }));
  }

  // Nobody is the host, so the room says what it is about to do by itself: `nx`,
  // how long until the next round starts (ms, -1 when none is coming), `fill`,
  // how many hamsters a round has at least (computers take the empty seats), and
  // `title`, the race to the title. `tot` is each seat's totals and `hist` the
  // past titles, both as the host's page keeps them.
  sendLobby() {
    const view = this.lobbyView();
    const spect = this.watchers.map((c) => c.watchName);
    const nx = this.untilNextRound();
    this.broadcast((slot, i) => ({ t: 'lobby', slots: view, spect, teams: this.teams, map: this.mapId, pw: '', you: i, wins: this.wins, tot: this.career, rd: this.rounds, hist: this.hist, nx, fill: MIN_PLAYERS, title: TITLE }));
  }

  roster() {
    return this.game.players.map((p) => ({ name: p.name, look: p.look, team: p.team, kind: p.kind, nest: p.nest, pid: p.pid || '', pub: p.pub || '' }));
  }

  startMessage(you) {
    return { t: 'start', g: this.round, map: this.game.map.id, players: this.roster(), you, wins: this.wins, tot: this.career, rd: this.rounds, hist: this.hist, mid: this.match.id, at: this.match.at };
  }

  // ---------- rounds ----------

  startRound() {
    const people = this.slots.filter((s) => s.kind === 'remote' && s.conn);
    if (!people.length) {
      this.nextAt = 0;
      // Those watching learn no round is coming after all.
      this.sendLobby();
      return false;
    }
    // People in their seats, then computers in the empty seats up to MIN_PLAYERS.
    const active = this.slots
      .map((slot, look) => ({ slot, look }))
      .filter(({ slot }) => slot.kind === 'remote' && slot.conn);
    for (let look = 0; active.length < MIN_PLAYERS && look < MAX_SLOTS; look++) {
      if (active.some((a) => a.look === look)) continue;
      active.push({ slot: { kind: `bot:${this.botLevel}`, name: NAMES[look] || `Bot ${look + 1}`, team: look % 2, input: IDLE }, look });
    }
    active.sort((a, b) => a.look - b.look);
    // A computer in a seat plays on its own record; a person's who left is put away for them.
    for (const { slot, look } of active) if (slot.kind !== 'remote') this.seatRecord(look, '');
    for (const s of this.slots) s.playerId = -1;
    const seed = (this.random() * 2 ** 32) >>> 0;
    this.game = createGame({
      map: MAPS[this.mapId],
      slots: active.map(({ slot, look }) => ({ name: slot.name, kind: slot.kind, look, team: this.teams ? slot.team : -1 })),
      seed,
    });
    this.helpers = [];
    this.controllers = active.map(({ slot }, id) => {
      slot.playerId = id;
      if (slot.kind === 'remote') {
        const help = createLaneHelp();
        this.helpers[id] = help;
        let seen = slot.input.seq;
        return (g) => {
          const i = slot.input;
          const bonk = i.seq !== seen;
          seen = i.seq;
          return help(g, g.players[id], { mx: i.mx, my: i.my, ax: i.ax, ay: i.ay, bonk, throw: i.th, stick: i.sk });
        };
      }
      const bot = createBot({ difficulty: this.botLevel, seed: seed + id * 7919 });
      return (g) => bot.think(g, id);
    });
    this.game.players.forEach((p, id) => {
      const slot = active[id].slot;
      p.pid = slot.kind === 'remote' ? slot.pid : '';
      p.pub = slot.kind === 'remote' ? slot.pub : '';
      p.userId = slot.kind === 'remote' ? slot.userId || '' : '';
      p.seat = active[id].look;
    });
    this.pending = [];
    this.round++;
    this.ticks = 0;
    this.overAt = 0;
    this.nextAt = 0;
    this.match = { id: Math.floor(this.random() * 36 ** 8).toString(36).padStart(8, '0') + this.now().toString(36).slice(-4), at: this.now() };
    this.broadcast((slot) => this.startMessage(slot.playerId ?? -1));
    return true;
  }

  snapshot(events) {
    const g = this.game;
    const r = (v) => Math.round(v * 10) / 10;
    const q = (v) => Math.round(v * 1000) / 1000;
    const acks = g.players.map(() => 0);
    for (const slot of this.slots) if (slot.conn && slot.playerId >= 0) acks[slot.playerId] = slot.input.n || 0;
    return {
      t: 's',
      g: this.round,
      k: g.tick,
      ak: acks,
      st: g.players.map((_, id) => {
        const m = this.helpers[id] && this.helpers[id].memory();
        return m ? [m.lx, m.ly, q(m.at), m.px, m.py, m.turn === 'x' ? 1 : m.turn === 'y' ? 2 : 0] : 0;
      }),
      ph: g.phase,
      cd: g.countdown,
      tm: g.time,
      hx: g.homeX,
      nb: g.nibbler,
      w: g.winner,
      ws: g.winners,
      to: g.timeout,
      p: g.players.map((p) => [
        r(p.x), r(p.y), r(p.vx), r(p.vy), q(p.fx), q(p.fy), p.carrying ? 1 : 0, q(p.gather), p.queued,
        p.swing ? [p.swing.phase, q(p.swing.t), q(p.swing.dx), q(p.swing.dy)] : 0, q(p.cooldown), p.kills, p.deaths, p.seeds, p.supers, q(p.charge), p.throws, r(p.wet), p.stops, q(p.dazed),
      ]),
      hz: g.hazards.map((h) => [h.kind, r(h.x), r(h.y), h.dx || 0, h.dy || 0, Math.round(h.age * 100) / 100]),
      ev: events,
    };
  }

  // One simulation tick, plus its snapshot.
  tick() {
    const g = this.game;
    if (!g || g.phase === 'over') return;
    step(g, this.controllers.map((read) => read(g)));
    for (const ev of g.events) this.pending.push({ ...ev });
    this.ticks++;
    const over = g.phase === 'over';
    if (this.pending.length || over || this.ticks % SNAPSHOT_EVERY === 0) {
      const msg = this.snapshot(this.pending);
      this.pending = [];
      if (msg.ev.length || over) this.broadcast(() => msg);
      else this.fastToAll(msg);
    }
    if (over) this.finishRound();
  }

  finishRound() {
    const g = this.game;
    this.rounds++;
    const winners = g.winners?.length ? g.winners : g.winner != null ? [g.winner] : [];
    for (const id of winners) {
      const seat = g.players[id]?.seat;
      if (seat != null) this.wins[seat]++;
    }
    // Each seat's totals, the round's numbers added (main.js roundOf()): a goal is a
    // seed brought home, in a round that did not run out of time.
    for (const p of g.players) {
      if (p.seat == null) continue;
      const goal = !g.timeout && g.winner === p.id ? 1 : 0;
      [p.kills, p.deaths, p.seeds, goal, p.supers, p.throws, p.stops, 1].forEach((v, k) => (this.career[p.seat][k] += v || 0));
    }
    const champs = this.champions(g.players);
    this.crowned = champs.length ? this.seasonOf(g.players, champs) : null;
    this.overAt = this.now();
    this.nextAt = this.overAt + (this.crowned ? TITLE_WAIT_MS : RESULT_WAIT_MS);
    // Right after the round's last snapshot: the record with the round counted in,
    // whether it decided the title, and how long until the next round starts.
    this.broadcast(() => ({ t: 'over', g: this.round, wins: this.wins, tot: this.career, rd: this.rounds, champ: !!this.crowned, nx: this.untilNextRound(), title: TITLE }));
    if (this.onResult) {
      try {
        this.onResult(this.result());
      } catch {
        // reporting must never stop the room
      }
    }
  }

  // What the round came to, decided here and nowhere else.
  result() {
    const g = this.game;
    return {
      room: this.id,
      matchId: this.match.id,
      at: this.match.at,
      endedAt: this.overAt,
      map: g.map.id,
      teams: this.teams,
      timeout: !!g.timeout,
      winners: g.winners?.length ? [...g.winners] : g.winner != null ? [g.winner] : [],
      // userId is the mingle user behind the seat (from the app ticket), for room rankings.
      players: g.players.map((p) => ({ id: p.id, name: p.name, kind: p.kind, team: p.team, pid: p.pid || '', userId: p.userId || '', seeds: p.seeds, kills: p.kills, deaths: p.deaths })),
    };
  }

  // Called by the server clock. Runs as many ticks as are due and moves the room
  // between lobby, round and results.
  update(elapsedTicks = 1) {
    const at = this.now();
    if (this.game && this.game.phase !== 'over') {
      for (let k = 0; k < elapsedTicks && this.game.phase !== 'over'; k++) this.tick();
      return;
    }
    if (!this.nextAt || at < this.nextAt) return;
    if (this.game && this.game.phase === 'over') {
      // A title decided: it goes into the past titles and the room starts over.
      if (this.crowned) {
        this.hist = [...this.hist, this.crowned].slice(-SEASONS_KEPT);
        this.crowned = null;
        this.clearRecords();
      }
      this.broadcast(() => ({ t: 'lobbyscreen' }));
      this.game = null;
      this.nextAt = this.humans.length ? at + LOBBY_WAIT_MS : 0;
      this.sendLobby();
      return;
    }
    this.startRound();
  }
}

export const TICK_MS = DT * 1000;
