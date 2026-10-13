// A batch of Hash Rush rounds for reinforcement learning, driven over stdin/stdout.
// It runs the game's own simulation, so what is learned here is the real game.
//
// Protocol: the trainer writes one JSON line of settings, then one frame of actions
// per step. Each frame starts with two bytes that set the sparring partners for the
// rounds dealt from then on: the percentage of rounds with scripted bots in them,
// and which bot levels may sit in (bit 0 easy, bit 1 normal, ...).
// In short: one JSON line of settings, then one frame of actions
// per decision (envs * MAX_P * 3 bytes: move 0-8, bonk 0/1, throw 0/1). This side
// answers with a JSON header line and then, per decision, one frame of:
//   obs    float32  envs * MAX_P * OBS
//   reward float32  envs * MAX_P
//   score  float32  envs * MAX_P   the finished round's score, on the step it ends
//   done   uint8    envs
//   role   uint8    envs * MAX_P   0 empty seat, 1 policy, 2/3/4 scripted bot
//   win    uint8    envs * MAX_P   who won the round that just ended
// A round that ends is replaced at once; `role` then describes the new one.

import { createGame, step, inHome, allied, lastStretch } from '../src/sim/game.js';
import { MAPS, MAP_IDS, WORLD, isFree } from '../src/sim/map.js';
import { HAZARD, iceNow, isNight, untilNight, inCannonLine } from '../src/sim/hazards.js';
import { SPEED, BONK, THROW, OVERTIME, HAMSTER_R, gatherTime } from '../src/sim/constants.js';
import { createBot } from '../src/ai/bot.js';
import { MVP_POINTS } from '../src/client/mvp.js';

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
export const OBS = SELF + WORLD_F + NAV + RAYS + HAZARDS * HAZARD_F + GATES * GATE_F + (MAX_P - 1) * OTHER;
const HAZARD_KINDS = ['trap', 'cannon', 'wave'];
const BOT_LEVELS = ['easy', 'normal', 'hard'];
const DIRS = [[0, 0], ...Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)])];

export const DEFAULTS = {
  envs: 16,
  seed: 1,
  frameSkip: 4, // game ticks per decision: 15 decisions a second
  maps: MAP_IDS, // every map, hazards and all
  players: [2, 3, 4, 5, 6, 7, 8], // how many seats a round has, drawn from this list
  teams: 0.5, // share of rounds played in teams; the rest are everyone for themselves
  teamCounts: [2, 3, 4], // how many teams a team round has, as far as the head count allows
  botEnv: 0.3, // share of rounds that have scripted bots in them
  botSeat: 0.6, // in such a round, the chance a seat other than the first is a bot
  botLevels: [0, 1, 2], // easy, normal, hard
  // Reward: the score table's own weights, and the win on top as the biggest prize.
  scoreWeight: 1,
  win: 30,
  lose: 0,
  death: 0,
  // Progress pay, so the first seed is ever found: nibbling one takes 33 "stand
  // still" choices in a row, which blind luck never produces. It is the change in
  // a potential (nearer the flower, further through the nibble, then nearer home
  // with the seed), so it adds up to nothing over a round trip and does not
  // change which way of playing is best.
  shape: 1,
  // Share of the policy's seats, in rounds without scripted bots, that start at the
  // flower, half of them already holding a seed, so nibbling and the run home are
  // seen early instead of waiting on luck.
  headStart: 0,
};

// ---------- what the map looks like to a policy ----------

const CELL = 8;
const fieldsOf = new Map();

