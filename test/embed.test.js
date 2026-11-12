import test from 'node:test';
import assert from 'node:assert/strict';
import { embedMode, readAppMessage, phaseOf, bringsKeyboard, connectApp, seatOf, createChatBubbles, FROM_APP, FROM_GAME, CHAT_MAX, BUBBLE_MAX } from '../src/client/embed.js';

const SERVER = 'wss://game.example.com';
const page = (search) => new URLSearchParams(search);

test('a page is embedded only with embed=1, a game server, a room and a ticket', () => {
  const full = 'embed=1&server=wss://game.example.com&room=mingle-42&ticket=abc.def&name=Mia&lang=ko';
  assert.equal(embedMode(page(full), SERVER), true);
  // The server address is the one net.js checked: none means peer-to-peer, never embedded.
  assert.equal(embedMode(page(full), ''), false);
  assert.equal(embedMode(page(full.replace('embed=1', 'embed=0')), SERVER), false);
  assert.equal(embedMode(page(full.replace('embed=1', 'embed=true')), SERVER), false);
  assert.equal(embedMode(page(full.replace('embed=1&', '')), SERVER), false);
  assert.equal(embedMode(page(full.replace('room=mingle-42&', '')), SERVER), false);
  assert.equal(embedMode(page(full.replace('ticket=abc.def&', '')), SERVER), false);
  assert.equal(embedMode(page(full.replace('ticket=abc.def', 'ticket=%20')), SERVER), false);
  assert.equal(embedMode(page('room=abc234'), ''), false);
});

test('only the app, from the window holding the page, is heard, and only what the table has', () => {
  const parent = {};
  const other = {};
  const from = (source, data) => readAppMessage({ source, data }, parent);
  assert.deepEqual(from(parent, { source: FROM_APP, type: 'visibility', visible: false }), { type: 'visibility', visible: false });
  assert.deepEqual(from(parent, { source: FROM_APP, type: 'visibility', visible: true }), { type: 'visibility', visible: true });
  assert.deepEqual(from(parent, { source: FROM_APP, type: 'voice', active: true, extra: 1 }), { type: 'voice', active: true });
  // Another window, or a page talking to itself.
  assert.equal(from(other, { source: FROM_APP, type: 'voice', active: true }), null);
  assert.equal(from(null, { source: FROM_APP, type: 'voice', active: true }), null);
  assert.equal(readAppMessage({ source: parent, data: { source: FROM_APP, type: 'voice', active: true } }, null), null);
  // Not from the app, or not as the table has it.
  assert.equal(from(parent, { source: FROM_GAME, type: 'voice', active: true }), null);
  assert.equal(from(parent, { type: 'voice', active: true }), null);
  assert.equal(from(parent, { source: FROM_APP, type: 'voice', active: 'true' }), null);
  assert.equal(from(parent, { source: FROM_APP, type: 'visibility', visible: 0 }), null);
  assert.equal(from(parent, { source: FROM_APP, type: 'visibility' }), null);
  assert.equal(from(parent, { source: FROM_APP, type: 'reload' }), null);
  assert.equal(from(parent, 'hashchat'), null);
  assert.equal(from(parent, null), null);
  assert.equal(readAppMessage(null, parent), null);
});

test("a chat message from the app is its id, its speaker's user id and its words, kept short", () => {
  const parent = {};
  const from = (source, data) => readAppMessage({ source, data }, parent);
  const chat = (fields) => from(parent, { source: FROM_APP, type: 'chat', id: 'm1', userId: 'u1', text: 'hi', ...fields });
  assert.deepEqual(chat({ extra: 1 }), { type: 'chat', id: 'm1', userId: 'u1', text: 'hi' });
  // On one line, without the spaces around it.
  assert.deepEqual(chat({ text: '  good\n\n game  ' }).text, 'good game');
  // Longer words are cut, never through an emoji; an id that long is no id.
  assert.equal(chat({ text: 'a'.repeat(CHAT_MAX + 50) }).text.length, CHAT_MAX);
  assert.equal(chat({ text: `${'a'.repeat(CHAT_MAX - 1)}😀` }).text, 'a'.repeat(CHAT_MAX - 1));
  assert.equal(chat({ id: 'm'.repeat(CHAT_MAX) }).id.length, CHAT_MAX);
  assert.equal(chat({ id: 'm'.repeat(CHAT_MAX + 1) }), null);
  assert.equal(chat({ userId: 'u'.repeat(CHAT_MAX + 1) }), null);
  // Every part a string with something in it.
  for (const bad of [{ id: '' }, { id: '  ' }, { id: 7 }, { id: undefined }, { userId: '' }, { userId: null }, { userId: 42 }, { text: '' }, { text: ' \n ' }, { text: 5 }, { text: null }, { text: ['hi'] }])
    assert.equal(chat(bad), null, JSON.stringify(bad));
  // From anyone but the app in the window holding the page, nothing.
  assert.equal(from({}, { source: FROM_APP, type: 'chat', id: 'm1', userId: 'u1', text: 'hi' }), null);
  assert.equal(from(parent, { source: FROM_GAME, type: 'chat', id: 'm1', userId: 'u1', text: 'hi' }), null);
});

