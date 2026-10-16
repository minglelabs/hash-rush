// Lobby, game loop and HUD. Each slot gets a controller that produces inputs for the
// simulation: the local human, a bot, or a friend connected over the network.
//
// Online play has no server. The host's browser runs the simulation; guests send
// their inputs and draw the snapshots the host sends back, with their own hamster
// played a little ahead so that it answers at once (predict.js).

import { createGame, step, allied, inHome, timeoutReason, timeoutWinners } from '../sim/game.js';
import { DT, OVERTIME, COUNTDOWN, BONK } from '../sim/constants.js';
import { MAP, MAPS, MAP_IDS } from '../sim/map.js';
import { createBot } from '../ai/bot.js';
import { createRLBot, loadRLPolicy } from '../ai/rl-bot.js';
import { createRenderer, drawHamster, drawSeed, nearHome } from './render.js';
import { createInput } from './input.js';
import { createLaneHelp } from './assist.js';
import { MVP_POINTS, mvpScore, pickMvp } from './mvp.js';
import { createAudio } from './audio.js';
import { createHaptics } from './haptics.js';
import { LOOKS, TEAMS, colorOf, lookOf } from './looks.js';
import { lang, t, LANGUAGES, stringsFor } from './i18n.js';
import { hostRoom, joinRoom, announceRoom, watchRooms } from './net.js';
import { identity, shareName, signResult, remember, lastRating, loadRanking } from './rank.js';
import { createPredictor } from './predict.js';
import { winRate } from './rankPage.js';
import { createRoomList } from './roomList.js';
import { createChat, floatLine, cleanChat, lineLife } from './chatbar.js';

const $ = (id) => document.getElementById(id);
const STORE = 'seed-rush-slots';
const SIDE_STORE = 'hash-rush-bonk-left';
const MODE_STORE = 'seed-rush-teams';
const MAP_STORE = 'seed-rush-map';
// Kept for as long as the tab lives, so a reload comes back to the same room.
const ROOM_STORE = 'hash-rush-room';
const REJOIN_STORE = 'hash-rush-rejoin';
const ASSIST_STORE = 'hash-rush-assist';
// What the host can set a slot to. 'open' is an empty seat anyone with the link
// can take, and 'remote' is one a friend has taken.
const KINDS = ['human', 'open', 'bot:easy', 'bot:normal', 'bot:hard', 'bot:ace', 'bot:rl', 'closed'];
// Every slot keeps a team, used only while team play is on. Teams need not be even: 3 v 2 is fine.
// The lobby always shows every seat, the way old kart lobbies did: the host, three
// computers, and the rest empty for friends. An empty seat can be closed.
const MAX_SLOTS = LOOKS.length;
const defaultName = (i) => t('names')[i] ?? t('fallbackName', i + 1);
const DEFAULT_SLOTS = Array.from({ length: MAX_SLOTS }, (_, i) => ({
  kind: i === 0 ? 'human' : i < 4 ? 'bot:hard' : 'open',
  name: defaultName(i),
  team: i % 2,
}));
const IDLE = { mx: 0, my: 0, ax: 0, ay: 0, seq: 0, n: 0 };
// A guest who never renamed itself is still called "Me" in its own language.
const ME_NAMES = new Set(LANGUAGES.map((code) => stringsFor(code).names[0]));

const validTeam = (v) => Number.isInteger(v) && v >= 0 && v < TEAMS.length;

// Two hamsters with one name cannot be told apart, so a name someone else in the
// room already has gets a number on the end.
const occupied = (s) => s.kind !== 'open' && s.kind !== 'closed';
function freeName(slot, name) {
  const taken = new Set(slots.filter((s) => s !== slot && occupied(s)).map((s) => s.name.trim()));
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const tag = String(n);
    const next = name.slice(0, 8 - tag.length) + tag;
    if (!taken.has(next)) return next;
  }
}

// The colour a seat goes by: its team's in a team game, its own otherwise.
function seatColor(look) {
  const p = game && game.players.find((q) => q.look === look);
  if (p) return colorOf(p);
  const guest = net.role === 'guest';
  const slot = (guest ? net.lobby || [] : slots)[look];
  if ((guest ? net.teams : teamMode) && slot && TEAMS[slot.team]) return TEAMS[slot.team].color;
  return LOOKS[look] ? LOOKS[look].color : '#6b7280';
}

function loadSlots() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    if (Array.isArray(saved) && saved.length >= 1 && saved.length <= MAX_SLOTS) {
      // Lists saved before every seat was shown are shorter: the rest start empty.
      return DEFAULT_SLOTS.map((d, i) => {
        const s = saved[i];
        if (!s) return { ...d };
        return {
          kind: i === 0 ? 'human' : KINDS.some((k) => k === s.kind && k !== 'human') ? s.kind : 'open',
          name: String(s.name || defaultName(i)).slice(0, 8),
          team: validTeam(s.team) ? s.team : i % 2,
        };
      });
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
  // A browser can briefly hold a newer page with an older, cached script that
  // lacks a key. Show nothing rather than the word "undefined".
  for (const el of document.querySelectorAll('[data-i18n]')) el.innerHTML = t(el.dataset.i18n) ?? '';
  for (const id of ['mute', 'muteLobby']) $(id).title = t('sound');
  $('swap').title = t('swapSides');
  if ($('peek')) $('peek').textContent = t('peekLobby');
  if ($('backToGame')) $('backToGame').textContent = t('backToGame');
  $('buzz').title = t('buzz');
  $('full').title = t('fullscreen');
  // For a guest these buttons do not go to a lobby of their own: they leave the room.
  // A guest's buttons leave the room. The host's end the round for everyone.
  for (const id of ['quit', 'back']) $(id).textContent = t(joinId ? 'leaveRoom' : 'endRound');
  $('how').replaceChildren(
    ...t('how').map((html) => {
      const li = document.createElement('li');
      li.innerHTML = html;
      return li;
    }),
  );
}

const slots = loadSlots();
let teamMode = false;
try {
  teamMode = localStorage.getItem(MODE_STORE) === '1';
} catch {
  // stays off
}
const wins = slots.map(() => 0);
// Bonks, times bonked and seeds added up over every round in this room.
const career = slots.map(() => [0, 0, 0, 0, 0, 0, 0]);
// Whose wins and totals each seat holds: a person's key (or their name, for a
// guest without one), '' for a computer. A record goes with the person, not the
// seat: whoever sits down brings their own, from `records` where the records of
// people not seated right now are kept. A championship that ends clears them all.
const owners = slots.map(() => '');
let records = {};
// A title decided but not yet filed in the past championships (the card is still up).
let pendingSeason = null;

function clearRecords() {
  wins.fill(0);
  career.forEach((c) => c.fill(0));
  records = {};
}

// Seat `i` is now `who`'s: put away the record that was there, bring out theirs.
function seatRecord(i, who) {
  if (owners[i] === who) return;
  if (owners[i] && (wins[i] || career[i].some(Boolean))) records[owners[i]] = { wins: wins[i], career: [...career[i]] };
  const theirs = who && records[who];
  wins[i] = theirs ? theirs.wins : 0;
  career[i] = theirs ? [...theirs.career] : career[i].map(() => 0);
  if (theirs) delete records[who];
  owners[i] = who;
}
// Rounds finished in this room.
let rounds = 0;
// The first to this many wins takes the championship, and the room starts over.
const TITLE_WINS = 10;
// ...and by this many wins clear of the next. With the leaders level at 9 it is
// deuce: the title goes to whoever first gets two ahead (11-9, 12-10 and so on).
const TITLE_LEAD = 2;
// Championships already decided in this room, newest last. Gone with the room.
let seasons = [];
const audio = createAudio();
const haptics = createHaptics();
// The host picks the map in the lobby; the meadow is the default.
let mapId = 'meadow';
try {
  const saved = localStorage.getItem(MAP_STORE);
  if (MAP_IDS.includes(saved)) mapId = saved;
} catch {
  // stays on the meadow
}
const renderer = createRenderer($('canvas'), MAP);
const query = new URLSearchParams(location.search);
// The phone controls can be tried out from the address bar, and the phone keeps
// what it was last given: ?assist=0 turns the lane help off.
function tuned(name, key) {
  try {
    if (query.has(name)) localStorage.setItem(key, query.get(name));
    return localStorage.getItem(key);
  } catch {
    return query.get(name);
  }
}
const input = createInput({
  stage: $('stage'),
  canvas: $('canvas'),
  pad: $('pad'),
  bonkBtn: $('bonk'),
  throwBtn: $('throw'),
  toWorldDir: renderer.toWorldDir,
  laneHelp: tuned('assist', ASSIST_STORE) !== '0',
});

const joinId = query.get('room');
// Opening the watch link joins as a spectator instead of taking a slot.
const watchOnly = query.has('watch');
// A private room asks for its password. The host's invite link carries it; someone
// coming in from the room list types it.
const cleanPw = (raw) => String(raw ?? '').trim().slice(0, 12);
let roomPw = '';
// role: null (offline), 'host' or 'guest'. `round` numbers the rounds a room has
// played, so a snapshot that turns up late is not taken for the next round's. For a
// guest, `snap` is the newest snapshot and `tick` its tick, `mine` is where its own
// hamster is played ahead to, and `line` says how good the connection is.
const net = { role: joinId ? 'guest' : null, room: null, host: null, status: '', lobby: null, teams: false, map: 'meadow', pw: cleanPw(query.get('pw')), needPw: false, you: -1, pending: [], watchers: [], round: 0, snap: null, tick: -1, mine: null, line: null };
const predictor = createPredictor();

