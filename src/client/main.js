// Lobby, game loop and HUD. Each slot gets a controller that produces inputs for the
// simulation: the local human, a bot, or a friend connected over the network.
//
// Online play has no server. The host's browser runs the simulation; guests send
// their inputs and draw the snapshots the host sends back.

import { createGame, step } from '../sim/game.js';
import { DT, OVERTIME, COUNTDOWN } from '../sim/constants.js';
import { MAP } from '../sim/map.js';
import { createBot } from '../ai/bot.js';
import { createRenderer, drawHamster } from './render.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { LOOKS } from './looks.js';
import { lang, t, LANGUAGES, stringsFor } from './i18n.js';
import { hostRoom, joinRoom } from './net.js';

const $ = (id) => document.getElementById(id);
const STORE = 'seed-rush-slots';
// What the host can set a slot to. 'remote' is an open slot a friend has taken.
const KINDS = ['human', 'bot:easy', 'bot:normal', 'bot:hard', 'closed', 'open'];
const DEFAULT_SLOTS = ['human', 'bot:normal', 'bot:normal', 'bot:normal'].map((kind, i) => ({ kind, name: t('names')[i] }));
const IDLE = { mx: 0, my: 0, ax: 0, ay: 0, seq: 0 };
// A guest who never renamed itself is still called "Me" in its own language.
const ME_NAMES = new Set(LANGUAGES.map((code) => stringsFor(code).names[0]));

function loadSlots() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    if (Array.isArray(saved) && saved.length === DEFAULT_SLOTS.length) {
      return DEFAULT_SLOTS.map((d, i) => ({
        kind: i === 0 ? 'human' : KINDS.some((k) => k === saved[i].kind && k !== 'human' && k !== 'open') ? saved[i].kind : d.kind,
        name: String(saved[i].name || d.name).slice(0, 8),
      }));
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_SLOTS.map((s) => ({ ...s }));
}

// Fills in the static page text for the chosen language.
function localizePage() {
  document.documentElement.lang = lang;
  document.querySelector('meta[name="description"]').content = t('description');
  for (const el of document.querySelectorAll('[data-i18n]')) el.innerHTML = t(el.dataset.i18n);
  $('mute').title = t('sound');
  $('how').replaceChildren(
    ...t('how').map((html) => {
      const li = document.createElement('li');
      li.innerHTML = html;
      return li;
    }),
  );
}

const slots = loadSlots();
const wins = slots.map(() => 0);
const audio = createAudio();
const renderer = createRenderer($('canvas'), MAP);
const input = createInput({
  stage: $('stage'),
  canvas: $('canvas'),
  stick: $('stick'),
  knob: $('knob'),
  bonkBtn: $('bonk'),
  toWorld: renderer.toWorld,
  toWorldDir: renderer.toWorldDir,
});

const query = new URLSearchParams(location.search);
const joinId = query.get('room');
// Opening the watch link joins as a spectator instead of taking a slot.
const watchOnly = query.has('watch');
// role: null (offline), 'host' or 'guest'.
const net = { role: joinId ? 'guest' : null, room: null, host: null, status: '', lobby: null, you: -1, pending: [], watchers: [] };

let game = null;
let controllers = [];
let meId = -1;
let last = 0;
let acc = 0;
let resultTimer = 0;
let bannerTimer = 0;
let scoreKey = '';
let bonkSeq = 0;
let bonkWas = false;

// ---------- lobby ----------

function drawAvatar(canvas, look) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = 52 * dpr;
  canvas.height = 46 * dpr;
  ctx.scale(dpr * 1.25, dpr * 1.25);
  drawHamster(ctx, { x: 21, y: 19, fx: 0.4, fy: 0, moving: false, carrying: false, swing: null, look, t: 0 });
}

const isPlaying = (slot) => slot.kind !== 'closed' && slot.kind !== 'open';

