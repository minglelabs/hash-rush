// The one map: burrow (home) on the left, the sunflower on the right, three lanes
// between them, split by hedges with a crossing in the middle.

export const WORLD = { w: 1280, h: 720 };

const HEDGES = [
  { x: 250, y: 178, w: 320, h: 114 },
  { x: 690, y: 178, w: 300, h: 114 },
  { x: 250, y: 428, w: 320, h: 114 },
  { x: 690, y: 428, w: 300, h: 114 },
];
const ROCK = { x: 630, y: 360, r: 34 };
const FLOWER = { x: 1130, y: 360, r: 30, gatherR: 66 };
const HOME = { x1: 24, y1: 24, x2: 190, y2: 696 };

// Nests sit on an arc so every hamster starts the same distance from the middle lane.
const NEST_ARC = { cx: HOME.x2, cy: 360, r: 125, angles: [-36, -12, 12, 36] };

function ring(c, radius, count, offset = 0) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = offset + (i / count) * Math.PI * 2;
    pts.push({ x: c.x + Math.cos(a) * radius, y: c.y + Math.sin(a) * radius });
  }
  return pts;
}

// Navigation waypoints: a visibility graph built from points just off every corner.
function buildWaypoints() {
  const off = 22;
  const pts = [];
  for (const h of HEDGES) {
    pts.push(
      { x: h.x - off, y: h.y - off },
      { x: h.x + h.w + off, y: h.y - off },
      { x: h.x - off, y: h.y + h.h + off },
      { x: h.x + h.w + off, y: h.y + h.h + off },
    );
  }
  pts.push(...ring(ROCK, ROCK.r + 28, 8, Math.PI / 8));
  pts.push(...ring(FLOWER, 55, 8));
  pts.push({ x: 110, y: 150 }, { x: 110, y: 360 }, { x: 110, y: 570 });
  return pts;
}

export const MAP = {
  name: '해바라기 밭',
  bounds: { x1: 24, y1: 24, x2: 1256, y2: 696 },
  home: HOME,
  nests: NEST_ARC.angles.map((deg) => {
    const a = (deg * Math.PI) / 180;
    return { x: NEST_ARC.cx - Math.cos(a) * NEST_ARC.r, y: NEST_ARC.cy + Math.sin(a) * NEST_ARC.r };
  }),
  flower: FLOWER,
  rects: HEDGES,
  circles: [ROCK],
  waypoints: buildWaypoints(),
  gatherSpots: ring(FLOWER, 55, 8),
};

// True when a circle of radius `pad` at (x, y) touches no obstacle.
export function isFree(map, x, y, pad = 0) {
  for (const r of map.rects) {
    if (x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad) return false;
  }
  for (const c of map.circles) if (Math.hypot(x - c.x, y - c.y) < c.r + pad) return false;
  return Math.hypot(x - map.flower.x, y - map.flower.y) >= map.flower.r + pad;
}

function pushOutRect(p, r, rect) {
  const x2 = rect.x + rect.w;
  const y2 = rect.y + rect.h;
  const cx = Math.max(rect.x, Math.min(p.x, x2));
  const cy = Math.max(rect.y, Math.min(p.y, y2));
  const dx = p.x - cx;
  const dy = p.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    p.x = cx + (dx / d) * r;
    p.y = cy + (dy / d) * r;
    return;
  }
  // Centre is inside the rect: leave through the nearest side.
  const left = p.x - rect.x;
  const right = x2 - p.x;
  const top = p.y - rect.y;
  const bottom = y2 - p.y;
  const m = Math.min(left, right, top, bottom);
  if (m === left) p.x = rect.x - r;
  else if (m === right) p.x = x2 + r;
  else if (m === top) p.y = rect.y - r;
  else p.y = y2 + r;
}

function pushOutCircle(p, r, c) {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const min = r + c.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return;
  const d = Math.sqrt(d2);
  if (d < 1e-6) {
    p.x = c.x + min;
    return;
  }
  p.x = c.x + (dx / d) * min;
  p.y = c.y + (dy / d) * min;
}

export function resolveCollisions(map, p, r) {
  const b = map.bounds;
  for (let pass = 0; pass < 2; pass++) {
    for (const rect of map.rects) pushOutRect(p, r, rect);
    for (const c of map.circles) pushOutCircle(p, r, c);
    pushOutCircle(p, r, map.flower);
    p.x = Math.max(b.x1 + r, Math.min(p.x, b.x2 - r));
    p.y = Math.max(b.y1 + r, Math.min(p.y, b.y2 - r));
  }
}

function segmentHitsRect(ax, ay, bx, by, x1, y1, x2, y2) {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.abs(dx) < 1e-9) {
    if (ax < x1 || ax > x2) return false;
  } else {
    let ta = (x1 - ax) / dx;
    let tb = (x2 - ax) / dx;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(dy) < 1e-9) {
    if (ay < y1 || ay > y2) return false;
  } else {
    let ta = (y1 - ay) / dy;
    let tb = (y2 - ay) / dy;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 1e-9 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

// True when a straight line from a to b stays `pad` away from every obstacle.
export function segmentClear(map, ax, ay, bx, by, pad = 0) {
  for (const r of map.rects) {
    if (segmentHitsRect(ax, ay, bx, by, r.x - pad, r.y - pad, r.x + r.w + pad, r.y + r.h + pad)) return false;
  }
  for (const c of map.circles) {
    if (distToSegment(c.x, c.y, ax, ay, bx, by) < c.r + pad) return false;
  }
  const f = map.flower;
  return distToSegment(f.x, f.y, ax, ay, bx, by) >= f.r + pad;
}
