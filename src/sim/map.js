// The maps: burrow (home) on the left, the sunflower on the right, and a maze of
// walls between them. Lanes wind through it, joined by a few cross links. A lane is
// only one hamster wide, so nobody can squeeze past anybody: a blocked lane means
// fighting or going around. Every map shares the same frame and differs in its
// lanes, its look and the trouble it throws at the hamsters.

// Kept small on purpose: the whole map is always on screen, so fewer world pixels
// means bigger hamsters, which matters most on a phone.
export const WORLD = { w: 914, h: 560 };

const CELL = 40;
const COLS = 12;
const ROWS = 13;
const HEDGE_X1 = 210;
const HEDGE_X2 = HEDGE_X1 + COLS * CELL;
// Hedge corners are rounded, which funnels a hamster into a lane mouth.
const CORNER = 20;

const BOUNDS = { x1: 24, y1: 20, x2: 890, y2: 20 + ROWS * CELL };
const FLOWER = { x: 790, y: 280, r: 30, gatherR: 66 };
const HOME = { x1: BOUNDS.x1, y1: BOUNDS.y1, x2: 150, y2: BOUNDS.y2 };
// Tunnels on either side of the flower that drop a hamster straight back at its nest.
const WARPS = [
  { x: FLOWER.x, y: 64, r: 34 },
  { x: FLOWER.x, y: 496, r: 34 },
];

// Nests sit on an arc so every hamster starts the same distance from the middle lane.
// A bigger game spreads them over a wider arc so nobody spawns inside anybody.
const NEST_ARC = { cx: HOME.x2, cy: FLOWER.y, r: 100, angles: [-36, -12, 12, 36] };
const NEST_ARC_BIG = { cx: HOME.x2 + 20, cy: FLOWER.y, r: 125, angles: Array.from({ length: 8 }, (_, i) => -66 + (i * 132) / 7) };
const arcNests = ({ cx, cy, r, angles }) =>
  angles.map((deg) => {
    const a = (deg * Math.PI) / 180;
    return { x: cx - Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });

const cellX = (c) => HEDGE_X1 + c * CELL + CELL / 2;
const cellY = (r) => BOUNDS.y1 + r * CELL + CELL / 2;
// A block of cells as a world rectangle.
const cellRect = ([c1, r1, c2, r2]) => ({ x: HEDGE_X1 + c1 * CELL, y: BOUNDS.y1 + r1 * CELL, w: (c2 - c1 + 1) * CELL, h: (r2 - r1 + 1) * CELL });

function ring(c, radius, count) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    pts.push({ x: c.x + Math.cos(a) * radius, y: c.y + Math.sin(a) * radius });
  }
  return pts;
}

const GATHER_SPOTS = ring(FLOWER, 55, 8);

