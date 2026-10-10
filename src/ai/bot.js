// Computer-controlled hamster. A bot only reads the public game state and returns
// the same input object a human does, so any slot can be swapped between the two.

import { DT, SPEED, CARRY_SPEED, BONK } from '../sim/constants.js';
import { distToSegment, isFree } from '../sim/map.js';
import { inHome } from '../sim/game.js';
import { mulberry32 } from '../sim/rng.js';
import { getNav } from './nav.js';

export const DIFFICULTY = {
  // reaction: how stale the bot's view of others is (seconds)
  // lead: how well it compensates for that delay when timing a swing (0..1)
  // margin/jitter: how far inside its reach it wants a target before swinging
  // bait: chance to hang back and wait for a whiff instead of rushing in
  // deny: chance to go after someone who picked up a seed
  // opportunism: swings per second at bystanders who happen to be in reach
  // caution: how strongly it routes around lanes with enemies in them
  easy: { reaction: 0.3, lead: 0.2, margin: 12, jitter: 10, bait: 0.1, deny: 0.4, opportunism: 0.2, caution: 0.5, hunt: 0.4 },
  normal: { reaction: 0.2, lead: 0.6, margin: 8, jitter: 6, bait: 0.3, deny: 0.6, opportunism: 0.45, caution: 1, hunt: 0.7 },
  hard: { reaction: 0.12, lead: 0.95, margin: 5, jitter: 3, bait: 0.5, deny: 0.8, opportunism: 0.7, caution: 1.2, hunt: 0.9 },
};

const LUNGE = SPEED * BONK.lunge * BONK.windup;
const DANGER_R = 180;
const DANGER_K = 260;
const ENTRY_YS = [60, 101, 140, 235, 310, 360, 410, 485, 580, 619, 660];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// If `me` started a swing now, how far outside/inside reach would `e` be at impact?
// `lead` is how far ahead (seconds) to extrapolate the target's movement.
export function predictSwing(me, e, lead) {
  const drift = e.swing ? 0 : lead;
  const px = e.x + e.vx * drift;
  const py = e.y + e.vy * drift;
  const dx = px - me.x;
  const dy = py - me.y;
  const d = Math.hypot(dx, dy) || 1;
  return { ax: dx / d, ay: dy / d, gap: Math.abs(d - LUNGE) };
}

function snapshot(g, p) {
  return {
    id: p.id,
    x: p.x,
    y: p.y,
    vx: p.vx,
    vy: p.vy,
    carrying: p.carrying,
    swing: p.swing ? p.swing.phase : null,
    gather: p.gather,
    seeds: p.seeds,
    home: inHome(g, p),
  };
}

