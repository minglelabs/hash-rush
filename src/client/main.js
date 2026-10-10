// Lobby, game loop and HUD. Each slot gets a controller that produces inputs for the
// simulation: the local human, a bot, or (later) a remote player.

import { createGame, step } from '../sim/game.js';
import { DT, OVERTIME } from '../sim/constants.js';
import { MAP } from '../sim/map.js';
import { createBot } from '../ai/bot.js';
import { createRenderer, drawHamster } from './render.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { LOOKS } from './looks.js';

const $ = (id) => document.getElementById(id);
const STORE = 'seed-rush-slots';
const KINDS = [
  ['human', '사람 (나)'],
  ['bot:easy', '컴퓨터 · 쉬움'],
  ['bot:normal', '컴퓨터 · 보통'],
  ['bot:hard', '컴퓨터 · 어려움'],
  ['closed', '닫힘'],
  ['open', '열림 · 온라인 (준비 중)'],
];
const DEFAULT_SLOTS = [
  { kind: 'human', name: '나' },
  { kind: 'bot:normal', name: '구름' },
  { kind: 'bot:normal', name: '초코' },
  { kind: 'bot:normal', name: '먼지' },
];

function loadSlots() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    if (Array.isArray(saved) && saved.length === DEFAULT_SLOTS.length) {
      return DEFAULT_SLOTS.map((d, i) => ({
        kind: i === 0 ? 'human' : KINDS.some(([k]) => k === saved[i].kind && k !== 'human' && k !== 'open') ? saved[i].kind : d.kind,
        name: String(saved[i].name || d.name).slice(0, 8),
      }));
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_SLOTS.map((s) => ({ ...s }));
}

// Picks the right Korean subject particle for a name: 구름이 / 초코가.
function subject(name) {
  const code = name.charCodeAt(name.length - 1);
  const hangul = code >= 0xac00 && code <= 0xd7a3;
  return name + (hangul && (code - 0xac00) % 28 ? '이' : '가');
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
});

let game = null;
let controllers = [];
let meId = -1;
let last = 0;
let acc = 0;
let resultTimer = 0;
let bannerTimer = 0;
let scoreKey = '';

// ---------- lobby ----------

function drawAvatar(canvas, look) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = 52 * dpr;
  canvas.height = 46 * dpr;
  ctx.scale(dpr * 1.25, dpr * 1.25);
  drawHamster(ctx, { x: 21, y: 19, fx: 0.4, fy: 0, moving: false, carrying: false, swing: null, look, t: 0 });
}

function renderLobby() {
  const list = $('slots');
  list.textContent = '';
  slots.forEach((slot, i) => {
    const li = document.createElement('li');
    li.style.setProperty('--c', LOOKS[i].color);
    li.classList.toggle('closed', slot.kind === 'closed');

    const avatar = document.createElement('canvas');
    drawAvatar(avatar, LOOKS[i]);

    const name = document.createElement('input');
    name.value = slot.name;
    name.maxLength = 8;
    name.setAttribute('aria-label', `${i + 1}번 자리 이름`);
    name.addEventListener('input', () => {
      slot.name = name.value;
      saveSlots();
    });

    const kind = document.createElement('select');
    kind.setAttribute('aria-label', `${i + 1}번 자리 종류`);
    for (const [value, label] of KINDS) {
      if ((value === 'human') !== (i === 0)) continue;
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      opt.disabled = value === 'open';
      kind.append(opt);
    }
    kind.value = slot.kind;
    kind.disabled = i === 0;
    kind.addEventListener('change', () => {
      slot.kind = kind.value;
      saveSlots();
      li.classList.toggle('closed', slot.kind === 'closed');
      updateStart();
    });

    li.append(avatar, name, kind);
    list.append(li);
  });
  updateStart();
}

function saveSlots() {
  try {
    localStorage.setItem(STORE, JSON.stringify(slots));
  } catch {
    // not persisted
  }
}

function updateStart() {
  const playing = slots.filter((s) => s.kind !== 'closed').length;
  $('start').disabled = playing < 2;
  $('start').textContent = playing < 2 ? '상대가 한 명은 있어야 해요' : '게임 시작';
}