// Builds a map from its lanes: runs of grid cells, [col, row, col, row]. A run can
// also be a block, which makes a room.
export function buildMap({ id, lanes, theme, hazard = null, ice = [], gates = [], cycle = false }) {
  const open = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
  for (const [c1, r1, c2, r2] of lanes) {
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
      for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) open[r][c] = true;
    }
  }
  const isOpen = (c, r) => r >= 0 && r < ROWS && c >= 0 && c < COLS && open[r][c];

  // Every wall cell is covered by its longest horizontal and vertical run. The two
  // sets overlap, so the union only has rounded corners where the wall really ends.
  const rects = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (open[r][c] || (c > 0 && !open[r][c - 1])) continue;
      let end = c;
      while (end + 1 < COLS && !open[r][end + 1]) end++;
      rects.push({ x: HEDGE_X1 + c * CELL, y: BOUNDS.y1 + r * CELL, w: (end - c + 1) * CELL, h: CELL });
    }
  }
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (open[r][c] || (r > 0 && !open[r - 1][c])) continue;
      let end = r;
      while (end + 1 < ROWS && !open[end + 1][c]) end++;
      if (end > r) rects.push({ x: HEDGE_X1 + c * CELL, y: BOUNDS.y1 + r * CELL, w: CELL, h: (end - r + 1) * CELL });
    }
  }

  // Rows where a lane opens into the burrow side and the flower side.
  const homeMouths = [];
  const flowerMouths = [];
  for (let r = 0; r < ROWS; r++) {
    if (open[r][0]) homeMouths.push(cellY(r));
    if (open[r][COLS - 1]) flowerMouths.push(cellY(r));
  }

  // Navigation waypoints: every bend, junction and lane mouth, plus a few points
  // in each room.
  const waypoints = [];
  const cells = [];
  // Centres of the wall cells, where the scenery goes.
  const walls = [];
  // Where a seed cannon can pop out: a wall at its back and a lane ahead of it.
  const cannonSpots = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!open[r][c]) {
        walls.push({ x: cellX(c), y: cellY(r) });
        continue;
      }
      cells.push({ x: cellX(c), y: cellY(r) });
      const w = isOpen(c - 1, r) || c === 0;
      const e = isOpen(c + 1, r) || c === COLS - 1;
      const n = isOpen(c, r - 1);
      const s = isOpen(c, r + 1);
      const straight = (w && e && !n && !s) || (n && s && !w && !e);
      if (!straight) waypoints.push({ x: cellX(c), y: cellY(r) });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const wallBehind = !isOpen(c - dx, r - dy) && c - dx >= 0 && c - dx < COLS;
        if (wallBehind && isOpen(c + dx, r + dy)) cannonSpots.push({ x: cellX(c) - dx * 12, y: cellY(r) - dy * 12, dx, dy });
      }
    }
  }
  for (const y of homeMouths) waypoints.push({ x: HEDGE_X1 - 30, y }, { x: 80, y });
  for (const y of flowerMouths) waypoints.push({ x: HEDGE_X2 + 40, y });
  waypoints.push(...GATHER_SPOTS);

  return {
    id,
    theme,
    bounds: BOUNDS,
    home: HOME,
    nests: arcNests(NEST_ARC),
    // Used once more than four hamsters play.
    bigNests: arcNests(NEST_ARC_BIG),
    flower: FLOWER,
    warps: WARPS,
    rects,
    corner: CORNER,
    // Where the lanes open on the burrow side, top to bottom.
    laneYs: homeMouths,
    laneWidth: CELL,
    rowYs: Array.from({ length: ROWS }, (_, r) => cellY(r)),
    // Anyone standing between these x values is inside a lane.
    lanes: { x1: HEDGE_X1, x2: HEDGE_X2 },
    waypoints,
    gatherSpots: GATHER_SPOTS,
    // Centres of the open lane cells, for things that turn up at random.
    cells,
    walls,
    cannonSpots,
    // What goes wrong on this map: 'trap', 'cannon', 'wave' or nothing.
    hazard,
    // Slippery floor, as world rectangles.
    ice: ice.map(cellRect),
    gates,
    // Day and night take turns, and the trouble changes with them (the sky map).
    cycle,
  };
}

