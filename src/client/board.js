// The feedback board: posts anyone can leave, with comments and likes. Like the
// ratings it lives on the public broker as retained messages, each signed with
// the writer's key so nobody can post under somebody else's.

import { identity, publish, read, write, heal } from './rank.js';
import { openBrokers } from './net.js';
import { pidOf, verify } from './rating.js';
import { t } from './i18n.js';

const TOPIC = 'minglelabs/hash-rush/v1/board';
const PID = /^[A-Za-z0-9_-]{16}$/;
const ID = /^[a-z0-9]{1,20}$/;
const POST_MAX = 500;
const COMMENT_MAX = 200;

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- the broker ----------

// What this browser has seen on the board, kept as it came: { topic: payload }.
// The public brokers forget what they hold now and then (the board was emptied
// once, as the ranking was); whatever any one browser kept, it puts back.
const SEEN_STORE = 'hashrush.boardSeen';
const SEEN_MAX = 1500;

// Everything on the board, checked: posts newest first, each with its comments
// oldest first and its likes. Rejects if no broker can be reached.
async function loadBoard() {
  const clients = await openBrokers();
  const raw = new Map();
  const text = new Map();
  const had = clients.map(() => new Map());
  const heard = (topic, payload) => {
    if (!topic.startsWith(`${TOPIC}/`)) return;
    const said = payload.toString();
    let data;
    try {
      data = JSON.parse(said);
    } catch {
      return;
    }
    if (typeof data.b !== 'string' || typeof data.s !== 'string') return;
    // The same message off two brokers is one message; a changed like keeps the newest.
    const was = raw.get(topic);
    if (!was || stamp(data) > stamp(was)) {
      raw.set(topic, data);
      text.set(topic, said);
    }
  };
  for (const [topic, payload] of Object.entries(read(SEEN_STORE, {}))) heard(topic, payload);
  await Promise.all(
    clients.map((c, i) => {
      c.on('message', (topic, payload) => {
        had[i].set(topic, payload.toString());
        heard(topic, payload);
      });
      return new Promise((resolve) => c.subscribe(`${TOPIC}/#`, () => setTimeout(resolve, 2500)));
    }),
  );

  const posts = new Map();
  const comments = [];
  const likes = [];
  const good = [];
  for (const [topic, data] of raw) {
    const parts = topic.slice(TOPIC.length + 1).split('/');
    const body = await checked(parts, data);
    if (!body) continue;
    good.push(topic);
    if (parts[0] === 'p') posts.set(`${parts[1]}/${parts[2]}`, { ...body, key: `${parts[1]}/${parts[2]}`, comments: [], likes: new Set() });
    else if (parts[0] === 'c') comments.push({ ...body, post: `${parts[1]}/${parts[2]}` });
    else if (body.on) likes.push({ pid: parts[3], post: `${parts[1]}/${parts[2]}` });
  }
  for (const c of comments) posts.get(c.post)?.comments.push(c);
  for (const l of likes) posts.get(l.post)?.likes.add(l.pid);
  for (const p of posts.values()) p.comments.sort((a, b) => a.at - b.at);
  // What checked out is kept here and put back on whichever broker lacks it.
  const kept = good.sort((a, b) => stamp(raw.get(a)) - stamp(raw.get(b))).slice(-SEEN_MAX);
  write(SEEN_STORE, Object.fromEntries(kept.map((topic) => [topic, text.get(topic)])));
  heal(clients, had, kept.map((topic) => [topic, text.get(topic)]));
  return [...posts.values()].sort((a, b) => b.at - a.at);
}

function stamp(data) {
  try {
    return Number(JSON.parse(data.b).at) || 0;
  } catch {
    return 0;
  }
}

// A message counts if it sits under its writer's key and that key signed it.
// Topics: p/<pid>/<id>, c/<post pid>/<post id>/<pid>/<id>, l/<post pid>/<post id>/<pid>.
async function checked(parts, { b, s }) {
  const shape = { p: 3, c: 5, l: 4 }[parts[0]];
  if (parts.length !== shape || !PID.test(parts[1]) || !ID.test(parts[2])) return null;
  const pid = parts[0] === 'p' ? parts[1] : parts[3];
  if (!PID.test(pid) || (parts[0] === 'c' && !ID.test(parts[4]))) return null;
  let body;
  try {
    body = JSON.parse(b);
  } catch {
    return null;
  }
  if (!body || body.pid !== pid || typeof body.pub !== 'string' || body.k !== parts[0]) return null;
  if ((await pidOf(body.pub)) !== pid || !(await verify(body.pub, b, s))) return null;
  return {
    pid,
    at: Number(body.at) || 0,
    name: String(body.name || '?').slice(0, 8),
    text: String(body.text || '').slice(0, parts[0] === 'p' ? POST_MAX : COMMENT_MAX),
    on: !!body.on,
  };
}

