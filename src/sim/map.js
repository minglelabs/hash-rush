// The one map: burrow (home) on the left, the sunflower on the right, and three
// lanes between them cut through a hedge. A lane is only one hamster wide, so
// nobody can squeeze past anybody: a blocked lane means fighting or going around.
// A cross lane in the middle links all three.

export const WORLD = { w: 1280, h: 720 };

const LANE_W = 40;
const LANE_YS = [180, 360, 540];
const HEDGE_X1 = 270;
const HEDGE_X2 = 990;
const CROSS_X = 630;
// Hedge corners are rounded, which funnels a hamster into a lane mouth.
const CORNER = 20;

const BOUNDS = { x1: 24, y1: 24, x2: 1256, y2: 696 };
const FLOWER = { x: 1135, y: 360, r: 30, gatherR: 66 };
const HOME = { x1: 24, y1: 24, x2: 190, y2: 696 };

// Nests sit on an arc so every hamster starts the same distance from the middle lane.
const NEST_ARC = { cx: HOME.x2, cy: 360, r: 125, angles: [-36, -12, 12, 36] };

function buildHedges() {
  const half = LANE_W / 2;
  const rows = [];
  let top = BOUNDS.y1;
  for (const y of LANE_YS) {
    rows.push([top, y - half]);
    top = y + half;
  }
  rows.push([top, BOUNDS.y2]);
  const hedges = [];
  rows.forEach(([y1, y2], i) => {
    const outer = i === 0 || i === rows.length - 1;
    const spans = outer
      ? [[HEDGE_X1, HEDGE_X2]]
      : [
          [HEDGE_X1, CROSS_X - half],
          [CROSS_X + half, HEDGE_X2],
        ];
    for (const [x1, x2] of spans) hedges.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  });
  return hedges;
}

function ring(c, radius, count) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    pts.push({ x: c.x + Math.cos(a) * radius, y: c.y + Math.sin(a) * radius });
  }
  return pts;
}

const GATHER_SPOTS = ring(FLOWER, 55, 8);

// Navigation waypoints: lane mouths, the crossings, and a few points in each room.
function buildWaypoints() {
  const pts = [];
  for (const y of LANE_YS) {
    pts.push({ x: HEDGE_X1 - 40, y }, { x: CROSS_X, y }, { x: HEDGE_X2 + 40, y });
    pts.push({ x: 110, y });
  }
  pts.push(...GATHER_SPOTS);
  return pts;
}

export const MAP = {
  name: '해바라기 밭',
  bounds: BOUNDS,
  home: HOME,
  nests: NEST_ARC.angles.map((deg) => {
    const a = (deg * Math.PI) / 180;
    return { x: NEST_ARC.cx - Math.cos(a) * NEST_ARC.r, y: NEST_ARC.cy + Math.sin(a) * NEST_ARC.r };
  }),
  flower: FLOWER,
  rects: buildHedges(),
  corner: CORNER,
  laneYs: LANE_YS,
  laneWidth: LANE_W,
  // Anyone standing between these x values is inside a lane.
  lanes: { x1: HEDGE_X1, x2: HEDGE_X2 },
  waypoints: buildWaypoints(),
  gatherSpots: GATHER_SPOTS,
};

// Hedges collide as rounded rectangles: a core rect grown by the corner radius.
function pushOutHedge(p, r, rect, corner) {
  const x1 = rect.x + corner;
  const y1 = rect.y + corner;
  const x2 = rect.x + rect.w - corner;
  const y2 = rect.y + rect.h - corner;
  const cx = Math.max(x1, Math.min(p.x, x2));
  const cy = Math.max(y1, Math.min(p.y, y2));
  const dx = p.x - cx;
  const dy = p.y - cy;
  const min = r + corner;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    p.x = cx + (dx / d) * min;
    p.y = cy + (dy / d) * min;
    return;
  }
  // Centre is inside the core: leave through the nearest side.
  const left = p.x - rect.x;
  const right = rect.x + rect.w - p.x;
  const top = p.y - rect.y;
  const bottom = rect.y + rect.h - p.y;
  const m = Math.min(left, right, top, bottom);
  if (m === left) p.x = rect.x - r;
  else if (m === right) p.x = rect.x + rect.w + r;
  else if (m === top) p.y = rect.y - r;
  else p.y = rect.y + rect.h + r;
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
    for (const rect of map.rects) pushOutHedge(p, r, rect, map.corner);
    pushOutCircle(p, r, map.flower);
    p.x = Math.max(b.x1 + r, Math.min(p.x, b.x2 - r));
    p.y = Math.max(b.y1 + r, Math.min(p.y, b.y2 - r));
  }
}

function pointRectDistance(px, py, x1, y1, x2, y2) {
  return Math.hypot(px - Math.max(x1, Math.min(px, x2)), py - Math.max(y1, Math.min(py, y2)));
}

// True when a circle of radius `pad` at (x, y) touches no obstacle.
export function isFree(map, x, y, pad = 0) {
  const c = map.corner;
  for (const r of map.rects) {
    if (pointRectDistance(x, y, r.x + c, r.y + c, r.x + r.w - c, r.y + r.h - c) < c + pad) return false;
  }
  return Math.hypot(x - map.flower.x, y - map.flower.y) >= map.flower.r + pad;
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

function segmentRectDistance(ax, ay, bx, by, x1, y1, x2, y2) {
  if (segmentHitsRect(ax, ay, bx, by, x1, y1, x2, y2)) return 0;
  return Math.min(
    pointRectDistance(ax, ay, x1, y1, x2, y2),
    pointRectDistance(bx, by, x1, y1, x2, y2),
    distToSegment(x1, y1, ax, ay, bx, by),
    distToSegment(x2, y1, ax, ay, bx, by),
    distToSegment(x1, y2, ax, ay, bx, by),
    distToSegment(x2, y2, ax, ay, bx, by),
  );
}

// True when a straight line from a to b stays `pad` away from every obstacle.
export function segmentClear(map, ax, ay, bx, by, pad = 0) {
  const c = map.corner;
  for (const r of map.rects) {
    if (segmentRectDistance(ax, ay, bx, by, r.x + c, r.y + c, r.x + r.w - c, r.y + r.h - c) < c + pad) return false;
  }
  const f = map.flower;
  return distToSegment(f.x, f.y, ax, ay, bx, by) >= f.r + pad;
}