let game = null;
let controllers = [];
let meId = -1;
let last = 0;
let acc = 0;
let resultTimer = 0;
let bannerTimer = 0;
let scoreKey = '';
let portalSaid = false;
let tickBeat = -1;
let bonkSeq = 0;
let bonkWas = false;
let bonkCool = 0;
// The last input a guest sent, and when (s).
let sentInput = null;
let sentAt = 0;
// When a guest last heard its own swing start ahead of the host's word (s).
let swungAt = -Infinity;
let swinging = false;
// The lane help of each friend's hamster this round, by player: what it remembers
// goes out with the snapshots, so that a guest playing ahead steers the same way.
let helpers = [];

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
  renderSeasons();
  const guest = net.role === 'guest';
  const rows = guest ? net.lobby || [] : slots;
  const teams = guest ? net.teams : teamMode;
  $('modeSolo').classList.toggle('on', !teams);
  $('modeTeam').classList.toggle('on', teams);
  // A guest cannot choose, so it gets a plain label instead of two dead buttons.
  $('modeSolo').hidden = $('modeTeam').hidden = guest;
  $('modeNow').hidden = !guest;
  $('modeNow').textContent = t('modeNow', t(teams ? 'modeTeam' : 'modeSolo'));
  $('modeNow').classList.toggle('team', teams);
  // The host chooses the map; a guest sees which one it is.
  // Each map is a tile with a picture for its theme.
  const sel = $('mapSel');
  if (!sel.children.length) {
    for (const id of MAP_IDS) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.dataset.map = id;
      const icon = document.createElement('i');
      icon.textContent = MAP_ICONS[id];
      tile.append(icon, t('mapNames')[id]);
      tile.addEventListener('click', () => pickMap(id));
      sel.append(tile);
    }
  }
  for (const tile of sel.children) {
    tile.classList.toggle('on', tile.dataset.map === (guest ? net.map : mapId));
    tile.disabled = guest;
  }
  // The line-up at a glance, e.g. "Red 3 : Blue 2".
  const sizes = TEAMS.map((_, k) => rows.filter((s) => s.kind !== 'closed' && s.kind !== 'open' && s.team === k).length);
  $('teamInfo').replaceChildren(
    ...(teams ? TEAMS : []).flatMap((team, k) => {
      if (!sizes[k]) return [];
      const b = document.createElement('b');
      b.textContent = `${t('teamNames')[k]} ${sizes[k]}`;
      b.style.color = team.color;
      return [' : ', b];
    }).slice(1),
  );
  const list = $('slots');
  // Rebuilding the list would replace whatever someone is using in it: the name
  // field being typed in (which drops focus and breaks Korean/Japanese/Chinese
  // composition) or a menu standing open while a friend types their name. While
  // the rows are otherwise the same, only the names are refreshed.
  const typing = document.activeElement;
  const shape = (slot, i) => `${slot.kind}:${guest ? i === net.you : ''}:${teams ? slot.team : ''}`;
  const keep =
    list.children.length === rows.length &&
    rows.every((slot, i) => list.children[i].dataset.shape === shape(slot, i));
  if (keep) {
    rows.forEach((slot, i) => {
      const field = list.children[i].querySelector('input');
      if (field !== typing) field.value = slot.kind === 'open' || slot.kind === 'closed' ? '' : slot.name;
    });
  } else list.textContent = '';
  rows.forEach((slot, i) => {
    if (keep) return;
    const li = document.createElement('li');
    li.dataset.shape = shape(slot, i);
    // A seat with nobody in it has no face, no colour and no team, so it cannot be
    // mistaken for a player.
    const vacant = slot.kind === 'open' || slot.kind === 'closed';
    li.style.setProperty('--c', teams && TEAMS[slot.team] ? TEAMS[slot.team].color : LOOKS[i].color);
    li.classList.toggle('teamed', teams);
    li.classList.toggle('closed', slot.kind === 'closed');
    li.classList.toggle('vacant', vacant);

    const avatar = document.createElement(vacant ? 'span' : 'canvas');
    if (!vacant) {
      const look = teams && TEAMS[slot.team] ? { ...LOOKS[i], color: TEAMS[slot.team].color } : LOOKS[i];
      drawAvatar(avatar, look);
      // The face opens the player's card: name, rating and record.
      avatar.classList.add('face');
      avatar.title = t('profileTap');
      avatar.addEventListener('click', () => {
        const level = String(slot.kind).startsWith('bot:') ? slot.kind.slice(4) : '';
        // The row may outlive the seat object it was drawn from: read it afresh.
        const now = (net.role === 'guest' ? net.lobby || [] : slots)[i] || slot;
        showProfile({ name: now.name, look, level, pid: level ? `bot:${level}` : guest ? now.pid || '' : keyOf(now).pid, seat: i });
      });
    }

    const mine = guest ? i === net.you : slot.kind !== 'remote';
    const name = document.createElement('input');
    // An open slot has nobody in it yet, so it shows no name.
    const empty = slot.kind === 'open' || slot.kind === 'closed';
    name.value = empty ? '' : slot.name;
    // The host's own seat, given up to watch the round instead.
    const hostWatching = !guest && i === 0 && slot.kind === 'closed';
    name.placeholder = slot.kind === 'open' ? t(guest ? 'waitingFriend' : 'emptySeat') : hostWatching ? t('spectating') : slot.kind === 'closed' ? t('kinds').closed : '';
    name.maxLength = 8;
    name.disabled = !mine || empty;
    name.setAttribute('aria-label', t('slotName', i + 1));
    name.addEventListener('input', () => {
      slot.name = name.value;
      if (mine) shareName(name.value);
      if (guest) {
        net.host.send({ t: 'name', name: name.value });
        // A guest's own name is the one its page keeps in the first seat, and
        // brings to the room again after a reload.
        slots[0].name = name.value;
        saveSlots();
      } else {
        saveSlots();
        sendLobby();
      }
    });
    if (!guest)
      name.addEventListener('change', () => {
        const free = freeName(slot, name.value.trim());
        if (free === name.value) return;
        slot.name = name.value = free;
        saveSlots();
        sendLobby();
      });

    const kind = document.createElement('select');
    kind.setAttribute('aria-label', t('slotKind', i + 1));
    // A guest only sees who is in each slot; the host chooses.
    const person = guest ? (i === net.you ? 'human' : 'remote') : slot.kind;
    const shown = slot.kind === 'human' || slot.kind === 'remote' ? person : slot.kind;
    // The host plays in the first seat or leaves it empty and watches.
    const options =
      !guest && i === 0
        ? ['human', 'closed']
        : guest || slot.kind === 'remote'
          ? [shown, ...(slot.kind === 'remote' && !guest ? ['kick', 'closed'] : [])]
          : KINDS.filter((k) => k !== 'human');
    for (const value of options) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = !guest && i === 0 && value === 'closed' ? t('hostWatch') : t('kinds')[value];
      kind.append(opt);
    }
    kind.value = shown;
    kind.disabled = guest;
    // Kicking a friend leaves the seat empty for somebody else.
    kind.addEventListener('change', () => setKind(slot, kind.value === 'kick' ? 'open' : kind.value));
    // A tap on an empty seat closes it, and a tap on a closed one opens it again.
    if (!guest && (slot.kind === 'open' || slot.kind === 'closed')) {
      li.classList.add('seat');
      li.addEventListener('click', (e) => {
        if (e.target === kind || kind.contains(e.target)) return;
        setKind(slot, i === 0 ? 'human' : slot.kind === 'open' ? 'closed' : 'open');
      });
    }

    li.append(avatar, name);
    if (teams) {
      // The host arranges the teams; a guest can also switch its own.
      const team = document.createElement('select');
      team.setAttribute('aria-label', t('slotTeam', i + 1));
      (vacant ? ['–'] : t('teamNames')).forEach((label, k) => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = label;
        team.append(opt);
      });
      if (!vacant) team.value = slot.team;
      team.disabled = vacant || (guest && i !== net.you);
      team.addEventListener('change', () => {
        slot.team = Number(team.value);
        if (guest) {
          net.host.send({ t: 'team', team: slot.team });
        } else {
          saveSlots();
          sendLobby();
        }
        renderLobby();
      });
      li.append(team);
    }
    li.append(kind);
    list.append(li);
  });

  const inviting = net.role === 'host' || slots.some((s) => s.kind === 'open');
  $('invite').hidden = guest || !inviting;
  // The password sits at the top of the room, where everyone in it can read it.
  $('roomPw').hidden = guest ? !net.lobby || !net.pw : !inviting;
  $('pwField').disabled = guest;
  $('pwField').placeholder = t('pwNone');
  if (document.activeElement !== $('pwField')) $('pwField').value = guest ? net.pw : roomPw;
  $('pwForm').hidden = !net.needPw;
  $('inviteText').textContent = net.room ? t('invite') : net.status || t('roomCreating');
  $('inviteLink').hidden = !net.room;
  $('copy').hidden = !net.room;
  $('watchRow').hidden = !net.room;
  if (net.room) {
    const link = `${location.origin}${location.pathname}?room=${net.room}${roomPw ? `&pw=${encodeURIComponent(roomPw)}` : ''}`;
    $('inviteLink').value = link;
    $('watchLink').value = `${link}&watch`;
    $('watchText').textContent = `${t('watchLink')} · ${t('spectators', net.watchers.length)}`;
  }
  // Chat exists only inside a room.
  syncChat();
  syncSpect();
  showLobbyBubbles();
  markFresh();
  $('slotHead').classList.toggle('teamed', teams);
  // A room that could not be reached, or was lost, says so at the top with the way
  // on: a room of one's own first, trying the same one again second.
  const failed = guest && !!net.failed;
  syncGone();
  $('netStatus').hidden = !guest || failed;
  $('netStatus').textContent = netLine();
  updateStart();
}

// How good a guest's line to the host is: the round trip, and whether it goes the
// long way round through the relay.
function lineText() {
  const line = net.host && net.line;
  if (!line) return '';
  const ms = line.ms || Math.round((predictor.lag() || 0) * 1000);
  return `📶 ${[ms ? `${ms}ms` : '', line.relay ? t('relayed') : ''].filter(Boolean).join(' · ')}`;
}

const netLine = () => net.status || [net.lobby && net.you < 0 ? t('spectating') : '', lineText()].filter(Boolean).join(' · ');

function showLine() {
  const line = net.host && net.line;
  $('ping').hidden = !line;
  if (!line) return;
  $('ping').textContent = lineText();
  $('ping').classList.toggle('slow', line.relay || line.ms >= 150);
  if (!$('lobby').hidden) $('netStatus').textContent = netLine();
}

setInterval(async () => {
  if (net.role !== 'guest' || document.hidden) return;
  net.line = net.host ? await net.host.route() : null;
  showLine();
}, 2000);

// Tells a friend the host has taken them out, then drops the connection. The
// close waits a moment so the message gets through first.
function kick(slot) {
  const conn = slot.conn;
  if (!conn) return;
  relayChat({ sys: 'leave', name: slot.name, look: -1, text: '' });
  slot.conn = null;
  slot.name = defaultName(slots.indexOf(slot));
  conn.kicked = true;
  if (conn.open) conn.send({ t: 'kicked' });
  setTimeout(() => conn.close(), 300);
}

function setKind(slot, kind) {
  kick(slot);
  slot.kind = kind;
  // A computer in the seat starts its own record; the person's is kept for them.
  if (kind.startsWith('bot:')) seatRecord(slots.indexOf(slot), '');
  if (kind === 'open') openRoom();
  if (kind === 'bot:rl') loadRLPolicy();
  saveSlots();
  renderLobby();
  sendLobby();
}

const MAP_ICONS = { meadow: '🌻', desert: '🌵', factory: '🏭', ice: '🧊', beach: '🏖️', graveyard: '👻', sky: '☁️' };

function pickMap(id) {
  if (net.role === 'guest' || !MAP_IDS.includes(id) || id === mapId) return;
  mapId = id;
  try {
    localStorage.setItem(MAP_STORE, mapId);
  } catch {
    // not persisted
  }
  renderLobby();
  sendLobby();
}

function setTeamMode(on) {
  if (net.role === 'guest' || teamMode === on) return;
  teamMode = on;
  try {
    localStorage.setItem(MODE_STORE, on ? '1' : '0');
  } catch {
    // not persisted
  }
  renderLobby();
  sendLobby();
}

function saveSlots() {
  try {
    localStorage.setItem(STORE, JSON.stringify(slots.map(({ kind, name, team }) => ({ kind, name, team }))));
  } catch {
    // not persisted
  }
}

function updateStart() {
  // Looking in from a round under way: the way back, not a new round.
  $('backToGame').hidden = !game;
  if (game) {
    $('start').hidden = true;
    return;
  }
  $('start').hidden = false;
  if (net.role === 'guest') {
    // Until the host is actually reached the button says so. After a failure the
    // buttons at the top take over.
    $('start').disabled = true;
    $('start').hidden = !!net.failed;
    $('start').textContent = net.host ? t('waitingHost') : t('connecting');
    return;
  }
  const playing = slots.filter(isPlaying);
  // A team game needs somebody to play against, however the sides are split.
  const lonely = teamMode && playing.length >= 2 && new Set(playing.map((s) => s.team)).size < 2;
  $('start').disabled = playing.length < 2 || lonely;
  // Only the host can wipe the room's record, and only once there is one.
  $('resetBtn').hidden = net.role === 'guest' || (rounds === 0 && wins.every((n) => !n));
  $('start').textContent = t(playing.length < 2 ? 'needOpponent' : lonely ? 'needTeams' : 'start');
}

function show(screen) {
  $('lobby').hidden = screen !== 'lobby';
  $('stage').hidden = screen !== 'stage';
  syncChat();
  if (screen === 'stage' && !window.history.state?.stage) window.history.pushState({ stage: true }, '');
  if (screen === 'lobby') checkUpdate();
  // The round's tune keeps going from one round to the next, result screen included.
  audio.setMusic(screen === 'lobby' ? 'lobby' : 'game');
}

// ---------- room list ----------

// Under the list, its page buttons; beside its button, the way out of this room
// and on to the room list page. Built here, so a page cached from before still gets them.
$('roomItems').insertAdjacentHTML('afterend', '<div id="roomsPager" class="pager"></div>');
$('roomListBtn').insertAdjacentHTML('beforebegin', '<div id="roomBtns"></div>');
$('roomBtns').append($('roomListBtn'));
$('roomBtns').insertAdjacentHTML('beforeend', '<button id="leaveToRooms"></button>');

// Leaves this room for the room list page. A host with friends in the room is
// asked first, since the room closes with them in it.
let leaving = false;
function leaveToRooms() {
  const friends = net.role === 'host' && slots.some((s) => s.conn);
  if (friends && !confirm(t('leaveHostConfirm'))) return;
  leaving = true;
  try {
    sessionStorage.removeItem(ROOM_STORE);
  } catch {
    // nothing kept
  }
  if (net.announce) net.announce.close();
  const pick = query.get('lang');
  location.href = `rooms.html${pick ? `?lang=${encodeURIComponent(pick)}` : ''}`;
}
$('leaveToRooms').textContent = t('leaveToRooms');
$('leaveToRooms').addEventListener('click', leaveToRooms);

let stopWatching = null;
let listTimer = 0;

function toggleRoomList() {
  const open = $('rooms').hidden;
  $('rooms').hidden = !open;
  $('roomListBtn').textContent = t(open ? 'roomListClose' : 'roomList');
  if (!open) {
    if (stopWatching) stopWatching();
    stopWatching = null;
    return;
  }
  $('roomItems').textContent = '';
  $('roomsStatus').textContent = t('roomsLoading');
  const render = createRoomList({ items: $('roomItems'), status: $('roomsStatus'), pages: $('roomsPager'), here: net.room || joinId, base: location.pathname });
  watchRooms(render)
    .then((stop) => {
      // Closed again while still connecting.
      if ($('rooms').hidden) stop();
      else stopWatching = stop;
    })
    .catch(() => ($('roomsStatus').textContent = t('roomsFail')));
}

// ---------- ranking ----------

// The ranking as last read, kept a minute so tapping through faces does not
// reconnect each time.
let rankingCache = null;
function ranking() {
  if (!rankingCache || Date.now() - rankingCache.at > 60000) {
    rankingCache = { at: Date.now(), rows: loadRanking().then((r) => r.rows) };
    rankingCache.rows.catch(() => (rankingCache = null));
  }
  return rankingCache.rows;
}