// Walking distance to the flower, to home and to the nearest tunnel from every
// 8px cell of the map, worked out once. A policy is told which way is downhill.
function fields(map) {
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

// ---------- one round ----------

const fieldAt = (F, dist, p) => {
  const i = cellOf(F, p.x, p.y);
  return i < 0 || dist[i] === Infinity ? 1 : Math.min(1, (dist[i] * CELL) / 1000);
};

// How far along a hamster is towards bringing a seed home, from 0 to 12: up to 1
// for getting to the flower, 6 more for nibbling the seed loose, 5 more for the
// way home with it.
function potential(g, p) {
  const F = fields(g.map);
  if (p.carrying) return 7 + 5 * (1 - fieldAt(F, F.home, p));
  return 1 - fieldAt(F, F.flower, p) + 6 * Math.min(1, p.gather / gatherTime(g.players.length, g.time));
}

const score = (g, p) => {
  const goal = g.phase === 'over' && !g.timeout && g.winner === p.id ? 1 : 0;
  const row = [p.kills, p.deaths, p.seeds, goal, p.supers, p.throws, p.stops];
  let s = 0;
  for (let k = 0; k < row.length; k++) s += (MVP_POINTS[k] || 0) * row[k];
  return s;
};

export function createEnvs(settings = {}) {
  const cfg = { ...DEFAULTS, ...settings };
  const E = cfg.envs;
  let state = (cfg.seed * 2654435761) >>> 0 || 1;
  const rnd = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const pick = (list) => list[Math.floor(rnd() * list.length)];

  const obs = new Float32Array(E * MAX_P * OBS);
  const reward = new Float32Array(E * MAX_P);
  const final = new Float32Array(E * MAX_P);
  const done = new Uint8Array(E);
  const role = new Uint8Array(E * MAX_P);
  const win = new Uint8Array(E * MAX_P);
  const envs = [];

  function reset(e) {
    const n = pick(cfg.players);
    const teamed = rnd() < cfg.teams;
    // At least two sides, and no more teams than hamsters.
    const teams = teamed ? Math.min(n, pick(cfg.teamCounts)) : 0;
    const withBots = rnd() < cfg.botEnv;
    const slots = [];
    const bots = [];
    for (let i = 0; i < MAX_P; i++) role[e * MAX_P + i] = 0;
    // Teams as even as the head count allows, dealt to the seats in a random order.
    const sides = Array.from({ length: n }, (_, i) => i % Math.max(1, teams));
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [sides[i], sides[j]] = [sides[j], sides[i]];
    }
    for (let i = 0; i < n; i++) {
      const level = withBots && i > 0 && rnd() < cfg.botSeat ? pick(cfg.botLevels) : -1;
      slots.push({ name: `p${i}`, kind: level < 0 ? 'human' : 'bot', team: teamed ? sides[i] : -1 });
      bots.push(level < 0 ? null : createBot({ difficulty: BOT_LEVELS[level], seed: Math.floor(rnd() * 1e9) }));
      role[e * MAX_P + i] = level < 0 ? 1 : 2 + level;
    }
    const g = createGame({ slots, map: MAPS[pick(cfg.maps)], seed: Math.floor(rnd() * 1e9) });
    while (g.phase === 'countdown') step(g, []);
    if (!withBots) {
      const f = g.map.flower;
      for (const p of g.players) {
        if (rnd() >= cfg.headStart) continue;
        for (let t = 0; t < 10; t++) {
          const a = rnd() * 2 * Math.PI;
          const d = f.r + HAMSTER_R + rnd() * (f.gatherR - f.r - HAMSTER_R);
          const x = f.x + Math.cos(a) * d;
          const y = f.y + Math.sin(a) * d;
          if (!isFree(g.map, x, y, HAMSTER_R)) continue;
          p.x = x;
          p.y = y;
          p.carrying = rnd() < 0.5;
          break;
        }
      }
    }
    envs[e] = { g, bots, teams, mapIndex: MAP_IDS.indexOf(g.map.id), prev: g.players.map(() => 0), deaths: g.players.map(() => 0), phi: g.players.map((p) => potential(g, p)) };
  }

  function observe(e) {
    const { g, teams, mapIndex } = envs[e];
    const F = fields(g.map);
    const ice = iceNow(g.map, g.time);
    const gates = g.gates || [];
    const night = isNight(g.map, g.time) ? 1 : 0;
    const dusk = g.map.cycle ? Math.min(1, untilNight(g.map, g.time) / 24) : 0;
    const players = g.players;
    const need = gatherTime(players.length, g.time);
    for (let i = 0; i < MAX_P; i++) {
      const base = (e * MAX_P + i) * OBS;
      obs.fill(0, base, base + OBS);
      const me = players[i];
      if (!me) continue;
      let o = base;
      const home = inHome(g, me);
      obs[o++] = me.x / WORLD.w;
      obs[o++] = me.y / WORLD.h;
      obs[o++] = me.vx / SPEED;
      obs[o++] = me.vy / SPEED;
      obs[o++] = me.fx;
      obs[o++] = me.fy;
      obs[o++] = me.carrying ? 1 : 0;
      obs[o++] = me.cooldown / BONK.cooldown;
      obs[o++] = me.swing && me.swing.phase === 'windup' ? 1 : 0;
      obs[o++] = me.swing && me.swing.phase === 'recovery' ? 1 : 0;
      obs[o++] = me.charge / THROW.max;
      obs[o++] = me.charge >= THROW.charge ? 1 : 0;
      obs[o++] = me.gather / need;
      obs[o++] = home ? 1 : 0;
      obs[o++] = lastStretch(g, me) ? 1 : 0;
      obs[o++] = me.wet > 0 ? 1 : 0;
      obs[o++] = (me.x - g.homeX) / WORLD.w;
      obs[o++] = Math.hypot(me.x - g.map.flower.x, me.y - g.map.flower.y) / WORLD.w;
      obs[o++] = ice.some((r) => me.x >= r.x && me.x <= r.x + r.w && me.y >= r.y && me.y <= r.y + r.h) ? 1 : 0;

      obs[o++] = g.time / OVERTIME.end;
      obs[o++] = g.time > OVERTIME.start ? 1 : 0;
      obs[o++] = g.homeX / WORLD.w;
      obs[o++] = g.nibbler === me.id ? 1 : 0;
      obs[o++] = g.nibbler >= 0 && g.nibbler !== me.id ? 1 : 0;
      obs[o++] = players.length / MAX_P;
      obs[o++] = me.team >= 0 ? 1 : 0;
      obs[o++] = players.some((p) => p !== me && p.carrying && !allied(p, me)) ? 1 : 0;
      obs[o++] = teams / 4;
      obs[o++] = night;
      obs[o++] = dusk;
      // Which map this is.
      obs[o + mapIndex] = 1;
      o += MAP_IDS.length;

      hint(F, F.flower, me.x, me.y, obs, o);
      hint(F, F.home, me.x, me.y, obs, o + 3);
      hint(F, F.warp, me.x, me.y, obs, o + 6);
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
        obs[o++] = reach;
      }

      // Trouble on the map, nearest first: where it is, what it is, whether it has
      // gone off yet, and for a cannon which way it points and whether I am in its line.
      const near = (a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y);
      const trouble = g.hazards.length > 1 ? [...g.hazards].sort(near) : g.hazards;
      for (let k = 0; k < HAZARDS; k++) {
        const h = trouble[k];
        if (h) {
          const spec = HAZARD[h.kind];
          obs[o] = 1;
          obs[o + 1] = (h.x - me.x) / WORLD.w;
          obs[o + 2] = (h.y - me.y) / WORLD.h;
          obs[o + 3] = Math.min(1, Math.hypot(h.x - me.x, h.y - me.y) / 200);
          obs[o + 4 + HAZARD_KINDS.indexOf(h.kind)] = 1;
          obs[o + 7] = h.age >= spec.warn ? 1 : 0;
          obs[o + 8] = Math.min(1, h.age / spec.warn);
          obs[o + 9] = h.dx || 0;
          obs[o + 10] = h.dy || 0;
          obs[o + 11] = h.kind === 'cannon' && inCannonLine(g.map, h, me) ? 1 : 0;
        }
        o += HAZARD_F;
      }
      // The nearest gates that are shut right now.
      const doors = gates.length > 1 ? gates.map((q) => ({ x: q.x + q.w / 2, y: q.y + q.h / 2 })).sort(near) : gates.map((q) => ({ x: q.x + q.w / 2, y: q.y + q.h / 2 }));
      for (let k = 0; k < GATES; k++) {
        const q = doors[k];
        if (q) {
          obs[o] = 1;
          obs[o + 1] = (q.x - me.x) / WORLD.w;
          obs[o + 2] = (q.y - me.y) / WORLD.h;
        }
        o += GATE_F;
      }

      // Everyone else, nearest first.
      const others = players.filter((p) => p !== me).sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
      for (const p of others) {
        obs[o++] = 1;
        obs[o++] = (p.x - me.x) / WORLD.w;
        obs[o++] = (p.y - me.y) / WORLD.h;
        obs[o++] = Math.min(1, Math.hypot(p.x - me.x, p.y - me.y) / (4 * BONK.reach));
        obs[o++] = p.vx / SPEED;
        obs[o++] = p.vy / SPEED;
        obs[o++] = p.carrying ? 1 : 0;
        obs[o++] = allied(p, me) ? 1 : 0;
        obs[o++] = p.swing && p.swing.phase === 'windup' ? 1 : 0;
        obs[o++] = p.swing && p.swing.phase === 'recovery' ? 1 : 0;
        obs[o++] = p.cooldown / BONK.cooldown;
        obs[o++] = inHome(g, p) ? 1 : 0;
        obs[o++] = (p.x - g.homeX) / WORLD.w;
      }
    }
  }

  // actions: Uint8Array, envs * MAX_P * 3
  function act(actions) {
    reward.fill(0);
    final.fill(0);
    win.fill(0);
    for (let e = 0; e < E; e++) {
      const env = envs[e];
      const { g, bots } = env;
      const n = g.players.length;
      for (let k = 0; k < cfg.frameSkip && g.phase !== 'over'; k++) {
        const inputs = [];
        for (let i = 0; i < n; i++) {
          if (bots[i]) {
            inputs.push(bots[i].think(g, i));
            continue;
          }
          const a = (e * MAX_P + i) * 3;
          const dir = DIRS[actions[a] % 9];
          // A press is one tick long, so every decision can start a new swing.
          inputs.push({ mx: dir[0], my: dir[1], bonk: actions[a + 1] === 1 && k === 0, throw: actions[a + 2] === 1 });
        }
        step(g, inputs);
      }
      const over = g.phase === 'over';
      for (let i = 0; i < n; i++) {
        const p = g.players[i];
        const s = score(g, p);
        let r = (s - env.prev[i]) * cfg.scoreWeight + (p.deaths - env.deaths[i]) * cfg.death;
        env.prev[i] = s;
        env.deaths[i] = p.deaths;
        if (!over && cfg.shape) {
          const phi = potential(g, p);
          r += cfg.shape * (phi - env.phi[i]);
          env.phi[i] = phi;
        }
        if (over) {
          const won = g.winners.includes(p.id);
          r += won ? cfg.win : cfg.lose;
          win[e * MAX_P + i] = won ? 1 : 0;
          final[e * MAX_P + i] = s;
        }
        reward[e * MAX_P + i] = r;
      }
      done[e] = over ? 1 : 0;
      if (over) reset(e);
      observe(e);
    }
  }

  for (let e = 0; e < E; e++) {
    reset(e);
    observe(e);
  }
  return { cfg, obs, reward, final, done, role, win, act };
}

