// The thinking part of the top-level bot. Instead of following fixed rules for
// what to do next, it lists a handful of plans ("go for the seed", "cut that
// carrier off at the door", "take the tunnel home"...), plays each one forward a
// couple of seconds in a copy of the game with everyone else doing the obvious
// thing, and takes the plan that leaves it best off. The hands stay the same as
// the hard bot's: this only chooses the plan.

import { step, inHome, allied } from '../sim/game.js';
import { BONK, HAMSTER_R, TICK_RATE } from '../sim/constants.js';
import { isFree } from '../sim/map.js';
import { mulberry32 } from '../sim/rng.js';
import { getNav } from './nav.js';

// How far ahead a plan is played out, and how often the bot thinks again.
// `edge` is how much better than the rule book's own plan another plan has to
// look before the bot leaves the rule book; `keep` is the same for changing its mind.
// A plan once chosen is given `commit` seconds: within that time only a much better
// one (`jump` points) replaces it. The scores are rough, and a bot that changes
// its mind three times a second gets nowhere.
export const SEARCH = { horizon: 2.4, every: 0.3, keep: 25, edge: 60, commit: 1.2, jump: 320 };

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function copy(g, seed) {
  return {
    ...g,
    players: g.players.map((p) => ({ ...p, swing: p.swing ? { ...p.swing } : null })),
    hazards: g.hazards.map((h) => ({ ...h })),
    hazardAt: { ...g.hazardAt },
    events: [],
    rng: mulberry32(seed),
    // What is already on the map plays out; nothing new turns up in a daydream.
    calm: true,
  };
}

// A driver turns a hamster's situation into an input, cheaply: walk a list of
// points, or run at somebody, and bonk whoever is in reach.
function walker(points) {
  let i = 0;
  return (g, p) => {
    while (i < points.length - 1 && dist(p, points[i]) < 14) i++;
    const to = points[i];
    const d = dist(p, to);
    return d < 4 ? { mx: 0, my: 0 } : { mx: (to.x - p.x) / d, my: (to.y - p.y) / d };
  };
}

function chaser(targetId, points) {
  const walk = points && points.length ? walker(points) : null;
  return (g, p) => {
    const e = g.players[targetId];
    const d = dist(p, e);
    // Close enough to see: go straight at it. Otherwise keep to the path there.
    if (!walk || d < 110) return d < 2 ? { mx: 0, my: 0 } : { mx: (e.x - p.x) / d, my: (e.y - p.y) / d };
    return walk(g, p);
  };
}

const still = () => ({ mx: 0, my: 0 });

// Whoever is near enough gets bonked. Everyone in the daydream does this.
function withBonk(g, p, move) {
  const out = { mx: move.mx, my: move.my, bonk: false, ax: 0, ay: 0 };
  if (p.swing || p.cooldown > 0 || inHome(g, p)) return out;
  for (const e of g.players) {
    if (e === p || allied(p, e) || inHome(g, e)) continue;
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > BONK.reach - 2) continue;
    out.bonk = true;
    out.ax = dx / (d || 1);
    out.ay = dy / (d || 1);
    break;
  }
  return out;
}