test('a mingle user is found in the seat the server says they sit in, and nobody else is', () => {
  const seats = [
    { kind: 'remote', name: 'Mia', userId: 'u1' },
    { kind: 'bot:hard', name: 'Cloud', userId: '' },
    { kind: 'open', name: 'Choco', userId: 'u3' },
    { kind: 'remote', name: 'Bo', userId: 'u2' },
    { kind: 'remote', name: 'Ann', userId: '' },
    { kind: 'remote', name: 'Bo2', userId: 'u2' },
  ];
  assert.equal(seatOf(seats, 'u1'), 0);
  assert.equal(seatOf(seats, 'u2'), 3);
  // A seat nobody sits in is nobody's, whatever it says.
  assert.equal(seatOf(seats, 'u3'), -1);
  assert.equal(seatOf(seats, 'u9'), -1);
  // A person without a ticket has no user to be found by.
  assert.equal(seatOf(seats, ''), -1);
  assert.equal(seatOf(seats, undefined), -1);
  // No lobby heard yet, or a lobby from before seats had users.
  assert.equal(seatOf(null, 'u1'), -1);
  assert.equal(seatOf([{ kind: 'remote', name: 'Mia' }, null], 'u1'), -1);
});

test("the chat room's talk goes up over the speaker's hamster, and its translation only changes the words", () => {
  const bubbles = new Map();
  const life = (text) => 1000 + text.length;
  const say = createChatBubbles(bubbles, life);
  const seats = [
    { kind: 'remote', name: 'Mia', userId: 'u1' },
    { kind: 'bot:hard', name: 'Cloud', userId: '' },
    { kind: 'remote', name: 'Bo', userId: 'u2' },
  ];
  assert.equal(say(seats, { id: 'm1', userId: 'u2', text: 'hola' }, 0), 2);
  assert.deepEqual(bubbles.get(2), { id: 'm1', name: 'Bo', text: 'hola', until: 1004 });
  // The translation: the same bubble with new words, and the time to read them from now.
  assert.equal(say(seats, { id: 'm1', userId: 'u2', text: 'hello there' }, 500), 2);
  assert.deepEqual(bubbles.get(2), { id: 'm1', name: 'Bo', text: 'hello there', until: 1511 });
  // The same words again change nothing.
  assert.equal(say(seats, { id: 'm1', userId: 'u2', text: 'hello there' }, 600), -1);
  assert.equal(bubbles.get(2).until, 1511);
  // A newer message takes the bubble; the older one's translation, come late, does not take it back.
  assert.equal(say(seats, { id: 'm2', userId: 'u2', text: 'gg' }, 700), 2);
  assert.equal(say(seats, { id: 'm1', userId: 'u2', text: 'hello again' }, 800), -1);
  assert.deepEqual(bubbles.get(2), { id: 'm2', name: 'Bo', text: 'gg', until: 1702 });
  // Once a bubble is gone, its translation does not bring it back.
  assert.equal(say(seats, { id: 'm2', userId: 'u2', text: 'good game' }, 1702), -1);
  assert.equal(bubbles.get(2).text, 'gg');
  // Each speaker has a bubble of their own.
  assert.equal(say(seats, { id: 'm3', userId: 'u1', text: 'ok' }, 1800), 0);
  assert.equal(bubbles.get(0).name, 'Mia');
  assert.equal(bubbles.size, 2);

  // Somebody not in a seat says nothing over any hamster, nor does the translation once they sit down.
  assert.equal(say(seats, { id: 'm4', userId: 'u9', text: 'hi' }, 1900), -1);
  seats[1] = { kind: 'remote', name: 'Zed', userId: 'u9' };
  assert.equal(say(seats, { id: 'm4', userId: 'u9', text: 'hi!' }, 1910), -1);
  assert.equal(say(seats, { id: 'm5', userId: 'u9', text: 'hey' }, 1920), 1);
  assert.equal(bubbles.get(1).name, 'Zed');
  // Nothing to place anyone by before the lobby is heard.
  assert.equal(say(null, { id: 'm6', userId: 'u1', text: 'early' }, 1930), -1);

  // A long message is cut to what a bubble holds, and shows it was.
  say(seats, { id: 'm7', userId: 'u1', text: 'x'.repeat(200) }, 2000);
  assert.equal(bubbles.get(0).text, `${'x'.repeat(BUBBLE_MAX - 1)}…`);
  assert.equal(bubbles.get(0).until, 2000 + 1000 + BUBBLE_MAX);
  say(seats, { id: 'm8', userId: 'u1', text: 'y'.repeat(BUBBLE_MAX) }, 2000);
  assert.equal(bubbles.get(0).text, 'y'.repeat(BUBBLE_MAX));
});