// Colours of a map: the surround, the open field, the lane floor, the burrow, the
// walls (rim, fill, two speckles, two accents) and the flecks on the ground.
const THEMES = {
  meadow: { outer: '#2f7a3d', field: '#93d36f', floor: '#ecdcae', home: '#f6e6c2', rim: '#2c7438', wall: '#3c9449', dots: ['#4fb05a', '#348540'], accents: ['#ffe3ee', '#fff6c9'], flecks: ['rgba(60, 140, 60, 0.35)', 'rgba(255, 255, 255, 0.22)'] },
  desert: { outer: '#a8732f', field: '#e9c682', floor: '#f6e3b0', home: '#fbeed0', rim: '#8a5a2b', wall: '#c08a4a', dots: ['#d3a060', '#a87438'], accents: ['#5f9e4a', '#f4d58a'], flecks: ['rgba(160, 110, 50, 0.3)', 'rgba(255, 255, 255, 0.25)'] },
  factory: { outer: '#333a47', field: '#8d96a3', floor: '#c6ccd5', home: '#e3dccb', rim: '#272d38', wall: '#566070', dots: ['#657082', '#48515f'], accents: ['#f2b705', '#1f2430'], flecks: ['rgba(40, 50, 65, 0.25)', 'rgba(255, 255, 255, 0.18)'] },
  ice: { outer: '#3c6c98', field: '#d6e9f3', floor: '#f0f6fa', home: '#f3ecdc', rim: '#5589b0', wall: '#97c4e0', dots: ['#b3d7ec', '#82b4d4'], accents: ['#ffffff', '#e2f4ff'], flecks: ['rgba(120, 170, 210, 0.3)', 'rgba(255, 255, 255, 0.5)'] },
  beach: { outer: '#2a80aa', field: '#f1dda2', floor: '#f8edc6', home: '#fdf3d6', rim: '#f4fbff', wall: '#35a3d6', dots: ['#4fb6e4', '#2b93c8'], accents: ['#ff8fa3', '#ffe066'], flecks: ['rgba(190, 150, 80, 0.3)', 'rgba(255, 255, 255, 0.35)'] },
  sky: { outer: '#4f9fdc', field: '#bfe3fb', floor: '#bfe3fb', home: '#fbfdff', rim: '#bcd3e8', wall: '#ffffff', dots: ['#ffffff', '#e6f1fa'], accents: ['#ffffff', '#ffffff'], flecks: ['rgba(255, 255, 255, 0.0)', 'rgba(255, 255, 255, 0.0)'], sky: true },
  graveyard: { outer: '#1c182a', field: '#57516c', floor: '#8a849e', home: '#b9b0a0', rim: '#1f1a30', wall: '#39324f', dots: ['#4a4265', '#2c2641'], accents: ['#ff9a1f', '#c8f060'], flecks: ['rgba(20, 15, 35, 0.3)', 'rgba(200, 190, 230, 0.2)'] },
};

// An iron gate: a bar that slides along its own length, and nobody gets past it.
// It starts at (x, y), travels `travel` pixels along `axis` and back every `period`
// seconds, resting for `hold` of the period at each end.
const gate = (x, y, w, h, axis, travel, period, offset, hold) => ({ x, y, w, h, axis, travel, period, offset, hold });
const laneX = (c) => HEDGE_X1 + c * CELL;
const laneY = (r) => BOUNDS.y1 + r * CELL;

