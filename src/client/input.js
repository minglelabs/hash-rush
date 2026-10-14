// Turns keyboard, mouse and touch into the per-tick input object the simulation
// expects. Mouse clicks work like an RTS right-click: walk there, or chase and bonk
// the hamster that was clicked. A tap on a phone's map is the same click.

import { BONK } from '../sim/constants.js';
import { inHome, allied } from '../sim/game.js';
import { segmentClear } from '../sim/map.js';
import { predictSwing } from '../ai/bot.js';

export const KEYS = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  bonk: ['Space', 'KeyJ'],
  // A key of its own, next to each hand's bonk: holding the bonk key only bonks.
  throw: ['KeyF', 'KeyK'],
};
const HANDLED = new Set(Object.values(KEYS).flat());
// Past this the hamster runs flat out, the way a held arrow key does.
const STICK_DEAD = 8;
// Lanes run along the axes, so a push counts as straight unless it is this close
// to a true diagonal.
const DIAGONAL = (15 * Math.PI) / 180;
// Extra lean needed to leave the current heading, so a wobbling thumb does not flicker.
const STICKY = (6 * Math.PI) / 180;
// A swipe on the map is a finger that travels this far (screen pixels)
const SWIPE_MIN = 16;
// over at least this long (ms); anything quicker is a tap, and a tap stops.
const SWIPE_TIME = 50;
const TAP_SLOP = 10;

// The touch pad is eight-way, like arrow keys: no slow walk, and a thumb a little
// off a key still runs straight down a lane. (dx, dy) is where the thumb lies from
// the pad's middle, and `was` is the previous result.
export function stickDir(dx, dy, was = null) {
  if (Math.hypot(dx, dy) < STICK_DEAD) return { x: 0, y: 0 };
  const a = Math.atan2(dy, dx);
  if (was && (was.x || was.y)) {
    let off = Math.abs(a - Math.atan2(was.y, was.x));
    if (off > Math.PI) off = 2 * Math.PI - off;
    if (off <= (was.x && was.y ? DIAGONAL : Math.PI / 4 - DIAGONAL) + STICKY) return was;
  }
  let snap = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
  if (Math.abs(a - snap) > DIAGONAL) snap = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
  return { x: Math.round(Math.cos(snap)) || 0, y: Math.round(Math.sin(snap)) || 0 };
}

// The way a swipe of (dx, dy) screen pixels over `ms` milliseconds points, straight
// along a lane, or null while it is still too short or too quick to count.
export function swipeDir(dx, dy, ms) {
  if (ms < SWIPE_TIME || Math.hypot(dx, dy) < SWIPE_MIN) return null;
  return Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
}

// Holding the touch button waits for the swing that connects instead of whiffing.
// Returns the aim to swing with now, or null to keep waiting. With nobody around a
// fresh press swings anyway, so the button never feels dead.
export function holdSwing(g, me, fresh) {
  if (me.swing || me.cooldown > 0 || inHome(g, me)) return null;
  let best = null;
  let near = false;
  for (const e of g.players) {
    if (e === me || allied(me, e) || inHome(g, e)) continue;
    const p = predictSwing(me, e, BONK.windup);
    if (p.dist < BONK.assist) near = true;
    if (p.dist > BONK.reach - 3 || (best && p.dist >= best.dist)) continue;
    if (segmentClear(g.map, me.x, me.y, e.x, e.y, 0)) best = p;
  }
  if (best) return best;
  return fresh && !near ? { ax: 0, ay: 0, dist: 0 } : null;
}

