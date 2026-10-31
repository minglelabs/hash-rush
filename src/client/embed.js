// Inside the mingle app (HashChat) the game runs in an iframe. The app opens the
// page with ?embed=1 beside the game server, the chat room's room and the app's
// entry ticket, and the two talk through window.postMessage. Every message is
// { source, type, ... }, and both sides follow one table (the mingle app's
// docs/hash-rush-in-app-uiux.md):
//
//   game -> app   { source: 'hash-rush', type: 'ready', version: 1 }
//                 { source: 'hash-rush', type: 'keyboard', open: true | false }
//                 { source: 'hash-rush', type: 'phase', phase: 'lobby' | 'round' | 'results' }
//   app -> game   { source: 'hashchat', type: 'visibility', visible: true | false }
//                 { source: 'hashchat', type: 'voice', active: true | false }
//                 { source: 'hashchat', type: 'chat', id, userId, text }
//
// The talk is the chat room's own: inside the app the game's chat does not show,
// and what somebody says in the room (`text`, in the reader's language, or as it
// was said until a translation is in) goes up in the bubble over their hamster.
// The same `id` again is that message, translated.

export const FROM_APP = 'hashchat';
export const FROM_GAME = 'hash-rush';
export const VERSION = 1;
export const PHASES = ['lobby', 'round', 'results'];
// The longest id, user id and text a chat message is taken with: longer words are
// cut down to it, and a longer id is no id.
export const CHAT_MAX = 300;
// A bubble holds as much as a line of the game's own chat could (chatbar.js).
export const BUBBLE_MAX = 80;

// The first `n` characters of `text`, never half an emoji.
const cut = (text, n) => (text.length <= n ? text : text.slice(0, /[\uD800-\uDBFF]/.test(text[n - 1]) ? n - 1 : n));
const anId = (v) => typeof v === 'string' && v.trim() !== '' && v.length <= CHAT_MAX;

// Only a page the app opened is embedded: embed=1 with a game server, a room and
// a ticket. `server` is the address as net.js's gameServer() checked it.
export function embedMode(query, server) {
  const given = (name) => String(query.get(name) || '').trim() !== '';
  return query.get('embed') === '1' && !!server && given('room') && given('ticket');
}

// What the app said, or null. Anything from another window than the one holding
// this page, from anyone but the app, or not in the table is dropped.
export function readAppMessage(event, parent) {
  if (!event || !parent || event.source !== parent) return null;
  const data = event.data;
  if (!data || typeof data !== 'object' || data.source !== FROM_APP) return null;
  if (data.type === 'visibility' && typeof data.visible === 'boolean') return { type: 'visibility', visible: data.visible };
  if (data.type === 'voice' && typeof data.active === 'boolean') return { type: 'voice', active: data.active };
  if (data.type === 'chat' && anId(data.id) && anId(data.userId) && typeof data.text === 'string') {
    const text = cut(data.text.replace(/\s+/g, ' ').trim(), CHAT_MAX).trimEnd();
    return text ? { type: 'chat', id: data.id, userId: data.userId, text } : null;
  }
  return null;
}

// The seat a mingle user sits in, by the lobby's seats (each with the userId the
// server took from its ticket), or -1: not in a seat, or nobody to look for.
export function seatOf(seats, userId) {
  if (!Array.isArray(seats) || typeof userId !== 'string' || !userId) return -1;
  return seats.findIndex((seat) => !!seat && seat.kind === 'remote' && seat.userId === userId);
}

// How many message ids are kept, to tell a translation from a new message.
const HEARD_MAX = 200;

// Puts the chat room's talk in the bubbles over the hamsters that the game's own
// chat used (main.js's `bubbles`: seat -> { name, text, until }), so it has the
// same look and the same time to be read: `life(text)` ms from when the words go
// up. `say(seats, { id, userId, text }, now)` returns the seat whose bubble
// changed, or -1. A message heard again under its id is its translation come in:
// only its words change, while its bubble is still up and no newer one has taken
// its place.
export function createChatBubbles(bubbles, life) {
  // Each message id heard, with the seat it went up over (-1: none).
  const heard = new Map();
  return function say(seats, { id, userId, text }, now) {
    const words = text.length > BUBBLE_MAX ? `${cut(text, BUBBLE_MAX - 1).trimEnd()}…` : text;
    if (heard.has(id)) {
      const seat = heard.get(id);
      const up = bubbles.get(seat);
      if (!up || up.id !== id || up.until <= now || up.text === words) return -1;
      bubbles.set(seat, { ...up, text: words, until: now + life(words) });
      return seat;
    }
    const seat = seatOf(seats, userId);
    heard.set(id, seat);
    if (heard.size > HEARD_MAX) heard.delete(heard.keys().next().value);
    if (seat < 0) return -1;
    bubbles.set(seat, { id, name: String(seats[seat].name || ''), text: words, until: now + life(words) });
    return seat;
  };
}

// Where the room stands, as the app hears it: no round, a round on, or its result.
export const phaseOf = (game) => (!game ? 'lobby' : game.phase === 'over' ? 'results' : 'round');

// Whether focus on `el` brings up a keyboard: a text box, not a checkbox or a
// field that cannot be typed in.
const TEXT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);
export function bringsKeyboard(el) {
  if (!el || el.disabled || el.readOnly) return false;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && TEXT_TYPES.has(String(el.type || 'text').toLowerCase());
}

// Connects the page to the app around it. `on.visibility(visible)`,
// `on.voice(active)` and `on.chat({ id, userId, text })` hear the app. The
// functions returned tell the app things, each only when it changes, and nothing
// before `ready`: what changed before then goes out right after it. A page that
// no window holds has nobody to tell.
export function connectApp(win, on) {
  const parent = win.parent && win.parent !== win ? win.parent : null;
  const post = (type, fields) => parent && parent.postMessage({ source: FROM_GAME, type, ...fields }, '*');
  if (parent)
    win.addEventListener('message', (event) => {
      const msg = readAppMessage(event, parent);
      if (msg?.type === 'visibility') on.visibility(msg.visible);
      else if (msg?.type === 'voice') on.voice(msg.active);
      else if (msg?.type === 'chat') on.chat?.({ id: msg.id, userId: msg.userId, text: msg.text });
    });
  let ready = false;
  let phase = '';
  let keyboard = false;
  return {
    ready() {
      if (ready) return;
      ready = true;
      post('ready', { version: VERSION });
      if (phase) post('phase', { phase });
      if (keyboard) post('keyboard', { open: true });
    },
    phase(next) {
      if (!PHASES.includes(next) || next === phase) return;
      phase = next;
      if (ready) post('phase', { phase });
    },
    keyboard(open) {
      if (!!open === keyboard) return;
      keyboard = !!open;
      if (ready) post('keyboard', { open: keyboard });
    },
  };
}
