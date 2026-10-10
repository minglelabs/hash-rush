// Turns keyboard, mouse and touch into the per-tick input object the simulation
// expects. Mouse clicks work like an RTS right-click: walk there, or chase and bonk
// the hamster that was clicked.

import { BONK } from '../sim/constants.js';
import { inHome } from '../sim/game.js';
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

export function createInput({ stage, canvas, stick, knob, bonkBtn, toWorld }) {
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
    touch = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
    stick.hidden = false;
    stick.style.left = `${e.clientX}px`;
    stick.style.top = `${e.clientY}px`;
    knob.style.transform = 'translate(-50%, -50%)';
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    let dx = e.clientX - touch.ox;
    let dy = e.clientY - touch.oy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_RANGE) {
      dx = (dx / d) * STICK_RANGE;
      dy = (dy / d) * STICK_RANGE;
    }
    touch.x = d < 8 ? 0 : dx / STICK_RANGE;
    touch.y = d < 8 ? 0 : dy / STICK_RANGE;
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
      if (e === me) continue;
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
    if (click && g.phase === 'playing') order = resolveClick(g, me);
    click = null;
    if (out.mx || out.my) order = null;
    if (!order || g.phase !== 'playing') return out;

    const nav = getNav(g.map);
    // Like an RTS unit, walk around a lane that someone is standing in.
    const blocked = blockCost(
      g.map,
      g.players.filter((p) => p !== me),
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
