// What a map throws at the hamsters: mole traps in the desert, seed cannons in the
// factory, waves on the beach, and in the sky all of them by turns. Each one gives
// a warning first (`warn` seconds) so it can be seen coming, then does its thing.
// Gates and ice belong to the map; this file only says when they are there.

import { DT, HAMSTER_R, THROW } from './constants.js';
import { segmentClear, distToSegment, gatesAt } from './map.js';

export const HAZARD = {
  // A mole's pit. Whoever steps in goes home, and that fills it in. Two at a time.
  trap: { warn: 1.6, live: 7, max: 2, every: [1.2, 2.8], r: 20 },
  // A cannon pokes out of a wall and fires a seed down the lane, as far as a hamster
  // throws. The seed is a real thing in flight: it takes whoever it touches, when
  // it touches them.
  cannon: { warn: 1.5, speed: 480, max: 3, every: [0.7, 1.6], range: THROW.range, width: THROW.width },
  // A wave washes over a patch of ground. Whoever it catches stays wet, and slow,
  // for `wet` seconds after getting out of the water. `slow` is the share of full
  // speed that wet fur takes off, on top of what a seed already takes.
  wave: { warn: 1.5, live: 3.2, max: 4, every: [0.7, 1.5], r: 78, wet: 5, slow: 0.2 },
};

// The sky map turns from day to night and back. By day it has pits and waves, by
// night gates and ice; cannons never stop. `omen` is how long before nightfall the
// gates and the ice show themselves.
export const SKY = { period: 48, night: 24, omen: 1.5 };
const skyClock = (time) => ((time % SKY.period) + SKY.period) % SKY.period;
export const isNight = (map, time) => !!map.cycle && skyClock(time) >= SKY.night;
// Seconds until night falls, for the warning; Infinity on maps without a sky.
export const untilNight = (map, time) => (map.cycle && skyClock(time) < SKY.night ? SKY.night - skyClock(time) : Infinity);

// Which kinds of trouble turn up on this map right now.
export function kindsNow(map, time) {
  if (map.cycle) return isNight(map, time) ? ['cannon'] : ['cannon', 'trap', 'wave'];
  return map.hazard ? [map.hazard] : [];
}

// The slippery patches right now.
export const iceNow = (map, time) => (map.cycle && !isNight(map, time) ? [] : map.ice);

// The gates that are in the way right now. A gate the burrow has swallowed in
// overtime is gone: nothing gets in a hamster's way at home.
export function gatesNow(map, time, homeX) {
  if (!map.gates.length || (map.cycle && !isNight(map, time))) return [];
  return gatesAt(map, time).filter((r) => r.x + r.w / 2 >= homeX);
}

const between = (rng, [a, b]) => a + rng() * (b - a);
const outside = (g, p) => p.x >= g.homeX;
const life = (kind) => (kind === 'cannon' ? HAZARD.cannon.range / HAZARD.cannon.speed + 0.05 : HAZARD[kind].live);

function place(g, kind) {
  const { map, rng } = g;
  for (let tries = 0; tries < 12; tries++) {
    if (kind === 'cannon') {
      const s = map.cannonSpots[Math.floor(rng() * map.cannonSpots.length)];
      if (s.x < g.homeX + 40 || g.hazards.some((h) => h.x === s.x && h.y === s.y)) continue;
      return { kind, x: s.x, y: s.y, dx: s.dx, dy: s.dy, age: 0 };
    }
    if (kind === 'trap') {
      const c = map.cells[Math.floor(rng() * map.cells.length)];
      if (c.x < g.homeX + 60 || g.hazards.some((h) => Math.hypot(h.x - c.x, h.y - c.y) < 90)) continue;
      return { kind, x: c.x, y: c.y, age: 0 };
    }
    const b = map.bounds;
    const x = map.lanes.x1 - 20 + rng() * (b.x2 - 60 - map.lanes.x1);
    const y = b.y1 + 50 + rng() * (b.y2 - b.y1 - 100);
    if (x < g.homeX + 60) continue;
    return { kind, x, y, age: 0 };
  }
  return null;
}

// Whether a hamster at p is in a cannon's line of fire.
export function inCannonLine(map, h, p) {
  const dx = p.x - h.x;
  const dy = p.y - h.y;
  const along = dx * h.dx + dy * h.dy;
  if (along < -HAMSTER_R || along > HAZARD.cannon.range) return false;
  return Math.abs(dx * h.dy - dy * h.dx) <= HAZARD.cannon.width && segmentClear(map, h.x, h.y, p.x, p.y, 0);
}

// How far along its line a cannon's seed has flown, or -1 before it is fired.
export function shotAt(h) {
  const spec = HAZARD.cannon;
  return h.age < spec.warn ? -1 : Math.min(spec.range, (h.age - spec.warn) * spec.speed);
}

