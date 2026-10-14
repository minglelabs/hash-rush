// Lane help for the touch stick. A lane is one hamster wide, and a thumb on glass
// has no keys to feel its way by, so a push that is a few pixels early, late or to
// one side would leave the hamster stuck on a hedge corner. Here such a push is
// read for what it plainly means:
//   - a slanted push along a wall runs straight down the lane at full speed, and
//     takes the first turning on the side it leans to;
//   - a push into a wall just before a turning keeps going until the turning comes,
//     and one just past it steps back;
//   - a push at the hedge from open ground goes to the nearest lane mouth and in;
//   - and a turning is cut on the slant across its rounded corner, the line a
//     keyboard player gets by pressing the second key a moment early.
// It never moves a hamster that is not being pushed, and open ground is left alone.
//
// It works on what the stick asked for and hands the simulation an ordinary move,
// so it runs wherever the simulation does: for a guest, on the host.

import { HAMSTER_R } from '../sim/constants.js';
import { HAZARD, iceNow } from '../sim/hazards.js';
import { distToSegment } from '../sim/map.js';

// How far past its nose a hamster looks for a wall: all the room a lane leaves it, and a bit.
const LOOK = 11;
// A turn asked for this far before its opening is kept until the opening comes,
const AHEAD = 60;
// one asked for this far past it goes back,
const BEHIND = 24;
// and from a standstill an opening this close on either side is the one meant.
const NEAR = 22;
// On open ground a push at the hedge can only mean one thing, the nearest lane, so
// its mouth may be further off.
const MOUTH = 60;
// Hedge ends are rounded, so from this close a hamster can head for a turning on
// the slant without catching the corner.
const CUT = 26;
// How long the way a hamster was last going still counts as the way it is going.
const RECENT = 0.25;

const grids = new WeakMap();

function gridOf(map) {
  let grid = grids.get(map);
  if (grid) return grid;
  const size = map.laneWidth;
  const cols = map.open[0].length;
  const rows = map.open.length;
  grid = {
    col: (x) => Math.floor((x - map.lanes.x1) / size),
    row: (y) => Math.floor((y - map.bounds.y1) / size),
    midX: (c) => map.lanes.x1 + (c + 0.5) * size,
    midY: (r) => map.bounds.y1 + (r + 0.5) * size,
    // Either side of the hedge is open ground, top to bottom.
    open: (c, r) => r >= 0 && r < rows && (c < 0 || c >= cols || map.open[r][c]),
    outside: (x) => x < map.lanes.x1 || x >= map.lanes.x2,
  };
  grids.set(map, grid);
  return grid;
}

// Whether a hamster at (x, y) has a wall right in front of it, going along one axis.
function walled(grid, x, y, dx, dy) {
  const half = HAMSTER_R - 0.25;
  const nose = HAMSTER_R + LOOK;
  if (dx) {
    const c = grid.col(x + dx * nose);
    return !(grid.open(c, grid.row(y - half)) && grid.open(c, grid.row(y + half)));
  }
  const r = grid.row(y + dy * nose);
  return !(grid.open(grid.col(x - half), r) && grid.open(grid.col(x + half), r));
}

// A push along one axis has hit a wall. Looks along the lane for the nearest place
// the push would go through, and returns how far along it is, or null. `going` is
// the way along the lane that counts as ahead (1 or -1); an opening counts up to
// `fore` ahead and `back` behind.
function opening(grid, x, y, dx, dy, going, fore, back) {
  const nose = HAMSTER_R + LOOK;
  const here = dx ? grid.row(y) : grid.col(x);
  const at = dx ? y : x;
  // The cell the hamster stands in, and the one its push leads to, `k` cells along.
  const lane = dx ? (k) => grid.open(grid.col(x), k) : (k) => grid.open(k, grid.row(y));
  const beyond = dx ? (k) => grid.open(grid.col(x + dx * nose), k) : (k) => grid.open(k, grid.row(y + dy * nose));
  const mid = dx ? grid.midY : grid.midX;
  const far = (way) => (way === going ? fore : back);
  let best = null;
  const take = (off) => {
    if (best === null || Math.abs(off) < Math.abs(best)) best = off;
  };
  // Beside the opening it stands at, but not square to it.
  const off = mid(here) - at;
  if (beyond(here) && Math.abs(off) <= far(Math.sign(off) || going)) take(off);
  // Or the first opening along the lane, either way.
  for (const way of [1, -1]) {
    for (let k = here + way; lane(k) && Math.abs(mid(k) - at) <= far(way); k += way) {
      if (!beyond(k)) continue;
      take(mid(k) - at);
      break;
    }
  }
  return best;
}

// Steering help would carry the hamster on down the lane: not into a mole's pit.
function pitOnWay(g, x, y, tx, ty) {
  const reach = HAZARD.trap.r + HAMSTER_R;
  return g.hazards.some((h) => h.kind === 'trap' && distToSegment(h.x, h.y, x, y, tx, ty) < reach);
}

