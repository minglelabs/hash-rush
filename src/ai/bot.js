// Computer-controlled hamster. A bot only reads the public game state and returns
// the same input object a human does, so any slot can be swapped between the two.

import { DT, SPEED, CARRY_SPEED, HAMSTER_R, BONK } from '../sim/constants.js';
import { distToSegment, isFree } from '../sim/map.js';
import { inHome, allied } from '../sim/game.js';
import { mulberry32 } from '../sim/rng.js';
import { getNav, blockCost } from './nav.js';

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
  easy: { reaction: 0.3, lead: 0.2, margin: 1, jitter: 4, bait: 0.1, hold: 0.2, deny: 0.5, hunt: 0.5, opportunism: 0.5, caution: 0.5 },
  normal: { reaction: 0.2, lead: 0.5, margin: 2.5, jitter: 2.5, bait: 0.35, hold: 0.7, deny: 0.8, hunt: 0.85, opportunism: 1, caution: 1 },
  hard: { reaction: 0.12, lead: 0.9, margin: 3, jitter: 1, bait: 0.55, hold: 1, deny: 1, hunt: 1, opportunism: 1.5, caution: 1.2 },
};

const TOUCH = 2 * HAMSTER_R;
const DANGER_R = 110;
const DANGER_K = 300;
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
  const history = [];
  const mem = {
    replanAt: 0,
    mode: 'gather',
    path: null,
    targetId: -1,
    entryY: -1,
    denyRolls: new Map(),
    huntRoll: { id: -1, until: 0, yes: false },
    duel: { id: -1, expires: 0 },
    noise: 0,
    noiseAt: 0,
    bonkDown: false,
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
    const blocked = blockCost(map, seen);

    const steerTo = (pt) => {
      const dx = pt.x - me.x;
      const dy = pt.y - me.y;
      const d = Math.hypot(dx, dy);
      if (d < 3) return;
      out.mx = dx / d;
      out.my = dy / d;
    };
    const follow = (points) => {
      if (points && points.length) steerTo(nav.nextTarget(me, points));
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
          if (nav.distance(me, P) / SPEED <= (walked + s) / (SPEED * CARRY_SPEED)) return P;
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
        const lastStand = c.x - g.homeX < LAST_STAND;
        const key = c.id * 1000 + c.seeds;
        if (!mem.denyRolls.has(key)) mem.denyRolls.set(key, rng() < cfg.deny);
        if (!mem.denyRolls.get(key) && !lastStand) continue;
        const near = dist(me, c) < 230 && nav.clear(me, c);
        // Out of reach is no reason to shrug either: everyone keeps after the seed,
        // except that with three or more chasers the one nearest the flower stays
        // on it, ready to nibble the moment the seed is knocked loose.
        const chasers = [me, ...mates, ...seen.filter((e) => e.id !== c.id && !allied(e, c))].filter((e) => !e.carrying);
        const stays = chasers.length >= 3 && chasers.every((e) => e === me || dist(e, f) > dist(me, f));
        const at = near ? c : intercept(c, lastStand || !stays);
        if (!at) continue;
        if (c.x < urgent) {
          urgent = c.x;
          target = { c, at };
        }
      }
      if (target) {
        mem.mode = 'deny';
        mem.targetId = target.c.id;
        mem.path = target.at === target.c ? null : nav.findPath(me, target.at).points;
        return;
      }

      // A team-mate is running a seed home: clear out whoever is closest to them.
      for (const c of mates) {
        if (!c.carrying || c.home) continue;
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
        const r = nav.findPath(me, spot, blocked);
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
        follow(nav.findPath(me, e).points);
        return;
      }
      const dx = e.x - me.x;
      const dy = e.y - me.y;
      const d = Math.hypot(dx, dy) || 1;
      if (e.swing === 'recovery') {
        steerTo(e);
        return;
      }
      const charging = -(e.vx * dx + e.vy * dy) / d > 0.5 * SPEED;
      if (mem.duel.hold && charging && d < 150) return;
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
      plan();
      mem.replanAt = now + 0.16 + rng() * 0.08;
    }

    const target = mem.targetId >= 0 ? seen.find((e) => e.id === mem.targetId) : null;
    // Only a deliberate shortcut home may step into a tunnel.
    let tunnelling = false;
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
        tunnelling = map.warps.includes(mem.path[mem.path.length - 1]);
      } else engage(target);
    } else if (mem.mode === 'hunt' && target) {
      engage(target);
    } else if (mem.path) {
      follow(mem.path);
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

    // Swing decision.
    let want = null;
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
        if (!want || p.dist < want.dist) want = p;
      }
    }
    if (want && !mem.bonkDown) {
      out.bonk = true;
      out.ax = want.ax;
      out.ay = want.ay;
      mem.bonkDown = true;
    } else {
      mem.bonkDown = false;
    }
    return out;
  }

  return { think };
}
