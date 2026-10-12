// Computer-controlled hamster. A bot only reads the public game state and returns
// the same input object a human does, so any slot can be swapped between the two.

import { DT, SPEED, CARRY_SPEED, HAMSTER_R, BONK, THROW } from '../sim/constants.js';
import { distToSegment, isFree, segmentClear } from '../sim/map.js';
import { inHome, allied } from '../sim/game.js';
import { mulberry32 } from '../sim/rng.js';
import { getNav, blockCost } from './nav.js';
import { HAZARD, hazardCost, inCannonLine } from '../sim/hazards.js';
import { createPlanner, SEARCH } from './search.js';

export const DIFFICULTY = {
  // reaction: how stale the bot's view of others is (seconds)
  // lead: how well it compensates for that delay when timing a swing (0..1)
  // margin/jitter: how far inside its reach it wants a target before swinging
  // bait: chance to hover just out of reach, waiting for a whiff, before going in
  // hold: chance to stand its ground when charged, which is the stronger position
  // deny: chance to go after someone who picked up a seed
  // hunt: chance to clear a rival away from the flower instead of waiting in line
  // opportunism: swings per second at bystanders who happen to be in reach
  // caution: how strongly a seed carrier avoids enemies waiting near its route
  // toss: chance to throw the seed at a single rival standing in the way home
  // volley: chance to throw it when it would take down two, or a rival's seed
  // freeze: how long it dithers before a swing it has decided on (seconds)
  // rally: whether it joins the chase after a seed it cannot head off in time
  // daze: how long it stands gathering its wits after a respawn, on picking up a
  //   seed, and every few seconds for no reason at all (seconds)
  easy: { reaction: 0.45, lead: 0, margin: 0, jitter: 9, bait: 0, hold: 0.1, deny: 0.5, hunt: 0.5, opportunism: 0.3, caution: 0.2, freeze: 0.3, rally: false, daze: 1.2, toss: 0.1, volley: 0.4 },
  normal: { reaction: 0.24, lead: 0.4, margin: 2, jitter: 4, bait: 0.25, hold: 0.5, deny: 0.7, hunt: 0.7, opportunism: 0.8, caution: 0.8, freeze: 0.09, rally: true, daze: 0.15, toss: 0.3, volley: 0.8 },
  // search: instead of the fixed rules below, it plays each plan forward in a copy
  //   of the game and picks the best (see search.js). Hands as good as hard's.
  hard: { reaction: 0.12, lead: 0.9, margin: 3, jitter: 1, bait: 0.55, hold: 1, deny: 1, hunt: 1, opportunism: 1.5, caution: 1.2, freeze: 0, rally: true, daze: 0, toss: 0.5, volley: 1 },
};
// dance: up close it feints instead of walking in: a dash at the rival to draw a
//   swing, a step back out of reach so the swing misses, then in for the hit.
// poach: in a free-for-all, with at least this many others already after a rival's
//   seed, it leaves that seed to them and goes for a second one of its own.
// wary: it learns from being fooled. Once a rival has drawn a wasted swing out of it
//   and bonked it for that, it stops swinging at that rival just for running at it:
//   it times the swing to how that rival comes in, or gives ground and waits for
//   it to be properly in reach. The number is how often it holds fire while it
//   still does not know the rival's habit.
DIFFICULTY.ace = { ...DIFFICULTY.hard, search: true, dance: true, poach: 2, wary: 0.5 };

const TOUCH = 2 * HAMSTER_R;
const DANGER_R = 110;
const DANGER_K = 300;
// Chance that a bot goes for a seed of its own while a team-mate carries one home.
const SECOND_SEED = 0.45;
// How far outside a tunnel's edge a bot stops when it does not mean to go in.
const RIM = 2;

// A seed carrier this close to the home edge has every rival bot drop what it is doing.
const LAST_STAND = 260;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// If `me` started a swing now, how far away would `e` be when it lands?
// `lead` is how far ahead (seconds) to extrapolate the target's movement.
export function predictSwing(me, e, lead) {
  const drift = e.swing ? 0 : lead;
  const cx = e.x - me.x;
  const cy = e.y - me.y;
  const cd = Math.hypot(cx, cy);
  const dx = cx + e.vx * drift;
  const dy = cy + e.vy * drift;
  const d = Math.hypot(dx, dy) || 1;
  // Hamsters are solid: one charging at me stops when it touches me. Carrying its
  // velocity on would put it behind me, and the swing would go the wrong way.
  if (cd > 1e-6 && ((d < TOUCH && d < cd) || dx * cx + dy * cy <= 0)) {
    return { ax: cx / cd, ay: cy / cd, dist: Math.min(cd, TOUCH) };
  }
  return { ax: dx / d, ay: dy / d, dist: d };
}