// A player's card, from a face in the lobby. The host also gets the room's
// keys to hand to a friend from here.
function showProfile({ name, look, level, pid, seat }) {
  const heir = net.role === 'host' && !game && slots[seat] && slots[seat].kind === 'remote' && slots[seat].conn;
  $('profileHost').hidden = !heir;
  $('profileHost').textContent = t('handOver');
  $('profileHost').onclick = heir ? () => handOver(seat) : null;
  drawAvatar($('profileFace'), look);
  $('profileName').textContent = level ? `🤖 ${t('botLevels')[level] || level}` : name;
  $('profileKind').textContent = level ? `${name} · ${t('profileBot')}` : '';
  $('profileRating').textContent = t('profileLoading');
  $('profileRecord').textContent = '';
  $('profile').hidden = false;
  const fill = (row) => {
    if (!row) {
      $('profileRating').textContent = t('profileNone');
      return;
    }
    $('profileRating').textContent = t('profileRating', row.elo, row.rank);
    $('profileRecord').textContent = t('profileRecord', row.games, row.wins, winRate(row));
  };
  const mine = myKey && pid === myKey.pid;
  if (!pid) return fill(null);
  ranking()
    .then((rows) => fill(rows.find((r) => r.pid === pid) || (mine && lastRating().games ? { ...lastRating(), rank: 0 } : null)))
    .catch(() => fill(mine && lastRating().games ? { ...lastRating(), rank: 0 } : null));
}
$('profileClose').addEventListener('click', () => ($('profile').hidden = true));
$('profile').addEventListener('click', (e) => e.target === $('profile') && ($('profile').hidden = true));

// What the room list shows about this room. Sent at most once a second, since
// renaming a slot sends the lobby on every keystroke.
function announce() {
  if (!net.announce) return;
  clearTimeout(listTimer);
  listTimer = setTimeout(() => {
    if (!net.announce) return;
    const humans = slots.filter((s) => s.kind === 'human' || s.kind === 'remote').length;
    net.announce.update(
      $('listed').checked
        ? {
            name: slots[0].name.trim() || defaultName(0),
            humans,
            bots: slots.filter(isPlaying).length - humans,
            open: slots.filter((s) => s.kind === 'open').length,
            state: game ? 'playing' : 'lobby',
            locked: !!roomPw,
          }
        : null,
    );
  }, 1000);
}

// ---------- hosting ----------

// What a host's tab remembers over a reload: the room's id, its scores, and who
// sat where. Friends are sent to reload too and find the same room waiting.
function loadRoom() {
  try {
    return JSON.parse(sessionStorage.getItem(ROOM_STORE)) || {};
  } catch {
    return {};
  }
}

function saveRoom() {
  if (net.role !== 'host' || !net.room) return;
  try {
    sessionStorage.setItem(
      ROOM_STORE,
      JSON.stringify({ room: net.room, wins, career, rounds, seasons, pw: roomPw, seats: slots.map((s) => (s.kind === 'remote' ? s.said || s.name : '')), owners, records, pending: pendingSeason }),
    );
  } catch {
    // not remembered: a reload opens a new room
  }
}

function restoreRoom() {
  const saved = loadRoom();
  if (!saved.room || joinId) return;
  (saved.wins || []).forEach((n, i) => i < wins.length && (wins[i] = Number(n) || 0));
  (saved.career || []).forEach((c, i) => i < career.length && Array.isArray(c) && (career[i] = c.map((v) => Number(v) || 0)));
  rounds = Number(saved.rounds) || 0;
  if (Array.isArray(saved.seasons)) seasons = saved.seasons;
  roomPw = cleanPw(saved.pw);
  // Each friend's seat is held for them by name.
  (saved.seats || []).forEach((name, i) => slots[i] && (slots[i].held = name || ''));
  (saved.owners || []).forEach((who, i) => i < owners.length && (owners[i] = typeof who === 'string' ? who : ''));
  if (saved.records && typeof saved.records === 'object') records = saved.records;
  // Reloaded with a title decided but the card not done yet: file it now and
  // start the next championship from nothing.
  if (saved.pending && Array.isArray(saved.pending.rows)) {
    seasons = [...seasons, saved.pending].slice(-10);
    clearRecords();
    rounds = 0;
  }
}