function renderLobby() {
  const guest = net.role === 'guest';
  const rows = guest ? net.lobby || [] : slots;
  const list = $('slots');
  list.textContent = '';
  rows.forEach((slot, i) => {
    const li = document.createElement('li');
    li.style.setProperty('--c', LOOKS[i].color);
    li.classList.toggle('closed', slot.kind === 'closed');

    const avatar = document.createElement('canvas');
    drawAvatar(avatar, LOOKS[i]);

    const mine = guest ? i === net.you : slot.kind !== 'remote';
    const name = document.createElement('input');
    // An open slot has nobody in it yet, so it shows no name.
    const empty = slot.kind === 'open';
    name.value = empty ? '' : slot.name;
    name.placeholder = empty ? t('waitingFriend') : '';
    name.maxLength = 8;
    name.disabled = !mine || empty;
    name.setAttribute('aria-label', t('slotName', i + 1));
    name.addEventListener('input', () => {
      slot.name = name.value;
      if (guest) {
        net.host.send({ t: 'name', name: name.value });
      } else {
        saveSlots();
        sendLobby();
      }
    });

    const kind = document.createElement('select');
    kind.setAttribute('aria-label', t('slotKind', i + 1));
    // A guest only sees who is in each slot; the host chooses.
    const person = guest ? (i === net.you ? 'human' : 'remote') : slot.kind;
    const shown = slot.kind === 'human' || slot.kind === 'remote' ? person : slot.kind;
    const options = guest || i === 0 || slot.kind === 'remote' ? [shown, ...(slot.kind === 'remote' && !guest ? ['open', 'closed'] : [])] : KINDS.filter((k) => k !== 'human');
    for (const value of options) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = t('kinds')[value];
      kind.append(opt);
    }
    kind.value = shown;
    kind.disabled = guest || i === 0;
    kind.addEventListener('change', () => setKind(slot, kind.value));

    li.append(avatar, name, kind);
    list.append(li);
  });

  const inviting = net.role === 'host' || slots.some((s) => s.kind === 'open');
  $('invite').hidden = guest || !inviting;
  $('inviteText').textContent = net.room ? t('invite') : net.status || t('roomCreating');
  $('inviteLink').hidden = !net.room;
  $('copy').hidden = !net.room;
  $('watchRow').hidden = !net.room;
  if (net.room) {
    const link = `${location.origin}${location.pathname}?room=${net.room}`;
    $('inviteLink').value = link;
    $('watchLink').value = `${link}&watch`;
    $('watchText').textContent = `${t('watchLink')} · ${t('spectators', net.watchers.length)}`;
  }
  $('netStatus').hidden = !guest;
  $('netStatus').textContent = net.status || (guest && net.lobby && net.you < 0 ? t('spectating') : '');
  updateStart();
}

function setKind(slot, kind) {
  if (slot.conn) {
    slot.conn.close();
    slot.conn = null;
  }
  slot.kind = kind;
  if (kind === 'open') openRoom();
  saveSlots();
  renderLobby();
  sendLobby();
}

function saveSlots() {
  try {
    localStorage.setItem(STORE, JSON.stringify(slots.map(({ kind, name }) => ({ kind, name }))));
  } catch {
    // not persisted
  }
}

function updateStart() {
  if (net.role === 'guest') {
    $('start').disabled = true;
    $('start').textContent = t('waitingHost');
    return;
  }
  const playing = slots.filter(isPlaying).length;
  $('start').disabled = playing < 2;
  $('start').textContent = t(playing < 2 ? 'needOpponent' : 'start');
}

function show(screen) {
  $('lobby').hidden = screen !== 'lobby';
  $('stage').hidden = screen !== 'stage';
}

// ---------- hosting ----------

async function openRoom() {
  if (net.role === 'host') return;
  net.role = 'host';
  net.status = '';
  try {
    const room = await hostRoom({ join: guestJoined, data: guestData, leave: guestLeft });
    net.room = room.room;
  } catch {
    net.role = null;
    net.status = t('roomFail');
    for (const s of slots) if (s.kind === 'open') s.kind = 'closed';
  }
  renderLobby();
}

// Nothing happens until the newcomer says hello: that message tells us whether
// they want a slot or only to watch.
function guestJoined() {}

function welcome(conn, msg) {
  const slot = msg.watch ? null : slots.find((s) => s.kind === 'open');
  if (slot) {
    slot.kind = 'remote';
    slot.conn = conn;
    slot.input = IDLE;
    slot.playerId = -1;
    slot.name = guestName(slot, msg.name);
  } else {
    // No free slot, or they asked to watch: they become a spectator.
    net.watchers.push(conn);
  }
  renderLobby();
  sendLobby();
  // Arriving mid-round, they watch it; a new player gets a hamster next round.
  if (game && !$('stage').hidden) conn.send({ t: 'start', players: roster(), you: -1, wins });
}

function guestName(slot, raw) {
  const name = String(raw || '').trim().slice(0, 8);
  return !name || ME_NAMES.has(name) ? DEFAULT_SLOTS[slots.indexOf(slot)].name : name;
}

