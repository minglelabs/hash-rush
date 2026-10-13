// Computer-controlled hamster. A bot only reads the public game state and returns
// the same input object a human does, so any slot can be swapped between the two.

import { DT, SPEED, CARRY_SPEED, LAST_STRETCH, HAMSTER_R, BONK, THROW, gatherTime } from '../sim/constants.js';
import { distToSegment, isFree, segmentClear, segmentHitsRect } from '../sim/map.js';
import { inHome, allied } from '../sim/game.js';
import { mulberry32 } from '../sim/rng.js';
import { getNav, blockCost } from './nav.js';
import { HAZARD, hazardCost, inCannonLine, iceNow, gatesNow } from '../sim/hazards.js';
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
  // thrifty: within this many pixels of home it never throws its seed away. The
  //   seed is the win; a rival knocked down there is worth nothing next to it.
  // nerve: it times a cannon instead of stopping the moment one shows red: it walks
  //   on through the line while it can be out again before the seed is fired, and
  //   holds back only when it cannot.
  // freeze: how long it dithers before a swing it has decided on (seconds)
  // rally: whether it joins the chase after a seed it cannot head off in time
  // The rookie keeps to four simple things: go for a seed, go and stop a rival who
  // has one, carry its own seed home, and bonk whoever comes close. No feints, no
  // standing its ground, no clearing the flower, no throwing. It is beatable because
  // it sees late and swings late, not because it stands about.
  easy: { reaction: 0.45, lead: 0, margin: 0, jitter: 9, bait: 0, hold: 0, deny: 1, hunt: 0, opportunism: 0.3, caution: 0.2, freeze: 0.3, rally: false, toss: 0, volley: 0 },
  normal: { reaction: 0.24, lead: 0.4, margin: 2, jitter: 4, bait: 0.25, hold: 0.5, deny: 0.7, hunt: 0.7, opportunism: 0.8, caution: 0.8, freeze: 0.09, rally: true, toss: 0.3, volley: 0.8 },
  // search: instead of the fixed rules below, it plays each plan forward in a copy
  //   of the game and picks the best (see search.js). Hands as good as hard's.
  hard: { reaction: 0.12, lead: 0.9, margin: 3, jitter: 1, bait: 0.55, hold: 1, deny: 1, hunt: 1, opportunism: 1.5, caution: 1.2, freeze: 0, rally: true, toss: 0.5, volley: 1, thrifty: 330, nerve: true },
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
// toss 0, boxed: it does not gamble its seed on one rival in the way. It throws for
//   two at once, for a rival's seed, or when one is ahead and another is coming up
//   within `boxed` pixels behind, so the seed is as good as lost anyway.
// trail: behind a rival that is running away it keeps this far back. A swing from
//   behind cannot reach anyone who keeps going, so all that happens at a rival's
//   heels is that it turns and swings first. From here that swing hits nothing,
//   and the bot is on it while it is stuck.
// lure: a rival with its head down at the flower still swings at whoever walks up,
//   and standing still it gets that swing in first. The bot dashes in to this
//   distance, where a swing looks sure to land, and straight back out; when the
//   swing has gone into thin air it goes in. With no time for that it goes straight in.
// pincer: on a team, those after the same seed split up instead of all running the
//   same way: the best placed cuts off the way it is going, the next covers the
//   way it would turn to instead, any others run it down from behind. Within this
//   many pixels of each other the lower-numbered one counts as better placed.
// gatewise: it knows the gates. It does not take one for open ground (no seeing or
//   swinging through it), waits in front of a shut one instead of pushing, and
//   routes by where each gate will be when it gets there. The number is what a
//   leg through a gate that will be shut then costs, in pixels of walking.
// clock: at the flower it counts. A seed takes a couple of seconds of standing
//   still, so it nibbles on only while no rival can reach it before the seed comes
//   loose, and it does not budge then. When one can, it goes out and meets it
//   first: a rival sent back to its nest is away for longer than a seed takes.
// ambush: a rival that has run along at its heels for this many seconds is not
//   feinting, it is following, and a follower runs straight into a swing: the bot
//   stops dead, turns and swings the moment that swing would land. Every time,
//   where the hard bot only does it when it happens to feel like a swing.
// dodge: carrying a seed past a side lane, it watches for a person waiting in
//   there who sets off to swing just as it crosses. Walking on is walking into
//   that swing, so it goes straight back the way it came for this many seconds:
//   the swing lands on nothing, and the bot is on whoever is stuck after it.
DIFFICULTY.ace = { ...DIFFICULTY.hard, search: true, dance: true, poach: 1, wary: 0.5, clock: 0.15, toss: 0, boxed: 120, trail: 78, lure: 54, pincer: 60, gatewise: 300, ambush: 0.2, dodge: 0.3 };

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
    spot: null,
    nibbling: false,
    flank: false,
    flee: { id: -1, since: 0, tick: -1 },
    tail: new Map(),
    dodge: { id: -1, until: 0, x: 0, y: 0 },
    cut: null,
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
    // Gates. The bot that knows them does not take a gate for open ground: it
    // cannot see or bonk through one, it does not walk into one, and it routes by
    // where each gate will be when it gets there, not where it is now.
    const gates = cfg.gatewise && map.gates.length ? g.gates || [] : [];
    const gateHit = (a, b, list, pad) => list.some((r) => segmentHitsRect(a.x, a.y, b.x, b.y, r.x - pad, r.y - pad, r.x + r.w + pad, r.y + r.h + pad));
    const clear = (a, b) => nav.clear(a, b) && !(gates.length && gateHit(a, b, gates, 0));
    const later = new Map();
    const gatesWhen = (t) => {
      const k = Math.round(t * 4);
      if (!later.has(k)) later.set(k, gatesNow(map, k / 4, g.homeX));
      return later.get(k);
    };
    // A maze makes the way there longer than the crow flies.
    const eta = (p) => now + (dist(me, p) * 1.3) / SPEED;
    const shut = (p, q) => (gateHit(p, q, gatesWhen(eta(p)), 3) || gateHit(p, q, gatesWhen(eta(q)), 3) ? cfg.gatewise : 0);
    // Pits, cannons about to fire and shut gates are as good as blocked too.
    const slippery = iceNow(map, now).some((r) => me.x >= r.x && me.x <= r.x + r.w && me.y >= r.y && me.y <= r.y + r.h);
    // How fast it can count on walking: a seed, and wet fur, slow it down.
    const pace = cfg.nerve && !slippery ? { x: me.x, y: me.y, v: SPEED * ((me.carrying ? LAST_STRETCH.speed : 1) - (me.wet > 0 ? HAZARD.wave.slow : 0)) } : null;
    const trouble = cfg.gatewise && map.gates.length ? hazardCost({ ...g, gates: [] }, pace) : hazardCost(g, pace);
    const blocked = cfg.gatewise && map.gates.length ? (p, q) => inLane(p, q) + trouble(p, q) + shut(p, q) : (p, q) => inLane(p, q) + trouble(p, q);

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
    // `shun`: places a team-mate has covered. The carrier is then taken to go home
    // by the best way that keeps clear of them, and that is the way to cut off.
    const intercept = (c, force, flank, shun) => {
      let entry = entries[0];
      let home = Infinity;
      let way = null;
      const wide = shun && ((p, q) => shun.reduce((k, at) => k + Math.max(0, 1 - distToSegment(at.x, at.y, p.x, p.y, q.x, q.y) / 130) * 900, 0));
      for (const en of entries) {
        const r = wide ? nav.findPath(c, en, wide) : null;
        const d = r ? r.cost : nav.distance(c, en);
        if (d < home) {
          home = d;
          entry = en;
          way = r;
        }
      }
      if (way) home = nav.distance(c, entry);
      const pts = [c, ...(way || nav.findPath(c, entry)).points];
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
      // With a team-mate already on its heels, running after it too adds nothing:
      // then the tunnel is taken whenever it is the quicker way round to the door.
      return nav.distance(me, door) / SPEED <= tunnelTime * (flank ? 1 : 1.25) ? door : viaTunnel;
    };

    const lastStandFor = (c) => c.x - g.homeX < LAST_STAND;
    const plan = () => {
      mem.targetId = -1;
      mem.flank = false;
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
        const near = dist(me, c) < 230 && clear(me, c);
        // Let the others have that one. With enough of them in its way, the seed is
        // theirs to stop, and the flower is free: fetch a second seed and walk it
        // home behind the commotion. Not when the first is about to get in.
        // "Enough of them" means that many who are better placed than I am to
        // get in its way: nearer the door it is making for. So the ones nearest
        // home defend and the ones out by the flower go for the seed, rather than
        // everybody leaving it to everybody else.
        if (cfg.poach && !mates.length && !lastStandFor(c) && !near) {
          const entry = entries.reduce((best, en) => (nav.distance(c, en) < nav.distance(c, best) ? en : best), entries[0]);
          const door = { x: g.homeX + 26, y: entry.y };
          const mine = travel(door);
          const better = seen.filter((e) => e.id !== c.id && !e.carrying && nav.distance(e, door) < mine).length;
          if (better >= cfg.poach) continue;
        }
        // Out of reach is no reason to shrug either: everyone keeps after the seed,
        // except that with three or more chasers the one nearest the flower stays
        // on it, ready to nibble the moment the seed is knocked loose.
        const chasers = [me, ...mates, ...seen.filter((e) => e.id !== c.id && !allied(e, c))].filter((e) => !e.carrying);
        const stays = chasers.length >= 3 && chasers.every((e) => e === me || dist(e, f) > dist(me, f));
        // With team-mates after the same seed, split up rather than all run the same
        // way and leave it the other. Everyone works the roles out the same way from
        // where everyone stands.
        let press = false;
        let flank = false;
        let shun = null;
        if (cfg.pincer) {
          const free = mates.filter((m) => !m.carrying);
          if (free.length) {
            const entry = entries.reduce((best, en) => (nav.distance(c, en) < nav.distance(c, best) ? en : best), entries[0]);
            const door = { x: g.homeX + 26, y: entry.y };
            // Clearly nearer the door goes first; when it is close, the lower number
            // does. Both sides of a pair come to the same answer that way, even
            // standing on the same spot.
            const mine = nav.distance(me, door);
            const better = free.filter((m) => {
              const theirs = nav.distance(m, door);
              return theirs < mine - cfg.pincer || (theirs <= mine + cfg.pincer && m.id < id);
            }).length;
            // The best placed takes the way it is going. The next covers the way it
            // would turn to instead. Any more run it down from behind.
            press = better >= 2;
            if (better === 1) {
              const first = free.reduce((best, m) => (nav.distance(m, door) < nav.distance(best, door) ? m : best));
              shun = [first, door];
            }
            // Cutting it off from behind it means going round, not after it.
            flank = !press && mine >= nav.distance(c, door);
          }
        }
        const at = flank || shun ? intercept(c, true, flank, shun) : near || press ? c : intercept(c, cfg.rally && (lastStand || !stays));
        if (!at) continue;
        if (c.x < urgent) {
          urgent = c.x;
          target = { c, at, flank: flank || !!shun };
        }
      }
      if (target) {
        mem.mode = 'deny';
        mem.targetId = target.c.id;
        // Where to cut it off shifts a little with every step the carrier takes,
        // and now and then jumps to another lane altogether. Do not turn round for
        // that: stay with the spot picked a moment ago while it is still ahead of
        // the carrier.
        const was = mem.cut;
        const jumped = was && was.id === target.c.id && target.at !== target.c && dist(was.at, target.at) > 110;
        if (jumped && now < was.until && was.at.x < target.c.x - 30 && !map.warps.includes(target.at)) target.at = was.at;
        else if (target.at !== target.c && (!was || was.id !== target.c.id || dist(was.at, target.at) > 110)) mem.cut = { id: target.c.id, at: target.at, until: now + 1.2 };
        mem.path = target.at === target.c ? null : route(target.at).points;
        mem.flank = target.flank && !!mem.path;
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
      let kept = null;
      for (const spot of map.gatherSpots) {
        let crowd = 0;
        for (const e of seen) {
          const d = dist(e, spot);
          if (d < TOUCH) crowd = Infinity;
          else if (d < 70) crowd += 400;
        }
        if (crowd === Infinity) continue;
        const r = route(spot, blocked);
        const option = { points: r.points, cost: r.cost + crowd, spot };
        if (!best || option.cost < best.cost) best = option;
        if (spot === mem.spot) kept = option;
      }
      // Two spots are often as good as each other. Keep heading for the one already
      // chosen unless another is clearly better, or the bot weaves between them.
      if (kept && kept.cost <= best.cost * 1.2 + 40) best = kept;
      mem.spot = best ? best.spot : null;
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
      if (!clear(me, e)) {
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
      // Right behind a rival that is running away there is nothing to hit: a swing
      // from behind falls short of anyone who keeps going. All that can happen at
      // its heels is that it turns and swings first. So follow a step out of that
      // swing's reach, and be there when it has swung at nothing, or stops.
      const fleeing = cfg.trail && !e.swing && d < 140 && (e.vx * dx + e.vy * dy) / d > 0.45 * SPEED;
      if (!fleeing || mem.flee.id !== e.id || g.tick !== mem.flee.tick + 1) mem.flee = { id: fleeing ? e.id : -1, since: now, tick: g.tick };
      else mem.flee.tick = g.tick;
      // Only one that has been going for a while: a step back in the middle of a
      // fight is footwork, and is answered as such below.
      if (fleeing && now - mem.flee.since >= 0.35) {
        // Not on ice, where nobody stops or turns on the spot.
        const slippery = iceNow(map, now).some((r) => me.x >= r.x && me.x <= r.x + r.w && me.y >= r.y && me.y <= r.y + r.h);
        if (!slippery) {
          if (d > cfg.trail) steerTo({ x: e.x + e.vx * 0.12, y: e.y + e.vy * 0.12 });
          return;
        }
      }
      const charging = -(e.vx * dx + e.vy * dy) / d > 0.5 * SPEED;
      if (mem.duel.hold && charging && d < 150) return;
      // No feints against a rival with a seed: it is not there to fight, it is going
      // past. Someone nibbling gets the short ones that draw its swing (see `lure`),
      // unless its seed is about to come loose: then straight in.
      const busy = e.nibbler && Math.hypot(e.vx, e.vy) < 20;
      const hurry = busy && (!cfg.lure || gatherTime(g.players.length, now) - g.players[e.id].gather < Math.max(0, d - 60) / SPEED + 1.1);
      if (cfg.dance && busy && !hurry && (mem.dance.id !== e.id || now > mem.dance.expires || !mem.dance.nib)) {
        mem.dance = { id: e.id, nib: now, out: false, turn: cfg.lure + rng() * 6, until: 0, feints: 0, most: 3, expires: now + 4 };
      } else if (mem.dance.nib) {
        // These feints are for the rival with its head down. Once that is well
        // over, the next meeting gets the full footwork again.
        if (busy) mem.dance.nib = now;
        else if (now - mem.dance.nib > 1.5) mem.dance = { id: -1, expires: 0 };
      }
      if (cfg.dance && !e.carrying && !hurry) {
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
              dn.turn = dn.nib ? cfg.lure + rng() * 6 : 58 + rng() * 10;
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
      // Nor is stopping a seed: the rule book defends, as the hard bot does. Its
      // way of cutting a carrier off beat the look-ahead's second-guessing of it.
      const defending = mem.mode === 'deny';
      // At the flower with its own head down, the clock decides: stay if the seed
      // comes loose before anyone can get here, otherwise deal with the first to come.
      let counted = false;
      mem.nibbling = false;
      if (cfg.clock && g.nibbler === id && mem.mode === 'gather') {
        const left = gatherTime(g.players.length, now) - me.gather;
        let first = null;
        let eta = Infinity;
        for (const e of seen) {
          if (e.home || e.carrying) continue;
          const t = Math.max(0, (clear(me, e) ? dist(me, e) : nav.distance(me, e)) - BONK.reach) / SPEED + BONK.windup;
          if (t < eta) {
            eta = t;
            first = e;
          }
        }
        if (eta > left + cfg.clock) {
          counted = true;
          mem.nibbling = true;
          mem.path = null;
        }
      }
      if (planner && !atNibbler && !defending && !counted) {
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
      let met = false;
      // Someone standing in the way: fight through rather than walk into a bonk.
      for (const e of seen) {
        if (e.home) continue;
        const d = dist(me, e);
        if (d > 150 || !clear(me, e)) continue;
        if ((out.mx * (e.x - me.x) + out.my * (e.y - me.y)) / (d || 1) < 0.5) continue;
        out.mx = 0;
        out.my = 0;
        engage(e);
        met = true;
        break;
      }
      // Someone in a side lane setting off for the spot I am about to cross
      // means to be there with a swing as I pass (see `dodge`).
      if (cfg.dodge && !met && (out.mx || out.my)) {
        const hx = out.mx;
        const hy = out.my;
        const lag = cfg.reaction + cfg.dodge;
        const from = now < mem.dodge.until ? seen.find((e) => e.id === mem.dodge.id && !e.home && e.swing !== 'recovery') : null;
        if (from) {
          out.mx = mem.dodge.x;
          out.my = mem.dodge.y;
        } else {
          for (const e of seen) {
            // A person's trick. A bot never swings round a corner at what it cannot
            // see, so from a bot there is nothing to step back from.
            if (e.home || e.carrying || e.swing || g.players[e.id].kind !== 'human') continue;
            const dx = e.x - me.x;
            const dy = e.y - me.y;
            const d = Math.hypot(dx, dy) || 1;
            // From the side, that is: one ahead is met head on, one behind cannot reach.
            if (d > 130 || (hx * dx + hy * dy) / d < -0.2 || Math.abs(e.vx * hy - e.vy * hx) < 0.4 * SPEED) continue;
            // Only one that can have its swing there just as I cross.
            const mine = (hx * dx + hy * dy) / Math.max(1, Math.hypot(me.vx, me.vy)) - cfg.reaction;
            const its = Math.max(0, Math.abs(hx * dy - hy * dx) - BONK.reach) / SPEED + BONK.windup;
            if (mine > its + 0.1) continue;
            const at = { x: e.x + e.vx * lag, y: e.y + e.vy * lag };
            if (distToSegment(at.x, at.y, me.x, me.y, me.x + hx * 100, me.y + hy * 100) > BONK.reach + 6) continue;
            // Not back into somebody else.
            if (seen.some((r) => r !== e && !r.home && dist(me, r) < 110 && (r.x - me.x) * hx + (r.y - me.y) * hy < 0)) continue;
            mem.dodge = { id: e.id, until: now + cfg.dodge, x: -hx, y: -hy };
            out.mx = -hx;
            out.my = -hy;
            break;
          }
        }
      }
    } else if (mem.mode === 'deny' && target) {
      if (dist(me, target) < (mem.flank ? 100 : 230) && clear(me, target)) engage(target);
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
        let shot = h.kind === 'cannon' && inCannonLine(map, h, ahead) && !inCannonLine(map, h, me);
        // Walk on if that gets it out of the line again before the seed comes by.
        if (shot && pace) {
          const spec = HAZARD.cannon;
          shot = false;
          for (let t = 0; t < spec.warn - h.age + spec.range / spec.speed + 0.1 && !shot; t += 2 * DT) {
            const at = { x: me.x + out.mx * pace.v * t, y: me.y + out.my * pace.v * t };
            if (!inCannonLine(map, h, at)) continue;
            const along = (at.x - h.x) * h.dx + (at.y - h.y) * h.dy;
            const age = h.age + t;
            shot = age > spec.warn - 0.15 && age < spec.warn + (along + HAMSTER_R) / spec.speed + 0.06;
          }
        }
        if (pit || shot) {
          out.mx = 0;
          out.my = 0;
          break;
        }
      }
    }

    // A shut gate right ahead: wait for it rather than push against it.
    if (gates.length && (out.mx || out.my) && gateHit(me, { x: me.x + out.mx * 24, y: me.y + out.my * 24 }, gates, 3)) {
      out.mx = 0;
      out.my = 0;
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
      // Close to home the seed stays in its cheeks, whoever is standing there.
      const keep = cfg.thrifty && me.x - g.homeX < cfg.thrifty;
      if (keep && mem.toss) {
        // A wind-up begun further out is called off: dropped if it is early enough,
        // otherwise swallowed by a swing, as when a target gets away.
        mem.toss = false;
        if (me.charge >= THROW.charge - 2 * DT) {
          if (!me.swing && me.cooldown <= 0 && !mem.bonkDown) abort = true;
          else mem.toss = { id: -1 };
        }
      }
      if (!keep && !mem.toss && ahead.length) {
        if (mem.tossRoll.id !== ahead[0].id || now > mem.tossRoll.until) {
          const sure = ahead.length > 1 || ahead[0].carrying;
          // Caught between one ahead and one coming up behind, the seed is lost
          // either way: then it may as well take somebody with it.
          const boxed = cfg.boxed && seen.some((e) => !e.home && !ahead.includes(e) && dist(me, e) < cfg.boxed && clear(me, e) && (e.x - me.x) * hx + (e.y - me.y) * hy < 0);
          mem.tossRoll = { id: ahead[0].id, until: now + 3, yes: rng() < (sure || boxed ? cfg.volley : cfg.toss) };
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
        if (p.dist > limit || !clear(me, e)) continue;
        const dx = e.x - me.x;
        const dy = e.y - me.y;
        const d = Math.hypot(dx, dy) || 1;
        const closing = -((e.vx - me.vx) * dx + (e.vy - me.vy) * dy) / d;
        const hostile = closing > 0.3 * SPEED || e.swing === 'windup';
        // Standing right where I am trying to go: the only way past is through.
        const inMyWay = d < BONK.reach && (wantX * dx + wantY * dy) / d > 0.5;
        const wanted = inMyWay || e.carrying || e.id === mem.targetId || e.swing === 'recovery' || (!me.carrying && e.nibbler);
        // At my heels, both of us running the same way, for long enough to be sure.
        let ambush = false;
        if (cfg.ambush) {
          const tailing = !e.swing && !e.carrying && -(me.vx * dx + me.vy * dy) / d > 0.45 * SPEED && -(e.vx * dx + e.vy * dy) / d > 0.45 * SPEED;
          const was = mem.tail.get(e.id);
          const since = tailing ? (was && was.tick === g.tick - 1 ? was.since : now) : -1;
          if (tailing) mem.tail.set(e.id, { tick: g.tick, since });
          ambush = tailing && now - since >= cfg.ambush;
        }
        if (!hostile && !wanted && !ambush && rng() >= cfg.opportunism * DT) continue;
        // The rival is not in reach yet, only on its way: this swing counts on it
        // carrying on. That is exactly what a feint looks like, so a wary bot
        // often lets it come, backing off, and swings once it is really there.
        // A rival with a seed has to come through, so that one is swung at as ever.
        // Not against a rival standing at the flower with its head down.
        const busy = e.nibbler && Math.hypot(e.vx, e.vy) < 20;
        if (cfg.wary && !ambush && !e.swing && !e.carrying && !busy) {
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
    if (giveGround && !want && !mem.nibbling) {
      out.mx = giveGround.x;
      out.my = giveGround.y;
      // Not into a tunnel, though.
      if (!me.carrying && map.warps.some((w) => Math.hypot(me.x + out.mx * 8 - w.x, me.y + out.my * 8 - w.y) < w.r + RIM + 2)) {
        out.mx = 0;
        out.my = 0;
      }
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