// ---------- the pipe ----------

const HEAD = 2;

function serve() {
  let buffered = Buffer.alloc(0);
  let envs = null;
  let frame = 0;
  const send = () => {
    const parts = [envs.obs, envs.reward, envs.final, envs.done, envs.role, envs.win].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength));
    process.stdout.write(Buffer.concat(parts));
  };
  process.stdin.on('data', (chunk) => {
    buffered = buffered.length ? Buffer.concat([buffered, chunk]) : chunk;
    if (!envs) {
      const nl = buffered.indexOf(10);
      if (nl < 0) return;
      envs = createEnvs(JSON.parse(buffered.subarray(0, nl).toString()));
      buffered = buffered.subarray(nl + 1);
      frame = HEAD + envs.cfg.envs * MAX_P * 3;
      process.stdout.write(`${JSON.stringify({ obs: OBS, maxPlayers: MAX_P, envs: envs.cfg.envs })}\n`);
      send();
    }
    while (buffered.length >= frame) {
      envs.cfg.botEnv = buffered[0] / 100;
      const levels = BOT_LEVELS.map((_, i) => i).filter((i) => buffered[1] & (1 << i));
      if (levels.length) envs.cfg.botLevels = levels;
      envs.act(new Uint8Array(buffered.subarray(HEAD, frame)));
      buffered = buffered.subarray(frame);
      send();
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

if (import.meta.url === `file://${process.argv[1]}`) serve();
