// The one map: burrow (home) on the left, the sunflower on the right, and a hedge
// maze between them. Three winding lanes run through it, joined by a few cross
// links. A lane is only one hamster wide, so nobody can squeeze past anybody: a
// blocked lane means fighting or going around.

export const WORLD = { w: 1280, h: 720 };

const CELL = 40;
const COLS = 18;
const ROWS = 17;
const HEDGE_X1 = 270;
const HEDGE_X2 = HEDGE_X1 + COLS * CELL;
// Hedge corners are rounded, which funnels a hamster into a lane mouth.
const CORNER = 20;

const BOUNDS = { x1: 24, y1: 20, x2: 1256, y2: 20 + ROWS * CELL };
const FLOWER = { x: 1135, y: 360, r: 30, gatherR: 66 };
const HOME = { x1: BOUNDS.x1, y1: BOUNDS.y1, x2: 190, y2: BOUNDS.y2 };

// Lanes as runs of grid cells: [col, row, col, row], straight in one direction.
const LANES = [
  // top
  [0, 2, 3, 2], [3, 2, 3, 5], [3, 5, 8, 5], [8, 5, 8, 2], [8, 2, 12, 2], [12, 2, 12, 5], [12, 5, 17, 5],
  // middle
  [0, 7, 4, 7], [4, 7, 4, 9], [4, 9, 9, 9], [9, 9, 9, 7], [9, 7, 13, 7], [13, 7, 13, 9], [13, 9, 17, 9],
  // bottom
  [0, 14, 3, 14], [3, 14, 3, 11], [3, 11, 8, 11], [8, 11, 8, 14], [8, 14, 12, 14], [12, 14, 12, 11], [12, 11, 17, 11],
  // cross links
  [6, 5, 6, 9], [7, 9, 7, 11], [12, 5, 12, 7], [15, 9, 15, 11],
];

// Nests sit on an arc so every hamster starts the same distance from the middle lane.
const NEST_ARC = { cx: HOME.x2, cy: 360, r: 125, angles: [-36, -12, 12, 36] };

const cellX = (c) => HEDGE_X1 + c * CELL + CELL / 2;
const cellY = (r) => BOUNDS.y1 + r * CELL + CELL / 2;

function carve() {
  const open = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
  for (const [c1, r1, c2, r2] of LANES) {
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
      for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) open[r][c] = true;
    }
  }
  return open;
}

const OPEN = carve();
const isOpen = (c, r) => r >= 0 && r < ROWS && c >= 0 && c < COLS && OPEN[r][c];

// Every hedge cell is covered by its longest horizontal and vertical run. The two
// sets overlap, so the union only has rounded corners where the hedge really ends.
function buildHedges() {
  const rects = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (OPEN[r][c] || (c > 0 && !OPEN[r][c - 1])) continue;
      let end = c;
      while (end + 1 < COLS && !OPEN[r][end + 1]) end++;
      rects.push({ x: HEDGE_X1 + c * CELL, y: BOUNDS.y1 + r * CELL, w: (end - c + 1) * CELL, h: CELL });
    }
  }
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (OPEN[r][c] || (r > 0 && !OPEN[r - 1][c])) continue;
      let end = r;
      while (end + 1 < ROWS && !OPEN[end + 1][c]) end++;
      if (end > r) rects.push({ x: HEDGE_X1 + c * CELL, y: BOUNDS.y1 + r * CELL, w: CELL, h: (end - r + 1) * CELL });
    }
  }
  return rects;
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
// Rows where a lane opens into the burrow side and the flower side.
const HOME_MOUTHS = [];
const FLOWER_MOUTHS = [];
for (let r = 0; r < ROWS; r++) {
  if (OPEN[r][0]) HOME_MOUTHS.push(cellY(r));
  if (OPEN[r][COLS - 1]) FLOWER_MOUTHS.push(cellY(r));
}

// Navigation waypoints: every bend, junction and lane mouth, plus a few points
// in each room.
function buildWaypoints() {
  const pts = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!OPEN[r][c]) continue;
      const w = isOpen(c - 1, r) || c === 0;
      const e = isOpen(c + 1, r) || c === COLS - 1;
      const n = isOpen(c, r - 1);
      const s = isOpen(c, r + 1);
      const straight = (w && e && !n && !s) || (n && s && !w && !e);
      if (!straight) pts.push({ x: cellX(c), y: cellY(r) });
    }
  }
  for (const y of HOME_MOUTHS) pts.push({ x: HEDGE_X1 - 40, y }, { x: 110, y });
  for (const y of FLOWER_MOUTHS) pts.push({ x: HEDGE_X2 + 40, y });
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
  // Where the lanes open on the burrow side, top to bottom.
  laneYs: HOME_MOUTHS,
  laneWidth: CELL,
  rowYs: Array.from({ length: ROWS }, (_, r) => cellY(r)),
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