async function openRoom() {
  if (net.role === 'host') return;
  net.role = 'host';
  net.status = '';
  try {
    const room = await hostRoom({ join: guestJoined, data: guestData, leave: guestLeft }, loadRoom().room);
    net.room = room.room;
    net.close = room.close;
    saveRoom();
    // The room works by link even if it cannot be listed.
    announceRoom(net.room)
      .then((a) => {
        net.announce = a;
        announce();
      })
      .catch(() => {});
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

// The team with the fewest players, out of those in use (red and blue at least).
function smallerTeam() {
  const size = TEAMS.map((_, k) => slots.filter((s) => isPlaying(s) && s.team === k).length);
  let best = 0;
  for (let k = 1; k < TEAMS.length; k++) if ((k < 2 || size[k] > 0) && size[k] < size[best]) best = k;
  return best;
}

function welcome(conn, msg, sitting = false) {
  if (roomPw && cleanPw(msg.pw) !== roomPw) {
    // A few tries, then the connection is dropped so the password cannot be guessed at speed.
    conn.tries = (conn.tries || 0) + 1;
    if (conn.tries > 5) conn.close();
    else conn.send({ t: 'pw', wrong: !!cleanPw(msg.pw) });
    return;
  }
  // Back after a reload, a friend gets the seat they had; a newcomer one nobody is due back in.
  const said = String(msg.name || '');
  const pid = typeof msg.pid === 'string' && /^[A-Za-z0-9_-]{16}$/.test(msg.pid) ? msg.pid : '';
  const who = pid || `n:${said}`;
  const free = msg.watch ? [] : slots.filter((s) => s.kind === 'open');
  const slot = free.find((s) => owners[slots.indexOf(s)] === who) || free.find((s) => s.held && s.held === said) || free.find((s) => !s.held) || free[0];
  // Somebody the room has not seen before is pointed out to everyone.
  const isNew = !!slot && slot.held !== said;
  if (slot) {
    slot.held = '';
    slot.said = said;
    // An empty seat has no team of its own: the newcomer goes to the smaller side.
    if (teamMode) slot.team = smallerTeam();
    slot.kind = 'remote';
    slot.conn = conn;
    // Who they are for the ratings: checked when results are read, kept as said here.
    slot.pid = typeof msg.pid === 'string' && /^[A-Za-z0-9_-]{16}$/.test(msg.pid) ? msg.pid : '';
    slot.pub = typeof msg.pub === 'string' && /^[A-Za-z0-9_-]{80,100}$/.test(msg.pub) ? msg.pub : '';
    slot.input = IDLE;
    slot.playerId = -1;
    slot.name = guestName(slot, msg.name);
    // Their own wins come with them; the seat's last occupant's go back on the shelf.
    seatRecord(slots.indexOf(slot), who);
  } else {
    // No free slot, or they asked to watch: they become a spectator, under the
    // name they came with, and can sit down later with the same hello.
    conn.watchName = String(msg.name || '').trim().slice(0, 8) || t('spectatorName');
    conn.hello = msg;
    net.watchers.push(conn);
  }
  renderLobby();
  sendLobby();
  relayChat({ sys: 'join', name: slot ? slot.name : conn.watchName, look: -1, text: '' });
  if (isNew) {
    const hello = { t: 'new', look: slots.indexOf(slot), name: slot.name };
    broadcast(() => hello);
    newcomer(hello);
  }
  // Arriving mid-round, they watch it; a new player gets a hamster next round.
  // A spectator taking a seat is watching the round already.
  if (sitting) return;
  if (game) conn.send({ t: 'start', g: net.round, map: game.map.id, players: roster(), you: -1, wins, tot: career, rd: rounds, hist: seasons });
  if (game && paused) conn.send({ t: 'pause', on: true, by: '' });
}

function guestName(slot, raw) {
  const name = String(raw || '').trim().slice(0, 8);
  return freeName(slot, !name || ME_NAMES.has(name) ? defaultName(slots.indexOf(slot)) : name);
}

const roster = () => game.players.map((p) => ({ name: p.name, look: p.look, team: p.team, kind: p.kind, nest: p.nest, pid: p.pid || '', pub: p.pub || '' }));

// The signing key of whoever sits in a slot: this browser's own for the host's
// seat, the one a guest said hello with for theirs, none for a bot.
let myKey = null;
identity().then((me) => {
  myKey = me;
  // The host's own seat holds the host's own record.
  if (me && net.role !== 'guest' && !owners[0]) owners[0] = me.pid;
});
function keyOf(slot) {
  if (slot.kind === 'human' && myKey) return { pid: myKey.pid, pub: myKey.pub };
  if (slot.kind === 'remote' && slot.pid && slot.pub) return { pid: slot.pid, pub: slot.pub };
  return { pid: '', pub: '' };
}

function guestData(conn, msg) {
  if (!msg || conn.kicked) return;
  if (msg.t === 'hello') {
    if (!slots.some((s) => s.conn === conn) && !net.watchers.includes(conn)) welcome(conn, msg);
    return;
  }
  const slot = slots.find((s) => s.conn === conn);
  if (msg.t === 'chat') {
    // Players and spectators can both talk; the host stamps the name on.
    if (!slot && !net.watchers.includes(conn)) return;
    const now = Date.now();
    if (now - (conn.lastChat || 0) < 400) return;
    conn.lastChat = now;
    const text = cleanChat(msg.text);
    if (text) relayChat({ name: slot ? slot.name : conn.watchName, look: slot ? slots.indexOf(slot) : -1, text });
    return;
  }
  if (msg.t === 'sit') {
    // A spectator takes a free seat: at once in the lobby, for the next round mid-game.
    const watching = net.watchers.indexOf(conn);
    if (watching < 0 || !slots.some((s) => s.kind === 'open')) return;
    net.watchers.splice(watching, 1);
    welcome(conn, { ...conn.hello, watch: false }, true);
    return;
  }
  if (!slot) return;
  if (msg.t === 'handoverOk') {
    if (net.handover === slots.indexOf(slot)) leaveForHeir();
    return;
  }
  if (msg.t === 'name') {
    slot.name = guestName(slot, msg.name);
    // The name they come back under after a reload is the new one: hold the seat for that.
    slot.said = String(msg.name || '');
    saveSlots();
    renderLobby();
    sendLobby();
  } else if (msg.t === 'team') {
    if (!teamMode || !validTeam(msg.team)) return;
    slot.team = msg.team;
    saveSlots();
    renderLobby();
    sendLobby();
  } else if (msg.t === 'i') {
    // Inputs are numbered and may overtake each other on the way: the newest counts.
    const no = Number(msg.n) || 0;
    if (no && no <= slot.input.n) return;
    const n = (v) => Math.max(-1, Math.min(1, Number(v) || 0));
    slot.input = { mx: n(msg.mx), my: n(msg.my), ax: n(msg.ax), ay: n(msg.ay), seq: Number(msg.seq) || 0, th: !!msg.th, sk: !!msg.sk, n: no };
  }
}

function guestLeft(conn) {
  const watching = net.watchers.indexOf(conn);
  if (watching >= 0) {
    net.watchers.splice(watching, 1);
    renderLobby();
    sendLobby();
    relayChat({ sys: 'leave', name: conn.watchName, look: -1, text: '' });
    return;
  }
  const slot = slots.find((s) => s.conn === conn);
  if (!slot) return;
  relayChat({ sys: 'leave', name: slot.name, look: -1, text: '' });
  slot.conn = null;
  slot.kind = 'open';
  slot.name = defaultName(slots.indexOf(slot));
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

// Everyone connected, players and spectators alike.
function forEachGuest(fn) {
  for (const slot of slots) if (slot.conn && slot.conn.open) fn(slot.conn);
  for (const conn of net.watchers) if (conn.open) fn(conn);
}

// Who is watching, by name: the host knows from its connections, a guest from the lobby.
function spectNames() {
  return net.role === 'host' ? net.watchers.map((c) => c.watchName) : net.spect || [];
}

// The spectators' names, in the lobby and over a round, and for a spectator a
// button to take a free seat: now in the lobby, from the next round mid-game.
function syncSpect() {
  const names = spectNames();
  const open = net.role === 'guest' && net.you < 0 && (net.lobby || []).some((s) => s.kind === 'open');
  for (const id of ['spectLobby', 'spectGame']) {
    const box = $(id);
    box.hidden = !net.role || (!names.length && !open);
    box.querySelector('span').textContent = names.length ? `👀 ${t('spectators', names.length)}: ${names.join(', ')}` : '';
    const sit = box.querySelector('.sit');
    sit.hidden = !open;
    sit.textContent = t('sitIn');
  }
  if (!$('stage').hidden && meId < 0) $('watching').textContent = t(net.role === 'guest' && net.you >= 0 ? 'watchThisRound' : 'spectating');
}
for (const b of document.querySelectorAll('.spect .sit')) b.addEventListener('click', () => net.host && net.host.send({ t: 'sit' }));

function sendLobby() {
  if (net.role !== 'host') return;
  const view = slots.map((s) => ({ kind: s.kind, name: s.name, team: s.team, pid: keyOf(s).pid }));
  syncSpect();
  broadcast((slot, i) => ({ t: 'lobby', slots: view, spect: spectNames(), teams: teamMode, map: mapId, pw: roomPw, you: i, wins, tot: career, rd: rounds, hist: seasons }));
  announce();
}

// What goes out without events is sent where a lost one is never sent again, so
// every snapshot is the whole picture. `k` is the tick it shows, `ak` the number
// of the last input each friend's hamster had been given by then, and `st` what
// the lane help of each remembered: [lx, ly, at, px, py, turn].
function snapshot(events) {
  const r = (v) => Math.round(v * 10) / 10;
  const q = (v) => Math.round(v * 1000) / 1000;
  const acks = game.players.map(() => 0);
  for (const slot of slots) if (slot.conn && slot.playerId >= 0) acks[slot.playerId] = slot.input.n || 0;
  return {
    t: 's',
    g: net.round,
    k: game.tick,
    ak: acks,
    st: game.players.map((_, id) => {
      const m = helpers[id] && helpers[id].memory();
      return m ? [m.lx, m.ly, q(m.at), m.px, m.py, m.turn === 'x' ? 1 : m.turn === 'y' ? 2 : 0] : 0;
    }),
    ph: game.phase,
    cd: game.countdown,
    tm: game.time,
    hx: game.homeX,
    nb: game.nibbler,
    w: game.winner,
    ws: game.winners,
    to: game.timeout,
    p: game.players.map((p) => [
      r(p.x), r(p.y), r(p.vx), r(p.vy), q(p.fx), q(p.fy), p.carrying ? 1 : 0, q(p.gather), p.queued,
      p.swing ? [p.swing.phase, q(p.swing.t), q(p.swing.dx), q(p.swing.dy)] : 0, q(p.cooldown), p.kills, p.deaths, p.seeds, p.supers, q(p.charge), p.throws, r(p.wet), p.stops, q(p.dazed),
    ]),
    // What the map is up to: [kind, x, y, dx, dy, age].
    hz: game.hazards.map((h) => [h.kind, r(h.x), r(h.y), h.dx || 0, h.dy || 0, Math.round(h.age * 100) / 100]),
    ev: events,
  };
}

// ---------- joining ----------

// `until` is a time up to which a room that is not there is tried again: its host
// is reloading and will be back with it in a moment.
async function enterRoom(until = 0) {
  net.status = t(until ? 'hostReloading' : 'connecting');
  net.failed = false;
  net.kicked = false;
  renderLobby();
  try {
    net.host = await joinRoom(joinId, { data: hostData, close: hostGone });
    net.lost = false;
    sayHello();
    net.status = '';
  } catch (err) {
    if (Date.now() < until) {
      setTimeout(() => !net.host && enterRoom(until), 1500);
      return;
    }
    net.failed = true;
    net.status = t(err && err.noRoom ? 'noRoom' : 'joinFail');
  }
  renderLobby();
}

function sayHello() {
  net.needPw = false;
  net.status = '';
  // The key goes along so the round can be rated; without one it is just not rated.
  identity().then((me) => net.host && net.host.send({ t: 'hello', name: slots[0].name, watch: watchOnly, pw: net.pw, pid: me?.pid, pub: me?.pub }));
}

// Lost the host, reloading along with it, or never got in: the cover says so.
function syncGone() {
  const gone = net.role === 'guest' && !net.host && (net.failed || net.reloading || net.lost);
  $('joinFail').hidden = !gone;
  $('joinFailText').textContent = net.status;
}

function hostGone() {
  net.host = null;
  net.lobby = null;
  net.lost = true;
  toLobby();
  // About to reload along with the host: nothing to say or do until then.
  if (net.reloading) return;
  if (!net.kicked) {
    // The host may only have reloaded. Keep knocking for a while before giving up.
    enterRoom(Date.now() + 20000);
    return;
  }
  net.failed = true;
  net.status = t('kicked');
  renderLobby();
}

// The host is reloading and wants everyone on the same version: follow, and come
// back to the same room, which takes the host a few seconds to reopen.
function reloadWithHost() {
  net.reloading = true;
  net.status = t('hostReloading');
  try {
    sessionStorage.setItem(REJOIN_STORE, String(Date.now() + 30000));
  } catch {
    // one try at the room, then
  }
  if ($('stage').hidden) renderLobby();
  syncGone();
  setTimeout(() => location.reload(), 2500);
}

function hostData(msg) {
  if (!msg) return;
  if (msg.t === 'lobby') {
    net.lobby = msg.slots;
    net.teams = !!msg.teams;
    net.map = MAP_IDS.includes(msg.map) ? msg.map : 'meadow';
    net.pw = cleanPw(msg.pw);
    if (net.needPw) net.status = '';
    net.needPw = false;
    net.you = msg.you;
    msg.wins.forEach((n, i) => (wins[i] = n));
    (msg.tot || []).forEach((v, i) => (career[i] = v));
    if (msg.rd >= 0) rounds = msg.rd;
    if (Array.isArray(msg.hist)) seasons = msg.hist;
    net.spect = Array.isArray(msg.spect) ? msg.spect.map((n) => String(n).slice(0, 8)) : [];
    if ($('stage').hidden) renderLobby();
    syncSpect();
  } else if (msg.t === 'reload') {
    reloadWithHost();
  } else if (msg.t === 'handover') {
    becomeHost(msg.pack);
  } else if (msg.t === 'kicked') {
    net.kicked = true;
    const host = net.host;
    hostGone();
    if (host) host.close();
  } else if (msg.t === 'pw') {
    net.needPw = true;
    net.status = t(msg.wrong ? 'pwWrong' : 'pwNeeded');
    renderLobby();
    $('pwInput').focus();
  } else if (msg.t === 'full') {
    net.status = t('roomFull');
    renderLobby();
  } else if (msg.t === 'start') {
    net.round = msg.g;
    net.match = typeof msg.mid === 'string' ? { id: msg.mid, at: Number(msg.at) || 0 } : null;
    net.snap = null;
    net.tick = -1;
    net.mine = null;
    predictor.reset();
    msg.wins.forEach((n, i) => (wins[i] = n));
    (msg.tot || []).forEach((v, i) => (career[i] = v));
    if (msg.rd >= 0) rounds = msg.rd;
    if (Array.isArray(msg.hist)) seasons = msg.hist;
    game = {
      map: MAPS[msg.map] || MAP,
      hazards: [],
      phase: 'countdown',
      countdown: COUNTDOWN,
      time: 0,
      homeX: (MAPS[msg.map] || MAP).home.x2,
      nibbler: -1,
      winner: null,
      winners: [],
      timeout: false,
      players: msg.players.map((p, id) => ({
        id, name: p.name, look: p.look, team: p.team ?? -1, kind: p.kind, nest: p.nest, x: p.nest.x, y: p.nest.y, vx: 0, vy: 0, fx: 1, fy: 0,
        carrying: false, gather: 0, queued: -1, swing: null, cooldown: 0, kills: 0, deaths: 0, seeds: 0, supers: 0, charge: 0, throws: 0, stops: 0,
        pid: typeof p.pid === 'string' ? p.pid : '', pub: typeof p.pub === 'string' ? p.pub : '',
      })),
    };
    renderer.setMap(game.map);
    meId = msg.you;
    enterStage();
  } else if (msg.t === 's' && game) {
    // One left over from the round before, or one of the next round that got here
    // ahead of its start.
    if (msg.g !== net.round) return;
    // Snapshots can overtake each other. An older one has nothing to show, but what
    // happened in it still happened.
    if (!(msg.k < net.tick)) {
      game.phase = msg.ph;
      game.countdown = msg.cd;
      game.time = msg.tm;
      game.homeX = msg.hx;
      game.nibbler = msg.nb;
      game.winner = msg.w;
      game.hazards = (msg.hz || []).map(([kind, x, y, dx, dy, age]) => ({ kind, x, y, dx, dy, age }));
      game.winners = msg.ws || [];
      game.timeout = !!msg.to;
      msg.p.forEach((s, i) => readPlayer(game.players[i], s));
      net.snap = msg;
      if (msg.k >= 0) {
        net.tick = msg.k;
        predictor.heard(performance.now() / 1000, msg.k, (meId >= 0 && msg.ak && msg.ak[meId]) || 0);
      }
      // My own hamster stays where it was last drawn until the next frame works it out again.
      if (net.mine && meId >= 0) Object.assign(game.players[meId], net.mine);
    }
    for (const ev of msg.ev || []) onEvent(ev);
  } else if (msg.t === 'lobbyscreen') {
    // The host cut the round short: it counts as the host judged it.
    if (Array.isArray(msg.ws) && game && game.phase === 'playing' && !game.rated) {
      game.winners = msg.ws.filter((id) => Number.isInteger(id) && game.players[id]);
      game.stopped = true;
      rateRound();
    }
    toLobby();
    renderLobby();
  } else if (msg.t === 'chat') {
    addChat(msg);
  } else if (msg.t === 'new') {
    newcomer(msg);
  } else if (msg.t === 'pause') {
    showPause(!!msg.on, msg.by || '');
  }
}

// One hamster as a snapshot has it.
function readPlayer(p, s) {
  [p.x, p.y, p.vx, p.vy, p.fx, p.fy] = s;
  p.carrying = !!s[6];
  p.gather = s[7];
  p.queued = s[8];
  p.swing = s[9] ? { phase: s[9][0], t: s[9][1], dx: s[9][2], dy: s[9][3] } : null;
  [p.cooldown, p.kills, p.deaths, p.seeds, p.supers = 0, p.charge = 0, p.throws = 0, p.wet = 0, p.stops = 0, p.dazed = 0] = s.slice(10);
}

// Somebody new has sat down: their row in the lobby glows yellow for a while and a
// line says so, in the lobby and over a round alike.
const fresh = new Map();
let freshTimer = 0;
$('slots').insertAdjacentHTML('beforebegin', '<p id="newcomer" hidden></p><div id="slotHead"><span></span><span data-i18n="colName"></span><span class="team" data-i18n="colTeam"></span><span data-i18n="colKind"></span></div>');

function newcomer({ look, name }) {
  const text = t('newcomer', String(name || '').slice(0, 8));
  fresh.set(Number(look), performance.now() + 8000);
  $('newcomer').textContent = text;
  if (!$('stage').hidden) banner(text);
  markFresh();
}

function markFresh() {
  const now = performance.now();
  let next = Infinity;
  [...$('slots').children].forEach((li, i) => {
    const until = fresh.get(i) || 0;
    li.classList.toggle('fresh', until > now);
    if (until > now) next = Math.min(next, until);
  });
  $('newcomer').hidden = next === Infinity;
  clearTimeout(freshTimer);
  if (next < Infinity) freshTimer = setTimeout(markFresh, next - now + 20);
}

// ---------- chat ----------

// One conversation runs through the whole room and looks the same everywhere (see
// chatbar.js): the lines float up over the screen and fade, in the lobby (from the
// corner of the page) as in a round (over the map), and one bar to type in stays
// open with its text through every change of screen: lobby, round, result, the
// next round.
const CHAT_LOGS = ['gameChat', 'lobbyChat'];

// Everything said in this room, kept in the tab so a reload does not lose it. The
// floating lines fade; this is what opening the chat shows.
const CHAT_STORE = 'hash-rush-chat';
const CHAT_KEEP = 300;
const chatRoom = () => net.room || joinId || '';
let chatHistory = [];
try {
  const saved = JSON.parse(sessionStorage.getItem(CHAT_STORE));
  if (saved && Array.isArray(saved.lines) && saved.room === (joinId || loadRoom().room || '')) chatHistory = saved.lines;
} catch {
  // nothing kept
}
function keepChat(line) {
  chatHistory.push(line);
  if (chatHistory.length > CHAT_KEEP) chatHistory.splice(0, chatHistory.length - CHAT_KEEP);
  try {
    sessionStorage.setItem(CHAT_STORE, JSON.stringify({ room: chatRoom(), lines: chatHistory }));
  } catch {
    // not kept
  }
  chat.heard(line);
}

function syncChat() {
  $('gameChat').hidden = !net.role;
  // The chat has one button of its own, floating over every screen.
  for (const id of ['chatBtn', 'lobbyChatBtn']) $(id).hidden = true;
  $('chatFab').hidden = !net.role;
  $('lobbyChat').hidden = !net.role || $('lobby').hidden;
  $('lobbyChatBtn').textContent = t('chatLabel');
}

// What each slot last said, shown for a few seconds as a speech bubble over its
// hamster: on the field during a round, on its row in the lobby.
const bubbles = new Map();
let bubbleTimer = 0;

function showLobbyBubbles() {
  const now = performance.now();
  let next = Infinity;
  [...$('slots').children].forEach((li, i) => {
    const said = bubbles.get(i);
    const live = said && said.until > now;
    let el = li.querySelector('.bubble');
    if (!live) {
      if (el) el.remove();
      return;
    }
    next = Math.min(next, said.until);
    if (!el) {
      el = document.createElement('div');
      el.className = 'bubble';
      li.append(el);
    }
    const who = document.createElement('b');
    who.textContent = `${said.name}:`;
    el.replaceChildren(who, ` ${said.text}`);
  });
  clearTimeout(bubbleTimer);
  if (next < Infinity) bubbleTimer = setTimeout(showLobbyBubbles, next - now + 20);
}

function addChat({ name, look, text, sys }) {
  // Somebody coming in or going out: a grey line with no speaker.
  if (sys) text = t(sys === 'join' ? 'chatJoin' : 'chatLeave', String(name || t('spectatorName')).slice(0, 8));
  // A soft chime for what somebody else says.
  if (look !== (net.role === 'host' ? 0 : net.you)) audio.play.chat();
  if (look >= 0) {
    const said = cleanChat(text);
    bubbles.set(look, { name: String(name), text: said, until: performance.now() + lineLife(said) });
    showLobbyBubbles();
  }
  syncChat();
  keepChat({ name: String(name || ''), text: cleanChat(text), color: seatColor(look), sys: !!sys, at: Date.now() });
  for (const id of CHAT_LOGS) floatLine($(id).querySelector('.chatLog'), { name, text: cleanChat(text), color: seatColor(look), sys });
}

// The host shows a message and passes it on to everyone in the room.
function relayChat(msg) {
  broadcast(() => ({ t: 'chat', ...msg }));
  addChat(msg);
}

function sendChat(raw) {
  const text = cleanChat(raw);
  if (!text) return;
  if (net.role === 'guest') {
    if (net.host) net.host.send({ t: 'chat', text });
  } else if (net.role === 'host') {
    relayChat({ name: slots[0].name, look: 0, text });
  }
}

const chat = createChat({
  send: sendChat,
  lines: () => chatHistory,
  quick: t('quickChat'),
  placeholder: t('chatPlaceholder'),
  openers: ['chatBtn', 'lobbyChatBtn'],
  logs: ['gameChat'],
  // Enter opens the bar anywhere in a room, the way it does in most games.
  enterOpens: () => !!net.role,
});

// Some phones shrink the page itself when the keyboard comes up, and everything
// sized from its height would shrink along. So the page's height is written down
// while nobody is typing, and held there while somebody is: the keyboard only
// ever covers the foot of the screen.
const typing = () => /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '') && !document.activeElement.readOnly;
// A keyboard on its way up or down can be caught halfway, with the page short for
// a moment; taking that height would shrink the whole map and grow it back. So
// the height only ever grows at once, or changes along with the width (a turned
// phone); a shorter page is taken only once it has stayed short a while.
let pinnedW = 0;
let pinnedH = 0;
let shrinkTimer = 0;
function pinHeight() {
  if (typing()) return;
  clearTimeout(shrinkTimer);
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w === pinnedW && h < pinnedH) {
    shrinkTimer = setTimeout(() => {
      if (!typing() && window.innerWidth === pinnedW && window.innerHeight < pinnedH) pinTo(window.innerWidth, window.innerHeight);
    }, 1500);
    return;
  }
  pinTo(w, h);
}
function pinTo(w, h) {
  pinnedW = w;
  pinnedH = h;
  document.documentElement.style.setProperty('--app-h', `${h}px`);
  // Tall or wide goes by the same held size, so a keyboard that shortens the page
  // never flips a tall layout into a wide one.
  document.documentElement.classList.toggle('tall', h > w);
}
pinHeight();
window.addEventListener('resize', pinHeight);
window.addEventListener('orientationchange', () => setTimeout(pinHeight, 300));
// The keyboard may still be on its way down when the box lets go.
document.addEventListener('focusout', () => setTimeout(pinHeight, 400));

// ---------- looking in on the lobby ----------
// Anyone can step out to the lobby and back while the round carries on without
// them drawn: to check the seats, the chat or the room link.
$('quit').insertAdjacentHTML('beforebegin', '<button id="peek"></button>');
$('start').insertAdjacentHTML('beforebegin', '<button id="backToGame" class="primary" hidden></button>');

function peekLobby() {
  if (!game) return;
  input.enable(false);
  show('lobby');
  renderLobby();
}

function backToGame() {
  if (!game) return;
  show('stage');
  input.enable(meId >= 0 && game.phase !== 'over' && !paused);
  renderer.resize();
  scoreKey = '';
}
$('peek').textContent = t('peekLobby');
$('backToGame').textContent = t('backToGame');
$('peek').addEventListener('click', peekLobby);
$('backToGame').addEventListener('click', backToGame);

// ---------- pause ----------
// The host can stop the round for everyone and start it again; guests just see it.
let paused = false;
$('field').insertAdjacentHTML('beforeend', '<div id="pause" hidden><b id="pauseWord"></b><p id="pauseBy"></p><button id="resume" class="primary"></button></div>');
$('boardBtn').insertAdjacentHTML('beforebegin', '<button id="pauseBtn">⏸</button>');

function showPause(on, by = '') {
  paused = on;
  $('pause').hidden = !on;
  $('pauseWord').textContent = t('paused');
  $('pauseBy').textContent = by ? t('pausedBy', by) : '';
  $('resume').textContent = t('resume');
  // Only the host stops and starts the round; a guest just waits.
  $('resume').hidden = net.role === 'guest';
}

function myName() {
  return net.role === 'guest' ? (game && meId >= 0 ? game.players[meId].name : '') : slots[0]?.name || '';
}

function setPause(on, by = myName()) {
  if (!game || game.phase === 'over' || $('stage').hidden || on === paused) return;
  if (net.role === 'guest') return;
  acc = 0;
  showPause(on, by);
  broadcast(() => ({ t: 'pause', on, by }));
}
$('pauseBtn').addEventListener('click', () => setPause(!paused));
$('resume').addEventListener('click', () => setPause(false));
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyP' || e.target instanceof HTMLInputElement) return;
  setPause(!paused);
});

