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

import { createGame, step } from '../src/sim/game.js';
import { MAPS, MAP_IDS, isFree } from '../src/sim/map.js';
import { HAMSTER_R, gatherTime } from '../src/sim/constants.js';
import { MAX_P, OBS, DIRS, fields, fieldAt, observe } from '../src/ai/observe.js';

export { MAX_P, OBS };
import { createBot } from '../src/ai/bot.js';
import { MVP_POINTS } from '../src/client/mvp.js';

const BOT_LEVELS = ['easy', 'normal', 'hard', 'ace'];

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
  allBots: false, // every seat a scripted bot, to record their play (rl/demo.js)
  // A fixed line-up instead of a random one: [{ level: -1 policy or 0..2 bot, team: -1 or a side }].
  lineup: null,
};

// ---------- one round ----------


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
  // What each scripted bot did over the last decision, in the policy's own actions.
  const botAct = new Uint8Array(E * MAX_P * 3);
  // Seats set here play `actions` even when a bot sits there; the bot still says
  // what it would have done, which is how rl/demo.js corrects a learner (DAgger).
  const steer = new Uint8Array(E * MAX_P);
  // Whether the round that just ended ran out of time.
  const timedOut = new Uint8Array(E);
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
    const lineup = cfg.lineup || Array.from({ length: n }, (_, i) => ({
      level: withBots && (i > 0 || cfg.allBots) && rnd() < cfg.botSeat ? pick(cfg.botLevels) : -1,
      team: teamed ? sides[i] : -1,
    }));
    for (let i = 0; i < lineup.length; i++) {
      const { level, team } = lineup[i];
      slots.push({ name: `p${i}`, kind: level < 0 ? 'human' : 'bot', team });
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
    envs[e] = { g, bots, prev: g.players.map(() => 0), deaths: g.players.map(() => 0), phi: g.players.map((p) => potential(g, p)) };
  }

  function observeEnv(e) {
    observe(envs[e].g, obs, e * MAX_P * OBS);
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
            const inp = bots[i].think(g, i);
            inputs.push(inp);
            const a = (e * MAX_P + i) * 3;
            if (k === 0) {
              const still = Math.hypot(inp.mx || 0, inp.my || 0) < 0.3;
              botAct[a] = still ? 0 : 1 + ((Math.round(Math.atan2(inp.my, inp.mx) / (Math.PI / 4)) + 8) % 8);
              botAct[a + 1] = 0;
              botAct[a + 2] = 0;
            }
            if (inp.bonk) botAct[a + 1] = 1;
            if (inp.throw) botAct[a + 2] = 1;
            if (!steer[e * MAX_P + i]) continue;
            inputs.pop();
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
      timedOut[e] = over && g.timeout ? 1 : 0;
      if (over) reset(e);
      observeEnv(e);
    }
  }

  for (let e = 0; e < E; e++) {
    reset(e);
    observeEnv(e);
  }
  return { cfg, obs, reward, final, done, role, win, timedOut, botAct, steer, act };
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