// `laneHelp` is there for trying the phone controls out: whether moves off the pad
// ask for the lane help.
export function createInput({ stage, canvas, pad, bonkBtn, throwBtn, toWorldDir, laneHelp = true }) {
  const down = new Set();
  let enabled = false;
  let touch = null;
  let button = false;
  let throwHeld = false;
  let buttonWas = false;
  let pulsed = false;
  // A swipe on the map sets the way to keep going, until the next swipe or a tap.
  let swipe = null;
  let glide = null;

  const held = (name) => KEYS[name].some((code) => down.has(code));

  function reset() {
    down.clear();
    touch = null;
    button = false;
    buttonWas = false;
    throwHeld = false;
    swipe = null;
    glide = null;
    showPad();
  }

  window.addEventListener('keydown', (e) => {
    if (!enabled || !HANDLED.has(e.code) || e.metaKey || e.ctrlKey || e.altKey) return;
    // Typing a chat message must not steer the hamster.
    if (e.target instanceof HTMLInputElement) return;
    down.add(e.code);
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));
  window.addEventListener('blur', () => down.clear());

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Touch: a faint pad of arrow keys under the thumb. Whichever way the thumb lies
  // from the pad's middle is the key held down, so a touch moves the hamster at
  // once and a short slide to the next key turns it. Its keys light up as they are held.
  function showPad() {
    pad.dataset.x = touch ? touch.x : 0;
    pad.dataset.y = touch ? touch.y : 0;
  }
  function press(e) {
    const r = pad.getBoundingClientRect();
    const dir = stickDir(e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2, touch);
    touch.x = dir.x;
    touch.y = dir.y;
    showPad();
  }
  pad.addEventListener('pointerdown', (e) => {
    if (!enabled || touch) return;
    touch = { id: e.pointerId, x: 0, y: 0 };
    glide = null;
    press(e);
    // The hint about the controls has done its job.
    stage.classList.add('played');
    e.preventDefault();
  });
  // Or a swipe anywhere on the map: the hamster heads that way and keeps going, the
  // way it would with the key held, until another swipe turns it or a tap stops it.
  // One finger can keep steering: each further stretch of its slide is a new swipe.
  stage.addEventListener('pointerdown', (e) => {
    if (!enabled || e.pointerType !== 'touch' || (e.target !== canvas && e.target !== stage) || swipe) return;
    swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, moved: false };
    stage.classList.add('played');
  });
  window.addEventListener('pointermove', (e) => {
    if (touch && e.pointerId === touch.id) press(e);
    if (!swipe || e.pointerId !== swipe.id) return;
    const dir = swipeDir(e.clientX - swipe.x, e.clientY - swipe.y, e.timeStamp - swipe.t);
    if (Math.hypot(e.clientX - swipe.x0, e.clientY - swipe.y0) > TAP_SLOP) swipe.moved = true;
    if (!dir) return;
    glide = dir;
    Object.assign(swipe, { x: e.clientX, y: e.clientY, t: e.timeStamp });
  });
  const release = (e) => {
    if (swipe && e.pointerId === swipe.id) {
      // A tap, not a swipe: stop where you are.
      if (!swipe.moved && e.type === 'pointerup') glide = null;
      swipe = null;
    }
    if (!touch || e.pointerId !== touch.id) return;
    touch = null;
    showPad();
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  bonkBtn.addEventListener('pointerdown', (e) => {
    button = true;
    e.preventDefault();
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) bonkBtn.addEventListener(type, () => (button = false));
  // On a phone the bonk button is held to wait for a hit, so throwing a seed gets
  // a button of its own: hold it, turn, let go.
  throwBtn.addEventListener('pointerdown', (e) => {
    throwHeld = true;
    e.preventDefault();
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) throwBtn.addEventListener(type, () => (throwHeld = false));

  function read(g, id) {
    const me = g.players[id];
    const out = { mx: 0, my: 0, bonk: held('bonk'), ax: 0, ay: 0, throw: held('throw') || throwHeld, stick: false };
    if (held('left')) out.mx -= 1;
    if (held('right')) out.mx += 1;
    if (held('up')) out.my -= 1;
    if (held('down')) out.my += 1;
    const finger = touch || glide;
    if (finger) {
      out.mx = finger.x;
      out.my = finger.y;
      // A move off the pad or a swipe is one the lane help may straighten out.
      out.stick = laneHelp && !!(finger.x || finger.y);
    }
    // Keys and the pad point in screen directions; the view may be turned.
    const dir = toWorldDir(out.mx, out.my);
    out.mx = dir.x;
    out.my = dir.y;
    // The sim swings on a fresh press, so a held button presses again each time a hit is on.
    const aim = button && g.phase === 'playing' ? holdSwing(g, me, !buttonWas) : null;
    buttonWas = button;
    if (aim && !pulsed) {
      out.bonk = true;
      out.ax = aim.ax;
      out.ay = aim.ay;
    }
    pulsed = !!aim && !pulsed;
    return out;
  }

  return {
    read,
    reset,
    enable: (on) => {
      enabled = on;
      if (!on) reset();
    },
  };
}
