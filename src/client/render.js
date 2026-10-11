// Canvas drawing. Reads game state, never changes it.

import { WORLD } from '../sim/map.js';
import { BONK, gatherTime, ALARM_RANGE, THROW } from '../sim/constants.js';
import { lastStretch } from '../sim/game.js';
import { mulberry32 } from '../sim/rng.js';
import { colorOf, lookOf } from './looks.js';
import { t as tr } from './i18n.js';

const TAU = Math.PI * 2;
const FONT = 'system-ui, "Apple SD Gothic Neo", "Hiragino Sans", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK KR", "Malgun Gothic", sans-serif';

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function oval(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
}

export function drawSeed(ctx, x, y, size, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(size, size);
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.bezierCurveTo(6, -3, 5, 6, 0, 8);
  ctx.bezierCurveTo(-5, 6, -6, -3, 0, -8);
  ctx.fillStyle = '#3a3330';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#1e1a18';
  ctx.stroke();
  ctx.strokeStyle = '#f4efe6';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-1.7, -4);
  ctx.quadraticCurveTo(-2.7, 1, -1, 5.5);
  ctx.moveTo(1.7, -4);
  ctx.quadraticCurveTo(2.7, 1, 1, 5.5);
  ctx.stroke();
  ctx.restore();
}

// o: { x, y, fx, fy, moving, carrying, swing, look, t }
export function drawHamster(ctx, o) {
  const L = o.look;
  const stride = o.moving ? Math.sin(o.t * 20) : 0;
  const bob = o.moving ? -Math.abs(stride) * 2 : Math.sin(o.t * 2.4) * 0.5;
  let sx = 1;
  let sy = 1;
  if (o.swing) {
    if (o.swing.phase === 'windup') {
      const k = o.swing.t / BONK.windup;
      sx = 1 + 0.14 * k;
      sy = 1 - 0.1 * k;
    } else {
      const k = Math.min(1, o.swing.t / BONK.recovery);
      sx = 0.9 + 0.1 * k;
      sy = 1.1 - 0.1 * k;
    }
  }
  const lx = o.fx * 2.6;
  const ly = o.fy * 2;

  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.fillStyle = 'rgba(30, 50, 20, 0.22)';
  oval(ctx, 0, 13, 15, 5.5);
  ctx.fill();
  ctx.translate(0, bob);
  ctx.scale(sx, sy);

  ctx.fillStyle = L.paw;
  oval(ctx, -7, 13 + stride * 1.5, 4.2, 2.6);
  ctx.fill();
  oval(ctx, 7, 13 - stride * 1.5, 4.2, 2.6);
  ctx.fill();

  for (const s of [-1, 1]) {
    ctx.fillStyle = L.ear;
    circle(ctx, s * 10.5, -12.5, 5.6);
    ctx.fillStyle = '#f7b6b6';
    circle(ctx, s * 10.5, -12.2, 3);
  }

  ctx.fillStyle = L.fur;
  oval(ctx, 0, 0, 16, 14.5);
  ctx.fill();
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = L.color;
  ctx.stroke();

  ctx.fillStyle = L.belly;
  oval(ctx, lx * 0.4, 5.5, 10, 7.5);
  ctx.fill();
  if (o.carrying) {
    oval(ctx, -10.5 + lx * 0.5, 3.5 + ly * 0.4, 6, 5.2);
    ctx.fill();
    oval(ctx, 10.5 + lx * 0.5, 3.5 + ly * 0.4, 6, 5.2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255, 130, 150, 0.55)';
  circle(ctx, -9 + lx * 0.6, 2.5 + ly * 0.5, 3);
  circle(ctx, 9 + lx * 0.6, 2.5 + ly * 0.5, 3);

  ctx.fillStyle = '#2a1c14';
  circle(ctx, -5.5 + lx, -3 + ly, 2.3);
  circle(ctx, 5.5 + lx, -3 + ly, 2.3);
  ctx.fillStyle = '#ffffff';
  circle(ctx, -4.8 + lx, -3.8 + ly, 0.9);
  circle(ctx, 6.2 + lx, -3.8 + ly, 0.9);

  const nx = lx * 1.1;
  ctx.fillStyle = '#e58a8a';
  oval(ctx, nx, 0.8 + ly, 1.6, 1.2);
  ctx.fill();
  ctx.strokeStyle = '#7a4a3a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(nx - 2.4, 3 + ly);
  ctx.quadraticCurveTo(nx - 1.2, 4.6 + ly, nx, 2.6 + ly);
  ctx.quadraticCurveTo(nx + 1.2, 4.6 + ly, nx + 2.4, 3 + ly);
  ctx.stroke();
  if (o.carrying) drawSeed(ctx, nx, 7.5 + ly, 0.72, Math.PI / 2 + (o.fx >= 0 ? 0.25 : -0.25));
  ctx.restore();
}

// How a computer's level is written under it: each level in its own colour.
const BOT_LEVEL = {
  'bot:easy': { key: 'easy', color: '#1f9d55' },
  'bot:normal': { key: 'normal', color: '#e08a00' },
  'bot:hard': { key: 'hard', color: '#d63031' },
};

// A seed carrier this close to the home edge sets off the alarm.
export const nearHome = (game, p) => p.carrying && p.x - game.homeX < ALARM_RANGE;

export function drawFlower(ctx, f, t) {
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.fillStyle = 'rgba(30, 50, 20, 0.2)';
  oval(ctx, 3, 8, 46, 42);
  ctx.fill();
  ctx.rotate(Math.sin(t * 0.8) * 0.05);
  for (const [n, r, len, wid, col, off] of [
    [16, 30, 20, 9, '#f6a609', 0],
    [16, 26, 17, 8, '#ffc933', Math.PI / 16],
  ]) {
    ctx.fillStyle = col;
    for (let i = 0; i < n; i++) {
      ctx.save();
      ctx.rotate(off + (i / n) * TAU);
      oval(ctx, 0, -r - len / 2 + 6, wid, len);
      ctx.fill();
      ctx.restore();
    }
  }
  const g = ctx.createRadialGradient(-6, -6, 3, 0, 0, 27);
  g.addColorStop(0, '#7a4a22');
  g.addColorStop(1, '#4a2a12');
  ctx.fillStyle = g;
  circle(ctx, 0, 0, 27);
  ctx.fillStyle = '#2d1a0b';
  for (let k = 1; k < 46; k++) {
    const a = k * 2.39996;
    const r = Math.sqrt(k / 46) * 23;
    circle(ctx, Math.cos(a) * r, Math.sin(a) * r, 1.5);
  }
  ctx.restore();
}

function buildGround(w, h, base, map) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  base(ctx);
  const rnd = mulberry32(11);
  const b = map.bounds;

  ctx.fillStyle = '#2f7a3d';
  ctx.fillRect(0, 0, WORLD.w, WORLD.h);
  ctx.fillStyle = '#93d36f';
  ctx.beginPath();
  ctx.roundRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1, 14);
  ctx.fill();

  // Sandy floor under the hedge block: only the lanes stay visible once the
  // hedges are drawn on top.
  const f = map.flower;
  ctx.fillStyle = '#ecdcae';
  ctx.fillRect(map.lanes.x1 - 6, b.y1, map.lanes.x2 - map.lanes.x1 + 12, b.y2 - b.y1);
  ctx.fillStyle = 'rgba(255, 244, 200, 0.4)';
  circle(ctx, f.x, f.y, 116);

  for (let i = 0; i < 520; i++) {
    const x = b.x1 + rnd() * (b.x2 - b.x1);
    const y = b.y1 + rnd() * (b.y2 - b.y1);
    ctx.strokeStyle = rnd() < 0.5 ? 'rgba(60, 140, 60, 0.35)' : 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 4, y - 3 - rnd() * 4);
    ctx.stroke();
  }
  return c;
}