export function createBot({ difficulty = 'normal', seed = 1 } = {}) {
  const rng = mulberry32(seed);
  // Every bot gets a slightly different temperament so they don't all play alike.
  const cfg = { ...(DIFFICULTY[difficulty] || DIFFICULTY.normal) };
  for (const k of ['bait', 'deny', 'hunt']) cfg[k] = Math.max(0, Math.min(1, cfg[k] + (rng() - 0.5) * 0.3));
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
    const seen = history[0].filter((s) => s.id !== id);
    const meHome = inHome(g, me);
    // Spots just inside the burrow that a seed carrier can aim for.
    const entries = ENTRY_YS.map((y) => ({ x: g.homeX - 14, y })).filter((p) => isFree(map, p.x, p.y, 16));

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
    const danger = (weight) => (p, q) => {
      let c = 0;
      for (const e of seen) {
        const w = weight(e);
        if (!w) continue;
        const d = distToSegment(e.x, e.y, p.x, p.y, q.x, q.y);
        if (d < DANGER_R) c += w * (1 - d / DANGER_R) * DANGER_K;
      }
      return c * cfg.caution;
    };

    // Where could I cut off a seed carrier before they get home?
    const intercept = (c) => {
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
      if (nav.distance(me, door) / SPEED <= home / (SPEED * CARRY_SPEED) + 0.25) return door;
      return null;
    };

    const plan = () => {
      mem.targetId = -1;
      if (me.carrying) {
        const cost = danger((e) => (e.home ? 0.5 : e.carrying ? 0.35 : 1));
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
        const key = c.id * 1000 + c.seeds;
        if (!mem.denyRolls.has(key)) mem.denyRolls.set(key, rng() < cfg.deny);
        if (!mem.denyRolls.get(key)) continue;
        const near = dist(me, c) < 230 && nav.clear(me, c);
        const at = near ? c : intercept(c);
        if (!at) continue;
        const eta = c.x;
        if (eta < urgent) {
          urgent = eta;
          target = { c, at };
        }
      }
      if (target) {
        mem.mode = 'deny';
        mem.targetId = target.c.id;
        mem.path = target.at === target.c ? null : nav.findPath(me, target.at).points;
        return;
      }

      // Otherwise go for a seed, clearing out anyone already nibbling on the flower.
      const fd = dist(me, f);
      let prey = null;
      let preyD = 300;
      for (const e of seen) {
        if (e.carrying || e.home || dist(e, f) > f.gatherR + 12) continue;
        if (fd <= f.gatherR && e.gather <= me.gather + 0.1) continue;
        const d = dist(me, e);
        if (d < preyD) {
          preyD = d;
          prey = e;
        }
      }
      if (prey) {
        if (mem.huntRoll.id !== prey.id || now > mem.huntRoll.until) {
          mem.huntRoll = { id: prey.id, until: now + 2.5, yes: rng() < cfg.hunt };
        }
        if (mem.huntRoll.yes) {
          mem.mode = 'hunt';
          mem.targetId = prey.id;
          mem.path = null;
          return;
        }
      }
      mem.mode = 'gather';
      if (fd <= f.gatherR - 8) {
        mem.path = null;
        return;
      }
      const cost = danger((e) => (e.home ? 0 : 0.35));
      let best = null;
      for (const spot of map.gatherSpots) {
        const r = nav.findPath(me, spot, cost);
        if (!best || r.cost < best.cost) best = r;
      }
      mem.path = best.points;
    };

    // Close-quarters movement against one opponent: rush in, or hang just outside
    // their reach hoping they swing at air.
    const engage = (e) => {
      mem.targetId = e.id;
      if (mem.duel.id !== e.id || now > mem.duel.expires) {
        mem.duel = {
          id: e.id,
          style: rng() < cfg.bait ? 'bait' : 'rush',
          until: now + 0.35 + rng() * 0.6,
          expires: now + 2.2 + rng(),
          side: rng() < 0.5 ? -1 : 1,
        };
      }
      if (!nav.clear(me, e)) {
        follow(nav.findPath(me, e).points);
        return;
      }
      const dx = e.x - me.x;
      const dy = e.y - me.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d;
      const uy = dy / d;
      if (e.swing !== 'recovery' && mem.duel.style === 'bait' && now < mem.duel.until) {
        if (d < 98) {
          out.mx = -ux;
          out.my = -uy;
        } else if (d > 122) {
          out.mx = ux;
          out.my = uy;
        } else {
          out.mx = -uy * mem.duel.side;
          out.my = ux * mem.duel.side;
        }
        return;
      }
      steerTo({ x: e.x + e.vx * 0.12, y: e.y + e.vy * 0.12 });
    };

    // While nibbling, keep the flower between me and whoever is closing in.
    const hideBehindFlower = () => {
      let threat = null;
      let td = 170;
      for (const e of seen) {
        if (e.home) continue;
        const d = dist(me, e);
        if (d < td) {
          td = d;
          threat = e;
        }
      }
      if (!threat) return;
      const want = Math.atan2(f.y - threat.y, f.x - threat.x);
      const mine = Math.atan2(me.y - f.y, me.x - f.x);
      let da = want - mine;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) < 0.2) return;
      const r = dist(me, f);
      const s = Math.sign(da);
      const tx = -Math.sin(mine) * s + (Math.cos(mine) * (52 - r)) / 20;
      const ty = Math.cos(mine) * s + (Math.sin(mine) * (52 - r)) / 20;
      const tl = Math.hypot(tx, ty) || 1;
      out.mx = tx / tl;
      out.my = ty / tl;
    };

    if (now >= mem.replanAt) {
      plan();
      mem.replanAt = now + 0.16 + rng() * 0.08;
    }

    const target = mem.targetId >= 0 ? seen.find((e) => e.id === mem.targetId) : null;
    if (mem.mode === 'home') {
      follow(mem.path);
      // Someone standing in the way: fight through rather than walk into a bonk.
      for (const e of seen) {
        if (e.home) continue;
        const d = dist(me, e);
        if (d > 170 || !nav.clear(me, e)) continue;
        if ((out.mx * (e.x - me.x) + out.my * (e.y - me.y)) / (d || 1) < 0.5) continue;
        engage(e);
        break;
      }
    } else if (mem.mode === 'deny' && target) {
      if (dist(me, target) < 230 && nav.clear(me, target)) engage(target);
      else if (mem.path) follow(mem.path);
      else engage(target);
    } else if (mem.mode === 'hunt' && target) {
      engage(target);
    } else if (mem.path) {
      follow(mem.path);
    } else {
      hideBehindFlower();
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
    if (now < mem.nudge.until) {
      out.mx = mem.nudge.x;
      out.my = mem.nudge.y;
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
        if (p.gap > limit || !nav.clear(me, e)) continue;
        const d = dist(me, e) || 1;
        const closing = -((e.vx - me.vx) * (e.x - me.x) + (e.vy - me.vy) * (e.y - me.y)) / d;
        const hostile = closing > 0.3 * SPEED || e.swing === 'windup';
        const wanted =
          e.carrying || e.id === mem.targetId || e.swing === 'recovery' || (!me.carrying && e.gather > 0);
        if (!hostile && !wanted && rng() >= cfg.opportunism * DT) continue;
        if (!want || p.gap < want.gap) want = p;
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
