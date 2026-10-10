// Path finding over the map's waypoint visibility graph. Used by bots, and by the
// human controller for click-to-move.

import { HAMSTER_R } from '../sim/constants.js';
import { segmentClear } from '../sim/map.js';

const PAD = HAMSTER_R * 0.7;
const cache = new WeakMap();

export function getNav(map) {
  let nav = cache.get(map);
  if (!nav) {
    nav = createNav(map);
    cache.set(map, nav);
  }
  return nav;
}

function createNav(map) {
  const nodes = map.waypoints;
  const n = nodes.length;
  const clear = (a, b) => segmentClear(map, a.x, a.y, b.x, b.y, PAD);
  const len = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const adj = nodes.map(() => []);
  const D = nodes.map((_, i) => nodes.map((__, j) => (i === j ? 0 : Infinity)));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!clear(nodes[i], nodes[j])) continue;
      const d = len(nodes[i], nodes[j]);
      adj[i].push(j);
      adj[j].push(i);
      D[i][j] = D[j][i] = d;
    }
  }
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (D[i][k] + D[k][j] < D[i][j]) D[i][j] = D[i][k] + D[k][j];
      }
    }
  }

  function visibleFrom(p) {
    const out = [];
    for (let i = 0; i < n; i++) if (clear(p, nodes[i])) out.push(i);
    return out;
  }

  // Walking distance between two points, ignoring everyone else.
  function distance(a, b) {
    if (clear(a, b)) return len(a, b);
    const va = visibleFrom(a);
    const vb = visibleFrom(b);
    let best = Infinity;
    for (const i of va) {
      const da = len(a, nodes[i]);
      for (const j of vb) {
        const d = da + D[i][j] + len(nodes[j], b);
        if (d < best) best = d;
      }
    }
    return best;
  }

  // Shortest path from a to b. `extra(p, q)` can add a cost to a leg, which is how
  // bots steer around lanes that have an enemy in them.
  function findPath(a, b, extra) {
    const cost = (p, q) => len(p, q) + (extra ? extra(p, q) : 0);
    const S = n;
    const G = n + 1;
    const pt = (i) => (i === S ? a : i === G ? b : nodes[i]);
    const dist = new Array(n + 2).fill(Infinity);
    const prev = new Array(n + 2).fill(-1);
    const done = new Array(n + 2).fill(false);
    const toGoal = new Array(n).fill(false);
    for (const j of visibleFrom(b)) toGoal[j] = true;
    const fromStart = visibleFrom(a);
    const direct = clear(a, b);
    dist[S] = 0;

    for (;;) {
      let u = -1;
      for (let i = 0; i < n + 2; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || dist[u] === Infinity || u === G) break;
      done[u] = true;
      const relax = (v) => {
        const d = dist[u] + cost(pt(u), pt(v));
        if (d < dist[v]) {
          dist[v] = d;
          prev[v] = u;
        }
      };
      if (u === S) {
        for (const v of fromStart) relax(v);
        if (direct) relax(G);
      } else {
        for (const v of adj[u]) if (!done[v]) relax(v);
        if (toGoal[u]) relax(G);
      }
    }

    if (dist[G] === Infinity) return { points: [b], cost: Infinity };
    const points = [];
    for (let i = G; i !== S; i = prev[i]) points.push(pt(i));
    points.reverse();
    return { points, cost: dist[G] };
  }

  // The furthest point of a path that can be walked to in a straight line.
  function nextTarget(from, points) {
    for (let i = points.length - 1; i > 0; i--) if (clear(from, points[i])) return points[i];
    return points[0];
  }

  return { nodes, clear, distance, findPath, nextTarget };
}