export const MAPS = {
  // Three winding lanes joined by four cross links.
  meadow: buildMap({
    id: 'meadow',
    theme: THEMES.meadow,
    lanes: [
      // top
      [0, 1, 2, 1], [2, 1, 2, 3], [2, 3, 5, 3], [5, 3, 5, 1], [5, 1, 8, 1], [8, 1, 8, 3], [8, 3, 11, 3],
      // middle
      [0, 5, 3, 5], [3, 5, 3, 7], [3, 7, 6, 7], [6, 7, 6, 5], [6, 5, 9, 5], [9, 5, 9, 7], [9, 7, 11, 7],
      // bottom
      [0, 11, 2, 11], [2, 11, 2, 9], [2, 9, 5, 9], [5, 9, 5, 11], [5, 11, 8, 11], [8, 11, 8, 9], [8, 9, 11, 9],
      // cross links
      [3, 3, 3, 5], [4, 7, 4, 9], [8, 3, 8, 5], [10, 7, 10, 9],
    ],
  }),
  // A tangle of thin-walled lanes with loops everywhere and no pattern to it.
  // Moles dig. (The lanes were grown as a random maze once and are fixed here.)
  desert: buildMap({
    id: 'desert',
    theme: THEMES.desert,
    hazard: 'trap',
    lanes: [
      [2, 0, 4, 0], [2, 0, 2, 4], [4, 0, 4, 6], [6, 0, 6, 2], [6, 0, 10, 0], [8, 0, 8, 12], [10, 0, 10, 4], [10, 6, 10, 12],
      [0, 2, 2, 2], [4, 2, 8, 2], [0, 4, 2, 4], [4, 4, 6, 4], [6, 4, 6, 6], [8, 4, 10, 4],
      [0, 6, 2, 6], [2, 6, 2, 10], [4, 6, 11, 6], [2, 8, 8, 8], [4, 8, 4, 10], [10, 8, 11, 8], [10, 2, 11, 2],
      [0, 10, 2, 10], [2, 10, 2, 12], [4, 10, 8, 10], [10, 10, 11, 10], [2, 12, 10, 12],
    ],
  }),
  // A works floor of passages that turn back on themselves. Cannons fire down them.
  factory: buildMap({
    id: 'factory',
    theme: THEMES.factory,
    hazard: 'cannon',
    lanes: [
      [2, 0, 2, 12], [2, 0, 4, 0], [4, 0, 4, 6], [6, 0, 10, 0], [6, 0, 6, 6], [8, 0, 8, 4], [10, 0, 10, 6],
      [0, 2, 6, 2], [8, 2, 10, 2], [0, 4, 2, 4], [4, 4, 8, 4], [10, 4, 11, 4], [0, 6, 2, 6], [4, 6, 10, 6],
      [8, 6, 8, 8], [4, 8, 11, 8], [4, 8, 4, 12], [6, 8, 6, 12], [10, 8, 10, 12], [2, 10, 8, 10], [8, 10, 8, 12],
      [10, 10, 11, 10], [0, 12, 2, 12], [4, 12, 6, 12], [8, 12, 10, 12],
    ],
  }),
  // A maze around a rink in the middle. The rink and a few of the lanes are ice.
  ice: buildMap({
    id: 'ice',
    theme: THEMES.ice,
    ice: [[4, 4, 6, 8], [0, 0, 10, 0], [8, 8, 11, 8], [6, 10, 10, 10], [2, 0, 2, 6]],
    lanes: [
      [0, 0, 10, 0], [2, 0, 2, 6], [4, 0, 4, 12], [8, 0, 8, 12], [10, 0, 10, 12],
      [0, 2, 2, 2], [4, 2, 6, 2], [6, 2, 6, 4], [8, 2, 11, 2], [8, 4, 11, 4],
      [4, 4, 6, 8],
      [0, 6, 8, 6], [2, 8, 6, 8], [2, 8, 2, 12], [8, 8, 11, 8],
      [0, 10, 4, 10], [6, 10, 10, 10], [6, 10, 6, 12], [2, 12, 10, 12],
    ],
  }),
  // Sandbars winding every which way between pools of sea. Waves roll in.
  beach: buildMap({
    id: 'beach',
    theme: THEMES.beach,
    hazard: 'wave',
    lanes: [
      [0, 0, 8, 0], [4, 0, 4, 2], [8, 0, 8, 2], [2, 2, 2, 4], [2, 2, 6, 2], [6, 2, 6, 12], [8, 2, 11, 2], [10, 2, 10, 6],
      [0, 4, 2, 4], [4, 4, 4, 12], [4, 4, 11, 4], [2, 6, 2, 12], [2, 6, 6, 6], [10, 6, 11, 6],
      [0, 8, 2, 8], [4, 8, 10, 8], [8, 8, 8, 12], [10, 8, 10, 10], [0, 10, 10, 10], [2, 12, 8, 12],
    ],
  }),
  // A maze of narrow alleys that double back on each other, behind iron gates.
  // (Grown as a random maze once and fixed here, like the desert.)
  graveyard: buildMap({
    id: 'graveyard',
    theme: THEMES.graveyard,
    lanes: [
      [0, 0, 2, 0], [2, 0, 2, 2], [4, 0, 10, 0], [4, 0, 4, 6], [6, 0, 6, 12], [8, 0, 8, 2], [10, 0, 10, 4],
      [0, 2, 4, 2], [6, 2, 8, 2], [10, 2, 11, 2], [2, 4, 2, 12], [2, 4, 6, 4], [8, 4, 8, 10], [8, 4, 11, 4],
      [2, 6, 10, 6], [10, 6, 10, 8], [0, 8, 8, 8], [10, 8, 11, 8],
      [0, 10, 2, 10], [4, 10, 10, 10], [4, 10, 4, 12], [10, 10, 10, 12], [2, 12, 10, 12],
    ],
    gates: [
      // Two long gates patrol the wide gap in front of the burrow, one after the other.
      gate(175, BOUNDS.y1 + 10, 10, 150, 'y', 340, 9, 0, 0.04),
      gate(175, BOUNDS.y1 + 10, 10, 150, 'y', 340, 9, 4.5, 0.04),
      // Doors across the alleys that run sideways slide up into the wall and back.
      gate(laneX(3) + 15, laneY(6), 10, CELL, 'y', -CELL, 6, 0, 0.36),
      gate(laneX(7) + 15, laneY(8), 10, CELL, 'y', -CELL, 6, 3, 0.36),
      gate(laneX(5) + 15, laneY(10), 10, CELL, 'y', -CELL, 7, 1, 0.36),
      // Doors across the alleys that run up and down slide sideways into the wall.
      gate(laneX(6), laneY(5) + 15, CELL, 10, 'x', CELL, 7, 1.5, 0.36),
      gate(laneX(4), laneY(3) + 15, CELL, 10, 'x', CELL, 6, 4, 0.36),
      gate(laneX(8), laneY(9) + 15, CELL, 10, 'x', CELL, 7, 5, 0.36),
    ],
  }),
  // Paths between the clouds, high over the land. Day brings pits and waves, night
  // brings gates and ice, and the cannons never stop.
  sky: buildMap({
    id: 'sky',
    theme: THEMES.sky,
    cycle: true,
    ice: [[0, 2, 11, 2], [6, 4, 6, 12], [0, 12, 10, 12]],
    lanes: [
      [4, 0, 4, 2], [4, 0, 8, 0], [6, 0, 6, 2], [8, 0, 8, 8], [0, 2, 11, 2], [2, 2, 2, 4], [0, 4, 2, 4],
      [6, 4, 6, 12], [6, 4, 11, 4], [10, 4, 10, 12], [4, 6, 4, 8], [4, 6, 6, 6], [8, 6, 11, 6],
      [0, 8, 6, 8], [2, 8, 2, 10], [8, 8, 10, 8], [2, 10, 8, 10], [8, 10, 8, 12], [0, 12, 10, 12],
    ],
    gates: [
      gate(laneX(3) + 15, laneY(2), 10, CELL, 'y', -CELL, 6, 0, 0.36),
      gate(laneX(9) + 15, laneY(4), 10, CELL, 'y', -CELL, 6, 3, 0.36),
      gate(laneX(5) + 15, laneY(10), 10, CELL, 'y', -CELL, 7, 1, 0.36),
      gate(laneX(3) + 15, laneY(8), 10, CELL, 'y', -CELL, 7, 4, 0.36),
      gate(laneX(6), laneY(5) + 15, CELL, 10, 'x', CELL, 7, 1.5, 0.36),
      gate(laneX(10), laneY(9) + 15, CELL, 10, 'x', CELL, 6, 4.5, 0.36),
    ],
  }),
};

