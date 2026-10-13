// Turns keyboard, mouse and touch into the per-tick input object the simulation
// expects. Mouse clicks work like an RTS right-click: walk there, or chase and bonk
// the hamster that was clicked. A tap on a phone's map is the same click.

import { BONK, HAMSTER_R } from '../sim/constants.js';
import { inHome, allied } from '../sim/game.js';
import { segmentClear, isFree } from '../sim/map.js';
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
// Past this the hamster runs flat out, the way a held arrow key does.
const STICK_DEAD = 8;
// Lanes run along the axes, so a push counts as straight unless it is this close
// to a true diagonal.
const DIAGONAL = (15 * Math.PI) / 180;
// Extra lean needed to leave the current heading, so a wobbling thumb does not flicker.
const STICKY = (6 * Math.PI) / 180;
// A fingertip is wider than a mouse pointer: a tap this near a rival (world pixels) means that rival.
const TAP_REACH = 48;

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

// Where a hamster told to go to (x, y) can actually stand: the spot itself, or the
// nearest ground to it when it is inside a hedge, on the flower or off the map.
export function nearestGround(map, x, y) {
  const b = map.bounds;
  const r = HAMSTER_R;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  x = clamp(x, b.x1 + r, b.x2 - r);
  y = clamp(y, b.y1 + r, b.y2 - r);
  if (isFree(map, x, y, r)) return { x, y };
  let best = null;
  let near = Infinity;
  const offer = (x1, y1, x2, y2) => {
    const px = clamp(x, x1, x2);
    const py = clamp(y, y1, y2);
    const d = Math.hypot(px - x, py - y);
    if (d < near) {
      near = d;
      best = { x: px, y: py };
    }
  };
  // The room a hamster has inside each lane cell, and the open ground either side of the hedge.
  const slack = map.laneWidth / 2 - r;
  for (const c of map.cells) offer(c.x - slack, c.y - slack, c.x + slack, c.y + slack);
  offer(b.x1 + r, b.y1 + r, map.lanes.x1 - r, b.y2 - r);
  offer(map.lanes.x2 + r, b.y1 + r, b.x2 - r, b.y2 - r);
  const f = map.flower;
  const d = Math.hypot(best.x - f.x, best.y - f.y);
  if (d < f.r + r) {
    const k = (f.r + r) / (d || 1);
    best = { x: f.x + (d ? best.x - f.x : -1) * k, y: f.y + (best.y - f.y) * k };
  }
  return best;
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
export function createInput({ stage, canvas, pad, bonkBtn, throwBtn, toWorld, toWorldDir, laneHelp = true }) {
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
  canvas.addEventListener('pointerdown', (e) => {
    if (!enabled || e.pointerType === 'touch') return;
    click = toWorld(e.clientX, e.clientY);
  });

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
    press(e);
    // The hint about the controls has done its job.
    stage.classList.add('played');
    e.preventDefault();
  });
  // A finger touching the map gives an order the moment it lands, like a mouse
  // click, so quick taps one after another steer the hamster step by step. A touch
  // beside the map counts for the nearest ground to it.
  stage.addEventListener('pointerdown', (e) => {
    if (!enabled || e.pointerType !== 'touch' || (e.target !== canvas && e.target !== stage)) return;
    click = { ...toWorld(e.clientX, e.clientY), reach: TAP_REACH };
  });
  window.addEventListener('pointermove', (e) => {
    if (touch && e.pointerId === touch.id) press(e);
  });
  const release = (e) => {
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
    return { type: 'move', ...nearestGround(g.map, at.x, at.y) };
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
      // A move off the pad is one the lane help may straighten out.
      out.stick = laneHelp && !!(touch.x || touch.y);
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