function buildObstacles(w, h, base, map) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  base(ctx);
  const rnd = mulberry32(5);

  // The hedge rects overlap, so everything is drawn as one union: shadow, a dark
  // rim, the fill on top of it, then leaves and blossoms clipped to the shape.
  const all = (dx, dy) => {
    ctx.beginPath();
    for (const r of map.rects) ctx.roundRect(r.x + dx, r.y + dy, r.w, r.h, map.corner);
  };
  ctx.fillStyle = 'rgba(30, 50, 20, 0.22)';
  all(1, 5);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#2c7438';
  all(0, 0);
  ctx.stroke();
  ctx.fillStyle = '#3c9449';
  ctx.fill();
  ctx.save();
  ctx.clip();
  const x1 = map.lanes.x1;
  const bw = map.lanes.x2 - x1;
  const y1 = map.bounds.y1;
  const bh = map.bounds.y2 - y1;
  for (let i = 0; i < (bw * bh) / 520; i++) {
    ctx.fillStyle = rnd() < 0.5 ? '#4fb05a' : '#348540';
    circle(ctx, x1 + rnd() * bw, y1 + rnd() * bh, 9 + rnd() * 9);
  }
  for (let i = 0; i < (bw * bh) / 4200; i++) {
    const x = x1 + rnd() * bw;
    const y = y1 + rnd() * bh;
    ctx.fillStyle = rnd() < 0.5 ? '#ffe3ee' : '#fff6c9';
    for (let k = 0; k < 5; k++) circle(ctx, x + Math.cos((k / 5) * TAU) * 3, y + Math.sin((k / 5) * TAU) * 3, 2.2);
    ctx.fillStyle = '#f7b500';
    circle(ctx, x, y, 1.6);
  }
  ctx.restore();

  return c;
}

