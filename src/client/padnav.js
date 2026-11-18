// Menus with a game controller: outside a round the D-pad or left stick moves the
// focus to the nearest button that way, A presses it and B works like Escape.
// During a round input.js has the controller instead (`busy` says when).

import { gamepads } from './input.js';

const REPEAT_FIRST = 380;
const REPEAT = 160;
const DEAD = 0.5;
const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

// The index of the rect nearest `from` in direction (dx, dy), or -1. Rects ahead
// count by their distance along the way plus twice their distance off to the side.
export function nearestWay(from, rects, dx, dy) {
  const cx = (r) => r.left + r.width / 2;
  const cy = (r) => r.top + r.height / 2;
  let best = -1;
  let bestScore = Infinity;
  rects.forEach((r, i) => {
    const vx = cx(r) - cx(from);
    const vy = cy(r) - cy(from);
    const along = vx * dx + vy * dy;
    if (along <= 1) return;
    const side = Math.abs(vx * dy - vy * dx);
    const score = along + 2 * side;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

// The way the D-pad or stick points, as one of four, or null.
export function padWay(gp) {
  const on = (i) => Boolean(gp.buttons[i]?.pressed);
  if (on(12)) return [0, -1];
  if (on(13)) return [0, 1];
  if (on(14)) return [-1, 0];
  if (on(15)) return [1, 0];
  const [x = 0, y = 0] = gp.axes;
  if (Math.max(Math.abs(x), Math.abs(y)) < DEAD) return null;
  return Math.abs(x) > Math.abs(y) ? [Math.sign(x), 0] : [0, Math.sign(y)];
}

function shown(el) {
  if (el.disabled || el.closest('[hidden]') || el.closest('[inert]')) return false;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

export function startPadNav({ busy }) {
  let running = false;
  let wayWas = null;
  let nextMove = 0;
  let aWas = true;
  let bWas = true;
  let startWas = true;

  function move([dx, dy]) {
    const all = [...document.querySelectorAll(FOCUSABLE)].filter(shown);
    if (!all.length) return;
    const now = document.activeElement;
    if (!now || now === document.body || !all.includes(now)) {
      all[0].focus();
      return;
    }
    const i = nearestWay(now.getBoundingClientRect(), all.map((el) => el.getBoundingClientRect()), dx, dy);
    if (i >= 0) {
      all[i].focus();
      all[i].scrollIntoView({ block: 'nearest' });
    }
  }

  function tick(t) {
    const pads = gamepads();
    if (!pads.length) {
      running = false;
      return;
    }
    requestAnimationFrame(tick);
    const gp = pads[0];
    const a = Boolean(gp.buttons[0]?.pressed);
    const b = Boolean(gp.buttons[1]?.pressed);
    const start = Boolean(gp.buttons[9]?.pressed);
    // Start opens and closes the game's menu, as Escape does.
    if (start && !startWas) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    startWas = start;
    if (busy()) {
      // Buttons held from the round must not press anything once it ends.
      aWas = bWas = true;
      wayWas = null;
      return;
    }
    const way = padWay(gp);
    if (way && (String(way) !== String(wayWas) || t >= nextMove)) {
      document.documentElement.classList.add('padnav');
      nextMove = t + (String(way) === String(wayWas) ? REPEAT : REPEAT_FIRST);
      move(way);
    }
    wayWas = way;
    if (a && !aWas) {
      document.documentElement.classList.add('padnav');
      const el = document.activeElement;
      if (el && el !== document.body) el.click();
      else move([0, 1]);
    }
    if (b && !bWas) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    aWas = a;
    bWas = b;
  }

  const begin = () => {
    if (running) return;
    running = true;
    requestAnimationFrame(tick);
  };
  window.addEventListener('gamepadconnected', begin);
  // The focus ring is for the controller; the mouse or a finger puts it away.
  window.addEventListener('pointerdown', () => document.documentElement.classList.remove('padnav'));
  if (gamepads().length) begin();
}