const roster = () => game.players.map((p) => ({ name: p.name, look: p.look, nest: p.nest }));

function guestData(conn, msg) {
  if (!msg) return;
  if (msg.t === 'hello') {
    if (!slots.some((s) => s.conn === conn) && !net.watchers.includes(conn)) welcome(conn, msg);
    return;
  }
  const slot = slots.find((s) => s.conn === conn);
  if (!slot) return;
  if (msg.t === 'name') {
    slot.name = guestName(slot, msg.name);
    renderLobby();
    sendLobby();
  } else if (msg.t === 'i') {
    const n = (v) => Math.max(-1, Math.min(1, Number(v) || 0));
    slot.input = { mx: n(msg.mx), my: n(msg.my), ax: n(msg.ax), ay: n(msg.ay), seq: Number(msg.seq) || 0 };
  }
}

function guestLeft(conn) {
  const watching = net.watchers.indexOf(conn);
  if (watching >= 0) {
    net.watchers.splice(watching, 1);
    renderLobby();
    return;
  }
  const slot = slots.find((s) => s.conn === conn);
  if (!slot) return;
  slot.conn = null;
  slot.kind = 'open';
  slot.name = DEFAULT_SLOTS[slots.indexOf(slot)].name;
  // Mid-game, a computer takes over the hamster so the round can finish.
  if (game && game.phase !== 'over' && slot.playerId >= 0) {
    const id = slot.playerId;
    const bot = createBot({ difficulty: 'normal', seed: Date.now() >>> 0 });
    controllers[id] = (g) => bot.think(g, id);
  }
  renderLobby();
  sendLobby();
}

function broadcast(make) {
  slots.forEach((slot, i) => {
    if (slot.conn && slot.conn.open) slot.conn.send(make(slot, i));
  });
  // Spectators get the same messages, addressed to nobody's slot.
  for (const conn of net.watchers) if (conn.open) conn.send(make({ playerId: -1 }, -1));
}

function sendLobby() {
  if (net.role !== 'host') return;
  const view = slots.map((s) => ({ kind: s.kind, name: s.name }));
  broadcast((slot, i) => ({ t: 'lobby', slots: view, you: i, wins }));
}

function snapshot(events) {
  const r = (v) => Math.round(v * 10) / 10;
  return {
    t: 's',
    ph: game.phase,
    cd: game.countdown,
    tm: game.time,
    hx: game.homeX,
    nb: game.nibbler,
    w: game.winner,
    p: game.players.map((p) => [
      r(p.x), r(p.y), r(p.vx), r(p.vy), p.fx, p.fy, p.carrying ? 1 : 0, p.gather, p.queued,
      p.swing ? [p.swing.phase, p.swing.t, p.swing.dx, p.swing.dy] : 0, p.cooldown, p.kills, p.deaths, p.seeds,
    ]),
    ev: events,
  };
}

// ---------- joining ----------

async function enterRoom() {
  net.status = t('connecting');
  renderLobby();
  try {
    net.host = await joinRoom(joinId, { data: hostData, close: hostGone });
    net.host.send({ t: 'hello', name: slots[0].name, watch: watchOnly });
    net.status = '';
  } catch {
    net.status = t('joinFail');
  }
  renderLobby();
}

function hostGone() {
  net.host = null;
  net.lobby = null;
  net.status = t('hostLeft');
  toLobby();
  renderLobby();
}

function hostData(msg) {
  if (!msg) return;
  if (msg.t === 'lobby') {
    net.lobby = msg.slots;
    net.you = msg.you;
    msg.wins.forEach((n, i) => (wins[i] = n));
    if ($('stage').hidden) renderLobby();
  } else if (msg.t === 'full') {
    net.status = t('roomFull');
    renderLobby();
  } else if (msg.t === 'start') {
    msg.wins.forEach((n, i) => (wins[i] = n));
    game = {
      map: MAP,
      phase: 'countdown',
      countdown: COUNTDOWN,
      time: 0,
      homeX: MAP.home.x2,
      nibbler: -1,
      winner: null,
      players: msg.players.map((p, id) => ({
        id, name: p.name, look: p.look, nest: p.nest, x: p.nest.x, y: p.nest.y, vx: 0, vy: 0, fx: 1, fy: 0,
        carrying: false, gather: 0, queued: -1, swing: null, cooldown: 0, kills: 0, deaths: 0, seeds: 0,
      })),
    };
    meId = msg.you;
    enterStage();
  } else if (msg.t === 's' && game) {
    game.phase = msg.ph;
    game.countdown = msg.cd;
    game.time = msg.tm;
    game.homeX = msg.hx;
    game.nibbler = msg.nb;
    game.winner = msg.w;
    msg.p.forEach((s, i) => {
      const p = game.players[i];
      [p.x, p.y, p.vx, p.vy, p.fx, p.fy] = s;
      p.carrying = !!s[6];
      p.gather = s[7];
      p.queued = s[8];
      p.swing = s[9] ? { phase: s[9][0], t: s[9][1], dx: s[9][2], dy: s[9][3] } : null;
      [p.cooldown, p.kills, p.deaths, p.seeds] = s.slice(10);
    });
    for (const ev of msg.ev) onEvent(ev);
  } else if (msg.t === 'lobbyscreen') {
    toLobby();
    renderLobby();
  }
}

