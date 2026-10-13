// Turns keyboard, mouse and touch into the per-tick input object the simulation
// expects. Mouse clicks work like an RTS right-click: walk there, or chase and bonk
// the hamster that was clicked. A tap on a phone's map is the same click.

import { BONK } from '../sim/constants.js';
import { inHome, allied } from '../sim/game.js';
import { segmentClear } from '../sim/map.js';
import { getNav, blockCost } from '../ai/nav.js';
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
// How far the stick trails behind the thumb. Every change of heading costs the
// thumb a trip of about this length, so it is kept short: nothing here is analogue.
const STICK_RANGE = 22;
// Past this the hamster runs flat out, the way a held arrow key does.
const STICK_DEAD = 8;
// Lanes run along the axes, so a push counts as straight unless it is this close
// to a true diagonal.
const DIAGONAL = (15 * Math.PI) / 180;
// Extra lean needed to leave the current heading, so a wobbling thumb does not flicker.
const STICKY = (6 * Math.PI) / 180;
// Closest the stick centre may sit to a screen edge.
const STICK_EDGE = 40;
// A thumb held on a heading creeps about without meaning to. The stick takes up this
// many pixels of creep a second, so only a move made on purpose turns or stops the hamster.
const STICK_CREEP = 20;
// A fingertip is wider than a mouse pointer: a tap this near a rival (world pixels) means that rival.
const TAP_REACH = 48;
// A touch on the map that lifts this soon (ms) without sliding is a tap, not a push.
const TAP = 300;

// The joystick is an eight-way pad: no slow walk, and a slightly crooked push still
// runs straight down a lane. `was` is the previous result.
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

// The stick itself, kept apart from the page so it can be tested: where its centre
// is, and which way the thumb on it is pushing. `w` and `h` are the screen's size,
// and times are in seconds.
export function stickStart(x, y, w, h, t, range = STICK_RANGE) {
  // A thumb near the screen edge has no room to push further out, so the stick
  // centre keeps clear of the edges and the knob starts under the thumb.
  const ox = Math.min(Math.max(x, STICK_EDGE), w - STICK_EDGE);
  const oy = Math.min(Math.max(y, STICK_EDGE), h - STICK_EDGE);
  return { ox, oy, sx: x, sy: y, px: x, py: y, at: t, range, live: false, x: 0, y: 0 };
}