export function createPlanner({ seed = 1 } = {}) {
  let last = null;
  // Bots do not all think on the same tick: each starts a little out of step.
  let lastAt = ((seed % 9) / 9) * SEARCH.every - SEARCH.every;
  let thought = 0;
  let since = 0;

  // `rules` is what the rule book would do right now: { mode, targetId, path, entryY }.
  function choose(g, id, cost, rules) {
    const now = g.time;
    // Between thoughts it stays with its last choice; if that was the rule book,
    // with whatever the rule book says now.
    if (now - lastAt < SEARCH.every) return !last || last.label === 'rules' ? rules : last.intent;
    const map = g.map;
    const nav = getNav(map);
    const me = g.players[id];
    const f = map.flower;
    const entries = map.rowYs.map((y) => ({ x: g.homeX - 14, y })).filter((p) => isFree(map, p.x, p.y, HAMSTER_R));
    const nearestEntry = (p) => entries.reduce((best, e) => (nav.distance(p, e) < nav.distance(p, best) ? e : best), entries[0]);
    const rivals = g.players.filter((p) => p !== me && !allied(p, me));
    const mates = g.players.filter((p) => p !== me && allied(p, me));
    const out = (p) => !inHome(g, p);

    // What everybody else is taken to be doing: a carrier runs home, the rest go
    // for the nearest seed an opponent is carrying, or else for the flower.
    const others = new Map();
    const homeRuns = new Map();
    for (const p of g.players) {
      if (p === me) continue;
      if (p.carrying) {
        const run = nav.findPath(p, nearestEntry(p)).points;
        homeRuns.set(p.id, run);
        others.set(p.id, walker(run));
        continue;
      }
      const prey = g.players.filter((c) => c.carrying && !allied(c, p) && !inHome(g, c)).sort((a, b) => dist(p, a) - dist(p, b))[0];
      if (prey) others.set(p.id, chaser(prey.id, nav.findPath(p, prey).points));
      else if (dist(p, f) <= f.gatherR - 6) others.set(p.id, still);
      else others.set(p.id, walker(nav.findPath(p, map.gatherSpots.reduce((best, s) => (dist(p, s) < dist(p, best) ? s : best))).points));
    }

    // The plans worth weighing right now.
    const plans = [];
    const add = (label, intent, drive) => plans.push({ label, intent, drive });
    const defending = rules.mode === 'deny';
    // The rule book's plan is always in the running, and has to be beaten clearly.
    const target = rules.targetId >= 0 ? g.players[rules.targetId] : null;
    const ruleDrive = target ? chaser(target.id, rules.path || nav.findPath(me, target).points) : rules.path && rules.path.length ? walker(rules.path) : still;
    add('rules', rules, ruleDrive);
    if (me.carrying) {
      const runs = entries.map((entry) => ({ entry, r: nav.findPath(me, entry, cost) })).sort((a, b) => a.r.cost - b.r.cost).slice(0, 3);
      for (const { entry, r } of runs) add(`home:${entry.y}`, { mode: 'home', entryY: entry.y, path: r.points }, walker(r.points));
    } else {
      const spot = map.gatherSpots.filter((s) => !rivals.some((e) => dist(e, s) < 2 * HAMSTER_R)).reduce((best, s) => (!best || nav.distance(me, s) < nav.distance(me, best) ? s : best), null) || f;
      const toSpot = dist(me, f) <= f.gatherR - 8 ? [] : nav.findPath(me, spot, cost).points;
      // When the rule book says a seed has to be stopped, that is settled: looking
      // ahead only gets to choose how. Whether to leave it to the others and go
      // for a second seed is the rule book's call, made on who is placed to defend.
      if (!defending) add('gather', { mode: 'gather', path: toSpot.length ? toSpot : null }, toSpot.length ? walker(toSpot) : still);

      const carriers = rivals.filter((c) => c.carrying && out(c)).sort((a, b) => a.x - b.x).slice(0, 2);
      for (const c of carriers) {
        add(`chase:${c.id}`, { mode: 'deny', targetId: c.id, path: null }, chaser(c.id, nav.findPath(me, c).points));
        // Get in front of it: at the door it is making for, on foot or by tunnel.
        const run = homeRuns.get(c.id);
        const door = { x: g.homeX + 26, y: run[run.length - 1].y };
        const toDoor = nav.findPath(me, door, cost).points;
        add(`door:${c.id}`, { mode: 'deny', targetId: c.id, path: toDoor }, chaser(c.id, toDoor));
        const tunnel = map.warps.reduce((best, w) => (nav.distance(me, w) < nav.distance(me, best) ? w : best));
        if (nav.distance(me, tunnel) < 260) {
          const toTunnel = nav.findPath(me, tunnel).points;
          add(`tunnel:${c.id}`, { mode: 'deny', targetId: c.id, path: toTunnel }, walker(toTunnel));
        }
      }
      // Clear somebody out: whoever is nearest, and whoever threatens a team-mate's seed.
      const near = rivals.filter((e) => !e.carrying && out(e) && dist(me, e) < 220).sort((a, b) => dist(me, a) - dist(me, b))[0];
      if (near && !defending) add(`hunt:${near.id}`, { mode: 'hunt', targetId: near.id, path: null }, chaser(near.id, null));
      const ward = mates.find((m) => m.carrying && out(m));
      if (ward) {
        const threat = rivals.filter((e) => !e.carrying && out(e)).sort((a, b) => dist(ward, a) - dist(ward, b))[0];
        if (threat && threat !== near && !defending) add(`guard:${threat.id}`, { mode: 'hunt', targetId: threat.id, path: null }, chaser(threat.id, nav.findPath(me, threat).points));
      }
    }
    if (!plans.length) return null;

    // Play each plan out and see where it leaves things.
    const ticks = Math.round(SEARCH.horizon * TICK_RATE);
    const before = g.players.map((p) => ({ deaths: p.deaths, kills: p.kills, x: p.x }));
    let best = null;
    for (const plan of plans) {
      const c = copy(g, (seed + g.tick * 31 + thought++) >>> 0);
      // Fresh drivers for each daydream: they remember where they are on a path.
      const drivers = c.players.map((p) => (p.id === id ? plan.drive : others.get(p.id)));
      let t = 0;
      for (; t < ticks && c.phase === 'playing'; t++) {
        step(c, c.players.map((p) => withBonk(c, p, drivers[p.id](c, p))));
      }
      plan.score = judge(c, id, before, t / ticks);
      // Stick with the current plan unless another is clearly better: no dithering.
      if (last && last.label === plan.label) plan.score += SEARCH.keep;
      if (plan.label === 'rules') plan.score += SEARCH.edge;
      if (!best || plan.score > best.score) best = plan;
    }
    const same = last && plans.find((p) => p.label === last.label);
    if (same && same !== best && now - since < SEARCH.commit && best.score < same.score + SEARCH.jump) best = same;
    if (!last || best.label !== last.label) since = now;
    last = best;
    lastAt = now;
    return best.intent;
  }

  // How good things look for hamster `id` at the end of a daydream.
  function judge(c, id, before, used) {
    const me = c.players[id];
    const map = c.map;
    const f = map.flower;
    const span = map.flower.x - map.home.x2;
    // How far along the way home a seed is, 0 at the flower and 1 at the door.
    const along = (p) => Math.max(0, Math.min(1, (f.x - p.x) / span));
    let s = 0;
    if (c.phase === 'over' && !c.timeout) {
      const mine = c.winners.includes(id);
      // Sooner is better when winning, later when losing.
      return mine ? 2000 - 400 * used : -2000 + 400 * used;
    }
    for (const p of c.players) {
      const side = p === me || allied(p, me) ? 1 : -1;
      const was = before[p.id];
      if (p.carrying) s += side * (260 + 520 * along(p));
      s -= side * 70 * (p.deaths - was.deaths) * (p === me ? 1.6 : 1);
      s += side * 15 * (p.kills - was.kills);
      // A rival left to nibble in peace is a seed on its way.
      if (side < 0) s -= 140 * p.gather;
    }
    if (!me.carrying) {
      // Being at the flower and nibbling is what leads to a seed.
      s -= 0.3 * Math.max(0, dist(me, f) - f.gatherR);
      s += 160 * me.gather;
    }
    return s;
  }

  return { choose };
}