const onIce = (g, p) => iceNow(g.map, g.time).some((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);

// Whether a move straight along one axis was drawn leaning into a wall beside it.
function rubs(g, me, sx, sy, inp) {
  if (sx && sy) return false;
  const px = sx ? 0 : Math.sign(inp.mx);
  const py = sy ? 0 : Math.sign(inp.my);
  return (px || py) && walled(gridOf(g.map), me.x, me.y, px, py);
}

const freshSteer = () => ({ lx: 0, ly: 0, at: -1, px: 0, py: 0, turn: null });

// The move to make for a stick pushed (dx, dy), each -1, 0 or 1 in world axes.
// `st` remembers which way the hamster was last sent.
export function steer(g, me, dx, dy, st) {
  const out = { x: dx, y: dy };
  // The same push as last tick keeps the turning it chose.
  if (dx !== st.px || dy !== st.py) st.turn = null;
  st.px = dx;
  st.py = dy;
  // On ice a hamster cannot follow a nudge anyway; it would only swing about.
  if ((!dx && !dy) || g.phase !== 'playing' || onIce(g, me)) return out;
  const grid = gridOf(g.map);
  const { x, y } = me;
  const recent = g.time - st.at <= RECENT;
  const send = (sx, sy) => {
    st.lx = sx;
    st.ly = sy;
    st.at = g.time;
    out.x = sx;
    out.y = sy;
    return out;
  };

  // Notes which way along the lane the hamster is headed without changing the move.
  const head = (sx, sy) => {
    st.lx = sx;
    st.ly = sy;
    st.at = g.time;
    return out;
  };

  if (dx && dy) {
    const across = !walled(grid, x, y, dx, 0);
    const down = !walled(grid, x, y, 0, dy);
    if (across !== down) {
      // Sliding along a wall towards a turning on the side leant to. The slant
      // itself is right once the turning is near enough to cut across to.
      st.turn = null;
      const off = across ? opening(grid, x, y, 0, dy, dx, CUT, 0) : opening(grid, x, y, dx, 0, dy, CUT, 0);
      if (off !== null) return across ? head(dx, 0) : head(0, dy);
      return across ? send(dx, 0) : send(0, dy);
    }
    const nose = HAMSTER_R + LOOK;
    const slant = grid.open(grid.col(x + dx * nose), grid.row(y + dy * nose));
    if (!across || slant) {
      // Boxed in, or open ground on the slant too: nothing to read into it.
      st.turn = null;
      st.at = -1;
      return out;
    }
    // A junction, with both ways open and a hedge corner between them. Having come
    // along one of them, the other is the turning that was being waited for.
    if (!st.turn && recent) st.turn = st.lx === dx && !st.ly ? 'y' : st.ly === dy && !st.lx ? 'x' : null;
    // From a standstill, the way the corner would have slid the hamster anyway:
    // whichever it is already further along. Pushed square at the corner it would
    // only have stuck there.
    if (!st.turn) st.turn = (x - grid.midX(grid.col(x))) * dx >= (y - grid.midY(grid.row(y))) * dy ? 'x' : 'y';
    return st.turn === 'x' ? send(dx, 0) : send(0, dy);
  }

  if (!walled(grid, x, y, dx, dy)) return send(dx, dy);
  const going = !recent ? 0 : dx ? st.ly : st.lx;
  const near = grid.outside(x) ? MOUTH : NEAR;
  const off = going ? opening(grid, x, y, dx, dy, going, AHEAD, BEHIND) : opening(grid, x, y, dx, dy, 1, near, near);
  if (off === null) return send(dx, dy);
  const side = Math.sign(off);
  if (pitOnWay(g, x, y, dx ? x : x + off, dx ? y + off : y)) return send(dx, dy);
  if (Math.abs(off) <= CUT) {
    out.x = dx || side;
    out.y = dy || side;
    return dx ? head(0, side) : head(side, 0);
  }
  return dx ? send(0, side) : send(side, 0);
}

// One of these stands between a slot's controller and the simulation. An input
// marked as coming off the touch stick gets its move straightened out; any other
// passes through untouched. `memory()` is what it remembers, and one made `from`
// that carries on from there: a guest's page does so to steer its own hamster the
// way the host is about to (predict.js).
export function createLaneHelp(from = null) {
  let st = from ? { ...from } : freshSteer();
  const help = (g, me, inp) => {
    if (!inp.stick) {
      st = freshSteer();
      return inp;
    }
    const sx = Math.sign(Math.round(inp.mx));
    const sy = Math.sign(Math.round(inp.my));
    const move = steer(g, me, sx, sy, st);
    // A slanted swipe goes the way it was drawn wherever the help had nothing to
    // straighten out, unless the slant only leans into the hedge beside the lane
    // and would rub along it at less than full speed.
    if (move.x === sx && move.y === sy && !rubs(g, me, sx, sy, inp)) return inp;
    inp.mx = move.x;
    inp.my = move.y;
    return inp;
  };
  help.memory = () => st;
  return help;
}
