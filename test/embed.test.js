import test from 'node:test';
import assert from 'node:assert/strict';
import { embedMode, readAppMessage, phaseOf, bringsKeyboard, connectApp, FROM_APP, FROM_GAME } from '../src/client/embed.js';

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
  const app = connectApp(win, { visibility: (v) => heard.push(['visibility', v]), voice: (v) => heard.push(['voice', v]) });
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
  assert.deepEqual(heard, [['visibility', false], ['voice', true], ['visibility', true]]);
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