// ---------- game ----------

function startGame() {
  const active = slots.map((s, i) => ({ slot: s, look: i })).filter((a) => isPlaying(a.slot));
  const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  for (const s of slots) s.playerId = -1;
  game = createGame({
    slots: active.map(({ slot, look }) => ({ name: slot.name.trim() || t('fallbackName', look + 1), kind: slot.kind, look })),
    seed,
  });
  controllers = active.map(({ slot }, id) => {
    slot.playerId = id;
    if (slot.kind === 'human') return (g) => input.read(g, id);
    if (slot.kind === 'remote') {
      // The guest counts its bonk presses; a new count is one press here.
      let seen = slot.input.seq;
      return () => {
        const i = slot.input;
        const bonk = i.seq !== seen;
        seen = i.seq;
        return { mx: i.mx, my: i.my, ax: i.ax, ay: i.ay, bonk };
      };
    }
    const bot = createBot({ difficulty: slot.kind.split(':')[1], seed: seed + id * 7919 });
    return (g) => bot.think(g, id);
  });
  meId = active.findIndex((a) => a.slot.kind === 'human');
  net.pending = [];
  const players = roster();
  broadcast((slot) => ({ t: 'start', players, you: slot.playerId, wins }));
  enterStage();
}

function enterStage() {
  clearTimeout(resultTimer);
  $('result').hidden = true;
  $('feed').textContent = '';
  $('banner').classList.remove('show');
  $('again').hidden = net.role === 'guest';
  scoreKey = '';
  acc = 0;
  renderer.clear();
  input.reset();
  input.enable(meId >= 0);
  $('watching').hidden = meId >= 0;
  show('stage');
  renderer.resize();
  big('3');
  audio.play.count();
}

function big(text) {
  const el = document.createElement('span');
  el.textContent = text;
  $('big').replaceChildren(el);
  el.addEventListener('animationend', () => el.remove());
}

