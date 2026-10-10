// Deterministic game simulation. It knows nothing about the DOM, input devices or
// who is a bot: every tick it takes one input per player and advances the world.
// Human, bot and (later) network players all feed it through the same input shape:
//   { mx, my, bonk, ax?, ay? }   move vector, bonk button, optional aim direction

import { DT, SPEED, CARRY_SPEED, HAMSTER_R, GATHER_TIME, COUNTDOWN, BONK, OVERTIME } from './constants.js';
import { MAP, resolveCollisions, segmentClear } from './map.js';
import { mulberry32 } from './rng.js';

export const EMPTY_INPUT = Object.freeze({ mx: 0, my: 0, bonk: false });

// Inside the burrow nobody can bonk or be bonked, and a carrier who gets here wins.
export function inHome(g, p) {
  return p.x < g.homeX;
}

export function createGame({ slots, map = MAP, seed = 1 }) {
  const rng = mulberry32(seed);
  const nests = map.nests.map((n) => ({ ...n }));
  for (let i = nests.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [nests[i], nests[j]] = [nests[j], nests[i]];
  }
  const players = slots.map((slot, id) => ({
    id,
    name: slot.name,
    kind: slot.kind,
    look: slot.look ?? id,
    nest: nests[id],
    x: nests[id].x,
    y: nests[id].y,
    vx: 0,
    vy: 0,
    fx: 1,
    fy: 0,
    carrying: false,
    gather: 0,
    swing: null,
    cooldown: 0,
    bonkHeld: false,
    kills: 0,
    deaths: 0,
    seeds: 0,
  }));
  return {
    map,
    tick: 0,
    time: 0,
    phase: 'countdown',
    countdown: COUNTDOWN,
    homeX: map.home.x2,
    players,
    winner: null,
    events: [],
  };
}

function pickAim(g, p, inp, mx, my, moveLen) {
  const al = Math.hypot(inp.ax || 0, inp.ay || 0);
  if (al > 1e-6) return { x: inp.ax / al, y: inp.ay / al };
  let best = null;
  let bestD = BONK.assist;
  for (const e of g.players) {
    if (e === p || inHome(g, e)) continue;
    const tx = e.x + e.vx * BONK.windup - p.x;
    const ty = e.y + e.vy * BONK.windup - p.y;
    const d = Math.hypot(tx, ty);
    if (d < bestD && d > 1e-6) {
      bestD = d;
      best = { x: tx / d, y: ty / d };
    }
  }
  if (best) return best;
  if (moveLen > 0.05) return { x: mx / moveLen, y: my / moveLen };
  return { x: p.fx, y: p.fy };
}

function respawn(g, p) {
  p.x = p.nest.x;
  p.y = p.nest.y;
  p.vx = 0;
  p.vy = 0;
  p.carrying = false;
  p.gather = 0;
  p.swing = null;
  p.cooldown = 0;
  p.deaths++;
  g.events.push({ type: 'spawn', id: p.id, x: p.x, y: p.y });
}

export function step(g, inputs) {
  g.events.length = 0;
  if (g.phase === 'over') return g;
  g.tick++;

  if (g.phase === 'countdown') {
    const before = Math.ceil(g.countdown - 1e-9);
    g.countdown -= DT;
    if (g.countdown <= 1e-9) {
      g.phase = 'playing';
      g.events.push({ type: 'go' });
    } else {
      const after = Math.ceil(g.countdown - 1e-9);
      if (after !== before) g.events.push({ type: 'count', n: after });
    }
    return g;
  }

  g.time += DT;
  const { map, players } = g;
  if (g.time > OVERTIME.start) {
    if (g.homeX === map.home.x2) g.events.push({ type: 'overtime' });
    const limit = map.flower.x - map.flower.gatherR - 20;
    g.homeX = Math.min(limit, map.home.x2 + (g.time - OVERTIME.start) * OVERTIME.speed);
  }
  const landing = [];

  for (const p of players) {
    const inp = inputs[p.id] || EMPTY_INPUT;
    p.cooldown = Math.max(0, p.cooldown - DT);

    let mx = +inp.mx || 0;
    let my = +inp.my || 0;
    let len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
      len = 1;
    }

    const pressed = !!inp.bonk && !p.bonkHeld;
    p.bonkHeld = !!inp.bonk;
    if (pressed && !p.swing && p.cooldown <= 0 && !inHome(g, p)) {
      const aim = pickAim(g, p, inp, mx, my, len);
      p.swing = { phase: 'windup', t: 0, dx: aim.x, dy: aim.y };
      p.fx = aim.x;
      p.fy = aim.y;
      p.cooldown = BONK.cooldown;
      g.events.push({ type: 'swing', id: p.id });
    }

    const speed = SPEED * (p.carrying ? CARRY_SPEED : 1);
    if (p.swing) {
      p.swing.t += DT;
      if (p.swing.phase === 'windup') {
        p.vx = p.swing.dx * SPEED * BONK.lunge;
        p.vy = p.swing.dy * SPEED * BONK.lunge;
        if (p.swing.t >= BONK.windup - 1e-9) {
          p.swing.phase = 'recovery';
          p.swing.t = 0;
          landing.push(p);
        }
      } else {
        p.vx = mx * speed * BONK.recoveryMove;
        p.vy = my * speed * BONK.recoveryMove;
        if (p.swing.t >= BONK.recovery - 1e-9) p.swing = null;
      }
    } else {
      p.vx = mx * speed;
      p.vy = my * speed;
      if (len > 0.05) {
        p.fx = mx / len;
        p.fy = my / len;
      }
    }

    p.x += p.vx * DT;
    p.y += p.vy * DT;
    resolveCollisions(map, p, HAMSTER_R);
  }

  // Every hit that lands this tick is judged against the same positions, so two
  // hamsters that connect on the same tick knock each other out.
  const bonked = new Set();
  for (const a of landing) {
    let hit = false;
    if (!inHome(g, a)) {
      for (const v of players) {
        if (v === a || inHome(g, v)) continue;
        const dx = v.x - a.x;
        const dy = v.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > BONK.reach) continue;
        if (d > HAMSTER_R && (dx * a.swing.dx + dy * a.swing.dy) / d < BONK.arcCos) continue;
        if (!segmentClear(map, a.x, a.y, v.x, v.y, 0)) continue;
        hit = true;
        bonked.add(v);
        a.kills++;
        g.events.push({ type: 'bonk', by: a.id, id: v.id, x: v.x, y: v.y, seed: v.carrying });
      }
    }
    g.events.push({ type: 'impact', id: a.id, x: a.x, y: a.y, dx: a.swing.dx, dy: a.swing.dy, hit });
  }
  for (const v of bonked) respawn(g, v);

  const f = map.flower;
  for (const p of players) {
    if (p.carrying) {
      if (inHome(g, p)) {
        g.phase = 'over';
        g.winner = p.id;
        g.events.push({ type: 'win', id: p.id });
        break;
      }
      continue;
    }
    if (Math.hypot(p.x - f.x, p.y - f.y) > f.gatherR) {
      p.gather = 0;
    } else if (!p.swing) {
      p.gather += DT;
      if (p.gather >= GATHER_TIME - 1e-9) {
        p.gather = 0;
        p.carrying = true;
        p.seeds++;
        g.events.push({ type: 'seed', id: p.id });
      }
    }
  }
  return g;
}