// The thumb has moved to (x, y). Updates the stick's centre and its heading.
export function stickMove(s, x, y, t) {
  // Resting the thumb where it landed, even off-centre, is not a push.
  if (!s.live) {
    const mx = x - s.sx;
    const my = y - s.sy;
    const m = Math.hypot(mx, my);
    if (m < 6) return;
    s.live = true;
    // The room kept at a screen edge is for a push on out towards that edge. Any
    // other push starts from under the thumb, or it would first run the wrong way.
    const ex = s.sx - s.ox;
    const ey = s.sy - s.oy;
    if (mx * ex + my * ey <= 0.5 * m * Math.hypot(ex, ey)) {
      s.ox = s.sx;
      s.oy = s.sy;
    }
  }
  if (s.x || s.y) {
    // While the thumb sat where it was, the stick slid round to sit right behind it.
    const k = s.range / Math.hypot(s.x, s.y);
    const gx = s.px - s.x * k - s.ox;
    const gy = s.py - s.y * k - s.oy;
    const take = Math.min(1, (STICK_CREEP * (t - s.at)) / (Math.hypot(gx, gy) || 1));
    s.ox += gx * take;
    s.oy += gy * take;
  }
  s.px = x;
  s.py = y;
  s.at = t;
  let dx = x - s.ox;
  let dy = y - s.oy;
  const d = Math.hypot(dx, dy);
  if (d > s.range) {
    // The stick trails a thumb that has run past its rim, so turning back takes
    // effect at once instead of after the trip back to the centre.
    s.ox += (dx / d) * (d - s.range);
    s.oy += (dy / d) * (d - s.range);
    dx = (dx / d) * s.range;
    dy = (dy / d) * s.range;
  }
  const dir = stickDir(dx, dy, s);
  if ((dir.x || dir.y) && (dir.x !== s.x || dir.y !== s.y)) {
    // A new heading starts dead on: the stick swings round behind the thumb, so
    // the next turn is as near on one side as on the other.
    const k = Math.hypot(dx, dy) / Math.hypot(dir.x, dir.y);
    s.ox = x - dir.x * k;
    s.oy = y - dir.y * k;
  }
  s.x = dir.x;
  s.y = dir.y;
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

// `stickRange` and `laneHelp` are there for trying the phone controls out: how far
// the stick trails the thumb, and whether stick moves ask for the lane help.
export function createInput({ stage, canvas, stick, knob, bonkBtn, throwBtn, toWorld, toWorldDir, stickRange = STICK_RANGE, laneHelp = true }) {
  const down = new Set();
  let enabled = false;
  let touch = null;
  let button = false;
  let throwHeld = false;
  let buttonWas = false;
  let pulsed = false;
  let click = null;
  let order = null;
  let autoHeld = false;

  const held = (name) => KEYS[name].some((code) => down.has(code));

  function reset() {
    down.clear();
    touch = null;
    button = false;
    buttonWas = false;
    throwHeld = false;
    click = null;
    order = null;
    stick.hidden = true;
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
  canvas.addEventListener('pointerdown', (e) => {
    if (!enabled || e.pointerType === 'touch') return;
    click = toWorld(e.clientX, e.clientY);
  });

  // Where the stick is drawn: its ring, the knob under the thumb, and a pointer on
  // the rim for the heading it has taken, which a thumb cannot hide.
  function showStick() {
    stick.style.left = `${touch.ox}px`;
    stick.style.top = `${touch.oy}px`;
    knob.style.transform = `translate(calc(-50% + ${touch.px - touch.ox}px), calc(-50% + ${touch.py - touch.oy}px))`;
    stick.classList.toggle('going', !!(touch.x || touch.y));
    if (touch.x || touch.y) stick.style.setProperty('--heading', `${Math.atan2(touch.y, touch.x)}rad`);
  }

  // Touch: the first finger on the screen becomes a floating joystick.
  stage.addEventListener('pointerdown', (e) => {
    if (!enabled || e.pointerType !== 'touch' || touch || e.target.closest('button')) return;
    touch = stickStart(e.clientX, e.clientY, window.innerWidth, window.innerHeight, e.timeStamp / 1000, stickRange);
    touch.id = e.pointerId;
    // A finger that only taps the map gives an order, like a mouse click.
    touch.tap = e.target === canvas ? e.timeStamp : 0;
    stick.hidden = false;
    showStick();
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    stickMove(touch, e.clientX, e.clientY, e.timeStamp / 1000);
    showStick();
  });
  const release = (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    if (e.type === 'pointerup' && touch.tap && !touch.live && e.timeStamp - touch.tap < TAP) click = { ...toWorld(touch.sx, touch.sy), reach: TAP_REACH };
    touch = null;
    stick.hidden = true;
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

  function resolveClick(g, me) {
    const at = click;
    click = null;
    let target = null;
    let best = at.reach || 36;
    for (const e of g.players) {
      if (e === me || allied(me, e)) continue;
      const d = Math.hypot(e.x - at.x, e.y - at.y);
      if (d < best) {
        best = d;
        target = e;
      }
    }
    if (target) return { type: 'attack', id: target.id, deaths: target.deaths };
    // Clicking the flower means "go nibble": aim for the near side of the ring.
    const f = g.map.flower;
    if (Math.hypot(at.x - f.x, at.y - f.y) < f.gatherR) {
      const dx = me.x - f.x;
      const dy = me.y - f.y;
      const d = Math.hypot(dx, dy) || 1;
      return { type: 'move', x: f.x + (dx / d) * 52, y: f.y + (dy / d) * 52 };
    }
    return { type: 'move', x: at.x, y: at.y };
  }

  function read(g, id) {
    const me = g.players[id];
    const out = { mx: 0, my: 0, bonk: held('bonk'), ax: 0, ay: 0, throw: held('throw') || throwHeld, stick: false };
    if (held('left')) out.mx -= 1;
    if (held('right')) out.mx += 1;
    if (held('up')) out.my -= 1;
    if (held('down')) out.my += 1;
    if (touch) {
      out.mx = touch.x;
      out.my = touch.y;
      // A move off the stick is one the lane help may straighten out.
      out.stick = laneHelp && !!(touch.x || touch.y);
    }
    // Keys and the joystick point in screen directions; the view may be turned.
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
    if (click && g.phase === 'playing') order = resolveClick(g, me);
    click = null;
    if (out.mx || out.my) order = null;
    if (!order || g.phase !== 'playing') return out;

    const nav = getNav(g.map);
    // Like an RTS unit, walk around a lane that someone is standing in.
    const blocked = blockCost(
      g.map,
      g.players.filter((p) => p !== me && !allied(me, p)),
    );
    const steer = (pt) => {
      const dx = pt.x - me.x;
      const dy = pt.y - me.y;
      const d = Math.hypot(dx, dy) || 1;
      out.mx = dx / d;
      out.my = dy / d;
    };
    if (order.type === 'attack') {
      const e = g.players[order.id];
      if (e.deaths !== order.deaths || inHome(g, e)) {
        order = null;
        return out;
      }
      const visible = nav.clear(me, e);
      steer(visible ? e : nav.nextTarget(me, nav.findPath(me, e).points));
      const p = predictSwing(me, { x: e.x, y: e.y, vx: e.vx, vy: e.vy, swing: e.swing }, BONK.windup);
      const ready = visible && !me.swing && me.cooldown <= 0 && !inHome(g, me) && p.dist <= BONK.reach - 3;
      if (ready && !autoHeld) {
        out.bonk = true;
        out.ax = p.ax;
        out.ay = p.ay;
        autoHeld = true;
      } else {
        autoHeld = false;
      }
    } else if (Math.hypot(order.x - me.x, order.y - me.y) < 5) {
      order = null;
    } else {
      steer(nav.nextTarget(me, nav.findPath(me, order, blocked).points));
    }
    return out;
  }

  return {
    read,
    reset,
    enable: (on) => {
      enabled = on;
      if (!on) reset();
    },
    // Where the hamster has been told to walk, for the on-field marker.
    marker: () => (order && order.type === 'move' ? order : null),
  };
}
