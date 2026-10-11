// What a map throws at the hamsters: mole traps in the desert, seed cannons in the
// factory, waves on the beach. Each one gives a warning first (`warn` seconds) so it
// can be seen coming, then does its thing. Gates and ice are part of the map itself
// and live with the movement code.

import { DT, HAMSTER_R, THROW } from './constants.js';
import { segmentClear, distToSegment } from './map.js';

export const HAZARD = {
  // A mole's pit. Whoever steps in goes home, and that fills it in. Two at a time.
  trap: { warn: 1.6, live: 7, max: 2, every: [1.2, 2.8], r: 20 },
  // A cannon pokes out of a wall and fires a seed down the lane, as far as a hamster throws.
  cannon: { warn: 1.5, live: 0.35, max: 3, every: [0.7, 1.6], range: THROW.range, width: THROW.width },
  // A wave washes over a patch of ground and leaves it wet for a while.
  wave: { warn: 1.5, live: 3.2, max: 2, every: [1.8, 3.6], r: 78, wet: 3, slow: 0.9 },
};

const between = (rng, [a, b]) => a + rng() * (b - a);
const outside = (g, p) => p.x >= g.homeX;

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

// Advances the hazards by one tick and returns the hamsters they knocked out.
export function stepHazards(g) {
  const { map, players } = g;
  const out = [];
  const kind = map.hazard;
  for (const p of players) p.wet = Math.max(0, (p.wet || 0) - DT);
  if (!kind) return out;
  const spec = HAZARD[kind];

  if (g.hazards.length < spec.max && g.time >= g.hazardAt) {
    const h = place(g, kind);
    if (h) {
      g.hazards.push(h);
      g.events.push({ type: 'omen', kind, x: h.x, y: h.y });
    }
    g.hazardAt = g.time + between(g.rng, spec.every);
  }

  for (const h of g.hazards) {
    const was = h.age;
    h.age += DT;
    const live = h.age >= spec.warn - 1e-9;
    if (kind === 'cannon') {
      // It fires once, the moment the warning is over.
      if (live && was < spec.warn - 1e-9) {
        const hit = players.filter((p) => outside(g, p) && !out.includes(p) && inCannonLine(map, h, p));
        out.push(...hit);
        g.events.push({ type: 'cannon', x: h.x, y: h.y, dx: h.dx, dy: h.dy, hit: hit.length });
        for (const p of hit) g.events.push({ type: 'zap', kind, id: p.id, x: p.x, y: p.y, seed: p.carrying });
      }
    } else if (kind === 'trap') {
      if (!live) continue;
      const victim = players.find((p) => outside(g, p) && !out.includes(p) && Math.hypot(p.x - h.x, p.y - h.y) < spec.r);
      if (victim) {
        out.push(victim);
        // Sprung: the pit is gone.
        h.age = Infinity;
        g.events.push({ type: 'zap', kind, id: victim.id, x: victim.x, y: victim.y, seed: victim.carrying });
      }
    } else if (kind === 'wave') {
      if (live && was < spec.warn - 1e-9) g.events.push({ type: 'splash', x: h.x, y: h.y });
      if (live) for (const p of players) if (outside(g, p) && Math.hypot(p.x - h.x, p.y - h.y) < spec.r) p.wet = spec.wet;
    }
  }
  g.hazards = g.hazards.filter((h) => h.age < spec.warn + spec.live);
  return out;
}

// Extra path cost for legs that run through trouble, for the bots' route finding:
// a pit or a cannon's line of fire, warned or live, and a gate that is in the way.
export function hazardCost(g) {
  const { map } = g;
  const gates = g.gates || [];
  if (!g.hazards.length && !gates.length) return () => 0;
  return (p, q) => {
    let c = 0;
    for (const h of g.hazards) {
      if (h.kind === 'trap') {
        if (distToSegment(h.x, h.y, p.x, p.y, q.x, q.y) < HAZARD.trap.r + 6) c += 2500;
      } else if (h.kind === 'cannon' && h.age < HAZARD.cannon.warn) {
        const ex = h.x + h.dx * HAZARD.cannon.range;
        const ey = h.y + h.dy * HAZARD.cannon.range;
        const near = Math.min(distToSegment(p.x, p.y, h.x, h.y, ex, ey), distToSegment(q.x, q.y, h.x, h.y, ex, ey), distToSegment(h.x, h.y, p.x, p.y, q.x, q.y), distToSegment(ex, ey, p.x, p.y, q.x, q.y));
        if (near < HAZARD.cannon.width && segmentClear(map, h.x, h.y, (p.x + q.x) / 2, (p.y + q.y) / 2, 0)) c += 1200;
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