function banner(text) {
  const el = $('banner');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function nameTag(p) {
  const b = document.createElement('b');
  b.textContent = p.name;
  b.style.color = LOOKS[p.look].color;
  return b;
}

function onEvent(ev) {
  renderer.onEvent(ev, game, meId);
  const players = game.players;
  if (ev.type === 'count') {
    big(String(ev.n));
    audio.play.count();
  } else if (ev.type === 'go') {
    big(t('go'));
    audio.play.go();
  } else if (ev.type === 'swing') {
    if (ev.id === meId) audio.play.swing();
  } else if (ev.type === 'bonk') {
    audio.play.bonk();
    const line = document.createElement('div');
    line.append(nameTag(players[ev.by]), ev.seed ? ` 🌻${t('bonkWord')} ` : ` ${t('bonkWord')} `, nameTag(players[ev.id]));
    line.addEventListener('animationend', () => line.remove());
    $('feed').prepend(line);
    while ($('feed').children.length > 4) $('feed').lastChild.remove();
    if (ev.seed && ev.id === meId) banner(t('lostSeed'));
  } else if (ev.type === 'spawn' || ev.type === 'warp') {
    if (ev.id === meId) audio.play.spawn();
  } else if (ev.type === 'seed') {
    audio.play.seed();
    banner(ev.id === meId ? t('gotSeedMe') : t('gotSeedOther', players[ev.id].name));
  } else if (ev.type === 'overtime') {
    audio.play.overtime();
    banner(t('overtime'));
  } else if (ev.type === 'win') {
    const winner = players[ev.id];
    wins[winner.look]++;
    if (ev.id === meId || meId < 0) audio.play.win();
    else audio.play.lose();
    input.enable(false);
    resultTimer = setTimeout(showResult, 1500);
  }
}

function showResult() {
  if (!game) return;
  const winner = game.players[game.winner];
  $('resultTitle').textContent = game.winner === meId ? t('winMe') : t('winOther', winner.name);
  const table = $('resultTable');
  table.textContent = '';
  const head = table.insertRow();
  for (const h of ['', ...t('columns')]) {
    const th = document.createElement('th');
    th.textContent = h;
    head.append(th);
  }
  for (const p of game.players) {
    const row = table.insertRow();
    row.classList.toggle('winner', p.id === game.winner);
    row.insertCell().append(nameTag(p));
    for (const v of [p.kills, p.deaths, p.seeds, wins[p.look]]) row.insertCell().textContent = v;
  }
  $('result').hidden = false;
  if (net.role !== 'guest') $('again').focus();
}

function updateHud() {
  const key = game.players.map((p) => `${p.carrying ? 1 : 0}${wins[p.look]}`).join();
  if (key !== scoreKey) {
    scoreKey = key;
    $('scores').replaceChildren(
      ...game.players.map((p) => {
        const chip = document.createElement('span');
        chip.className = `chip${p.id === meId ? ' me' : ''}${p.carrying ? ' carry' : ''}`;
        chip.style.setProperty('--c', LOOKS[p.look].color);
        const dot = document.createElement('i');
        const name = document.createElement('span');
        name.textContent = (p.carrying ? '🌻 ' : '') + p.name;
        const tally = document.createElement('small');
        tally.textContent = t('tally', wins[p.look]);
        chip.append(dot, name, tally);
        return chip;
      }),
    );
  }
  const s = Math.floor(game.time);
  const overtime = game.time > OVERTIME.start;
  $('clock').textContent = `${overtime ? `${t('overtimeClock')} ` : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  $('clock').classList.toggle('overtime', overtime);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!game || $('stage').hidden) return;

  if (net.role === 'guest') {
    // Guests do not simulate: send this frame's input, draw the latest snapshot.
    if (meId >= 0) {
      const i = input.read(game, meId);
      if (i.bonk && !bonkWas) bonkSeq++;
      bonkWas = i.bonk;
      if (net.host) net.host.send({ t: 'i', mx: i.mx, my: i.my, ax: i.ax, ay: i.ay, seq: bonkSeq });
    }
  } else {
    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 5) {
      step(
        game,
        controllers.map((read) => read(game)),
      );
      for (const ev of game.events) {
        onEvent(ev);
        net.pending.push({ ...ev });
      }
      acc -= DT;
      steps++;
    }
    if (steps === 5) acc = 0;
    if (steps && net.role === 'host') {
      const msg = snapshot(net.pending);
      net.pending = [];
      broadcast(() => msg);
    }
  }
  renderer.draw(game, { dt, meId, marker: input.marker() });
  updateHud();
}

function toLobby() {
  clearTimeout(resultTimer);
  input.enable(false);
  game = null;
  show('lobby');
}

$('start').addEventListener('click', () => {
  audio.unlock();
  startGame();
});
$('again').addEventListener('click', startGame);
for (const id of ['back', 'quit']) {
  $(id).addEventListener('click', () => {
    // A guest leaving goes back to its own offline lobby.
    if (net.role === 'guest') {
      location.href = location.pathname;
      return;
    }
    broadcast(() => ({ t: 'lobbyscreen' }));
    toLobby();
    renderLobby();
  });
}
for (const [button, field] of [['copy', 'inviteLink'], ['copyWatch', 'watchLink']]) {
  $(button).addEventListener('click', async () => {
    $(field).select();
    try {
      await navigator.clipboard.writeText($(field).value);
    } catch {
      document.execCommand('copy');
    }
    $(button).textContent = t('copied');
    setTimeout(() => ($(button).textContent = t('copy')), 1500);
  });
}
$('mute').textContent = audio.isMuted() ? '🔇' : '🔊';
$('mute').addEventListener('click', () => {
  audio.unlock();
  $('mute').textContent = audio.toggle() ? '🔇' : '🔊';
});
// Browsers only allow sound after a tap, and a guest never presses Start.
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
window.addEventListener('resize', () => renderer.resize());
document.addEventListener('visibilitychange', () => {
  acc = 0;
});

localizePage();
renderLobby();
show('lobby');
if (net.role === 'guest') enterRoom();
requestAnimationFrame((now) => {
  last = now;
  frame(now);
});
