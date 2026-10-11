// Turns keyboard, mouse and touch into the per-tick input object the simulation
// expects. Mouse clicks work like an RTS right-click: walk there, or chase and bonk
// the hamster that was clicked.

import { BONK } from '../sim/constants.js';
import { inHome, allied } from '../sim/game.js';
import { getNav, blockCost } from '../ai/nav.js';
import { predictSwing } from '../ai/bot.js';

const KEYS = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  bonk: ['Space', 'KeyJ'],
};
const HANDLED = new Set(Object.values(KEYS).flat());
const STICK_RANGE = 46;
// Top speed comes after a short drag; the knob can still travel the full range.
const STICK_FULL = 18;
// Closest the stick centre may sit to a screen edge.
const STICK_EDGE = 90;

export function createInput({ stage, canvas, stick, knob, bonkBtn, toWorld, toWorldDir }) {
  const down = new Set();
  let enabled = false;
  let touch = null;
  let button = false;
  let click = null;
  let order = null;
  let autoHeld = false;

  const held = (name) => KEYS[name].some((code) => down.has(code));

  function reset() {
    down.clear();
    touch = null;
    button = false;
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

  // Touch: the first finger on the screen becomes a floating joystick.
  stage.addEventListener('pointerdown', (e) => {
    if (!enabled || e.pointerType !== 'touch' || touch || e.target.closest('button')) return;
    // A thumb near the screen edge has no room to push further out, so the stick
    // centre keeps clear of the edges and the knob starts under the thumb.
    const ox = Math.min(Math.max(e.clientX, STICK_EDGE), window.innerWidth - STICK_EDGE);
    const oy = Math.min(Math.max(e.clientY, STICK_EDGE), window.innerHeight - STICK_EDGE);
    touch = { id: e.pointerId, ox, oy, sx: e.clientX, sy: e.clientY, live: false, x: 0, y: 0 };
    stick.hidden = false;
    stick.style.left = `${ox}px`;
    stick.style.top = `${oy}px`;
    knob.style.transform = `translate(calc(-50% + ${e.clientX - ox}px), calc(-50% + ${e.clientY - oy}px))`;
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    // Resting the thumb where it landed, even off-centre, is not a push.
    if (!touch.live) {
      const mx = e.clientX - touch.sx;
      const my = e.clientY - touch.sy;
      if (Math.hypot(mx, my) < 6) return;
      touch.live = true;
      // Pushing back away from the edge: centre on the thumb so it does not first run the wrong way.
      if (mx * (touch.sx - touch.ox) + my * (touch.sy - touch.oy) < 0) {
        touch.ox = touch.sx;
        touch.oy = touch.sy;
        stick.style.left = `${touch.ox}px`;
        stick.style.top = `${touch.oy}px`;
      }
    }
    let dx = e.clientX - touch.ox;
    let dy = e.clientY - touch.oy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_RANGE) {
      dx = (dx / d) * STICK_RANGE;
      dy = (dy / d) * STICK_RANGE;
    }
    const k = d < 6 ? 0 : Math.min(1, d / STICK_FULL) / Math.min(d, STICK_RANGE);
    touch.x = dx * k;
    touch.y = dy * k;
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  });
  const release = (e) => {
    if (!touch || e.pointerId !== touch.id) return;
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

  function resolveClick(g, me) {
    const at = click;
    click = null;
    let target = null;
    let best = 36;
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
    const out = { mx: 0, my: 0, bonk: held('bonk') || button, ax: 0, ay: 0 };
    if (held('left')) out.mx -= 1;
    if (held('right')) out.mx += 1;
    if (held('up')) out.my -= 1;
    if (held('down')) out.my += 1;
    if (touch) {
      out.mx = touch.x;
      out.my = touch.y;
    }
    // Keys and the joystick point in screen directions; the view may be turned.
    const dir = toWorldDir(out.mx, out.my);
    out.mx = dir.x;
    out.my = dir.y;
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