export function createRenderer(canvas, map) {
  const ctx = canvas.getContext('2d');
  const fx = [];
  // Puffs kicked up behind a hamster slowed by its seed, drawn under the hamsters.
  const dust = [];
  const dustAt = new Map();
  let scale = 1;
  let ground = null;
  let obstacles = null;
  let shake = 0;
  let clock = 0;
  // On a tall screen the world is shown turned a quarter: burrow at the bottom,
  // flower at the top. The simulation never knows; only drawing and input turn.
  let portrait = false;

  // World-space drawing transform, with an optional offset in world pixels.
  function base(c, ox = 0, oy = 0) {
    if (portrait) c.setTransform(0, -scale, scale, 0, ox * scale, (WORLD.w + oy) * scale);
    else c.setTransform(scale, 0, 0, scale, ox * scale, oy * scale);
  }

  // Runs `fn` with the origin at a world point but axes aligned to the screen,
  // for things that must not be drawn sideways: hamsters, labels, text.
  function upright(x, y, fn) {
    ctx.save();
    ctx.translate(x, y);
    if (portrait) ctx.transform(0, 1, -1, 0, 0, 0);
    fn();
    ctx.restore();
  }

  // A screen-space direction (right, down) as a world direction, and back.
  const toWorldDir = (sx, sy) => (portrait ? { x: -sy, y: sx } : { x: sx, y: sy });
  const toScreenDir = (wx, wy) => (portrait ? { x: wy, y: -wx } : { x: wx, y: wy });

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    const tall = r.height > r.width;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(r.width * dpr);
    if (w === canvas.width && tall === portrait && ground) return;
    portrait = tall;
    const vw = portrait ? WORLD.h : WORLD.w;
    const vh = portrait ? WORLD.w : WORLD.h;
    const h = Math.round((w * vh) / vw);
    canvas.width = w;
    canvas.height = h;
    scale = w / vw;
    ground = buildGround(w, h, base, map);
    obstacles = buildObstacles(w, h, base, map);
  }

  function toWorld(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const u = (clientX - r.left) / r.width;
    const v = (clientY - r.top) / r.height;
    return portrait ? { x: (1 - v) * WORLD.w, y: u * WORLD.h } : { x: u * WORLD.w, y: v * WORLD.h };
  }

  function burst(x, y, count, color, speed) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const v = speed * (0.5 + Math.random() * 0.7);
      fx.push({ type: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.45 + Math.random() * 0.2, color });
    }
  }

  function onEvent(ev, game, meId) {
    const color = (id) => colorOf(game.players[id]);
    if (ev.type === 'impact') {
      fx.push({ type: 'swoosh', x: ev.x, y: ev.y, a: Math.atan2(ev.dy, ev.dx), t: 0, life: 0.2, hit: ev.hit });
    } else if (ev.type === 'bonk') {
      burst(ev.x, ev.y, 9, '#ffe066', 190);
      fx.push({ type: 'poof', x: ev.x, y: ev.y, t: 0, life: 0.4 });
      fx.push({ type: 'text', x: ev.x, y: ev.y - 26, text: tr('bonkWord'), color: color(ev.by), t: 0, life: 0.7 });
      if (ev.seed) fx.push({ type: 'seed', x: ev.x, y: ev.y, t: 0, life: 0.8 });
      if (ev.id === meId || ev.by === meId) shake = 7;
    } else if (ev.type === 'warp') {
      fx.push({ type: 'ring', x: ev.fromX, y: ev.fromY, color: '#ffdc96', t: 0, life: 0.45 });
      fx.push({ type: 'ring', x: ev.x, y: ev.y, color: color(ev.id), t: 0, life: 0.45 });
    } else if (ev.type === 'throw') {
      fx.push({ type: 'toss', x: ev.x, y: ev.y, dx: ev.dx, dy: ev.dy, t: 0, life: 0.22 });
    } else if (ev.type === 'spawn') {
      fx.push({ type: 'ring', x: ev.x, y: ev.y, color: color(ev.id), t: 0, life: 0.45 });
    } else if (ev.type === 'seed') {
      const p = game.players[ev.id];
      fx.push({ type: 'ring', x: p.x, y: p.y, color: '#ffd23f', t: 0, life: 0.5 });
      fx.push({ type: 'text', x: p.x, y: p.y - 30, text: tr('seedGot'), color: color(ev.id), t: 0, life: 0.9 });
    } else if (ev.type === 'win') {
      // Confetti lives in screen space so it always falls down the screen.
      const vw = portrait ? WORLD.h : WORLD.w;
      for (let i = 0; i < 110; i++) {
        fx.push({
          type: 'confetti',
          x: Math.random() * vw,
          y: -20 - Math.random() * 260,
          vx: (Math.random() - 0.5) * 60,
          vy: 170 + Math.random() * 150,
          spin: Math.random() * TAU,
          t: 0,
          life: 4.5,
          color: ['#ffd23f', '#e5484d', '#2f6fed', '#1f9d55', '#9b51e0', '#ffffff'][i % 6],
        });
      }
    }
  }

  function drawFx(dt) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const e = fx[i];
      e.t += dt;
      if (e.t >= e.life) {
        fx.splice(i, 1);
        continue;
      }
      const k = e.t / e.life;
      if (e.type === 'spark') {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.vx *= 0.92;
        e.vy *= 0.92;
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = e.color;
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(e.t * 9);
        ctx.beginPath();
        for (let s = 0; s < 10; s++) {
          const r = s % 2 ? 2 : 5;
          ctx.lineTo(Math.cos((s / 10) * TAU) * r, Math.sin((s / 10) * TAU) * r);
        }
        ctx.fill();
        ctx.restore();
      } else if (e.type === 'poof') {
        ctx.globalAlpha = 0.75 * (1 - k);
        ctx.fillStyle = '#ffffff';
        for (let s = 0; s < 6; s++) {
          const a = (s / 6) * TAU;
          circle(ctx, e.x + Math.cos(a) * 22 * k, e.y + Math.sin(a) * 16 * k, 9 * (1 - k * 0.5));
        }
      } else if (e.type === 'ring') {
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 4 * (1 - k) + 1;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 12 + 30 * k, 0, TAU);
        ctx.stroke();
      } else if (e.type === 'toss') {
        // The thrown seed streaks along its path.
        const at = THROW.range * Math.min(1, k * 1.3);
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = '#fff3b0';
        ctx.lineCap = 'round';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(e.x + e.dx * at * 0.4, e.y + e.dy * at * 0.4);
        ctx.lineTo(e.x + e.dx * at, e.y + e.dy * at);
        ctx.stroke();
        ctx.globalAlpha = 1;
        upright(e.x + e.dx * at, e.y + e.dy * at, () => drawSeed(ctx, 0, 0, 1.3, k * 14));
      } else if (e.type === 'swoosh') {
        ctx.globalAlpha = (e.hit ? 0.95 : 0.6) * (1 - k);
        ctx.strokeStyle = e.hit ? '#fff3b0' : '#ffffff';
        ctx.lineCap = 'round';
        ctx.lineWidth = 7 * (1 - k) + 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, BONK.reach * (0.55 + 0.4 * k), e.a - 1.15, e.a + 1.15);
        ctx.stroke();
      } else if (e.type === 'text') {
        ctx.globalAlpha = 1 - k * k;
        ctx.font = `800 17px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#ffffff';
        upright(e.x, e.y, () => {
          ctx.strokeText(e.text, 0, -22 * k);
          ctx.fillStyle = e.color;
          ctx.fillText(e.text, 0, -22 * k);
        });
      } else if (e.type === 'seed') {
        ctx.globalAlpha = 1 - k;
        upright(e.x, e.y, () => drawSeed(ctx, 26 * k, -46 * Math.sin(k * Math.PI), 1.1, k * 9));
      } else if (e.type === 'confetti') {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        ctx.globalAlpha = Math.min(1, (1 - k) * 3);
        ctx.fillStyle = e.color;
        ctx.save();
        ctx.setTransform(scale, 0, 0, scale, e.x * scale, e.y * scale);
        ctx.rotate(e.spin + e.t * 6);
        ctx.fillRect(-5, -3, 10, 6);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  // view: { dt, meId, marker }
  function draw(game, view) {
    if (!ground) resize();
    if (!ground) return;
    const dt = view.dt;
    clock += dt;
    const t = clock;
    const b = map.bounds;
    const f = map.flower;
    const carrierOut = game.players.some((p) => p.carrying);

    shake = Math.max(0, shake - dt * 30);
    const ox = shake ? (Math.random() - 0.5) * shake : 0;
    const oy = shake ? (Math.random() - 0.5) * shake : 0;
    ctx.setTransform(1, 0, 0, 1, ox * scale, oy * scale);
    ctx.drawImage(ground, 0, 0);
    base(ctx, ox, oy);

    // Burrow floor. In overtime it spreads towards the flower.
    ctx.fillStyle = '#f6e6c2';
    ctx.beginPath();
    ctx.roundRect(b.x1, b.y1, game.homeX - b.x1, b.y2 - b.y1, [14, 0, 0, 14]);
    ctx.fill();
    const grown = game.homeX > map.home.x2 + 0.5;

    ctx.setTransform(1, 0, 0, 1, ox * scale, oy * scale);
    ctx.drawImage(obstacles, 0, 0);
    base(ctx, ox, oy);

    // In overtime everything that now counts as home, hedges included, is washed
    // in a warm colour so the moved finish line is impossible to miss.
    if (grown) {
      ctx.fillStyle = `rgba(255, 150, 40, ${0.34 + 0.08 * Math.sin(t * 4)})`;
      ctx.beginPath();
      ctx.roundRect(b.x1, b.y1, game.homeX - b.x1, b.y2 - b.y1, [14, 0, 0, 14]);
      ctx.fill();
    }
    ctx.strokeStyle = carrierOut || grown ? `rgba(255, 120, 20, ${0.8 + 0.2 * Math.sin(t * 8)})` : 'rgba(170, 120, 60, 0.7)';
    ctx.lineWidth = grown ? 6 : 4;
    ctx.setLineDash([12, 10]);
    ctx.lineDashOffset = -t * 18;
    ctx.beginPath();
    ctx.moveTo(game.homeX, b.y1);
    ctx.lineTo(game.homeX, b.y2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Tunnels back to the nest.
    for (const w of map.warps) {
      ctx.fillStyle = '#4a2f1a';
      circle(ctx, w.x, w.y, w.r);
      ctx.strokeStyle = '#8a5a2b';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.r, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 220, 150, 0.8)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 9]);
      ctx.lineDashOffset = t * 22;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.r + 7 + 2 * Math.sin(t * 3), 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      upright(w.x, w.y, () => {
        ctx.font = `${Math.round(w.r * 0.9)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('🏠', 0, w.r * 0.32);
      });
    }

    ctx.font = `800 20px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(140, 95, 45, 0.55)';
    upright(b.x1 + 36, b.y1 + 28, () => ctx.fillText(tr('home'), 0, 7));

    for (const p of game.players) {
      upright(p.nest.x, p.nest.y, () => {
        ctx.fillStyle = '#5b3d22';
        oval(ctx, 0, 6, 19, 11);
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = colorOf(p);
        ctx.stroke();
      });
    }

    // Winding up a throw: the path the seed will take grows out of the hamster and
    // turns gold once it is ready to let go.
    for (const p of game.players) {
      if (!p.carrying || !(p.charge > 0)) continue;
      const k = Math.min(1, p.charge / THROW.charge);
      // Gold when ready, reddening as it nears the point where it lets go by itself.
      const hot = Math.max(0, Math.min(1, (p.charge - THROW.charge) / (THROW.max - THROW.charge)));
      ctx.strokeStyle = k < 1 ? 'rgba(255, 255, 255, 0.6)' : `rgba(255, ${Math.round(200 - 140 * hot)}, 40, ${0.75 + 0.2 * Math.sin(t * (14 + 16 * hot))})`;
      ctx.lineCap = 'round';
      ctx.lineWidth = 2 * THROW.width * (k < 1 ? 0.35 : 0.5);
      ctx.beginPath();
      ctx.moveTo(p.x + p.fx * 18, p.y + p.fy * 18);
      ctx.lineTo(p.x + p.fx * THROW.range * k, p.y + p.fy * THROW.range * k);
      ctx.stroke();
    }

    // Nibbling ring around the flower.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 9]);
    ctx.lineDashOffset = t * 12;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.gatherR + 12, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    drawFlower(ctx, f, t);

    if (view.marker) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(view.marker.x, view.marker.y, 7 + 2 * Math.sin(t * 8), 0, TAU);
      ctx.stroke();
    }

    // A seed carrier labours along: its feet kick up dust, thicker on the last stretch.
    for (const p of game.players) {
      const v = Math.hypot(p.vx, p.vy);
      if (!p.carrying || v < 20 || p.swing || t < (dustAt.get(p.id) || 0)) continue;
      const heavy = lastStretch(game, p);
      dustAt.set(p.id, t + (heavy ? 0.06 : 0.1));
      const side = (Math.random() - 0.5) * 12;
      dust.push({
        x: p.x - (p.vx / v) * 17 - (p.vy / v) * side,
        y: p.y - (p.vy / v) * 17 + (p.vx / v) * side,
        r: heavy ? 8 : 6,
        t: 0,
        life: heavy ? 0.7 : 0.5,
      });
    }
    for (let i = dust.length - 1; i >= 0; i--) {
      const e = dust[i];
      e.t += dt;
      if (e.t >= e.life) {
        dust.splice(i, 1);
        continue;
      }
      const k = e.t / e.life;
      ctx.fillStyle = `rgba(255, 248, 228, ${0.85 * (1 - k)})`;
      ctx.strokeStyle = `rgba(120, 90, 60, ${0.4 * (1 - k)})`;
      ctx.lineWidth = 1.2;
      circle(ctx, e.x, e.y, e.r * (0.6 + 0.9 * k));
      ctx.stroke();
    }

    // Draw back to front as seen on screen.
    const depth = (p) => (portrait ? -p.x : p.y);
    const order = [...game.players].sort((a, c) => depth(a) - depth(c));
    for (const p of order) {
      const look = lookOf(p);
      const face = toScreenDir(p.fx, p.fy);
      upright(p.x, p.y, () => {
        if (p.carrying) {
          // The seed carrier is the one everybody needs to find: a glow and a
          // turning ring mark it, and close to home they turn into a red alarm.
          const near = nearHome(game, p);
          const beat = 0.5 + 0.5 * Math.sin(t * (near ? 14 : 7));
          const glow = ctx.createRadialGradient(0, 0, 6, 0, 0, 46);
          glow.addColorStop(0, near ? 'rgba(255, 60, 40, 0.5)' : 'rgba(255, 215, 60, 0.5)');
          glow.addColorStop(1, near ? 'rgba(255, 60, 40, 0)' : 'rgba(255, 215, 60, 0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(0, 0, 46, 0, TAU);
          ctx.fill();
          ctx.save();
          ctx.rotate(t * 2.2);
          ctx.setLineDash([12, 8]);
          ctx.lineWidth = 3.5;
          ctx.strokeStyle = near ? `rgba(240, 40, 30, ${0.75 + 0.25 * beat})` : `rgba(255, 190, 30, ${0.65 + 0.3 * beat})`;
          ctx.beginPath();
          ctx.arc(0, 0, 27 + 2 * beat, 0, TAU);
          ctx.stroke();
          ctx.restore();
          if (near) {
            // A red circle that keeps closing in on the carrier.
            const k = (t * 1.4) % 1;
            ctx.lineWidth = 5;
            ctx.strokeStyle = `rgba(235, 30, 30, ${0.9 - 0.5 * k})`;
            ctx.beginPath();
            ctx.arc(0, 0, 62 - 26 * k, 0, TAU);
            ctx.stroke();
            ctx.lineWidth = 4;
            ctx.strokeStyle = 'rgba(235, 30, 30, 0.95)';
            ctx.beginPath();
            ctx.arc(0, 0, 36, 0, TAU);
            ctx.stroke();
          }
        }
        drawHamster(ctx, {
          x: 0,
          y: 0,
          fx: face.x,
          fy: face.y,
          moving: Math.hypot(p.vx, p.vy) > 20 && !p.swing,
          carrying: p.carrying,
          swing: p.swing,
          look,
          t: t + p.id * 1.7,
        });
        if (lastStretch(game, p) && Math.hypot(p.vx, p.vy) > 20) {
          // So close, and so heavy: sweat flies off its brow.
          for (let i = 0; i < 4; i++) {
            const k = (t * 1.9 + i / 4 + p.id * 0.37) % 1;
            const side = i % 2 ? 1 : -1;
            const sx = side * (12 + 16 * k);
            const sy = -16 - 18 * k + 24 * k * k;
            ctx.fillStyle = `rgba(120, 200, 255, ${0.95 * (1 - k)})`;
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * (1 - k)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(sx - side * 3, sy - 8);
            ctx.quadraticCurveTo(sx + 5.5, sy, sx, sy + 4);
            ctx.quadraticCurveTo(sx - 5.5, sy, sx - side * 3, sy - 8);
            ctx.fill();
            ctx.stroke();
          }
        }
        if (p.gather > 0) {
          ctx.lineCap = 'round';
          ctx.lineWidth = 5;
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
          ctx.beginPath();
          ctx.arc(0, 0, 23, 0, TAU);
          ctx.stroke();
          ctx.strokeStyle = '#ffd23f';
          ctx.beginPath();
          ctx.arc(0, 0, 23, -Math.PI / 2, -Math.PI / 2 + (p.gather / gatherTime(game.players.length)) * TAU);
          ctx.stroke();
        }
        // In the ring but not first in line: waiting for a turn at the flower.
        if (p.queued >= 0 && game.nibbler >= 0 && game.nibbler !== p.id) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          for (let i = 0; i < 3; i++) circle(ctx, -7 + i * 7, -24 - 2 * Math.max(0, Math.sin(t * 6 - i)), 2.4);
        }
        if (p.id === view.meId && p.cooldown > 0) {
          const half = 0.9 * (p.cooldown / BONK.cooldown);
          ctx.lineCap = 'round';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.beginPath();
          ctx.arc(0, 4, 21, Math.PI * 0.5 - half, Math.PI * 0.5 + half);
          ctx.stroke();
        }
      });
    }

    for (const p of order) {
      const look = lookOf(p);
      const me = p.id === view.meId;
      upright(p.x, p.y, () => {
        let ly = -25;
        if (p.carrying) {
          drawSeed(ctx, 0, ly - 6 + Math.sin(t * 6) * 2, 1, 0.3);
          ly -= 20;
        }
        // A phone shows the map small, so its labels are drawn a size up.
        ctx.font = `800 ${(me ? 15 : 13) * (portrait ? 1.55 : 1)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.strokeText(p.name, 0, ly);
        ctx.fillStyle = look.color;
        ctx.fillText(p.name, 0, ly);
        // A computer's level, small, under its feet.
        const level = BOT_LEVEL[p.kind];
        if (level) {
          ctx.font = `800 ${10 * (portrait ? 1.5 : 1)}px ${FONT}`;
          ctx.lineWidth = 3;
          ctx.strokeText(tr('botLevels')[level.key], 0, portrait ? 36 : 31);
          ctx.fillStyle = level.color;
          ctx.fillText(tr('botLevels')[level.key], 0, portrait ? 36 : 31);
          ctx.fillStyle = look.color;
        }
        if (me) {
          const ay = ly - 15 + Math.sin(t * 6) * 2;
          ctx.beginPath();
          ctx.moveTo(-7, ay - 8);
          ctx.lineTo(7, ay - 8);
          ctx.lineTo(0, ay + 2);
          ctx.closePath();
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      });
    }

    // What somebody just said, in a bubble over their hamster: "name: message".
    const now = performance.now();
    for (const p of order) {
      const said = view.bubbles && view.bubbles.get(p.look);
      if (!said || said.until <= now) continue;
      upright(p.x, p.y, () => drawBubble(p, said, now));
    }

    drawFx(dt);
  }

  function drawBubble(p, said, now) {
    const size = 13 * (portrait ? 1.45 : 1);
    const maxW = 170 * (portrait ? 1.3 : 1);
    const head = `${said.name}: `;
    ctx.font = `700 ${size}px ${FONT}`;
    // Chinese, Japanese and Korean have no spaces to break at, so wrap by character.
    const lines = [''];
    for (const ch of head + said.text) {
      if (ctx.measureText(lines.at(-1) + ch).width > maxW) {
        if (lines.length === 3) {
          lines[2] = `${lines[2].slice(0, -1)}…`;
          break;
        }
        lines.push('');
      }
      lines[lines.length - 1] += ch;
    }
    const w = Math.max(...lines.map((line) => ctx.measureText(line).width)) + 16;
    const lh = size * 1.25;
    const h = lines.length * lh + 10;
    // Keep the whole bubble on screen when the hamster is near an edge.
    const sx = portrait ? p.y : p.x;
    const sy = portrait ? WORLD.w - p.x : p.y;
    const vw = portrait ? WORLD.h : WORLD.w;
    const cx = Math.min(Math.max(sx, w / 2 + 4), vw - w / 2 - 4) - sx;
    const top = Math.max(-(p.carrying ? 58 : 34) - h, 4 - sy);
    ctx.globalAlpha = Math.min(1, (said.until - now) / 400);
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, top, w, h, 9);
    ctx.moveTo(-5, top + h - 1);
    ctx.lineTo(0, top + h + 7);
    ctx.lineTo(5, top + h - 1);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colorOf(p);
    ctx.stroke();
    ctx.textAlign = 'left';
    lines.forEach((line, i) => {
      const y = top + 5 + lh * (i + 0.78);
      ctx.fillStyle = '#3a2a1a';
      ctx.fillText(line, cx - w / 2 + 8, y);
      // The name stands out in the speaker's colour.
      if (i === 0) {
        const shown = line.slice(0, head.length - 1);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
        ctx.fillRect(cx - w / 2 + 7, top + 4, ctx.measureText(shown).width + 1, lh);
        ctx.fillStyle = colorOf(p);
        ctx.fillText(shown, cx - w / 2 + 8, y);
      }
    });
    ctx.globalAlpha = 1;
  }

  return { resize, draw, onEvent, toWorld, toWorldDir, clear: () => (fx.length = dust.length = 0) };
}