// ---------- game ----------

function startGame() {
  const active = slots.map((s, i) => ({ slot: s, look: i })).filter((a) => isPlaying(a.slot));
  const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  for (const s of slots) s.playerId = -1;
  renderer.setMap(MAPS[mapId]);
  game = createGame({
    map: MAPS[mapId],
    slots: active.map(({ slot, look }) => ({
      name: slot.name.trim() || t('fallbackName', look + 1),
      kind: slot.kind,
      look,
      team: teamMode ? slot.team : -1,
    })),
    seed,
  });
  helpers = [];
  controllers = active.map(({ slot }, id) => {
    slot.playerId = id;
    // A move off a touch pad is straightened out here, where the hamster really
    // is, whether the thumb is the host's or a guest's.
    if (slot.kind === 'human') {
      const help = createLaneHelp();
      return (g) => help(g, g.players[id], input.read(g, id));
    }
    if (slot.kind === 'remote') {
      const help = createLaneHelp();
      helpers[id] = help;
      // The guest counts its bonk presses; a new count is one press here.
      let seen = slot.input.seq;
      return (g) => {
        const i = slot.input;
        const bonk = i.seq !== seen;
        seen = i.seq;
        return help(g, g.players[id], { mx: i.mx, my: i.my, ax: i.ax, ay: i.ay, bonk, throw: i.th, stick: i.sk });
      };
    }
    const level = slot.kind.split(':')[1];
    const bot = level === 'rl' ? createRLBot({ seed: seed + id * 7919 }) : createBot({ difficulty: level, seed: seed + id * 7919 });
    return (g) => bot.think(g, id);
  });
  meId = active.findIndex((a) => a.slot.kind === 'human');
  net.pending = [];
  net.round++;
  // Everyone in the round signs the same result at the end: it needs the same id and time.
  net.match = { id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4), at: Date.now() };
  game.players.forEach((p, id) => Object.assign(p, keyOf(active[id].slot)));
  const players = roster();
  broadcast((slot) => ({ t: 'start', g: net.round, map: mapId, players, you: slot.playerId, wins, tot: career, rd: rounds, hist: seasons, mid: net.match.id, at: net.match.at }));
  enterStage();
  announce();
}

function enterStage() {
  clearTimeout(resultTimer);
  showPause(false);
  $('pauseBtn').hidden = net.role === 'guest';
  $('resetGame').hidden = net.role === 'guest';
  $('result').hidden = true;
  hideChampions();
  $('feed').textContent = '';
  // A round starts with a clean overlay. The typing bar stays as it was, open
  // with whatever was being typed.
  $('gameChat').querySelector('.chatLog').textContent = '';
  $('banner').classList.remove('show');
  $('callout').textContent = '';
  // Only the host starts the next round. A guest's button asks for it instead, out
  // loud in the chat, which also makes plain who it is up to.
  const guest = net.role === 'guest';
  $('again').classList.toggle('ask', guest);
  $('again').textContent = t(guest ? 'askAgain' : 'again');
  $('againBtn').hidden = true;
  $('resultWait').hidden = true;
  scoreKey = '';
  showBoard(false);
  alarmKey = '';
  acc = 0;
  renderer.clear();
  input.reset();
  input.enable(meId >= 0);
  $('watching').hidden = meId >= 0;
  // A friend who walked in on a round has a seat already and plays from the next one.
  $('watching').textContent = t(net.role === 'guest' && net.you >= 0 ? 'watchThisRound' : 'spectating');
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

function banner(text, alarm = false) {
  const el = $('banner');
  el.textContent = text;
  el.classList.add('show');
  el.classList.toggle('alarm', alarm);
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// The shout for a big play: "Double kill!", "Super play!". Plays that land within a
// moment of each other, like a double kill that also stops a seed, share one shout.
let calloutAt = 0;
let calloutLines = [];

function callout(by, lines) {
  const now = performance.now();
  calloutLines = now - calloutAt < 400 ? [...new Set([...calloutLines, ...lines])] : lines;
  calloutAt = now;
  const box = document.createElement('div');
  box.append(nameTag(by));
  for (const line of calloutLines) {
    const el = document.createElement('span');
    el.textContent = line;
    el.classList.toggle('super', line === t('superPlay'));
    box.append(el);
  }
  box.addEventListener('animationend', () => box.remove());
  $('callout').replaceChildren(box);
}

function nameTag(p) {
  const b = document.createElement('b');
  b.textContent = p.name;
  b.style.color = colorOf(p);
  return b;
}

// Whether this hamster is the winner or on the winner's team.
const won = (p) => game.winners.includes(p.id);
// A team game lists team-mates together.
const lineUp = () => [...game.players].sort((a, b) => a.team - b.team);

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
    // A guest has already heard and felt its own swing, when it pressed the button.
    if (ev.id === meId && performance.now() / 1000 - swungAt > 1.5) {
      audio.play.swing();
      haptics.buzz(12);
    }
  } else if (ev.type === 'bonk') {
    audio.play.bonk();
    // Felt in the hand: a thump for a bonk landed, a longer rattle for one taken.
    if (ev.by === meId) haptics.buzz(35);
    if (ev.id === meId) haptics.buzz([70, 50, 110]);
    const line = document.createElement('div');
    line.append(nameTag(players[ev.by]), ev.seed ? ` 🌻${t('bonkWord')} ` : ` ${t('bonkWord')} `, nameTag(players[ev.id]));
    line.addEventListener('animationend', () => line.remove());
    $('feed').prepend(line);
    while ($('feed').children.length > 4) $('feed').lastChild.remove();
    if (ev.seed && ev.id === meId) banner(t('lostSeed'));
    if (ev.close) {
      callout(players[ev.by], [t('superPlay')]);
      audio.play.superplay();
    }
  } else if (ev.type === 'zap') {
    // The map got somebody: a pit or a cannon.
    audio.play.zap();
    if (ev.id === meId) haptics.buzz([70, 50, 110]);
    const line = document.createElement('div');
    line.append(ev.kind === 'trap' ? '🕳️ ' : '💥 ', nameTag(players[ev.id]));
    line.addEventListener('animationend', () => line.remove());
    $('feed').prepend(line);
    while ($('feed').children.length > 4) $('feed').lastChild.remove();
    if (ev.seed && ev.id === meId) banner(t('lostSeed'));
  } else if (ev.type === 'omen') {
    audio.play.omen();
  } else if (ev.type === 'cannon') {
    audio.play.toss();
  } else if (ev.type === 'splash') {
    audio.play.splash();
  } else if (ev.type === 'throw') {
    audio.play.toss();
  } else if (ev.type === 'multi') {
    const names = t('killNames');
    const name = names[Math.min(ev.n, names.length + 1) - 2];
    // Three at once is a super play in its own right.
    callout(players[ev.by], ev.n >= 3 ? [name, t('superPlay')] : [name]);
    if (ev.n >= 3) audio.play.triple();
    else audio.play.double();
  } else if (ev.type === 'spawn' || ev.type === 'warp') {
    if (ev.id === meId) audio.play.spawn();
  } else if (ev.type === 'seed') {
    audio.play.seed();
    if (ev.id === meId) haptics.buzz([20, 40, 20]);
    const mate = meId >= 0 && allied(players[meId], players[ev.id]);
    banner(ev.id === meId ? t('gotSeedMe') : t(mate ? 'gotSeedMate' : 'gotSeedOther', players[ev.id].name));
  } else if (ev.type === 'overtime') {
    audio.play.overtime();
    banner(t('overtime'));
  } else if (ev.type === 'rush') {
    audio.play.overtime();
    banner(t('rush'));
  } else if (ev.type === 'win') {
    // A team wins together: everyone on it gets the win.
    for (const p of players) if (won(p)) wins[p.look]++;
    addCareer();
    rateRound();
    if (meId < 0 || won(players[meId])) audio.play.win();
    else audio.play.lose();
    input.enable(false);
    resultTimer = setTimeout(showResult, 1500);
  }
}

// A finished round goes into this browser's record, and, with two or more people in
// it, gets signed for the ratings. Spectators keep no record.
function rateRound() {
  if (!game || game.rated || meId < 0) return;
  game.rated = true;
  const me = game.players[meId];
  const people = game.players.filter((p) => p.pid && p.pub);
  // Computers take part as their level; a person needs a key to count.
  const bots = game.players.filter((p) => String(p.kind || '').startsWith('bot:'));
  const levels = new Set(bots.map((p) => p.kind));
  const rated = !!net.match && people.includes(me) && people.length + levels.size >= 2;
  // The ranking goes by the name this player last played under.
  if (rated) shareName(me.name);
  remember({ at: Date.now(), map: game.map.id, team: me.team >= 0, myTeam: me.team, won: won(me), rated, stopped: !!game.stopped, with: game.players.filter((p) => p !== me).map((p) => ({ name: p.name, level: String(p.kind || '').startsWith('bot:') ? p.kind.slice(4) : '', team: p.team })) });
  const players = [...people.map((p) => ({ pid: p.pid, pub: p.pub, won: won(p) })), ...bots.map((p) => ({ pid: p.kind, won: won(p) }))];
  if (rated) signResult({ id: net.match.id, at: net.match.at, map: game.map.id, team: me.team >= 0, players });
}

