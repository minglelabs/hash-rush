// What a trained policy sees of the game: a fixed row of numbers per seat. Shared by
// the training environment (rl/env.js) and the in-game RL bot (rl-bot.js), so the
// bot sees exactly what it learned from.

import { inHome, allied, lastStretch } from '../sim/game.js';
import { MAP_IDS, WORLD, isFree } from '../sim/map.js';
import { HAZARD, iceNow, isNight, untilNight, inCannonLine } from '../sim/hazards.js';
import { SPEED, BONK, THROW, OVERTIME, HAMSTER_R, gatherTime } from '../sim/constants.js';

// How stale what the learned bot sees is, in game ticks: 0.15 s, the same as the
// quickest scripted bot and a quick person. It plays and trains on this.
export const REACTION_TICKS = 9;

export const MAX_P = 8;
const SELF = 19;
const WORLD_F = 11 + MAP_IDS.length;
const NAV = 9;
const RAYS = 8;
const HAZARDS = 4;
const HAZARD_F = 12;
const GATES = 2;
const GATE_F = 3;
const OTHER = 13;
// The first policies saw only this much; team play was added after it.
const BASE_OBS = SELF + WORLD_F + NAV + RAYS + HAZARDS * HAZARD_F + GATES * GATE_F + (MAX_P - 1) * OTHER;
const TEAM_F = 10;
// What the nearest teammate is up to, and where to cut off the rival carrier
// nearest home: added after TEAM_F, so the policies before it read only the
// numbers they know and carry on as they were.
const MATE_F = 10;
export const OBS = BASE_OBS + TEAM_F + MATE_F;
const HAZARD_KINDS = ['trap', 'cannon', 'wave'];
export const DIRS = [[0, 0], ...Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)])];

// ---------- what the map looks like to a policy ----------

const CELL = 8;
const fieldsOf = new Map();

// Walking distance to the flower, to home and to the nearest tunnel from every
// 8px cell of the map, worked out once. A policy is told which way is downhill.
export function fields(map) {
  if (fieldsOf.has(map)) return fieldsOf.get(map);
  const cols = Math.ceil(WORLD.w / CELL);
  const rows = Math.ceil(WORLD.h / CELL);
  const free = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) free[r * cols + c] = isFree(map, (c + 0.5) * CELL, (r + 0.5) * CELL, HAMSTER_R * 0.8) ? 1 : 0;
  }
  const flood = (isSource) => {
    const dist = new Float32Array(cols * rows).fill(Infinity);
    let frontier = [];
    for (let i = 0; i < dist.length; i++) {
      if (free[i] && isSource((i % cols + 0.5) * CELL, (Math.floor(i / cols) + 0.5) * CELL)) {
        dist[i] = 0;
        frontier.push(i);
      }
    }
    // The steps cost 1 or 1.41, so a few relaxation sweeps settle it.
    while (frontier.length) {
      const next = [];
      for (const i of frontier) {
        const c = i % cols;
        const r = (i - c) / cols;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const nc = c + dc;
            const nr = r + dr;
            if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
            const j = nr * cols + nc;
            if (!free[j]) continue;
            // No cutting a corner between two walls.
            if (dr && dc && (!free[r * cols + nc] || !free[nr * cols + c])) continue;
            const d = dist[i] + (dr && dc ? 1.4142 : 1);
            if (d < dist[j] - 1e-4) {
              dist[j] = d;
              next.push(j);
            }
          }
        }
      }
      frontier = next;
    }
    return dist;
  };
  const f = map.flower;
  const out = {
    cols,
    rows,
    free,
    flower: flood((x, y) => Math.hypot(x - f.x, y - f.y) < f.gatherR - 6),
    home: flood((x) => x < map.home.x2 - 12),
    warp: flood((x, y) => map.warps.some((w) => Math.hypot(x - w.x, y - w.y) < w.r - 4)),
  };
  fieldsOf.set(map, out);
  return out;
}

function cellOf(F, x, y) {
  const c = Math.max(0, Math.min(F.cols - 1, Math.floor(x / CELL)));
  const r = Math.max(0, Math.min(F.rows - 1, Math.floor(y / CELL)));
  let i = r * F.cols + c;
  if (F.free[i]) return i;
  // Pressed against a wall: use the nearest walkable cell.
  let best = -1;
  let bestD = Infinity;
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= F.cols || nr >= F.rows) continue;
      i = nr * F.cols + nc;
      if (F.free[i] && dr * dr + dc * dc < bestD) {
        bestD = dr * dr + dc * dc;
        best = i;
      }
    }
  }
  return best;
}