test('the room is in the lobby, in a round or at its result', () => {
  assert.equal(phaseOf(null), 'lobby');
  assert.equal(phaseOf({ phase: 'countdown' }), 'round');
  assert.equal(phaseOf({ phase: 'playing' }), 'round');
  assert.equal(phaseOf({ phase: 'over' }), 'results');
});

test('a text box brings up a keyboard; a checkbox, a locked field or nothing does not', () => {
  assert.equal(bringsKeyboard({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(bringsKeyboard({ tagName: 'INPUT' }), true);
  assert.equal(bringsKeyboard({ tagName: 'INPUT', type: 'search' }), true);
  assert.equal(bringsKeyboard({ tagName: 'TEXTAREA' }), true);
  assert.equal(bringsKeyboard({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(bringsKeyboard({ tagName: 'INPUT', type: 'text', readOnly: true }), false);
  assert.equal(bringsKeyboard({ tagName: 'INPUT', type: 'text', disabled: true }), false);
  assert.equal(bringsKeyboard({ tagName: 'BUTTON' }), false);
  assert.equal(bringsKeyboard({ tagName: 'BODY' }), false);
  assert.equal(bringsKeyboard(null), false);
});

// A stand-in for the iframe's window and the app's window around it.
function frame() {
  const listeners = [];
  const sent = [];
  const parent = { postMessage: (data, origin) => sent.push({ data, origin }) };
  const win = { parent, addEventListener: (type, fn) => type === 'message' && listeners.push(fn) };
  const heard = [];
  const app = connectApp(win, { visibility: (v) => heard.push(['visibility', v]), voice: (v) => heard.push(['voice', v]), chat: (v) => heard.push(['chat', v]) });
  const fire = (source, data) => listeners.forEach((fn) => fn({ source, data }));
  return { app, parent, sent, heard, fire, listeners };
}

test("the app's messages reach the page, and nobody else's do", () => {
  const { parent, heard, fire } = frame();
  fire(parent, { source: FROM_APP, type: 'visibility', visible: false });
  fire(parent, { source: FROM_APP, type: 'voice', active: true });
  fire({}, { source: FROM_APP, type: 'voice', active: false });
  fire(parent, { source: 'someone', type: 'visibility', visible: true });
  fire(parent, { source: FROM_APP, type: 'visibility', visible: 'yes' });
  fire(parent, { source: FROM_APP, type: 'visibility', visible: true });
  fire(parent, { source: FROM_APP, type: 'chat', id: 'm1', userId: 'u1', text: ' hi ' });
  fire({}, { source: FROM_APP, type: 'chat', id: 'm2', userId: 'u1', text: 'hi' });
  fire(parent, { source: FROM_APP, type: 'chat', id: 'm3', userId: 'u1', text: 3 });
  assert.deepEqual(heard, [['visibility', false], ['voice', true], ['visibility', true], ['chat', { id: 'm1', userId: 'u1', text: 'hi' }]]);
});

test("a page that does not listen for chat lets the app's chat pass", () => {
  const listeners = [];
  const parent = { postMessage() {} };
  connectApp({ parent, addEventListener: (type, fn) => listeners.push(fn) }, { visibility() {}, voice() {} });
  assert.doesNotThrow(() => listeners.forEach((fn) => fn({ source: parent, data: { source: FROM_APP, type: 'chat', id: 'm1', userId: 'u1', text: 'hi' } })));
});

test('the page says ready once, then each phase and keyboard change once, to any origin', () => {
  const { app, sent } = frame();
  // Before ready nothing goes out; the phase reached by then follows ready.
  app.phase('lobby');
  assert.deepEqual(sent, []);
  app.ready();
  app.ready();
  app.phase('lobby');
  app.phase('round');
  app.phase('round');
  app.phase('paused');
  app.keyboard(false);
  app.keyboard(true);
  app.keyboard(true);
  app.keyboard(false);
  app.phase('results');
  app.phase('lobby');
  assert.deepEqual(
    sent.map((m) => m.data),
    [
      { source: FROM_GAME, type: 'ready', version: 1 },
      { source: FROM_GAME, type: 'phase', phase: 'lobby' },
      { source: FROM_GAME, type: 'phase', phase: 'round' },
      { source: FROM_GAME, type: 'keyboard', open: true },
      { source: FROM_GAME, type: 'keyboard', open: false },
      { source: FROM_GAME, type: 'phase', phase: 'results' },
      { source: FROM_GAME, type: 'phase', phase: 'lobby' },
    ],
  );
  assert.ok(sent.every((m) => m.origin === '*'));
});

test('a page that no window holds tells nobody and hears nothing', () => {
  const listeners = [];
  const win = { addEventListener: (type, fn) => listeners.push(fn) };
  win.parent = win;
  const app = connectApp(win, { visibility: () => assert.fail('heard'), voice: () => assert.fail('heard') });
  app.ready();
  app.phase('round');
  app.keyboard(true);
  assert.equal(listeners.length, 0);
});
