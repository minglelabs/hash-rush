// Deterministic game simulation. It knows nothing about the DOM, input devices or
// who is a bot: every tick it takes one input per player and advances the world.
// Human, bot and (later) network players all feed it through the same input shape:
//   { mx, my, bonk, ax?, ay?, throw? }   move vector, bonk button, optional aim
//   direction, and whether the throw button is held

import { DT, SPEED, CARRY_SPEED, LAST_STRETCH, HAMSTER_R, gatherTime, COUNTDOWN, BONK, OVERTIME, ALARM_RANGE, THROW, ICE } from './constants.js';
import { MAP, resolveCollisions, segmentClear, segmentHitsRect, gatesAt, pushOutRect } from './map.js';
import { HAZARD, stepHazards } from './hazards.js';
import { mulberry32 } from './rng.js';

export const EMPTY_INPUT = Object.freeze({ mx: 0, my: 0, bonk: false });

// Inside the burrow nobody can bonk or be bonked, and a carrier who gets here wins.
export function inHome(g, p) {
  return p.x < g.homeX;
}

// A seed carrier's share of full speed: slower with the seed, slowest right before home.
export const lastStretch = (g, p) => p.carrying && p.x - g.homeX < LAST_STRETCH.range;
export function carrySpeed(g, p) {
  if (!p.carrying) return 1;
  return lastStretch(g, p) ? LAST_STRETCH.speed : CARRY_SPEED;
}

// Walls, the flower, the map edge and any gate in the way.
function collide(g, p) {
  resolveCollisions(g.map, p, HAMSTER_R);
  if (!g.gates.length) return;
  for (const r of g.gates) pushOutRect(p, HAMSTER_R, r);
  resolveCollisions(g.map, p, HAMSTER_R);
}

// A clear line from a to b: no wall, and no gate, in between.
function sight(g, a, b) {
  if (!segmentClear(g.map, a.x, a.y, b.x, b.y, 0)) return false;
  return !g.gates.some((r) => segmentHitsRect(a.x, a.y, b.x, b.y, r.x, r.y, r.x + r.w, r.y + r.h));
}

const onIce = (map, p) => map.ice.some((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);


// Team-mates cannot bonk each other and walk straight through one another. A slot
// without a team (-1) is on its own side, so a game with no teams is everyone
// against everyone.
export function allied(a, b) {
  return a.team >= 0 && a.team === b.team;
}

export function createGame({ slots, map = MAP, seed = 1 }) {
  const rng = mulberry32(seed);
  const nests = (slots.length > map.nests.length ? map.bigNests : map.nests).map((n) => ({ ...n }));
  for (let i = nests.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [nests[i], nests[j]] = [nests[j], nests[i]];
  }
  if (slots.some((s) => s.team >= 0)) {
    // Team-mates start side by side. Which team gets which stretch of the arc is random.
    const rank = new Map();
    for (const s of slots) if (!rank.has(s.team)) rank.set(s.team, rng());
    const order = slots.map((_, id) => id).sort((a, b) => rank.get(slots[a].team) - rank.get(slots[b].team) || a - b);
    const byY = nests.slice(0, slots.length).sort((a, b) => a.y - b.y);
    order.forEach((id, i) => (nests[id] = byY[i]));
  }
  const players = slots.map((slot, id) => ({
    id,
    name: slot.name,
    kind: slot.kind,
    look: slot.look ?? id,
    team: slot.team ?? -1,
    nest: nests[id],
    x: nests[id].x,
    y: nests[id].y,
    vx: 0,
    vy: 0,
    fx: 1,
    fy: 0,
    carrying: false,
    gather: 0,
    queued: -1,
    swing: null,
    cooldown: 0,
    bonkHeld: false,
    chain: 0,
    chainUntil: 0,
    kills: 0,
    deaths: 0,
    seeds: 0,
    supers: 0,
    throws: 0,
    charge: 0,
    wet: 0,
  }));
  return {
    map,
    tick: 0,
    time: 0,
    phase: 'countdown',
    countdown: COUNTDOWN,
    homeX: map.home.x2,
    // Trouble on the map right now, and when the next lot is due.
    hazards: [],
    hazardAt: 2,
    gates: gatesAt(map, 0),
    nibbler: -1,
    rng,
    players,
    winner: null,
    winners: [],
    timeout: false,
    events: [],
  };
}

function pickAim(g, p, inp, mx, my, moveLen) {
  const al = Math.hypot(inp.ax || 0, inp.ay || 0);
  if (al > 1e-6) return { x: inp.ax / al, y: inp.ay / al };
  let best = null;
  let bestD = BONK.assist;
  for (const e of g.players) {
    if (e === p || allied(p, e) || inHome(g, e)) continue;
    const tx = e.x + e.vx * BONK.windup - p.x;
    const ty = e.y + e.vy * BONK.windup - p.y;
    const d = Math.hypot(tx, ty);
    if (d < bestD && d > 1e-6) {
      bestD = d;
      best = { x: tx / d, y: ty / d };
    }
  }
  if (best) return best;
  if (moveLen > 0.05) return { x: mx / moveLen, y: my / moveLen };
  return { x: p.fx, y: p.fy };
}

// Hamsters are solid. Whoever walked into the other gives way, so standing still
// in a lane blocks it and nobody can be shoved along.
function separate(g) {
  const { map, players } = g;
  const min = 2 * HAMSTER_R;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i];
        const b = players[j];
        if (allied(a, b)) continue;
        let nx = b.x - a.x;
        let ny = b.y - a.y;
        const d = Math.hypot(nx, ny);
        if (d >= min) continue;
        if (d < 1e-6) {
          nx = 1;
          ny = 0;
        } else {
          nx /= d;
          ny /= d;
        }
        const pa = Math.max(0, a.vx * nx + a.vy * ny);
        const pb = Math.max(0, -(b.vx * nx + b.vy * ny));
        const wa = pa + pb > 1e-6 ? pa / (pa + pb) : 0.5;
        const overlap = min - d;
        a.x -= nx * overlap * wa;
        a.y -= ny * overlap * wa;
        b.x += nx * overlap * (1 - wa);
        b.y += ny * overlap * (1 - wa);
        collide(g, a);
        collide(g, b);
      }
    }
  }
}