export const MAP_IDS = Object.keys(MAPS);
// The default map.
export const MAP = MAPS.meadow;

// Where each gate of a map is at a given time, as rectangles.
export function gatesAt(map, time) {
  return map.gates.map((g) => {
    const ph = (((time + g.offset) % g.period) + g.period) % g.period / g.period;
    const move = 0.5 - g.hold;
    const k = ph < g.hold ? 0 : ph < g.hold + move ? (ph - g.hold) / move : ph < 2 * g.hold + move ? 1 : 1 - (ph - 2 * g.hold - move) / move;
    const d = g.travel * k;
    return { x: g.x + (g.axis === 'x' ? d : 0), y: g.y + (g.axis === 'y' ? d : 0), w: g.w, h: g.h, axis: g.axis };
  });
}

// Keeps a circle out of a plain rectangle: a gate.
export function pushOutRect(p, r, rect) {
  const cx = Math.max(rect.x, Math.min(p.x, rect.x + rect.w));
  const cy = Math.max(rect.y, Math.min(p.y, rect.y + rect.h));
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
  // Centre inside the bar: out through its thin side, which is across its travel.
  if (rect.w < rect.h) p.x = p.x < rect.x + rect.w / 2 ? rect.x - r : rect.x + rect.w + r;
  else p.y = p.y < rect.y + rect.h / 2 ? rect.y - r : rect.y + rect.h + r;
}

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

export function segmentHitsRect(ax, ay, bx, by, x1, y1, x2, y2) {
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