// Which way to walk to get nearer `dist`'s target, and how far it is.
function hint(F, dist, x, y, out, at) {
  const i = cellOf(F, x, y);
  out[at] = out[at + 1] = 0;
  out[at + 2] = 1;
  if (i < 0 || dist[i] === Infinity) return;
  const c = i % F.cols;
  const r = (i - c) / F.cols;
  let best = dist[i];
  let bx = 0;
  let by = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const nc = c + dc;
      const nr = r + dr;
      if ((!dr && !dc) || nc < 0 || nr < 0 || nc >= F.cols || nr >= F.rows) continue;
      const d = dist[nr * F.cols + nc];
      if (d < best) {
        best = d;
        bx = dc;
        by = dr;
      }
    }
  }
  const len = Math.hypot(bx, by) || 1;
  out[at] = bx / len;
  out[at + 1] = by / len;
  out[at + 2] = Math.min(1, (dist[i] * CELL) / 1000);
}

// Where `p` will be after walking `px` pixels down `dist`'s slope: a carrier's
// way home a little ahead of it, the spot to cut it off at.
function ahead(F, dist, p, px) {
  let i = cellOf(F, p.x, p.y);
  if (i < 0 || dist[i] === Infinity) return { x: p.x, y: p.y };
  for (let step = 0; step < px / CELL; step++) {
    const c = i % F.cols;
    const r = (i - c) / F.cols;
    let next = i;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nc = c + dc;
        const nr = r + dr;
        if ((!dr && !dc) || nc < 0 || nr < 0 || nc >= F.cols || nr >= F.rows) continue;
        const j = nr * F.cols + nc;
        if (dist[j] < dist[next]) next = j;
      }
    }
    if (next === i) break;
    i = next;
  }
  const c = i % F.cols;
  return { x: (c + 0.5) * CELL, y: ((i - c) / F.cols + 0.5) * CELL };
}

export const fieldAt = (F, dist, p) => {
  const i = cellOf(F, p.x, p.y);
  return i < 0 || dist[i] === Infinity ? 1 : Math.min(1, (dist[i] * CELL) / 1000);
};

// Everyone's job, worked out from the game alone so the bot in the game plays the
// job it trained for, beside people or bots. In a team round:
//   attack: carries the team's seed home, or with no seed on the team, is the one
//           nearest the flower (by walking) and goes for it;
//   mark:   each rival seed carrier gets its own marker, the nearest teammate not
//           attacking, so two carriers are never both left to one hamster;
//   guard:  the rest watch the rival nearest the flower, the next seed's way.
// In a free-for-all everyone plays alone and marks the nearest rival carrier.
// Returns, per player index, { job, mark } with mark a player or null.
const jobsOf = new WeakMap();
export function jobs(g) {
  const cached = jobsOf.get(g);
  if (cached && cached.tick === g.tick) return cached.out;
  const players = g.players;
  const F = fields(g.map);
  const far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const out = players.map(() => ({ job: 'solo', mark: null }));
  for (const p of players) {
    if (p.team >= 0) continue;
    let best = null;
    for (const q of players) if (q !== p && q.carrying && (!best || far(q, p) < far(best, p))) best = q;
    out[p.id].mark = best;
  }
  const teams = [...new Set(players.filter((p) => p.team >= 0).map((p) => p.team))];
  const f = g.map.flower;
  for (const t of teams) {
    const mates = players.filter((p) => p.team === t);
    const rivals = players.filter((p) => p.team !== t);
    let free = mates.filter((p) => !p.carrying);
    for (const p of mates) if (p.carrying) out[p.id].job = 'attack';
    if (free.length === mates.length) {
      let best = null;
      for (const p of mates) if (!best || fieldAt(F, F.flower, p) < fieldAt(F, F.flower, best)) best = p;
      out[best.id].job = 'attack';
      free = free.filter((p) => p !== best);
    }
    // Nearest pairs first, each carrier and each marker used once.
    const pairs = [];
    for (const c of rivals) if (c.carrying) for (const p of free) pairs.push([far(c, p), c, p]);
    pairs.sort((x, y) => x[0] - y[0]);
    const taken = new Set();
    for (const [, c, p] of pairs) {
      if (taken.has(c) || taken.has(p)) continue;
      taken.add(c).add(p);
      out[p.id] = { job: 'mark', mark: c };
    }
    let threat = null;
    for (const q of rivals) if (!q.carrying && (!threat || far(q, f) < far(threat, f))) threat = q;
    for (const p of free) if (!taken.has(p)) out[p.id] = { job: 'guard', mark: threat };
  }
  jobsOf.set(g, { tick: g.tick, out });
  return out;
}