function sendHome(p) {
  p.x = p.nest.x;
  p.y = p.nest.y;
  p.vx = 0;
  p.vy = 0;
  p.carrying = false;
  p.gather = 0;
  p.queued = -1;
  p.swing = null;
  p.cooldown = 0;
  p.charge = 0;
  p.wet = 0;
}

function respawn(g, p) {
  sendHome(p);
  p.chain = 0;
  p.chainUntil = 0;
  p.deaths++;
  g.events.push({ type: 'spawn', id: p.id, x: p.x, y: p.y });
}

// Nobody brought a seed home in time: the side with the most bonks takes the
// round, then the fewest times bonked, then the most seeds picked. Sides still
// level after that share the win. A team counts as one side.
function timeoutWinners(players) {
  const sides = new Map();
  for (const p of players) {
    const key = p.team >= 0 ? `t${p.team}` : `p${p.id}`;
    const side = sides.get(key) || { ids: [], kills: 0, deaths: 0, seeds: 0 };
    side.ids.push(p.id);
    side.kills += p.kills + p.throws;
    side.deaths += p.deaths;
    side.seeds += p.seeds;
    sides.set(key, side);
  }
  const rank = (a, b) => b.kills - a.kills || a.deaths - b.deaths || b.seeds - a.seeds;
  const sorted = [...sides.values()].sort(rank);
  return sorted.filter((s) => rank(s, sorted[0]) === 0).flatMap((s) => s.ids);
}

// Credits `a` with knocking out `victims`, by a bonk or a thrown seed.
function strike(g, a, victims, bonked, thrown = false) {
  if (!victims.length) return;
  for (const v of victims) {
    bonked.add(v);
    // A thrown seed is its own kind of knock-out and is counted apart from bonks.
    if (thrown) a.throws++;
    else a.kills++;
    // `close` marks a seed stopped just short of home.
    const close = v.carrying && v.x - g.homeX < ALARM_RANGE;
    g.events.push({ type: 'bonk', by: a.id, id: v.id, x: v.x, y: v.y, seed: v.carrying, close });
  }
  // Several down at once, or one after another in quick succession.
  a.chain = (g.time <= a.chainUntil ? a.chain : 0) + victims.length;
  a.chainUntil = g.time + BONK.chain;
  if (a.chain > 1) g.events.push({ type: 'multi', by: a.id, n: a.chain });
  // A super play: three or more in a chain, or a seed stopped at the door.
  // One swing counts once, whichever way it earned it.
  if (a.chain >= 3 || victims.some((v) => v.carrying && v.x - g.homeX < ALARM_RANGE)) a.supers++;
}