// A finished round goes into the running totals once.
// A goal is a seed brought home: one hamster's, in a round that did not run out of time.
const goal = (p) => (game.phase === 'over' && !game.timeout && game.winner === p.id ? 1 : 0);
const roundOf = (p) => [p.kills, p.deaths, p.seeds, goal(p), p.supers, p.throws || 0, p.stops || 0];
// The order the table shows them in. This round leaves the goal out: its badge says it.
const ROUND_COLS = [0, 5, 6, 1, 2, 4];
const TOTAL_COLS = [0, 5, 6, 1, 2, 3, 4];

const PLAYED = 7;
// Rounds finished and not won. A round still going is not counted either way.
const losses = (p) => Math.max(0, ((career[p.look] || [])[PLAYED] || 0) - wins[p.look]);

function addCareer() {
  if (game.counted) return;
  game.counted = true;
  rounds++;
  for (const p of game.players) {
    const c = career[p.look] || (career[p.look] = [0, 0, 0, 0, 0, 0, 0]);
    roundOf(p).forEach((v, k) => (c[k] = (c[k] || 0) + v));
    // After the seven numbers above: rounds played, for the losses.
    c[PLAYED] = (c[PLAYED] || 0) + 1;
  }
}

// The score table: this round's numbers, then the running totals for the room,
// each under its own heading. The corner says which game of the room this is.
// It is the result screen's table and the one Tab brings up mid-round.
// Which half a narrow screen shows; a wide one shows both side by side.
// The running totals first: they are what people look at.
let scoreView = 'total';

function setScoreView(view) {
  scoreView = view;
  for (const table of document.querySelectorAll('.scoreTable')) {
    table.dataset.view = view;
    for (const b of table.querySelectorAll('.scoreTabs button')) b.classList.toggle('on', b.dataset.view === view);
  }
}

function fillScores(table) {
  table.textContent = '';
  const tabs = document.createElement('div');
  tabs.className = 'scoreTabs';
  for (const [view, label] of [['round', t('thisRound')], ['total', t('totals')]]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.view = view;
    b.textContent = label;
    b.addEventListener('click', (e) => {
      // The mid-round table closes on a tap anywhere else on it.
      e.stopPropagation();
      setScoreView(view);
    });
    tabs.append(b);
  }
  table.createCaption().append(tabs);
  const th = (row, text, span = 1) => {
    const cell = document.createElement('th');
    cell.textContent = text;
    cell.colSpan = span;
    row.append(cell);
    return cell;
  };
  const cols = t('columns');
  const groups = table.insertRow();
  groups.className = 'groups';
  const race = document.createElement('small');
  race.textContent = deuce() ? t('deuce', TITLE_LEAD) : t('firstTo', TITLE_WINS);
  race.classList.toggle('deuce', deuce());
  th(groups, t('gameNo', rounds + (game.counted ? 0 : 1))).append(race);
  th(groups, '').classList.add('wins');
  th(groups, t('thisRound'), ROUND_COLS.length).classList.add('round');
  th(groups, t('totals'), TOTAL_COLS.length + 3).classList.add('total', 'split');
  const head = table.insertRow();
  th(head, '');
  // Wins, the race to the title, right beside each name and shown in both views.
  th(head, t('colWins')).classList.add('wins');
  ROUND_COLS.forEach((c) => th(head, cols[c]).classList.add('round'));
  [...TOTAL_COLS.map((c) => cols[c]), t('colLosses'), t('colScore')].forEach((h, k) => {
    const cell = th(head, h);
    cell.classList.add('total');
    cell.classList.toggle('split', k === 0);
  });
  th(head, '').classList.add('total');
  // Until the round is added to the totals, they include it as it stands.
  const totalOf = (p) => roundOf(p).map((v, k) => ((career[p.look] || [])[k] || 0) + (game.counted ? 0 : v));
  const mvps = pickMvp(game.players.map((p) => [p.id, totalOf(p)]));
  for (const p of lineUp()) {
    const row = table.insertRow();
    row.classList.toggle('winner', won(p));
    const who = row.insertCell();
    who.append(nameTag(p));
    // Two badges, for two different things: the goal of this round, and the best
    // record of the room so far.
    if (goal(p)) {
      const scored = document.createElement('span');
      scored.className = 'goalBadge';
      scored.textContent = t('goalBadge');
      who.append(scored);
    }
    const round = roundOf(p);
    const total = totalOf(p);
    const won_ = row.insertCell();
    won_.className = 'wins';
    won_.textContent = t('tally', wins[p.look]);
    [...ROUND_COLS.map((c) => round[c]), ...TOTAL_COLS.map((c) => total[c]), losses(p), mvpScore(total)].forEach((v, k) => {
      const cell = row.insertCell();
      cell.textContent = v;
      cell.classList.add(k >= ROUND_COLS.length ? 'total' : 'round');
      cell.classList.toggle('split', k === ROUND_COLS.length);
    });
    row.lastChild.classList.add('score');
    // The MVP badge sits at the far right, after the score that earned it.
    const prize = row.insertCell();
    prize.className = 'total prize';
    if (mvps.includes(p.id)) {
      const badge = document.createElement('span');
      badge.className = 'mvp';
      badge.textContent = 'MVP';
      prize.append(badge);
    }
  }
  // How the score that decides the MVP adds up.
  const rule = table.insertRow();
  rule.className = 'rule';
  const cell = rule.insertCell();
  cell.colSpan = ROUND_COLS.length + TOTAL_COLS.length + 5;
  cell.textContent = `${t('mvpRule')} = ${TOTAL_COLS.filter((c) => MVP_POINTS[c]).map((c) => `${cols[c]} ×${MVP_POINTS[c]}`).join(' + ')}`;
  setScoreView(scoreView);
}

let boardKey = '';
let tabResult = false;
// Once a round is over, Tab and the chart button bring the result card back.
function reopenResult() {
  if (!game || game.phase !== 'over' || $('stage').hidden) return false;
  if ($('result').hidden) showResult();
  return true;
}

function showBoard(on) {
  if (!game || $('stage').hidden || !$('result').hidden) on = false;
  $('board').hidden = !on;
  boardKey = '';
  if (on) fillScores($('boardTable'));
}

// ---------- championship ----------

// Whoever has the most wins once somebody reaches the title, two clear of the
// next. Wins belong to a seat, not a team, so sides can be reshuffled between
// rounds; level at the top (team-mates, a shared round) means the title is shared.
// Each side's wins: a team's (its best seat, as team-mates win together) or one
// hamster's own in a free-for-all. Two sides level at the top is no title: it is
// deuce until one of them is two clear of every other side.
const sideOf = (p) => (p.team >= 0 ? `t${p.team}` : `p${p.id}`);
function standing() {
  const sides = new Map();
  for (const p of game.players) sides.set(sideOf(p), Math.max(sides.get(sideOf(p)) ?? 0, wins[p.look]));
  const [top = 0, next = 0] = [...sides.values()].sort((a, b) => b - a);
  return { top, next, sides };
}
function champions() {
  const { top, next, sides } = standing();
  if (top < TITLE_WINS || top - next < TITLE_LEAD) return [];
  return game.players.filter((p) => sides.get(sideOf(p)) === top && wins[p.look] === top);
}
// Both leaders within a win of the title and nobody two clear: play on.
function deuce() {
  const { top, next } = standing();
  return top >= TITLE_WINS - 1 && next >= TITLE_WINS - 1 && !champions().length;
}

let champTimer = 0;
let champFrame = 0;