function snapshot(g, p) {
  return {
    id: p.id,
    team: p.team,
    x: p.x,
    y: p.y,
    vx: p.vx,
    vy: p.vy,
    carrying: p.carrying,
    swing: p.swing ? p.swing.phase : null,
    seeds: p.seeds,
    nibbler: g.nibbler === p.id,
    home: inHome(g, p),
  };
}

export function createBot({ difficulty = 'normal', seed = 1 } = {}) {
  const rng = mulberry32(seed);
  // Every bot gets a slightly different temperament so they don't all play alike.
  const cfg = { ...(DIFFICULTY[difficulty] || DIFFICULTY.normal) };
  for (const k of ['bait', 'hold', 'deny', 'hunt']) cfg[k] = Math.max(0, Math.min(1, cfg[k] + (rng() - 0.5) * 0.3));
  const delayTicks = Math.max(1, Math.round(cfg.reaction / DT));
  const planner = cfg.search ? createPlanner({ seed }) : null;
  const history = [];
  const mem = {
    replanAt: 0,
    mode: 'gather',
    path: null,
    targetId: -1,
    entryY: -1,
    denyRolls: new Map(),
    secondRolls: new Map(),
    huntRoll: { id: -1, until: 0, yes: false },
    duel: { id: -1, expires: 0 },
    dance: { id: -1, expires: 0 },
    fooled: new Map(),
    whiff: { id: -1, until: 0 },
    inReach: new Map(),
    habit: new Map(),
    patience: { id: -1, until: 0, hold: false },
    aimedAt: -1,
    noise: 0,
    noiseAt: 0,
    bonkDown: false,
    swingAt: -1,
    dazeUntil: 0,
    deaths: 0,
    carrying: false,
    toss: false,
    tossRoll: { id: -1, until: 0, yes: false },
    stuck: { x: 0, y: 0, at: 0 },
    nudge: { until: 0, x: 0, y: 0 },
  };

  function think(g, id) {
    const map = g.map;
    const me = g.players[id];
    history.push(g.players.map((p) => snapshot(g, p)));
    if (history.length > delayTicks + 1) history.shift();

    const out = { mx: 0, my: 0, bonk: false, ax: 0, ay: 0 };
    if (g.phase !== 'playing') {
      mem.bonkDown = false;
      return out;
    }

    const nav = getNav(map);
    const now = g.time;
    const f = map.flower;
    // Everything below is about rivals; team-mates are neither targets nor obstacles.
    const seen = history[0].filter((s) => s.id !== id && !allied(s, me));
    const mates = history[0].filter((s) => s.id !== id && allied(s, me));
    const meHome = inHome(g, me);
    // Spots just inside the burrow that a seed carrier can aim for.
    const entries = map.rowYs.map((y) => ({ x: g.homeX - 14, y })).filter((p) => isFree(map, p.x, p.y, HAMSTER_R));
    // A lane with someone in it cannot be passed, so paths cost more through it.
    const inLane = blockCost(map, seen);
    // Pits, cannons about to fire and shut gates are as good as blocked too.
    const trouble = hazardCost(g);
    const blocked = (p, q) => inLane(p, q) + trouble(p, q);

    const steerTo = (pt) => {
      const dx = pt.x - me.x;
      const dy = pt.y - me.y;
      const d = Math.hypot(dx, dy);
      if (d < 3) return;
      out.mx = dx / d;
      out.my = dy / d;
    };
    // Only a deliberate shortcut home may step into a tunnel.
    let tunnelling = false;
    const follow = (points) => {
      if (!points || !points.length) return;
      if (map.warps.includes(points[points.length - 1])) tunnelling = true;
      steerTo(nav.nextTarget(me, points));
    };
    // A tunnel is part of the map like any lane: for a hamster without a seed it
    // is a one-way hop from the flower's side to its own nest. Routes and travel
    // distances count it whenever going in and walking on from the nest is shorter.
    const tunnels = me.carrying ? [] : map.warps;
    const travel = (to) => {
      let best = nav.distance(me, to);
      for (const w of tunnels) {
        // As the crow flies is the least it could be: most targets are ruled out here.
        if (dist(me, w) + dist(me.nest, to) >= best) continue;
        best = Math.min(best, nav.distance(me, w) + nav.distance(me.nest, to));
      }
      return best;
    };
    const route = (to, extra) => {
      let best = nav.findPath(me, to, extra);
      for (const w of tunnels) {
        // The least the tunnel way can cost; skip the search unless it could win.
        if (dist(me, w) + dist(me.nest, to) >= best.cost) continue;
        if (nav.distance(me, w) + nav.distance(me.nest, to) >= best.cost) continue;
        const leg = nav.findPath(me, w, extra);
        const after = nav.findPath(me.nest, to, extra);
        if (leg.cost + after.cost < best.cost) best = { points: leg.points, cost: leg.cost + after.cost };
      }
      return best;
    };
    // Enemies loitering near a leg of the route, e.g. at a lane mouth.
    const danger = (p, q) => {
      let c = 0;
      for (const e of seen) {
        if (e.home) continue;
        const d = distToSegment(e.x, e.y, p.x, p.y, q.x, q.y);
        if (d < DANGER_R) c += (e.carrying ? 0.35 : 1) * (1 - d / DANGER_R) * DANGER_K;
      }
      return c * cfg.caution;
    };

    // Where could I cut off a seed carrier before they get home?
    const intercept = (c, force) => {
      let entry = entries[0];
      let home = Infinity;
      for (const en of entries) {
        const d = nav.distance(c, en);
        if (d < home) {
          home = d;
          entry = en;
        }
      }
      const pts = [c, ...nav.findPath(c, entry).points];
      let walked = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const seg = dist(a, b);
        if (seg < 1) continue;
        for (let s = i === 1 ? 40 : 0; s <= seg; s += 50) {
          const P = { x: a.x + ((b.x - a.x) * s) / seg, y: a.y + ((b.y - a.y) * s) / seg };
          if (P.x < g.homeX + 20) break;
          if (travel(P) / SPEED <= (walked + s) / (SPEED * CARRY_SPEED)) return P;
        }
        walked += seg;
      }
      const door = { x: g.homeX + 26, y: entry.y };
      const deadline = home / (SPEED * CARRY_SPEED) + 0.25;
      if (nav.distance(me, door) / SPEED <= deadline) return door;
      // Too far to run: a tunnel by the flower drops me at my nest, ahead of them.
      const fromNest = nav.distance(me.nest, door) / SPEED;
      let viaTunnel = null;
      let tunnelTime = Infinity;
      for (const w of map.warps) {
        const time = nav.distance(me, w) / SPEED + fromNest;
        if (time <= deadline) return w;
        if (time < tunnelTime) {
          tunnelTime = time;
          viaTunnel = w;
        }
      }
      // Too late on paper. That is no reason to let it go: carriers get held up
      // on the way and at the door, so head there anyway.
      if (!force) return null;
      // Running at them shows the chase; the tunnel is only worth it when clearly quicker.
      return nav.distance(me, door) / SPEED <= tunnelTime * 1.25 ? door : viaTunnel;
    };

    const lastStandFor = (c) => c.x - g.homeX < LAST_STAND;
    const plan = () => {
      mem.targetId = -1;
      if (me.carrying) {
        const cost = (p, q) => blocked(p, q) + danger(p, q);
        let best = null;
        let kept = null;
        for (const entry of entries) {
          const r = nav.findPath(me, entry, cost);
          if (!best || r.cost < best.cost) best = { ...r, y: entry.y };
          if (mem.mode === 'home' && entry.y === mem.entryY) kept = { ...r, y: entry.y };
        }
        // Stick with the lane already chosen unless another is clearly better.
        if (kept && kept.cost <= best.cost * 1.15) best = kept;
        mem.mode = 'home';
        mem.entryY = best.y;
        mem.path = best.points;
        return;
      }

      // Someone has a seed: stop them if I can get in their way.
      let target = null;
      let urgent = Infinity;
      for (const c of seen) {
        if (!c.carrying || c.home) continue;
        // A seed about to reach home is everybody's problem, whatever was rolled.
        const lastStand = cfg.rally && c.x - g.homeX < LAST_STAND;
        const key = c.id * 1000 + c.seeds;
        if (!mem.denyRolls.has(key)) mem.denyRolls.set(key, rng() < cfg.deny);
        if (!mem.denyRolls.get(key) && !lastStand) continue;
        const near = dist(me, c) < 230 && nav.clear(me, c);
        // Let the others have that one. With enough of them after it, the seed is
        // theirs to stop, and the flower is free: fetch a second seed and walk it
        // home behind the commotion. Not when the first is about to get in.
        if (cfg.poach && !mates.length && !lastStandFor(c) && !(dist(me, c) < 120 && nav.clear(me, c))) {
          const others = seen.filter((e) => e.id !== c.id && !e.carrying && !e.home).length;
          if (others >= cfg.poach) continue;
        }
        // Out of reach is no reason to shrug either: everyone keeps after the seed,
        // except that with three or more chasers the one nearest the flower stays
        // on it, ready to nibble the moment the seed is knocked loose.
        const chasers = [me, ...mates, ...seen.filter((e) => e.id !== c.id && !allied(e, c))].filter((e) => !e.carrying);
        const stays = chasers.length >= 3 && chasers.every((e) => e === me || dist(e, f) > dist(me, f));
        const at = near ? c : intercept(c, cfg.rally && (lastStand || !stays));
        if (!at) continue;
        if (c.x < urgent) {
          urgent = c.x;
          target = { c, at };
        }
      }
      if (target) {
        mem.mode = 'deny';
        mem.targetId = target.c.id;
        mem.path = target.at === target.c ? null : route(target.at).points;
        return;
      }

      // A team-mate is running a seed home: clear out whoever is closest to them.
      // Or leave the escorting to others and fetch a second seed, which gives the
      // rivals two carriers to stop. One choice per trip, so it does not dither.
      for (const c of mates) {
        if (!c.carrying || c.home) continue;
        const key = c.id * 1000 + c.seeds;
        if (!mem.secondRolls.has(key)) mem.secondRolls.set(key, rng() < SECOND_SEED);
        if (g.nibbler === id || mem.secondRolls.get(key)) break;
        let guard = null;
        let guardD = 320;
        for (const e of seen) {
          if (e.home || e.carrying) continue;
          const d = dist(e, c);
          if (d < guardD) {
            guardD = d;
            guard = e;
          }
        }
        if (guard) {
          mem.mode = 'hunt';
          mem.targetId = guard.id;
          mem.path = null;
          return;
        }
      }

      // Otherwise go for a seed. Only one hamster can nibble at a time and it has
      // to hold still, so a rival near the flower has to be dealt with first.
      const fd = dist(me, f);
      let rival = null;
      let rivalD = Infinity;
      if (fd < 330 && g.nibbler !== id) {
        for (const e of seen) {
          if (e.carrying || e.home || dist(e, f) > 330) continue;
          const d = e.nibbler ? 0 : dist(me, e);
          if (d < rivalD) {
            rivalD = d;
            rival = e;
          }
        }
      }
      if (rival) {
        if (mem.huntRoll.id !== rival.id || now > mem.huntRoll.until) {
          mem.huntRoll = { id: rival.id, until: now + 2.5, yes: rng() < cfg.hunt };
        }
        if (mem.huntRoll.yes) {
          mem.mode = 'hunt';
          mem.targetId = rival.id;
          mem.path = null;
          return;
        }
      }
      mem.mode = 'gather';
      if (fd <= f.gatherR - 8) {
        mem.path = null;
        return;
      }
      // Pick a free spot on the ring, preferably out of everyone's reach.
      let best = null;
      for (const spot of map.gatherSpots) {
        let crowd = 0;
        for (const e of seen) {
          const d = dist(e, spot);
          if (d < TOUCH) crowd = Infinity;
          else if (d < 70) crowd += 400;
        }
        if (crowd === Infinity) continue;
        const r = route(spot, blocked);
        if (!best || r.cost + crowd < best.cost) best = { points: r.points, cost: r.cost + crowd };
      }
      mem.path = best ? best.points : [f];
    };

    // Close-quarters movement against one opponent. Whoever walks into a hamster
    // that is standing ready gets hit first, so: stand firm when charged, and when
    // attacking, hover just out of reach to draw a swing at thin air before going in.
    const engage = (e) => {
      mem.targetId = e.id;
      if (mem.duel.id !== e.id || now > mem.duel.expires) {
        mem.duel = {
          id: e.id,
          bait: rng() < cfg.bait,
          hold: rng() < cfg.hold,
          until: now + 0.5 + rng() * 1.1,
          expires: now + 2.4 + rng(),
        };
      }
      if (!nav.clear(me, e)) {
        follow(route(e).points);
        return;
      }
      const dx = e.x - me.x;
      const dy = e.y - me.y;
      const d = Math.hypot(dx, dy) || 1;
      // A swing that has started cannot be taken back: once it is seen, it has as
      // good as landed, so that is the moment to go in. Without the footwork a bot
      // waits until the rival is plainly stuck.
      if (e.swing === 'recovery' || (cfg.dance && e.swing && d > BONK.reach + 6)) {
        steerTo(e);
        return;
      }
      const charging = -(e.vx * dx + e.vy * dy) / d > 0.5 * SPEED;
      if (mem.duel.hold && charging && d < 150) return;
      // Someone nibbling is not going to swing: no feints, straight in.
      if (cfg.dance && !(e.nibbler && Math.hypot(e.vx, e.vy) < 20)) {
        // Dash in to where a swing at me looks sure to land, then straight back
        // out before it does. A few feints, and if nothing bites, go in for real.
        let dn = mem.dance;
        if (dn.id !== e.id || now > dn.expires) {
          dn = mem.dance = { id: e.id, out: false, turn: 58 + rng() * 10, until: 0, feints: 0, most: 2 + Math.floor(rng() * 3), expires: now + 4 };
        }
        if (dn.feints < dn.most) {
          if (dn.out) {
            out.mx = -dx / d;
            out.my = -dy / d;
            if (now >= dn.until || d > 92) {
              dn.out = false;
              dn.turn = 58 + rng() * 10;
            }
          } else {
            out.mx = dx / d;
            out.my = dy / d;
            if (d <= dn.turn) {
              dn.out = true;
              dn.until = now + 0.17 + rng() * 0.1;
              dn.feints++;
            }
          }
          return;
        }
        steerTo({ x: e.x + e.vx * 0.12, y: e.y + e.vy * 0.12 });
        return;
      }
      if (mem.duel.bait && now < mem.duel.until) {
        if (d < 58) {
          out.mx = -dx / d;
          out.my = -dy / d;
        } else if (d > 68) {
          out.mx = dx / d;
          out.my = dy / d;
        }
        return;
      }
      steerTo({ x: e.x + e.vx * 0.12, y: e.y + e.vy * 0.12 });
    };

    if (now >= mem.replanAt) {
      // The thinking bot weighs its plans by playing them forward; if it comes up
      // with nothing, the rules below still apply.
      plan();
      mem.replanAt = now + (planner ? Math.min(SEARCH.every, 0.2) : 0.16 + rng() * 0.08);
      // A rival at the flower with its head down is to be bonked, now. That is not
      // up for a second opinion: weighing it is how a bot ends up standing and watching.
      const atNibbler = mem.mode === 'hunt' && mem.targetId === g.nibbler && Math.hypot(g.players[g.nibbler].vx, g.players[g.nibbler].vy) < 20;
      if (planner && !atNibbler) {
        const rules = { mode: mem.mode, targetId: mem.targetId, path: mem.path, entryY: mem.entryY };
        const idea = planner.choose(g, id, (p, q) => blocked(p, q) + (me.carrying ? danger(p, q) : 0), rules);
        if (idea && idea !== rules) {
          mem.mode = idea.mode;
          mem.targetId = idea.targetId ?? -1;
          mem.path = idea.path || null;
          if (idea.entryY !== undefined) mem.entryY = idea.entryY;
        }
      }
    }

    const target = mem.targetId >= 0 ? seen.find((e) => e.id === mem.targetId) : null;
    if (mem.mode === 'home') {
      follow(mem.path);
      // Someone standing in the way: fight through rather than walk into a bonk.
      for (const e of seen) {
        if (e.home) continue;
        const d = dist(me, e);
        if (d > 150 || !nav.clear(me, e)) continue;
        if ((out.mx * (e.x - me.x) + out.my * (e.y - me.y)) / (d || 1) < 0.5) continue;
        out.mx = 0;
        out.my = 0;
        engage(e);
        break;
      }
    } else if (mem.mode === 'deny' && target) {
      if (dist(me, target) < 230 && nav.clear(me, target)) engage(target);
      else if (mem.path) {
        follow(mem.path);
      } else engage(target);
    } else if (mem.mode === 'hunt' && target) {
      engage(target);
    } else if (mem.path) {
      follow(mem.path);
    }

    // Do not walk into a pit, and do not step into a line a cannon is about to
    // fire down. Waiting a moment is cheaper than a trip home.
    if (g.hazards.length && (out.mx || out.my)) {
      const ahead = { x: me.x + out.mx * 26, y: me.y + out.my * 26 };
      for (const h of g.hazards) {
        const pit = h.kind === 'trap' && Math.hypot(ahead.x - h.x, ahead.y - h.y) < HAZARD.trap.r + 8 && Math.hypot(me.x - h.x, me.y - h.y) >= HAZARD.trap.r;
        const shot = h.kind === 'cannon' && inCannonLine(map, h, ahead) && !inCannonLine(map, h, me);
        if (pit || shot) {
          out.mx = 0;
          out.my = 0;
          break;
        }
      }
    }

    // Break out of the rare case where steering presses into a corner.
    if (now - mem.stuck.at > 0.6) {
      const wants = Math.hypot(out.mx, out.my) > 0.5 && !me.swing;
      if (wants && Math.hypot(me.x - mem.stuck.x, me.y - mem.stuck.y) < 5) {
        const a = rng() * Math.PI * 2;
        mem.nudge = { until: now + 0.3, x: Math.cos(a), y: Math.sin(a) };
        mem.replanAt = 0;
      }
      mem.stuck = { x: me.x, y: me.y, at: now };
    }
    const wantX = out.mx;
    const wantY = out.my;
    if (now < mem.nudge.until) {
      out.mx = mem.nudge.x;
      out.my = mem.nudge.y;
    }

    // A seed carrier is safe from the tunnel it stands in, and whoever follows it in
    // is sent home. Stop at the rim, which is still within reach of anyone inside.
    if (!me.carrying && !tunnelling) {
      for (const w of map.warps) {
        const rx = me.x - w.x;
        const ry = me.y - w.y;
        const d = Math.hypot(rx, ry) || 1;
        const room = Math.max(0, d - w.r - RIM) / (SPEED * DT);
        const inward = -(out.mx * rx + out.my * ry) / d;
        if (inward <= room) continue;
        out.mx += (rx / d) * (inward - room);
        out.my += (ry / d) * (inward - room);
        // Headed straight in, that leaves it standing still: go round to the target's side.
        if (target && Math.hypot(out.mx, out.my) < 0.3 && dist(me, target) > BONK.reach - cfg.margin - cfg.jitter) {
          const side = -ry * (target.x - me.x) + rx * (target.y - me.y) < 0 ? -1 : 1;
          out.mx = (side * -ry) / d;
          out.my = (side * rx) / d;
        }
      }
    }

    // The last word on tunnels: a step that would end inside one is not taken. The
    // rim logic above only cancels walking straight in. Sliding round the rim is
    // another way in, above all between a tunnel and the map's edge, where there is
    // no room to pass and the edge pushes a hamster inwards.
    if (!me.carrying && !tunnelling && (out.mx || out.my)) {
      const b = map.bounds;
      const nx = Math.max(b.x1 + HAMSTER_R, Math.min(b.x2 - HAMSTER_R, me.x + out.mx * SPEED * DT));
      const ny = Math.max(b.y1 + HAMSTER_R, Math.min(b.y2 - HAMSTER_R, me.y + out.my * SPEED * DT));
      for (const w of map.warps) {
        const next = Math.hypot(nx - w.x, ny - w.y);
        if (next < w.r + RIM && next < Math.hypot(me.x - w.x, me.y - w.y) - 0.01) {
          out.mx = 0;
          out.my = 0;
          break;
        }
      }
    }

    // Seed throw. A carrier can give its seed up to knock down whoever is lined up
    // ahead: well worth it for two at once or a rival's seed, a gamble against one
    // hamster blocking the way. It winds up on the walk and lets go once it would hit.
    let abort = false;
    if (me.carrying && !meHome) {
      const wl = Math.hypot(wantX, wantY);
      const hx = wl > 0.3 ? wantX / wl : me.fx;
      const hy = wl > 0.3 ? wantY / wl : me.fy;
      // Rivals a seed thrown along (ax, ay) would reach, nearest first.
      const inLine = (ax, ay, reach, width) =>
        seen
          .filter((e) => {
            const dx = e.x - me.x;
            const dy = e.y - me.y;
            const along = dx * ax + dy * ay;
            if (e.home || along <= 0 || along > reach || Math.abs(dx * ay - dy * ax) > width) return false;
            return segmentClear(map, me.x, me.y, e.x, e.y, 0);
          })
          .sort((a, b) => dist(me, a) - dist(me, b));
      const ahead = inLine(hx, hy, THROW.range + 30, THROW.width + 6);
      if (!mem.toss && ahead.length) {
        if (mem.tossRoll.id !== ahead[0].id || now > mem.tossRoll.until) {
          const sure = ahead.length > 1 || ahead[0].carrying;
          mem.tossRoll = { id: ahead[0].id, until: now + 3, yes: rng() < (sure ? cfg.volley : cfg.toss) };
        }
        mem.toss = mem.tossRoll.yes ? { id: ahead[0].id } : false;
      }
      if (mem.toss) {
        out.throw = true;
        const face = (e, k) => {
          const d = dist(me, e) || 1;
          out.mx = ((e.x - me.x) / d) * k;
          out.my = ((e.y - me.y) / d) * k;
        };
        // Keep the one it wound up for in its sights, whatever the route home says,
        // and stand off rather than walk into its reach.
        const mark = seen.find((e) => e.id === mem.toss.id);
        const inSight = mark && !mark.home && dist(me, mark) < THROW.range + 30 && segmentClear(map, me.x, me.y, mark.x, mark.y, 0);
        if (inSight) face(mark, dist(me, mark) < 90 ? 0.08 : 1);
        const hit = inLine(me.fx, me.fy, THROW.range - 8, THROW.width - 5);
        if (me.charge >= THROW.charge && hit.length) {
          out.throw = false;
          mem.toss = false;
          face(hit[0], 0.08);
        } else if (!inSight || me.charge > THROW.max - 0.3) {
          // It got away. A wind-up let go early is simply dropped; a full one would
          // throw the seed at nothing, so a swing is started to swallow it instead.
          mem.toss = false;
          if (me.charge < THROW.charge - 2 * DT) out.throw = false;
          else if (!me.swing && me.cooldown <= 0 && !mem.bonkDown) abort = true;
          else mem.toss = { id: -1 };
        }
      }
    } else {
      mem.toss = false;
    }

    // How each rival comes at me: how near it gets before it turns away again.
    if (cfg.wary) {
      for (const e of seen) {
        const dx = e.x - me.x;
        const dy = e.y - me.y;
        const d = Math.hypot(dx, dy) || 1;
        const closing = -(e.vx * dx + e.vy * dy) / d;
        let h = mem.habit.get(e.id);
        if (!h) mem.habit.set(e.id, (h = { coming: false, min: Infinity, turns: [] }));
        if (e.home || d > 120) {
          h.coming = false;
        } else if (closing > 0.4 * SPEED) {
          h.min = h.coming ? Math.min(h.min, d) : d;
          h.coming = true;
        } else if (h.coming && closing < -0.3 * SPEED) {
          h.turns.push(Math.min(h.min, d));
          if (h.turns.length > 3) h.turns.shift();
          h.coming = false;
        }
      }
    }

    // Fooled: I swung at somebody, hit nothing, and that same somebody bonked me
    // while I was stuck. Once is enough to start treating it differently.
    if (cfg.wary) {
      if (mem.aimedAt >= 0 && g.events.some((ev) => ev.type === 'impact' && ev.id === id)) {
        if (g.events.some((ev) => ev.type === 'impact' && ev.id === id && !ev.hit)) mem.whiff = { id: mem.aimedAt, until: now + 1 };
        mem.aimedAt = -1;
      }
      const hit = g.events.find((ev) => ev.type === 'bonk' && ev.id === id);
      if (hit && hit.by === mem.whiff.id && now <= mem.whiff.until) mem.fooled.set(hit.by, (mem.fooled.get(hit.by) || 0) + 1);
    }

    // Swing decision.
    let want = null;
    let giveGround = null;
    if (!me.swing && me.cooldown <= 0 && !meHome) {
      if (now >= mem.noiseAt) {
        mem.noise = (rng() * 2 - 1) * cfg.jitter;
        mem.noiseAt = now + 0.4;
      }
      const lead = BONK.windup + cfg.reaction * cfg.lead;
      const limit = BONK.reach - cfg.margin + mem.noise;
      for (const e of seen) {
        if (e.home) continue;
        const p = predictSwing(me, e, lead);
        if (p.dist > limit || !nav.clear(me, e)) continue;
        const dx = e.x - me.x;
        const dy = e.y - me.y;
        const d = Math.hypot(dx, dy) || 1;
        const closing = -((e.vx - me.vx) * dx + (e.vy - me.vy) * dy) / d;
        const hostile = closing > 0.3 * SPEED || e.swing === 'windup';
        // Standing right where I am trying to go: the only way past is through.
        const inMyWay = d < BONK.reach && (wantX * dx + wantY * dy) / d > 0.5;
        const wanted = inMyWay || e.carrying || e.id === mem.targetId || e.swing === 'recovery' || (!me.carrying && e.nibbler);
        if (!hostile && !wanted && rng() >= cfg.opportunism * DT) continue;
        // The rival is not in reach yet, only on its way: this swing counts on it
        // carrying on. That is exactly what a feint looks like, so a wary bot
        // often lets it come, backing off, and swings once it is really there.
        // A rival with a seed has to come through, so that one is swung at as ever.
        // Not against a rival standing at the flower with its head down.
        const busy = e.nibbler && Math.hypot(e.vx, e.vy) < 20;
        if (cfg.wary && !e.swing && !e.carrying && !busy) {
          const fooled = mem.fooled.get(e.id) || 0;
          const turns = mem.habit.get(e.id)?.turns || [];
          const there = d <= BONK.reach - 3 && closing > -0.2 * SPEED;
          const stay = mem.inReach.get(e.id);
          const ticks = there ? (stay && stay.tick === g.tick - 1 ? stay.n + 1 : 1) : 0;
          mem.inReach.set(e.id, { tick: g.tick, n: ticks });
          // Where it will be when a swing started now lands, if it keeps coming. Once
          // that is past the point of touching, the swing is too late: it will have
          // bumped into me and may already be on its way back out.
          const inward = -(e.vx * dx + e.vy * dy) / d;
          const onTime = inward > 0.5 * SPEED && d - inward * lead >= TOUCH + 1;
          // Against someone who has fooled it before, one guess per approach: take
          // the swing, or let it come.
          if (mem.patience.id !== e.id || now > mem.patience.until) {
            mem.patience = { id: e.id, until: now + 0.7, hold: fooled > 0 && rng() < cfg.wary };
          }
          // It has shown how it comes at me. One that runs right up before it turns
          // will be there when a well-timed swing lands, so that swing is always
          // on. One that turns short of my reach is feinting or about to commit,
          // and there is no telling which: sometimes swing, sometimes wait until it
          // has stood in reach for a few ticks.
          const comesClose = turns.length > 0 && turns.reduce((a, b) => a + b, 0) / turns.length <= BONK.reach - 1;
          // From the first meeting on, a swing at a rival running in is only ever the
          // timely one. Once it has got as far as touching, swinging is what it
          // wants: step back instead. A rival that is not rushing in is fair game.
          const fire = ticks >= 3 || (onTime && (comesClose || !mem.patience.hold)) || (!fooled && inward <= 0.5 * SPEED);
          if (!fire) {
            if (!there) giveGround = { x: -dx / d, y: -dy / d };
            continue;
          }
        }
        if (!want || p.dist < want.dist) want = { ...p, id: e.id };
      }
    }
    if (giveGround && !want) {
      out.mx = giveGround.x;
      out.my = giveGround.y;
      // Not into a tunnel, though.
      if (!me.carrying && map.warps.some((w) => Math.hypot(me.x + out.mx * 8 - w.x, me.y + out.my * 8 - w.y) < w.r + RIM + 2)) {
        out.mx = 0;
        out.my = 0;
      }
    }

    // A weaker bot loses its thread now and then and just stands there.
    const jolt = me.deaths !== mem.deaths || me.carrying !== mem.carrying;
    mem.deaths = me.deaths;
    mem.carrying = me.carrying;
    if (cfg.daze && (jolt || rng() < 0.3 * DT)) mem.dazeUntil = Math.max(mem.dazeUntil, now + cfg.daze * (0.5 + rng()));
    if (now < mem.dazeUntil) {
      out.mx = 0;
      out.my = 0;
    }

    // A weaker bot dithers: the chance has to stay open for a moment before it swings.
    if (!want) mem.swingAt = -1;
    else if (mem.swingAt < 0) mem.swingAt = now + cfg.freeze * (0.5 + rng());
    if (want && now < mem.swingAt) want = null;
    if (abort && !want) want = { ax: me.fx, ay: me.fy, dist: 0 };
    if (want && !mem.bonkDown) {
      out.bonk = true;
      out.ax = want.ax;
      out.ay = want.ay;
      mem.bonkDown = true;
      mem.aimedAt = want.id ?? -1;
      // A swing and a throw do not mix: the bonk goes first and the wind-up is dropped.
      out.throw = false;
      mem.toss = false;
    } else {
      mem.bonkDown = false;
    }
    return out;
  }

  return { think };
}