export function step(g, inputs) {
  g.events.length = 0;
  if (g.phase === 'over') return g;
  g.tick++;

  if (g.phase === 'countdown') {
    const before = Math.ceil(g.countdown - 1e-9);
    g.countdown -= DT;
    if (g.countdown <= 1e-9) {
      g.phase = 'playing';
      g.events.push({ type: 'go' });
    } else {
      const after = Math.ceil(g.countdown - 1e-9);
      if (after !== before) g.events.push({ type: 'count', n: after });
    }
    return g;
  }

  g.time += DT;
  if (g.map.gates.length) g.gates = gatesAt(g.map, g.time);
  const { map, players } = g;
  if (g.time > OVERTIME.start) {
    if (g.homeX === map.home.x2) g.events.push({ type: 'overtime' });
    // It ends up over the near half of the nibbling ring, where nobody can be bonked,
    // so even a crowded round that has stalled into a brawl finishes.
    const limit = map.flower.x;
    g.homeX = Math.min(limit, map.home.x2 + (g.time - OVERTIME.start) * OVERTIME.speed);
  }
  const landing = [];
  const throwing = [];

  for (const p of players) {
    const inp = inputs[p.id] || EMPTY_INPUT;
    p.cooldown = Math.max(0, p.cooldown - DT);

    let mx = +inp.mx || 0;
    let my = +inp.my || 0;
    let len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
      len = 1;
    }

    const pressed = !!inp.bonk && !p.bonkHeld;
    p.bonkHeld = !!inp.bonk;
    if (pressed && !p.swing && p.cooldown <= 0 && !inHome(g, p)) {
      const aim = pickAim(g, p, inp, mx, my, len);
      p.swing = { phase: 'windup', t: 0, dx: aim.x, dy: aim.y };
      p.fx = aim.x;
      p.fy = aim.y;
      p.cooldown = BONK.cooldown;
      g.events.push({ type: 'swing', id: p.id });
    }

    // Holding the button with a seed winds up a throw, and letting go throws it.
    // The swing the press started can be cut short, but not before it lands.
    const landed = !(p.swing && p.swing.phase === 'windup');
    if (inp.throw && p.carrying && !inHome(g, p)) {
      p.charge += DT;
      // Fully wound up: it goes by itself.
      if (p.charge >= THROW.max - 1e-9 && landed) {
        throwing.push(p);
        p.charge = 0;
      }
    } else {
      const ready = p.charge >= THROW.charge - 1e-9 && p.carrying && !inHome(g, p);
      if (ready && landed) throwing.push(p);
      p.charge = 0;
    }

    const speed = SPEED * carrySpeed(g, p) * (p.wet > 0 ? HAZARD.wave.slow : 1);
    // Where the hamster is trying to go; on ice it only gets there gradually.
    let tx = 0;
    let ty = 0;
    if (p.swing) {
      p.swing.t += DT;
      if (p.swing.phase === 'windup') {
        if (p.swing.t >= BONK.windup - 1e-9) {
          p.swing.phase = 'recovery';
          p.swing.t = 0;
          landing.push(p);
        }
      } else {
        tx = mx * speed * BONK.recoveryMove;
        ty = my * speed * BONK.recoveryMove;
        if (p.swing.t >= BONK.recovery - 1e-9) p.swing = null;
      }
    } else {
      tx = mx * speed;
      ty = my * speed;
      if (len > 0.05) {
        p.fx = mx / len;
        p.fy = my / len;
      }
    }

    // Winding up a throw, the hamster turns wherever it is steered, even while the
    // swing that the press started still holds it in place.
    if (p.charge > 0 && len > 0.05) {
      p.fx = mx / len;
      p.fy = my / len;
    }

    const slippery = map.ice.length > 0 && onIce(map, p);
    if (slippery) {
      // Inertia: the speed creeps towards what is asked for, so starting, stopping
      // and turning round all take time.
      const dvx = tx - p.vx;
      const dvy = ty - p.vy;
      const dv = Math.hypot(dvx, dvy);
      const most = (SPEED / ICE.ramp) * DT;
      const k = dv > most ? most / dv : 1;
      p.vx += dvx * k;
      p.vy += dvy * k;
    } else {
      p.vx = tx;
      p.vy = ty;
    }

    const fromX = p.x;
    const fromY = p.y;
    p.x += p.vx * DT;
    p.y += p.vy * DT;
    collide(g, p);
    // Sliding into a wall kills the speed in that direction.
    if (slippery) {
      p.vx = (p.x - fromX) / DT;
      p.vy = (p.y - fromY) / DT;
    }
  }
  separate(g);

  // There is never a double knock-out. When several hits land on the same tick
  // they resolve one at a time in a random order, and a hamster that has already
  // been bonked loses its own hit.
  for (let i = landing.length - 1; i > 0; i--) {
    const j = Math.floor(g.rng() * (i + 1));
    [landing[i], landing[j]] = [landing[j], landing[i]];
  }
  const bonked = new Set();
  // Thrown seeds go first, in a random order when two fly on the same tick.
  for (let i = throwing.length - 1; i > 0; i--) {
    const j = Math.floor(g.rng() * (i + 1));
    [throwing[i], throwing[j]] = [throwing[j], throwing[i]];
  }
  for (const a of throwing) {
    if (bonked.has(a)) continue;
    a.carrying = false;
    a.swing = null;
    a.cooldown = BONK.cooldown;
    const victims = [];
    for (const v of players) {
      if (v === a || bonked.has(v) || inHome(g, v)) continue;
      if (allied(a, v) && !THROW.friendlyFire) continue;
      const dx = v.x - a.x;
      const dy = v.y - a.y;
      const along = dx * a.fx + dy * a.fy;
      if (along < 0 || along > THROW.range || Math.abs(dx * a.fy - dy * a.fx) > THROW.width) continue;
      if (!sight(g, a, v)) continue;
      victims.push(v);
    }
    g.events.push({ type: 'throw', id: a.id, x: a.x, y: a.y, dx: a.fx, dy: a.fy, hit: victims.length });
    strike(g, a, victims, bonked, true);
  }
  for (const a of landing) {
    if (bonked.has(a)) continue;
    // A bonk lands on one hamster only: the nearest one in front.
    let victim = null;
    let nearest = BONK.reach;
    if (!inHome(g, a)) {
      for (const v of players) {
        if (v === a || allied(a, v) || bonked.has(v) || inHome(g, v)) continue;
        const dx = v.x - a.x;
        const dy = v.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > nearest) continue;
        if (d > HAMSTER_R && (dx * a.swing.dx + dy * a.swing.dy) / d < BONK.arcCos) continue;
        if (!sight(g, a, v)) continue;
        victim = v;
        nearest = d;
      }
    }
    if (victim) {
      // Team-mates can stand inside each other, and that is a risk: a hit on one
      // of a clump takes out everyone overlapping it.
      const clump = [victim];
      for (const c of clump) {
        for (const v of players) {
          if (clump.includes(v) || !allied(c, v) || bonked.has(v) || inHome(g, v)) continue;
          if (Math.hypot(v.x - c.x, v.y - c.y) < 2 * HAMSTER_R) clump.push(v);
        }
      }
      strike(g, a, clump, bonked);
    }
    g.events.push({ type: 'impact', id: a.id, x: a.x, y: a.y, dx: a.swing.dx, dy: a.swing.dy, hit: !!victim });
  }
  for (const v of bonked) respawn(g, v);
  // Whatever the map itself does to them.
  for (const v of stepHazards(g)) if (!bonked.has(v)) respawn(g, v);

  // A tunnel takes an empty-handed hamster straight back to its nest, which is the
  // quick way to get in front of someone already running home with a seed.
  for (const p of players) {
    if (p.carrying) continue;
    for (const w of map.warps) {
      if (Math.hypot(p.x - w.x, p.y - w.y) > w.r) continue;
      const from = { x: p.x, y: p.y };
      sendHome(p);
      g.events.push({ type: 'warp', id: p.id, fromX: from.x, fromY: from.y, x: p.x, y: p.y });
      break;
    }
  }

  for (const p of players) {
    if (p.carrying && inHome(g, p)) {
      g.phase = 'over';
      g.winner = p.id;
      g.winners = players.filter((o) => o === p || allied(o, p)).map((o) => o.id);
      g.events.push({ type: 'win', id: p.id, team: p.team });
      return g;
    }
  }

  if (g.time >= OVERTIME.end) {
    g.phase = 'over';
    g.timeout = true;
    g.winners = timeoutWinners(players);
    g.winner = g.winners[0];
    g.events.push({ type: 'win', id: g.winner, team: players[g.winner].team, timeout: true });
    return g;
  }

  // The flower feeds one hamster at a time, like a single mineral patch. Whoever
  // has waited in the ring longest nibbles, and has to hold still to do it.
  // Walking resets the progress; leaving or bonking goes to the back of the line.
  const f = map.flower;
  let nibbler = null;
  for (const p of players) {
    const inRing = !p.carrying && Math.hypot(p.x - f.x, p.y - f.y) <= f.gatherR;
    if (!inRing || p.swing) {
      p.queued = inRing ? g.tick : -1;
      p.gather = 0;
      continue;
    }
    if (p.queued < 0) p.queued = g.tick;
    if (!nibbler || p.queued < nibbler.queued) nibbler = p;
  }
  g.nibbler = nibbler ? nibbler.id : -1;
  for (const p of players) if (p !== nibbler) p.gather = 0;
  if (nibbler) {
    if (Math.hypot(nibbler.vx, nibbler.vy) > 1) {
      nibbler.gather = 0;
    } else {
      nibbler.gather += DT;
      if (nibbler.gather >= gatherTime(players.length) - 1e-9) {
        nibbler.gather = 0;
        nibbler.queued = -1;
        nibbler.carrying = true;
        nibbler.seeds++;
        g.nibbler = -1;
        g.events.push({ type: 'seed', id: nibbler.id });
      }
    }
  }
  return g;
}