// Fills one row of OBS numbers per seat, MAX_P rows from `at`; empty seats are zeros.
export function observe(g, out, at = 0) {
  const teams = new Set(g.players.map((p) => p.team).filter((t) => t >= 0)).size;
  const mapIndex = MAP_IDS.indexOf(g.map.id);
  const F = fields(g.map);
  const ice = iceNow(g.map, g.time);
  const gates = g.gates || [];
  const night = isNight(g.map, g.time) ? 1 : 0;
  const dusk = g.map.cycle ? Math.min(1, untilNight(g.map, g.time) / 24) : 0;
  const players = g.players;
  const need = gatherTime(players.length, g.time);
  for (let i = 0; i < MAX_P; i++) {
    const base = at + i * OBS;
    out.fill(0, base, base + OBS);
    const me = players[i];
    if (!me) continue;
    let o = base;
    const home = inHome(g, me);
    out[o++] = me.x / WORLD.w;
    out[o++] = me.y / WORLD.h;
    out[o++] = me.vx / SPEED;
    out[o++] = me.vy / SPEED;
    out[o++] = me.fx;
    out[o++] = me.fy;
    out[o++] = me.carrying ? 1 : 0;
    out[o++] = me.cooldown / BONK.cooldown;
    out[o++] = me.swing && me.swing.phase === 'windup' ? 1 : 0;
    out[o++] = me.swing && me.swing.phase === 'recovery' ? 1 : 0;
    out[o++] = me.charge / THROW.max;
    out[o++] = me.charge >= THROW.charge ? 1 : 0;
    out[o++] = me.gather / need;
    out[o++] = home ? 1 : 0;
    out[o++] = lastStretch(g, me) ? 1 : 0;
    out[o++] = me.wet > 0 ? 1 : 0;
    out[o++] = (me.x - g.homeX) / WORLD.w;
    out[o++] = Math.hypot(me.x - g.map.flower.x, me.y - g.map.flower.y) / WORLD.w;
    out[o++] = ice.some((r) => me.x >= r.x && me.x <= r.x + r.w && me.y >= r.y && me.y <= r.y + r.h) ? 1 : 0;

    out[o++] = g.time / OVERTIME.end;
    out[o++] = g.time > OVERTIME.start ? 1 : 0;
    out[o++] = g.homeX / WORLD.w;
    out[o++] = g.nibbler === me.id ? 1 : 0;
    out[o++] = g.nibbler >= 0 && g.nibbler !== me.id ? 1 : 0;
    out[o++] = players.length / MAX_P;
    out[o++] = me.team >= 0 ? 1 : 0;
    out[o++] = players.some((p) => p !== me && p.carrying && !allied(p, me)) ? 1 : 0;
    out[o++] = teams / 4;
    out[o++] = night;
    out[o++] = dusk;
    // Which map this is.
    out[o + mapIndex] = 1;
    o += MAP_IDS.length;

    hint(F, F.flower, me.x, me.y, out, o);
    hint(F, F.home, me.x, me.y, out, o + 3);
    hint(F, F.warp, me.x, me.y, out, o + 6);
    o += NAV;

    // How far it is to a wall in eight directions, out to 120px.
    for (let k = 1; k <= RAYS; k++) {
      let reach = 1;
      for (let s = CELL; s <= 120; s += CELL) {
        const x = me.x + DIRS[k][0] * s;
        const y = me.y + DIRS[k][1] * s;
        const c = Math.floor(x / CELL);
        const r = Math.floor(y / CELL);
        const shut = gates.some((q) => x >= q.x - 6 && x <= q.x + q.w + 6 && y >= q.y - 6 && y <= q.y + q.h + 6);
        if (shut || c < 0 || r < 0 || c >= F.cols || r >= F.rows || !F.free[r * F.cols + c]) {
          reach = s / 120;
          break;
        }
      }
      out[o++] = reach;
    }

    // Trouble on the map, nearest first: where it is, what it is, whether it has
    // gone off yet, and for a cannon which way it points and whether I am in its line.
    const near = (a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y);
    const trouble = g.hazards.length > 1 ? [...g.hazards].sort(near) : g.hazards;
    for (let k = 0; k < HAZARDS; k++) {
      const h = trouble[k];
      if (h) {
        const spec = HAZARD[h.kind];
        out[o] = 1;
        out[o + 1] = (h.x - me.x) / WORLD.w;
        out[o + 2] = (h.y - me.y) / WORLD.h;
        out[o + 3] = Math.min(1, Math.hypot(h.x - me.x, h.y - me.y) / 200);
        out[o + 4 + HAZARD_KINDS.indexOf(h.kind)] = 1;
        out[o + 7] = h.age >= spec.warn ? 1 : 0;
        out[o + 8] = Math.min(1, h.age / spec.warn);
        out[o + 9] = h.dx || 0;
        out[o + 10] = h.dy || 0;
        out[o + 11] = h.kind === 'cannon' && inCannonLine(g.map, h, me) ? 1 : 0;
      }
      o += HAZARD_F;
    }
    // The nearest gates that are shut right now.
    const doors = gates.length > 1 ? gates.map((q) => ({ x: q.x + q.w / 2, y: q.y + q.h / 2 })).sort(near) : gates.map((q) => ({ x: q.x + q.w / 2, y: q.y + q.h / 2 }));
    for (let k = 0; k < GATES; k++) {
      const q = doors[k];
      if (q) {
        out[o] = 1;
        out[o + 1] = (q.x - me.x) / WORLD.w;
        out[o + 2] = (q.y - me.y) / WORLD.h;
      }
      o += GATE_F;
    }

    // Everyone else, nearest first.
    const others = players.filter((p) => p !== me).sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
    for (const p of others) {
      out[o++] = 1;
      out[o++] = (p.x - me.x) / WORLD.w;
      out[o++] = (p.y - me.y) / WORLD.h;
      out[o++] = Math.min(1, Math.hypot(p.x - me.x, p.y - me.y) / (4 * BONK.reach));
      out[o++] = p.vx / SPEED;
      out[o++] = p.vy / SPEED;
      out[o++] = p.carrying ? 1 : 0;
      out[o++] = allied(p, me) ? 1 : 0;
      out[o++] = p.swing && p.swing.phase === 'windup' ? 1 : 0;
      out[o++] = p.swing && p.swing.phase === 'recovery' ? 1 : 0;
      out[o++] = p.cooldown / BONK.cooldown;
      out[o++] = inHome(g, p) ? 1 : 0;
      out[o++] = (p.x - g.homeX) / WORLD.w;
    }

    // Team play: my job, who has a seed, and whom I am watching.
    o = base + BASE_OBS;
    const { job, mark } = jobs(g)[me.id];
    out[o] = job === 'attack' ? 1 : 0;
    out[o + 1] = job === 'mark' ? 1 : 0;
    out[o + 2] = job === 'guard' ? 1 : 0;
    out[o + 3] = players.some((p) => p !== me && p.carrying && allied(p, me)) ? 1 : 0;
    out[o + 4] = players.filter((p) => p.carrying && !allied(p, me) && p !== me).length / 4;
    if (mark) {
      out[o + 5] = 1;
      out[o + 6] = (mark.x - me.x) / WORLD.w;
      out[o + 7] = (mark.y - me.y) / WORLD.h;
      out[o + 8] = fieldAt(F, F.home, mark);
      out[o + 9] = Math.min(1, Math.hypot(mark.x - me.x, mark.y - me.y) / 1000);
    }

    // The nearest teammate's job and whether it is after the same rival, and the
    // spot ahead of the rival carrier nearest home where its way home can be cut
    // off, with whether a teammate is nearer that carrier: one presses from
    // behind, the other gets in front.
    o = base + BASE_OBS + TEAM_F;
    if (me.team < 0) continue;
    const all = jobs(g);
    let mate = null;
    for (const p of players) if (p !== me && p.team === me.team && (!mate || Math.hypot(p.x - me.x, p.y - me.y) < Math.hypot(mate.x - me.x, mate.y - me.y))) mate = p;
    if (mate) {
      const theirs = all[mate.id];
      out[o] = 1;
      out[o + 1] = theirs.job === 'attack' ? 1 : 0;
      out[o + 2] = theirs.job === 'mark' ? 1 : 0;
      out[o + 3] = theirs.job === 'guard' ? 1 : 0;
      out[o + 4] = theirs.mark && theirs.mark === mark ? 1 : 0;
    }
    let carrier = null;
    for (const p of players) if (p.carrying && !allied(p, me) && (!carrier || fieldAt(F, F.home, p) < fieldAt(F, F.home, carrier))) carrier = p;
    if (carrier) {
      const cut = ahead(F, F.home, carrier, 120);
      out[o + 5] = (cut.x - me.x) / WORLD.w;
      out[o + 6] = (cut.y - me.y) / WORLD.h;
      out[o + 7] = Math.min(1, Math.hypot(cut.x - me.x, cut.y - me.y) / 1000);
      const mine = Math.hypot(carrier.x - me.x, carrier.y - me.y);
      out[o + 8] = players.some((p) => p !== me && p.team === me.team && Math.hypot(carrier.x - p.x, carrier.y - p.y) < mine) ? 1 : 0;
      out[o + 9] = fieldAt(F, F.home, carrier);
    }
  }
}