function show(screen) {
  $('lobby').hidden = screen !== 'lobby';
  $('stage').hidden = screen !== 'stage';
}

// ---------- game ----------

function startGame() {
  const active = slots.map((s, i) => ({ ...s, look: i })).filter((s) => s.kind !== 'closed');
  const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  game = createGame({
    slots: active.map((s) => ({ name: s.name.trim() || `햄스터${s.look + 1}`, kind: s.kind, look: s.look })),
    seed,
  });
  controllers = active.map((s, id) => {
    if (s.kind === 'human') return (g) => input.read(g, id);
    const bot = createBot({ difficulty: s.kind.split(':')[1], seed: seed + id * 7919 });
    return (g) => bot.think(g, id);
  });
  meId = active.findIndex((s) => s.kind === 'human');

  clearTimeout(resultTimer);
  $('result').hidden = true;
  $('feed').textContent = '';
  $('banner').classList.remove('show');
  $('hint').classList.remove('gone');
  setTimeout(() => $('hint').classList.add('gone'), 9000);
  scoreKey = '';
  acc = 0;
  renderer.clear();
  input.reset();
  input.enable(true);
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
    big('출발!');
    audio.play.go();
  } else if (ev.type === 'swing') {
    if (ev.id === meId) audio.play.swing();
  } else if (ev.type === 'bonk') {
    audio.play.bonk();
    const line = document.createElement('div');
    line.append(nameTag(players[ev.by]), ev.seed ? ' 🌻뿅! ' : ' 뿅! ', nameTag(players[ev.id]));
    line.addEventListener('animationend', () => line.remove());
    $('feed').prepend(line);
    while ($('feed').children.length > 4) $('feed').lastChild.remove();
    if (ev.seed && ev.id === meId) banner('씨를 놓쳤어요! 다시 해바라기로!');
  } else if (ev.type === 'spawn') {
    if (ev.id === meId) audio.play.spawn();
  } else if (ev.type === 'seed') {
    audio.play.seed();
    banner(ev.id === meId ? '🌻 해씨 획득! 집으로 달려요!' : `🌻 ${subject(players[ev.id].name)} 씨를 물었어요! 막아요!`);
  } else if (ev.type === 'overtime') {
    audio.play.overtime();
    banner('⏰ 연장전! 집이 점점 넓어집니다');
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
  const winner = game.players[game.winner];
  $('resultTitle').textContent = game.winner === meId ? '🎉 내가 이겼다!' : `🏆 ${subject(winner.name)} 이겼어요`;
  const table = $('resultTable');
  table.textContent = '';
  const head = table.insertRow();
  for (const h of ['', '꿀밤', '맞음', '해씨', '누적 승']) {
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
  $('again').focus();
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
        tally.textContent = `${wins[p.look]}승`;
        chip.append(dot, name, tally);
        return chip;
      }),
    );
  }
  const s = Math.floor(game.time);
  const overtime = game.time > OVERTIME.start;
  $('clock').textContent = `${overtime ? '연장전 ' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  $('clock').classList.toggle('overtime', overtime);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!game || $('stage').hidden) return;
  acc += dt;
  let steps = 0;
  while (acc >= DT && steps < 5) {
    step(
      game,
      controllers.map((read) => read(game)),
    );
    for (const ev of game.events) onEvent(ev);
    acc -= DT;
    steps++;
  }
  if (steps === 5) acc = 0;
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
$('back').addEventListener('click', toLobby);
$('quit').addEventListener('click', toLobby);
$('mute').textContent = audio.isMuted() ? '🔇' : '🔊';
$('mute').addEventListener('click', () => {
  audio.unlock();
  $('mute').textContent = audio.toggle() ? '🔇' : '🔊';
});
window.addEventListener('resize', () => renderer.resize());
document.addEventListener('visibilitychange', () => {
  acc = 0;
});

renderLobby();
show('lobby');
requestAnimationFrame((t) => {
  last = t;
  frame(t);
});