// A gold cup with a sunflower seed standing in it, rays turning behind and
// confetti coming down.
function drawTrophy(canvas, time, won = TITLE_WINS) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = 300;
  const H = 250;
  if (canvas.width !== W * dpr) {
    canvas.width = W * dpr;
    canvas.height = H * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, 128);
  for (let i = 0; i < 12; i++) {
    ctx.rotate(Math.PI / 6);
    ctx.fillStyle = `rgba(255, 205, 60, ${i % 2 ? 0.34 : 0.16})`;
    ctx.save();
    ctx.rotate(time * 0.35);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-22, -150);
    ctx.lineTo(22, -150);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(W / 2, 132 + Math.sin(time * 2.4) * 3);
  const gold = ctx.createLinearGradient(-60, 0, 60, 0);
  gold.addColorStop(0, '#c98a12');
  gold.addColorStop(0.35, '#ffe27a');
  gold.addColorStop(0.6, '#f6b92c');
  gold.addColorStop(1, '#b8770a');
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#8a5a08';
  ctx.lineWidth = 3;
  // handles
  ctx.lineWidth = 9;
  ctx.strokeStyle = '#d99a1c';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(side * 52, -22, 22, side > 0 ? -Math.PI / 2 : Math.PI / 2, side > 0 ? Math.PI / 2 : (3 * Math.PI) / 2);
    ctx.stroke();
  }
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#8a5a08';
  // the seed, standing in the cup
  drawSeed(ctx, 0, -76, 4.6, Math.sin(time * 1.7) * 0.12);
  // bowl
  ctx.fillStyle = gold;
  ctx.beginPath();
  ctx.moveTo(-56, -52);
  ctx.lineTo(56, -52);
  ctx.quadraticCurveTo(54, 18, 12, 30);
  ctx.lineTo(12, 52);
  ctx.lineTo(-12, 52);
  ctx.lineTo(-12, 30);
  ctx.quadraticCurveTo(-54, 18, -56, -52);
  ctx.fill();
  ctx.stroke();
  // rim and base
  ctx.beginPath();
  ctx.roundRect(-62, -60, 124, 13, 6);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(-34, 50, 68, 12, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#6b4a2a';
  ctx.beginPath();
  ctx.roundRect(-46, 61, 92, 22, 6);
  ctx.fill();
  ctx.fillStyle = '#ffe27a';
  ctx.font = '800 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${won}`, 0, 77);
  // shine
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.beginPath();
  ctx.ellipse(-30, -22, 6, 20, 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const colors = ['#e5484d', '#3e63dd', '#f6b92c', '#30a46c', '#9b51e0', '#ff8fb1'];
  for (let i = 0; i < 46; i++) {
    const x = (i * 71.3 + Math.sin(time * 1.3 + i) * 14) % W;
    const y = (time * (46 + (i % 7) * 11) + i * 37) % (H + 20) - 10;
    ctx.save();
    ctx.translate((x + W) % W, y);
    ctx.rotate(time * (2 + (i % 5)) + i);
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(-4, -2.5, 8, 5);
    ctx.restore();
  }
}

function showChampions(champs) {
  if (game.crowned) return;
  game.crowned = true;
  // Filed for sure even if the host reloads or leaves while the card is up.
  if (net.role !== 'guest') {
    pendingSeason = seasonOf(champs);
    saveRoom();
  }
  $('result').hidden = true;
  $('board').hidden = true;
  $('againBtn').hidden = true;
  const mine = champs.some((p) => p.id === meId);
  $('champTitle').textContent = champs.length > 1 ? t('champShared') : mine ? t('champMe') : t('champOther', champs[0].name);
  $('champNames').replaceChildren(
    ...champs.map((p) => {
      const who = document.createElement('div');
      const face = document.createElement('canvas');
      drawAvatar(face, lookOf(p));
      who.append(face, nameTag(p));
      return who;
    }),
  );
  // The full record under the trophy: this is the last look at it before the
  // room starts over.
  fillScores($('champStats'));
  // Where the two halves are tabs, open on the totals: the title is won on those.
  setScoreView('total');
  // Only the host can take the room back to the lobby; anyone can put the card away.
  $('champLobby').hidden = net.role === 'guest';
  $('champNote').textContent = t('champNote', rounds, wins[champs[0].look]);
  $('champ').hidden = false;
  cancelAnimationFrame(champFrame);
  const start = performance.now();
  const loop = (now) => {
    drawTrophy($('trophy'), (now - start) / 1000, wins[champs[0].look]);
    champFrame = requestAnimationFrame(loop);
  };
  champFrame = requestAnimationFrame(loop);
  audio.setMusic(null);
  audio.play.fanfare();
  audio.play.cheer();
  // The host closes the season; everyone else follows it back to the lobby.
  clearTimeout(champTimer);
  if (net.role !== 'guest') champTimer = setTimeout(endSeason, 22000);
}

function hideChampions() {
  clearTimeout(champTimer);
  cancelAnimationFrame(champFrame);
  $('champ').hidden = true;
  setScoreView('total');
}

// The title is decided: keep the record, wipe the scores and take the room back
// to the lobby for a fresh start.
// What goes into the past championships for a title just won.
function seasonOf(champs) {
  return {
    games: rounds,
    rows: [...game.players]
      .sort((a, b) => wins[b.look] - wins[a.look])
      .map((p) => ({ name: p.name, look: p.look, wins: wins[p.look], champ: champs.includes(p) })),
  };
}

function endSeason() {
  if (!game || net.role === 'guest') return;
  const champs = champions();
  if (champs.length) {
    seasons.push(pendingSeason || seasonOf(champs));
    seasons = seasons.slice(-10);
    pendingSeason = null;
    clearRecords();
    rounds = 0;
    saveRoom();
  }
  toLobby();
  broadcast(() => ({ t: 'lobbyscreen' }));
  renderLobby();
  sendLobby();
}

function renderSeasons() {
  $('seasons').hidden = !seasons.length;
  $('seasonList').replaceChildren(
    ...seasons.map((season, i) => {
      const li = document.createElement('li');
      const head = document.createElement('b');
      head.textContent = t(season.stopped ? 'seasonStopped' : 'seasonNo', i + 1, season.games);
      li.classList.toggle('stopped', !!season.stopped);
      li.append(head);
      for (const r of season.rows) {
        const who = document.createElement('span');
        who.style.color = LOOKS[r.look] ? LOOKS[r.look].color : '';
        who.textContent = `${r.champ ? '🏆 ' : ''}${r.name} ${r.wins}`;
        who.classList.toggle('champ', !!r.champ);
        li.append(who);
      }
      return li;
    }),
  );
}

function showResult() {
  if (!game) return;
  const champs = champions();
  if (champs.length) {
    showChampions(champs);
    return;
  }
  const winner = game.players[game.winner];
  const winners = game.winners.map((id) => game.players[id]);
  // Time ran out with the top sides level: they share the round.
  const shared = winners.some((p) => !allied(p, winner) && p !== winner);
  const who = shared ? winners.map((p) => p.name).join(', ') : winner.team >= 0 ? t('teamNames')[winner.team] : winner.name;
  // The verdict is the player's own: a win or a loss, said outright. A spectator has neither.
  const mine = meId >= 0 ? (won(game.players[meId]) ? 'win' : 'lose') : '';
  const title = $('resultTitle');
  title.textContent = mine === 'win' ? t('victory') : mine === 'lose' ? t('defeat') : t('roundOver');
  title.className = mine;
  $('resultWinner').textContent = `🏆 ${t(shared ? 'winnersShared' : 'winnerIs', who)}`;
  // A round that ran out of time says what settled it.
  const why = game.timeout ? timeoutReason(game.players) : null;
  $('resultWhy').hidden = !why;
  if (why) $('resultWhy').textContent = t({ bonks: 'whyBonks', bonked: 'whyBonked', seeds: 'whySeeds', tie: 'whyTie' }[shared ? 'tie' : why.by], who, why.n);
  $('board').hidden = true;
  fillScores($('resultTable'));
  $('result').hidden = false;
  syncChat();
  // The card can be put away to look around, so the rematch button is also outside it.
  $('againBtn').hidden = net.role === 'guest';
  againAt = performance.now();
  // In a room Enter is for the chat, so the rematch button must not catch it.
  if (!net.role) $('again').focus();
}

// Tell everyone, once per carry, when a seed is about to reach home.
let alarmKey = '';
function watchCarrier() {
  const p = game.phase === 'playing' && game.players.find((c) => nearHome(game, c));
  const key = p ? `${p.id}:${p.seeds}` : '';
  if (key && key !== alarmKey) {
    const mate = meId >= 0 && allied(game.players[meId], p);
    banner(p.id === meId ? t('alarmMe') : t(mate ? 'alarmMate' : 'alarmOther', p.name), true);
    audio.play.siren();
  }
  // Stepping back out and in again does not repeat it; a new seed does.
  if (key || !game.players.some((c) => c.carrying)) alarmKey = key || '';
}

function updateHud() {
  watchCarrier();
  // The throw button is only there while this player has a seed to throw.
  $('throw').hidden = !(meId >= 0 && game.phase === 'playing' && game.players[meId].carrying);
  // The bonk button shows the wait for the next swing, and that there is none at home.
  const me = meId >= 0 && game.phase === 'playing' ? game.players[meId] : null;
  const cool = me ? Math.ceil((me.cooldown / BONK.cooldown) * 24) / 24 : 0;
  if (cool !== bonkCool) {
    bonkCool = cool;
    $('bonk').style.setProperty('--cool', cool);
  }
  $('bonk').classList.toggle('off', !!me && inHome(game, me));
  // Stepping onto a portal with a seed does nothing; say why, once per visit.
  const onPortal = !!me && me.carrying && game.map.warps.some((w) => Math.hypot(me.x - w.x, me.y - w.y) <= w.r);
  if (onPortal && !portalSaid) banner(t('portalNoSeed'), true);
  portalSaid = onPortal;
  if (!$('board').hidden) {
    const now = game.players.map((p) => `${p.kills},${p.deaths},${p.seeds},${p.supers},${p.throws},${p.stops}`).join();
    if (now !== boardKey) {
      boardKey = now;
      fillScores($('boardTable'));
    }
  }
  const key = game.players.map((p) => `${p.carrying ? 1 : 0}${wins[p.look]}`).join();
  if (key !== scoreKey) {
    scoreKey = key;
    $('scores').classList.toggle('many', game.players.length > 4);
    $('scores').replaceChildren(
      ...lineUp().map((p) => {
        const chip = document.createElement('span');
        chip.className = `chip${p.id === meId ? ' me' : ''}${p.carrying ? ' carry' : ''}`;
        chip.style.setProperty('--c', colorOf(p));
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
  // The clock is heard ticking all through overtime, twice a second.
  const beat = overtime && game.phase === 'playing' ? Math.floor(game.time * 2) : -1;
  if (beat !== tickBeat) {
    tickBeat = beat;
    if (beat >= 0) audio.play.tick(beat % 2);
  }
  $('clock').textContent = `${overtime ? `${t('overtimeClock')} ` : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  $('clock').classList.toggle('overtime', overtime);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // A round goes on while someone looks in on the lobby; it is only not drawn.
  if (!game) return;
  const away = $('stage').hidden;

  if (net.role === 'guest') {
    // Guests do not simulate the round: send the input, draw the latest snapshot.
    if (meId >= 0 && !paused) {
      const at = performance.now() / 1000;
      const i = input.read(game, meId);
      if (i.bonk && !bonkWas) bonkSeq++;
      bonkWas = i.bonk;
      const msg = { t: 'i', n: 0, mx: i.mx, my: i.my, ax: i.ax || 0, ay: i.ay || 0, seq: bonkSeq, th: i.throw ? 1 : 0, sk: i.stick ? 1 : 0 };
      const was = sentInput;
      const changed = !was || ['mx', 'my', 'ax', 'ay', 'seq', 'th', 'sk'].some((key) => msg[key] !== was[key]);
      // A change goes out at once; otherwise once a tick, which is all the host can use.
      if (net.host && (changed || at - sentAt > DT * 0.9)) {
        msg.n = was ? was.n + 1 : 1;
        net.host.fast(msg);
        predictor.sent(at, msg);
        sentInput = msg;
        sentAt = at;
      }
      playAhead(at);
    }
  } else if (paused) {
    acc = 0;
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
      // Events must get there. A plain snapshot is replaced by the next one anyway.
      if (msg.ev.length) broadcast(() => msg);
      else forEachGuest((conn) => (conn.fast && conn.fast(msg)) || conn.send(msg));
    }
  }
  if (away) return;
  renderer.draw(game, { dt, meId, bubbles });
  updateHud();
}

// Draws a guest's own hamster where its inputs have taken it by now, ahead of the
// snapshot, which only knows the ones that had reached the host.
function playAhead(at) {
  if (!net.snap) return;
  const me = game.players[meId];
  readPlayer(me, net.snap.p[meId]);
  const m = net.snap.st && net.snap.st[meId];
  const steer = m ? { lx: m[0], ly: m[1], at: m[2], px: m[3], py: m[4], turn: m[5] === 1 ? 'x' : m[5] === 2 ? 'y' : null } : null;
  net.mine = predictor.view(at, game, meId, steer);
  if (net.mine) Object.assign(me, net.mine);
  // The swing is heard and felt as the button goes down, not when the host says so.
  const now = !!(net.mine && net.mine.swing);
  if (now && !swinging) {
    audio.play.swing();
    haptics.buzz(12);
    swungAt = at;
  }
  swinging = now;
}

// ---------- handing the room over ----------

// The room lives in the host's browser, so handing it over means moving it: the
// host packs up everything the room remembers, with the friend's seat and its own
// swapped so the friend sits first, as a host does. The friend saves that and
// reloads as host of the same room id; the old host lets the id go and comes back
// as a guest, and everyone else reloads and rejoins, as when a host reloads.
// Only between rounds.
function handOver(seat) {
  const heir = slots[seat];
  if (net.role !== 'host' || game || !heir || heir.kind !== 'remote' || !heir.conn) return;
  if (!confirm(t('handOverAsk', heir.name))) return;
  const swap = (list) => {
    const out = [...list];
    [out[0], out[seat]] = [out[seat], out[0]];
    return out;
  };
  const seats = slots.map((s, i) => (i === 0 ? '' : s.kind === 'remote' ? s.said || s.name : s.held || ''));
  // The old host is due back in the friend's old seat, under its own name.
  seats[0] = slots[0].name;
  const pack = {
    room: net.room,
    pw: roomPw,
    teams: teamMode,
    map: mapId,
    wins: swap(wins),
    career: swap(career),
    owners: swap(owners),
    records,
    rounds,
    seasons,
    seats: swap(seats).map((name, i) => (i === 0 ? '' : name)),
    slots: swap(slots.map((s, i) => ({ kind: i === 0 || s.kind === 'remote' ? 'open' : s.kind, name: s.name, team: s.team }))).map((s, i) => (i === 0 ? { ...s, kind: 'human', name: heir.name } : s)),
  };
  net.handover = seat;
  net.status = t('handingOver', heir.name);
  $('profile').hidden = true;
  renderLobby();
  heir.conn.send({ t: 'handover', pack });
}

// The friend has the room's things: let the room's id go and come back as a guest.
function leaveForHeir() {
  const room = net.room;
  net.handover = -1;
  broadcast(() => ({ t: 'reload' }));
  try {
    sessionStorage.removeItem(ROOM_STORE);
    sessionStorage.setItem(REJOIN_STORE, String(Date.now() + 30000));
  } catch {
    // one try at the room, then
  }
  // Not a host any more: nothing to save or tell anyone on the way out.
  net.role = null;
  setTimeout(() => {
    if (net.close) net.close();
    location.href = `${location.pathname}?room=${room}`;
  }, 300);
}

// Handed the room: keep what it remembers as this browser's own, then reload as
// its host. The old host still holds the id for a moment; opening it is retried.
function becomeHost(pack) {
  if (!pack || typeof pack.room !== 'string' || !Array.isArray(pack.slots)) return;
  try {
    localStorage.setItem(STORE, JSON.stringify(pack.slots));
    localStorage.setItem(MODE_STORE, pack.teams ? '1' : '0');
    if (MAP_IDS.includes(pack.map)) localStorage.setItem(MAP_STORE, pack.map);
    sessionStorage.setItem(ROOM_STORE, JSON.stringify({ room: pack.room, wins: pack.wins, career: pack.career, rounds: pack.rounds, seasons: pack.seasons, pw: pack.pw, seats: pack.seats, owners: pack.owners, records: pack.records }));
  } catch {
    return;
  }
  net.status = t('becomingHost');
  renderLobby();
  net.host.send({ t: 'handoverOk' });
  setTimeout(() => (location.href = location.pathname), 600);
}

// A round cut short still counts for the ratings and the record: it is judged as
// if time had run out right then. The host decides who that is and tells the
// guests, so everybody signs the same result.
function settleCutShort() {
  if (!game || game.phase !== 'playing' || game.rated) return null;
  game.winners = timeoutWinners(game.players);
  game.stopped = true;
  rateRound();
  return game.winners;
}

// Calling the championship off and going back to round one. Nothing is wiped: the
// games played so far go into the list of past championships, marked as stopped
// with no champion, and a round in progress is abandoned. A reload carries on
// where it was, which is the point of it; this is the way to begin again.
// The room, its link and who sits where stay.
function resetSeries() {
  if (net.role === 'guest' || !confirm(t('resetAsk'))) return;
  if (game) {
    const ws = settleCutShort();
    broadcast(() => ({ t: 'lobbyscreen', ws }));
    toLobby();
  }
  if (rounds > 0) {
    seasons.push({
      games: rounds,
      stopped: true,
      rows: slots
        .map((s, look) => ({ name: s.name.trim() || defaultName(look), look, wins: wins[look], champ: false, in: isPlaying(s) || wins[look] > 0 }))
        .filter((r) => r.in)
        .sort((a, b) => b.wins - a.wins)
        .map(({ in: _, ...r }) => r),
    });
    seasons = seasons.slice(-10);
  }
  clearRecords();
  rounds = 0;
  saveRoom();
  renderLobby();
  sendLobby();
}

function toLobby() {
  clearTimeout(resultTimer);
  hideChampions();
  input.enable(false);
  game = null;
  show('lobby');
  announce();
}

// A room that could not be joined, or was lost, covers the whole page: what is
// behind it would be stale, so all there is to do is reload into the room or
// open a new one. Built here, so a page cached from before it existed gets one.
document.body.insertAdjacentHTML(
  'beforeend',
  '<div id="joinFail" hidden><div><p id="joinFailText"></p><button id="retryJoin" class="primary" data-i18n="retry"></button><button id="newRoom" data-i18n="newRoom"></button></div></div>',
);
// Out of a dead link and into a lobby of one's own, as its host.
$('newRoom').addEventListener('click', () => (location.href = location.pathname));
$('retryJoin').addEventListener('click', () => location.reload());
$('start').addEventListener('click', () => {
  audio.unlock();
  if (net.role === 'guest') enterRoom();
  else startGame();
});
let askedAt = 0;
$('again').addEventListener('click', () => {
  if (net.role !== 'guest') {
    startGame();
    return;
  }
  // Once every few seconds, so it cannot be used to flood the chat.
  if (performance.now() - askedAt < 3000) return;
  askedAt = performance.now();
  sendChat(t('askAgainLine'));
  // Say on the button itself that it went, and how: the line shows in the chat.
  $('again').textContent = t('askedAgain');
  setTimeout(() => net.role === 'guest' && ($('again').textContent = t('askAgain')), 3000);
});
$('resetBtn').addEventListener('click', resetSeries);
$('resetGame').addEventListener('click', resetSeries);
$('modeSolo').addEventListener('click', () => setTeamMode(false));
$('modeTeam').addEventListener('click', () => setTeamMode(true));
$('roomListBtn').addEventListener('click', toggleRoomList);
// "Add to home screen", in the lobby's menu and the round's settings. Opened from
// there the game runs full screen, without the browser's address bar. Android
// browsers can be asked to install it; iPhones only do it from the share menu,
// so there the button says how.
let installAsk = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installAsk = e;
});
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
$('feedbackBtn').insertAdjacentHTML('afterend', '<button id="installBtn"></button>');
$('boardBtn').insertAdjacentHTML('afterend', '<button id="installGameBtn"></button>');
document.body.insertAdjacentHTML(
  'beforeend',
  '<div id="installHelp" hidden><div class="card"><p id="installText"></p><button id="installOk" class="primary"></button></div></div>',
);
for (const id of ['installBtn', 'installGameBtn']) {
  $(id).textContent = t('installApp');
  $(id).hidden = installed();
  $(id).addEventListener('click', async () => {
    if (installAsk) {
      installAsk.prompt();
      installAsk = null;
      return;
    }
    $('installText').textContent = t('installHow');
    $('installOk').textContent = t('installOk');
    $('installHelp').hidden = false;
  });
}
$('installOk').addEventListener('click', () => ($('installHelp').hidden = true));
$('installHelp').addEventListener('click', (e) => e.target === $('installHelp') && ($('installHelp').hidden = true));

// The hamburger at the top right holds the ranking and the feedback board.
$('menuBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('menu').hidden = !$('menu').hidden;
});
document.addEventListener('click', () => ($('menu').hidden = true));
// Each has a page of its own. From inside a room it opens in a new tab, so the
// room is not left behind.
for (const [id, page] of [['rankBtn', 'ranking.html'], ['feedbackBtn', 'board.html']]) {
  $(id).addEventListener('click', () => {
    const pick = new URLSearchParams(location.search).get('lang');
    const url = pick ? `${page}?lang=${encodeURIComponent(pick)}` : page;
    if (net.role) window.open(url, '_blank');
    else location.href = url;
  });
}
$('listed').addEventListener('change', announce);
$('pwField').addEventListener('input', () => {
  roomPw = cleanPw($('pwField').value);
  renderLobby();
  sendLobby();
});
$('pwForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!net.host) return;
  net.pw = cleanPw($('pwInput').value);
  $('pwInput').value = '';
  sayHello();
  renderLobby();
});
for (const id of ['back', 'quit']) {
  $(id).addEventListener('click', () => {
    // A guest leaving goes back to its own offline lobby.
    if (net.role === 'guest') {
      location.href = location.pathname;
      return;
    }
    // Leaving a decided title early still closes the season.
    if (game && game.phase === 'over' && champions().length) {
      endSeason();
      return;
    }
    const ws = settleCutShort();
    broadcast(() => ({ t: 'lobbyscreen', ws }));
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
// Hold Tab to look at the scores mid-round; phones get a button that toggles them.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Tab' || $('stage').hidden) return;
  // Held down, Tab repeats: it must never move the focus around instead.
  if (tabResult || $('result').hidden) e.preventDefault();
  if (!$('result').hidden) return;
  if (game && game.phase === 'over') tabResult = reopenResult();
  else if ($('board').hidden) showBoard(true);
});
// Letting go of Tab puts the scores away again, the result card included when
// Tab is what brought it back.
const releaseTab = () => {
  showBoard(false);
  if (tabResult) $('result').hidden = true;
  tabResult = false;
};
window.addEventListener('keyup', (e) => e.code === 'Tab' && releaseTab());
window.addEventListener('blur', releaseTab);
// The score table has a button of its own in the top left corner of a round, as
// the settings have on the right; on a tall screen the wins live only in the table.
$('field').insertAdjacentHTML('beforeend', '<button id="scoreBtn"></button>');
// With a keyboard, it says Tab does the same.
$('scoreBtn').textContent = `${t('scoreBtn')}${matchMedia('(pointer: fine)').matches ? ' (Tab)' : ''}`;
$('scoreBtn').addEventListener('click', () => $('boardBtn').click());
$('boardBtn').addEventListener('click', () => {
  if (game && game.phase === 'over' && !$('result').hidden) $('result').hidden = true;
  else if (!reopenResult()) showBoard($('board').hidden);
});
$('resultClose').addEventListener('click', () => ($('result').hidden = true));
// Putting the card away shows the field again; the room still goes back to the
// lobby when the host's time is up, or at once when the host says so.
$('champClose').addEventListener('click', () => {
  cancelAnimationFrame(champFrame);
  $('champ').hidden = true;
});
$('champLobby').addEventListener('click', endSeason);
// A click on the dimmed map around the card also puts it away.
$('result').addEventListener('click', (e) => e.target === $('result') && ($('result').hidden = true));
// So does one on the bare strip beside or under the map, where a phone's screen runs past it.
$('stage').addEventListener('click', (e) => e.target === $('stage') && ($('result').hidden = true));
// It comes up under a thumb that may be on its way to another button: a tap that
// lands in its first moments was not meant for it.
let againAt = 0;
$('againBtn').addEventListener('click', () => performance.now() - againAt > 700 && startGame());
// On a tall screen the field buttons fold behind "⋯". Choosing one, or touching
// anywhere else, folds them away again.
// A gear, as settings are in most games. Set here too, for a page cached with the old dots.
$('toolsMore').textContent = '⚙️';
$('toolsMore').addEventListener('click', () => $('tools').classList.toggle('open'));
$('toolsMenu').addEventListener('click', () => $('tools').classList.remove('open'));
window.addEventListener('pointerdown', (e) => {
  if (!$('tools').contains(e.target)) $('tools').classList.remove('open');
});
$('board').addEventListener('click', () => showBoard(false));
// The scores lie over the map without blocking it, so a touch anywhere off them
// puts them away too.
window.addEventListener('pointerdown', (e) => {
  if (!$('board').hidden && !$('board').contains(e.target) && !$('boardBtn').contains(e.target) && e.target !== $('scoreBtn')) showBoard(false);
});
// The same sound button sits in the lobby and on the field.
const soundButtons = ['mute', 'muteLobby'].map($);
for (const b of soundButtons) {
  b.textContent = audio.icon();
  b.addEventListener('click', () => {
    audio.unlock();
    audio.toggle();
    for (const other of soundButtons) other.textContent = audio.icon();
  });
}
// Which thumb bonks is a matter of habit, so the phone remembers the chosen side.
const setBonkSide = (left) => document.body.classList.toggle('bonk-left', left);
try {
  setBonkSide(localStorage.getItem(SIDE_STORE) === '1');
} catch {
  // storage is blocked: the button stays on the right
}
$('swap').addEventListener('click', () => {
  const left = !document.body.classList.contains('bonk-left');
  setBonkSide(left);
  try {
    localStorage.setItem(SIDE_STORE, left ? '1' : '0');
  } catch {
    // not remembered, still swapped for this visit
  }
});
// A phone that can buzz gets a switch for it, and one that can hide the browser's
// bars a button for that: every strip of screen given back makes the hamsters bigger.
$('buzz').hidden = !haptics.supported;
const showBuzz = () => ($('buzz').textContent = haptics.enabled() ? '📳' : '📴');
showBuzz();
$('buzz').addEventListener('click', () => {
  if (haptics.toggle()) haptics.buzz(35);
  showBuzz();
});
$('full').hidden = !document.documentElement.requestFullscreen;
$('full').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
});
// Browsers only allow sound after a tap, and a guest never presses Start. Mobile
// browsers accept different events as the tap, so keep trying until sound is on.
const tapEvents = ['pointerdown', 'touchend', 'click', 'keydown'];
const tryUnlock = () => {
  audio.unlock();
  if (audio.ready()) for (const type of tapEvents) window.removeEventListener(type, tryUnlock, true);
};
for (const type of tapEvents) window.addEventListener(type, tryUnlock, true);
// Joining from the room list and leaving a room both load the page afresh, and a
// guest then has nothing to tap. A browser that remembers the tap on the page
// before lets sound start straight away; the others wait for the next tap as before.
tryUnlock();
// The context is suspended again when the tab comes back on some phones.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !audio.ready()) for (const type of tapEvents) window.addEventListener(type, tryUnlock, true);
});

// iOS ignores user-scalable=no, so stop pinch and double-tap zoom by hand: a zoomed-in
// page cannot be zoomed back out mid-game.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false },
);
let lastTouchEnd = 0;
document.addEventListener(
  'touchend',
  (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 350 && !e.target.closest('input, select')) e.preventDefault();
    lastTouchEnd = now;
  },
  { passive: false },
);
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
// iOS browsers go back a page on a swipe in from the screen's edge, which would
// drop you out of the round. Mid-game an edge touch is kept from starting one, and
// a back that gets through anyway lands on this same page.
document.addEventListener(
  'touchstart',
  (e) => {
    if ($('stage').hidden || e.target.closest('button, input, select, a')) return;
    const x = e.changedTouches[0].clientX;
    if (x < 30 || x > innerWidth - 30) e.preventDefault();
  },
  { passive: false },
);
window.addEventListener('popstate', () => !$('stage').hidden && window.history.pushState({ stage: true }, ''));
// Mashing the bonk button must never count as a double tap.
$('bonk').addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
window.addEventListener('resize', () => renderer.resize());
document.addEventListener('visibilitychange', () => {
  acc = 0;
});

// ---------- updates ----------

// The service worker makes every page load fetch the latest deploy. A page that is
// already open is never reloaded, since that would end a round or close a room;
// instead the lobby offers a button once a newer version is out.
const seenTags = new Map();
let lastCheck = -Infinity;

async function checkUpdate() {
  if (performance.now() - lastCheck < 60000 || !$('updateBtn').hidden) return;
  lastCheck = performance.now();
  const files = performance
    .getEntriesByType('resource')
    .map((e) => e.name)
    .filter((url) => url.startsWith(location.origin) && /\.(js|css)(\?|$)/.test(url));
  try {
    for (const url of new Set([location.origin + location.pathname, ...files])) {
      const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      const tag = res.ok && (res.headers.get('etag') || res.headers.get('last-modified'));
      if (!tag) continue;
      if (!seenTags.has(url)) seenTags.set(url, tag);
      else if (seenTags.get(url) !== tag) $('updateBtn').hidden = false;
    }
  } catch {
    // offline: try again later
  }
}
setInterval(() => {
  if (!document.hidden && !$('lobby').hidden) checkUpdate();
}, 180000);
$('updateBtn').addEventListener('click', () => {
  // A host takes the whole room along, so it is asked first.
  const shared = net.role === 'host' && (net.watchers.length > 0 || slots.some((s) => s.conn));
  if (!shared || confirm(t('updateLeave'))) location.reload();
});
// However a host's page goes away to be loaded again, the room is noted down and
// everyone in it is told to reload too. (A tab that is closed for good tells them
// the same; they knock at the room for a while and then say it cannot be found.)
window.addEventListener('pagehide', () => {
  // Leaving for good, not reloading: friends are not told to wait for this room.
  if (net.role !== 'host' || leaving) return;
  saveRoom();
  broadcast(() => ({ t: 'reload' }));
});
// Reloading in the middle of a round with friends in it loses the round: ask.
window.addEventListener('beforeunload', (e) => {
  if (net.role !== 'host' || !game || game.phase === 'over' || !slots.some((s) => s.conn)) return;
  e.preventDefault();
  e.returnValue = '';
});

if ('serviceWorker' in navigator) {
  // The first visit loads before the worker is in charge and may have run cached
  // scripts. Nothing has happened yet at that point, so load once more through it.
  const fresh = !navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (fresh && performance.now() < 8000 && !game) location.reload();
  });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

localizePage();
// The room exists from the start, so the invite link is always there to share.
restoreRoom();
if (!joinId) openRoom();
renderLobby();
show('lobby');
if (net.role === 'guest') {
  // Straight after reloading along with the host, the room may not be back yet.
  let until = 0;
  try {
    until = Number(sessionStorage.getItem(REJOIN_STORE)) || 0;
    sessionStorage.removeItem(REJOIN_STORE);
  } catch {
    // one try
  }
  enterRoom(until);
}
requestAnimationFrame((now) => {
  last = now;
  frame(now);
});