// Advances the hazards by one tick and returns the hamsters they knocked out.
export function stepHazards(g) {
  const { map, players } = g;
  const out = [];
  for (const p of players) p.wet = Math.max(0, (p.wet || 0) - DT);

  for (const kind of g.calm ? [] : kindsNow(map, g.time)) {
    const spec = HAZARD[kind];
    if (g.hazards.filter((h) => h.kind === kind).length >= spec.max || g.time < (g.hazardAt[kind] ?? 2)) continue;
    const h = place(g, kind);
    if (h) {
      g.hazards.push(h);
      g.events.push({ type: 'omen', kind, x: h.x, y: h.y });
    }
    g.hazardAt[kind] = g.time + between(g.rng, spec.every);
  }

  for (const h of g.hazards) {
    const { kind } = h;
    const spec = HAZARD[kind];
    const before = kind === 'cannon' ? shotAt(h) : 0;
    const was = h.age;
    h.age += DT;
    const live = h.age >= spec.warn - 1e-9;
    if (!live) continue;
    const fresh = was < spec.warn - 1e-9;
    if (kind === 'cannon') {
      if (fresh) g.events.push({ type: 'cannon', x: h.x, y: h.y, dx: h.dx, dy: h.dy });
      // The stretch the seed covered this tick. A hamster it passed over is hit;
      // one that steps into the line behind it, or ahead of where it has got to, is not.
      const from = Math.max(0, before);
      const to = shotAt(h);
      for (const p of players) {
        if (!outside(g, p) || out.includes(p)) continue;
        const dx = p.x - h.x;
        const dy = p.y - h.y;
        const along = dx * h.dx + dy * h.dy;
        if (along < from - HAMSTER_R || along > to + HAMSTER_R || Math.abs(dx * h.dy - dy * h.dx) > spec.width) continue;
        if (!segmentClear(map, h.x, h.y, p.x, p.y, 0)) continue;
        out.push(p);
        g.events.push({ type: 'zap', kind, id: p.id, x: p.x, y: p.y, seed: p.carrying });
      }
    } else if (kind === 'trap') {
      const victim = players.find((p) => outside(g, p) && !out.includes(p) && Math.hypot(p.x - h.x, p.y - h.y) < spec.r);
      if (victim) {
        out.push(victim);
        // Sprung: the pit is gone.
        h.age = Infinity;
        g.events.push({ type: 'zap', kind, id: victim.id, x: victim.x, y: victim.y, seed: victim.carrying });
      }
    } else if (kind === 'wave') {
      if (fresh) g.events.push({ type: 'splash', x: h.x, y: h.y });
      for (const p of players) if (outside(g, p) && Math.hypot(p.x - h.x, p.y - h.y) < spec.r) p.wet = spec.wet;
    }
  }
  g.hazards = g.hazards.filter((h) => h.age < HAZARD[h.kind].warn + life(h.kind));
  return out;
}

// Extra path cost for legs that run through trouble, for the bots' route finding:
// a pit or a cannon's line of fire, warned or live, and a gate that is in the way.
// `pace` ({ x, y, v }) is for a bot that times a cannon: where it is and how fast
// it walks. A line it will be through before the cannon fires, or will only reach
// once the seed has landed, costs it nothing.
export function hazardCost(g, pace) {
  const { map } = g;
  const gates = g.gates || [];
  if (!g.hazards.length && !gates.length) return () => 0;
  return (p, q) => {
    let c = 0;
    for (const h of g.hazards) {
      if (h.kind === 'trap') {
        if (distToSegment(h.x, h.y, p.x, p.y, q.x, q.y) < HAZARD.trap.r + 6) c += 2500;
      } else if (h.kind === 'cannon') {
        const ex = h.x + h.dx * HAZARD.cannon.range;
        const ey = h.y + h.dy * HAZARD.cannon.range;
        const near = Math.min(distToSegment(p.x, p.y, h.x, h.y, ex, ey), distToSegment(q.x, q.y, h.x, h.y, ex, ey), distToSegment(h.x, h.y, p.x, p.y, q.x, q.y), distToSegment(ex, ey, p.x, p.y, q.x, q.y));
        if (near < HAZARD.cannon.width && segmentClear(map, h.x, h.y, (p.x + q.x) / 2, (p.y + q.y) / 2, 0)) {
          if (pace) {
            const reach = Math.min(Math.hypot(p.x - pace.x, p.y - pace.y), Math.hypot(q.x - pace.x, q.y - pace.y)) / pace.v;
            const left = HAZARD.cannon.warn - h.age;
            if (left > reach + 0.6 || reach > left + HAZARD.cannon.range / HAZARD.cannon.speed + 0.1) continue;
          }
          c += 1200;
        }
      }
    }
    for (const r of gates) {
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      if (distToSegment(cx, cy, p.x, p.y, q.x, q.y) < Math.max(r.w, r.h) / 2 + 4) c += 500;
    }
    return c;
  };
}