async function put(topic, fields) {
  const me = await identity();
  if (!me) throw new Error('no key');
  const body = JSON.stringify({ ...fields, pid: me.pid, pub: me.pub, at: Date.now() });
  await publish(`${TOPIC}/${topic(me.pid)}`, JSON.stringify({ b: body, s: await me.sign(body) }));
  return { pid: me.pid, at: JSON.parse(body).at };
}

// ---------- the page ----------

const $ = (id) => document.getElementById(id);
let posts = [];
let myPid = '';
let nameOf = () => '';
let ask = 0;

const when = (at) => {
  const d = new Date(at);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// A text box and a button that sends what is in it, then clears it.
function composer(placeholder, max, multi, send) {
  const form = el('form', 'boardForm');
  const field = el(multi ? 'textarea' : 'input');
  field.placeholder = placeholder;
  field.maxLength = max;
  const go = el('button', 'primary', t(multi ? 'boardPost' : 'boardReply'));
  form.append(field, go);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = field.value.trim();
    if (!text || go.disabled) return;
    go.disabled = true;
    try {
      await send(text);
      field.value = '';
    } catch {
      $('boardStatus').textContent = t('boardSendFail');
    }
    go.disabled = false;
  });
  return form;
}

function render() {
  const list = $('boardList');
  list.textContent = '';
  for (const p of posts) {
    const li = el('li');
    const head = el('div', 'boardHead');
    head.append(el('b', '', p.name), el('time', '', when(p.at)));
    const liked = p.likes.has(myPid);
    const like = el('button', liked ? 'liked' : '', `${liked ? '❤️' : '🤍'} ${p.likes.size}`);
    like.addEventListener('click', async () => {
      like.disabled = true;
      try {
        const { pid } = await put((me) => `l/${p.key}/${me}`, { k: 'l', on: !liked });
        if (liked) p.likes.delete(pid);
        else p.likes.add(pid);
        render();
      } catch {
        like.disabled = false;
        $('boardStatus').textContent = t('boardSendFail');
      }
    });
    const talk = el('button', '', `💬 ${p.comments.length}`);
    const thread = el('div', 'boardThread');
    thread.hidden = !p.open;
    talk.addEventListener('click', () => {
      p.open = !p.open;
      thread.hidden = !p.open;
    });
    for (const c of p.comments) {
      const line = el('p');
      line.append(el('b', '', c.name), ` ${c.text} `, el('time', '', when(c.at)));
      thread.append(line);
    }
    thread.append(
      composer(t('boardCommentHint'), COMMENT_MAX, false, async (text) => {
        const name = nameOf();
        const id = newId();
        const { pid, at } = await put((me) => `c/${p.key}/${me}/${id}`, { k: 'c', name, text });
        p.comments.push({ pid, at, name, text });
        p.open = true;
        render();
      }),
    );
    const acts = el('div', 'boardActs');
    acts.append(like, talk);
    li.append(head, el('p', 'boardText', p.text), acts, thread);
    list.append(li);
  }
}

// Fills the board page, reading the board fresh. `name` gives the name to sign with.
export function openBoard(name) {
  nameOf = name;
  const form = $('boardCompose');
  form.replaceChildren(
    composer(t('boardHint'), POST_MAX, true, async (text) => {
      const name = nameOf();
      const id = newId();
      const { pid, at } = await put((me) => `p/${me}/${id}`, { k: 'p', name, text });
      posts.unshift({ key: `${pid}/${id}`, pid, at, name, text, comments: [], likes: new Set() });
      $('boardStatus').textContent = '';
      render();
    }),
  );
  $('boardStatus').textContent = t('boardLoading');
  const mine = ++ask;
  identity().then((me) => (myPid = me ? me.pid : ''));
  loadBoard()
    .then((got) => {
      if (mine !== ask) return;
      posts = got;
      $('boardStatus').textContent = posts.length ? '' : t('boardEmpty');
      render();
    })
    .catch(() => ($('boardStatus').textContent = t('boardFail')));
}
