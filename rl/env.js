// A batch of Hash Rush rounds for reinforcement learning, driven over stdin/stdout.
// It runs the game's own simulation, so what is learned here is the real game.
//
// Protocol: the trainer writes one JSON line of settings, then one frame of actions
// per step. Each frame starts with two bytes that set the sparring partners for the
// rounds dealt from then on: the percentage of rounds with scripted bots in them,
// and which bot levels may sit in (bit 0 easy, bit 1 normal, ...).
// In short: one JSON line of settings, then one frame of actions
// per decision (envs * MAX_P * 3 bytes: move 0-8, bonk 0/1, throw 0/1, then
// envs * MAX_P bytes saying which seats see the round the old way, `stale`). This side
// answers with a JSON header line and then, per decision, one frame of:
//   obs    float32  envs * MAX_P * OBS
//   reward float32  envs * MAX_P
//   score  float32  envs * MAX_P   the finished round's score, on the step it ends
//   done   uint8    envs
//   role   uint8    envs * MAX_P   0 empty seat, 1 policy, 2/3/4 scripted bot
//   win    uint8    envs * MAX_P   who won the round that just ended
// A round that ends is replaced at once; `role` then describes the new one.

import { createGame, step, carrySpeed, allied } from '../src/sim/game.js';
import { MAPS, MAP_IDS, isFree } from '../src/sim/map.js';
import { HAMSTER_R, SPEED, DT, gatherTime, pickTime, PICK } from '../src/sim/constants.js';
import { MAX_P, OBS, DIRS, REACTION_TICKS, fields, fieldAt, observe, jobs, snapshot, towardsHome, walkHome } from '../src/ai/observe.js';

export { MAX_P, OBS };
import { createBot } from '../src/ai/bot.js';
import { MVP_POINTS } from '../src/client/mvp.js';

const BOT_LEVELS = ['easy', 'normal', 'hard', 'ace'];

export const DEFAULTS = {
  envs: 16,
  seed: 1,
  frameSkip: 4, // game ticks per decision: 15 decisions a second
  // How many ticks late the policy sees the round (src/ai/observe.js): it learns
  // on the same stale view it plays with in the browser.
  reaction: REACTION_TICKS,
  maps: MAP_IDS, // every map, hazards and all
  players: [2, 3, 4, 5, 6, 7, 8], // how many seats a round has, drawn from this list
  teams: 0.5, // share of rounds played in teams; the rest are everyone for themselves
  teamCounts: [2, 3, 4], // how many teams a team round has, as far as the head count allows
  botEnv: 0.3, // share of rounds that have scripted bots in them
  botSeat: 0.6, // in such a round, the chance a seat other than the first is a bot
  // In a team round with bots, the chance the bots sit by side instead of by
  // seat: the first seat's side is all policy, every other side is all bots of
  // one level (chance `botSeat`) or all policy, as teams are made up in the game.
  sideBots: 0,
  // Share of team rounds played as the game's hosted rooms start: a side of two
  // against a side of one to six.
  duo: 0,
  // Share of free-for-all rounds with bots where every seat but the first is a bot
  // of one and the same level: one learner among a pack that all play alike, as
  // a person meets three easy bots that all run for the seed.
  pack: 0,
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
  // Team spirit (OpenAI Five): in a team round each hamster is paid this share of
  // its team's average instead of its own, so clearing the way for a teammate's
  // seed pays too. The win bonus is shared anyway; 0 is everyone for themselves.
  teamSpirit: 0,
  // A bot level (3 the ace) that also thinks in every policy seat without playing
  // it, so the learner can be taught what it would have done (`taught`, botAct).
  // -1: none.
  teacher: -1,
  // Defence and team jobs (jobs() in src/ai/observe.js).
  // `catch`: extra pay for bonking a rival who has a seed, up to three times as
  //   much the nearer that rival was to home.
  // `delay`: pay per decision to whoever is on a rival seed carrier (its marker in
  //   a team round, anyone within DELAY_R alone) for the ground the carriers did not
  //   cover, counting the freest of them, so holding one up while another walks
  //   home earns nothing.
  // `role`: pay for a marker or guard closing in on the rival it watches.
  catch: 0,
  // Taking a rival's seed by pickpocketing: what nibbling a seed scores.
  steal: 2,
  // What having a seed pickpocketed costs the one who had it.
  robbed: 0,
  // Bonking a rival off a teammate's seed while it is picking the pocket.
  save: 0,
  delay: 0,
  role: 0,
  // Share of the policy's seats, in rounds without scripted bots, that start at the
  // flower, half of them already holding a seed, so nibbling and the run home are
  // seen early instead of waiting on luck.
  headStart: 0,
  // Share of rounds that start with a seed carrier on its way home and a rival
  // right up against it: pickpocketing takes a second of staying in touch, and
  // shaking a pickpocket off takes a swing at it, neither of which luck finds.
  tail: 0,
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
  const nibble = 6 * Math.min(1, p.gather / gatherTime(g.players.length, g.time));
  // Rubbing a rival carrier towards taking its seed counts like nibbling one loose.
  const pick = p.pickOn >= 0 ? 6 * Math.min(1, p.pick / pickTime(g.players.length, g.time)) : 0;
  return 1 - fieldAt(F, F.flower, p) + Math.max(nibble, pick);
}

const score = (g, p) => {
  const goal = g.phase === 'over' && !g.timeout && g.winner === p.id ? 1 : 0;
  const row = [p.kills, p.deaths, p.seeds, goal, p.supers, p.throws, p.stops];
  let s = 0;
  for (let k = 0; k < row.length; k++) s += (MVP_POINTS[k] || 0) * row[k];
  return s;
};

const DELAY_R = 200;
const homeLeft = (g, p) => fieldAt(fields(g.map), fields(g.map).home, p);

// How close a marker or guard is to the rival it watches. Higher is closer.
function guardPhi(g, p) {
  const { job, mark } = jobs(g)[p.id];
  if ((job !== 'mark' && job !== 'guard') || !mark) return 0;
  return -Math.min(1, Math.hypot(mark.x - p.x, mark.y - p.y) / 1000);
}

const jobKey = (g, p) => {
  const { job, mark } = jobs(g)[p.id];
  return `${job}:${mark ? mark.id : -1}`;
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
  // Policy seats where the teacher said what it would have done (botAct).
  const taught = new Uint8Array(E * MAX_P);
  // Whether the round that just ended ran out of time.
  const timedOut = new Uint8Array(E);
  // Seats set here see the whole round `reaction` ticks late, themselves included,
  // as the policies before rl17 learned. The others see themselves as they are
  // now and only the other hamsters late, which is how the scripted bots see.
  const stale = new Uint8Array(E * MAX_P);
  const envs = [];

  function reset(e) {
    let n = pick(cfg.players);
    const teamed = rnd() < cfg.teams;
    // At least two sides, and no more teams than hamsters.
    let teams = teamed ? Math.min(n, pick(cfg.teamCounts)) : 0;
    const withBots = rnd() < cfg.botEnv;
    const duo = cfg.duo > 0 && teamed && rnd() < cfg.duo;
    if (duo) {
      n = 3 + Math.floor(rnd() * (MAX_P - 2));
      teams = 2;
    }
    const slots = [];
    const bots = [];
    for (let i = 0; i < MAX_P; i++) role[e * MAX_P + i] = 0;
    // Teams as even as the head count allows, dealt to the seats in a random order.
    const sides = Array.from({ length: n }, (_, i) => (duo ? (i < 2 ? 0 : 1) : i % Math.max(1, teams)));
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [sides[i], sides[j]] = [sides[j], sides[i]];
    }
    // Bots by side: each side but the first seat's is one level of bot or all policy.
    let sideLevel = null;
    if (cfg.sideBots > 0 && teamed && withBots && !cfg.allBots && rnd() < cfg.sideBots) {
      sideLevel = Array.from({ length: teams }, (_, t) => (t !== sides[0] && rnd() < cfg.botSeat ? pick(cfg.botLevels) : -1));
      if (sideLevel.every((l) => l < 0)) sideLevel[(sides[0] + 1 + Math.floor(rnd() * (teams - 1))) % teams] = pick(cfg.botLevels);
    }
    const pack = cfg.pack > 0 && !teamed && withBots && !cfg.allBots && rnd() < cfg.pack ? pick(cfg.botLevels) : -1;
    const lineup = cfg.lineup || Array.from({ length: n }, (_, i) => ({
      level: sideLevel ? sideLevel[sides[i]] : pack >= 0 ? (i > 0 ? pack : -1) : withBots && (i > 0 || cfg.allBots) && rnd() < cfg.botSeat ? pick(cfg.botLevels) : -1,
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
    // A carrier part of the way home with a rival at its side, to practise on.
    if (cfg.tail > 0 && g.players.length > 1 && rnd() < cfg.tail) {
      const c = pick(g.players);
      const rivals = g.players.filter((p) => p !== c && !allied(p, c));
      const f = g.map.flower;
      for (let t = 0; rivals.length && t < 12; t++) {
        const a = rnd() * 2 * Math.PI;
        const d = f.r + HAMSTER_R + rnd() * (f.gatherR - f.r - HAMSTER_R);
        const from = { x: f.x + Math.cos(a) * d, y: f.y + Math.sin(a) * d };
        if (!isFree(g.map, from.x, from.y, HAMSTER_R)) continue;
        const spot = towardsHome(g.map, from, rnd() * 0.75 * walkHome(g.map, from));
        const b = rnd() * 2 * Math.PI;
        const x = spot.x + Math.cos(b) * (PICK.reach - 3);
        const y = spot.y + Math.sin(b) * (PICK.reach - 3);
        if (spot.x < g.homeX + 60 || x < g.homeX + 30 || !isFree(g.map, spot.x, spot.y, HAMSTER_R) || !isFree(g.map, x, y, HAMSTER_R)) continue;
        Object.assign(c, { x: spot.x, y: spot.y, carrying: true });
        Object.assign(pick(rivals), { x, y, carrying: false });
        break;
      }
    }
    const teachers = lineup.map(({ level }) => (level < 0 && cfg.teacher >= 0 ? createBot({ difficulty: BOT_LEVELS[cfg.teacher], seed: Math.floor(rnd() * 1e9) }) : null));
    for (let i = 0; i < MAX_P; i++) taught[e * MAX_P + i] = teachers[i] ? 1 : 0;
    envs[e] = { tick: 0, past: [], g, bots, teachers, home: g.players.map((p) => homeLeft(g, p)), job: g.players.map((p) => jobKey(g, p)), guard: g.players.map((p) => guardPhi(g, p)), caught: g.players.map(() => 0), prev: g.players.map(() => 0), deaths: g.players.map(() => 0), phi: g.players.map((p) => potential(g, p)) };
  }

  // What the policy sees at a decision: the round as it was `reaction` ticks ago
  // (or as it began, early on). Views are kept only for the ticks that will be asked for.
  function observeEnv(e) {
    const env = envs[e];
    if (!cfg.reaction) {
      observe(env.g, obs, e * MAX_P * OBS);
      return;
    }
    const want = env.tick - cfg.reaction;
    while (env.past.length > 1 && env.past[1].tick <= want) env.past.shift();
    const then = env.past.length && env.past[0].tick <= want ? env.past[0] : null;
    const at = e * MAX_P * OBS;
    // Each seat as it is now, with the others as they were.
    observe(env.g, obs, at, then);
    // The old way: the whole view from back then, the seat itself included.
    if (then && then.view) for (let i = 0; i < MAX_P; i++) if (stale[e * MAX_P + i]) obs.set(then.view.subarray(i * OBS, (i + 1) * OBS), at + i * OBS);
  }
  function keepView(env, e) {
    if (!cfg.reaction || (env.tick + cfg.reaction) % cfg.frameSkip !== 0) return;
    const kept = snapshot(env.g);
    // The round's own clock: the game's started with the countdown.
    kept.tick = env.tick;
    kept.view = null;
    for (let i = 0; i < MAX_P; i++) {
      if (!stale[e * MAX_P + i]) continue;
      kept.view = new Float32Array(MAX_P * OBS);
      observe(env.g, kept.view);
      break;
    }
    env.past.push(kept);
  }

  // actions: Uint8Array, envs * MAX_P * 3
  function act(actions) {
    reward.fill(0);
    final.fill(0);
    win.fill(0);
    for (let e = 0; e < E; e++) {
      const env = envs[e];
      const { g, bots, teachers } = env;
      const n = g.players.length;
      for (let k = 0; k < cfg.frameSkip && g.phase !== 'over'; k++) {
        const inputs = [];
        for (let i = 0; i < n; i++) {
          const a = (e * MAX_P + i) * 3;
          const bot = bots[i] || teachers[i];
          if (bot) {
            const inp = bot.think(g, i);
            if (k === 0) {
              const still = Math.hypot(inp.mx || 0, inp.my || 0) < 0.3;
              botAct[a] = still ? 0 : 1 + ((Math.round(Math.atan2(inp.my, inp.mx) / (Math.PI / 4)) + 8) % 8);
              botAct[a + 1] = 0;
              botAct[a + 2] = 0;
            }
            if (inp.bonk) botAct[a + 1] = 1;
            if (inp.throw) botAct[a + 2] = 1;
            if (bots[i] && !steer[e * MAX_P + i]) {
              inputs.push(inp);
              continue;
            }
          }
          const dir = DIRS[actions[a] % 9];
          // A press is one tick long, so every decision can start a new swing.
          inputs.push({ mx: dir[0], my: dir[1], bonk: actions[a + 1] === 1 && k === 0, throw: actions[a + 2] === 1 });
        }
        // Whose pocket each one is picking, before a bonk sends it home.
        const picking = cfg.save ? g.players.map((p) => p.pickOn) : null;
        step(g, inputs);
        // For tools that look at what happens tick by tick.
        if (cfg.onTick) cfg.onTick(g, e);
        env.tick++;
        keepView(env, e);
        for (const ev of g.events) {
          if (ev.type === 'bonk' && picking && picking[ev.id] >= 0 && picking[ev.id] !== ev.by && allied(g.players[picking[ev.id]], g.players[ev.by])) env.caught[ev.by] += cfg.save;
          if (ev.type === 'bonk' && ev.seed && cfg.catch) env.caught[ev.by] += cfg.catch * (1 + 2 * (1 - homeLeft(g, ev)));
          // Taking a seed off a rival: the nibbling's score for winning a seed, and
          // the catch bonus for stopping a carrier.
          if (ev.type === 'steal') {
            env.caught[ev.by] += cfg.steal + cfg.catch * (1 + 2 * (1 - homeLeft(g, ev)));
            env.caught[ev.id] -= cfg.robbed;
          }
        }
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
        r += env.caught[i];
        env.caught[i] = 0;
        if (!over && cfg.role) {
          const job = jobKey(g, p);
          const phi = guardPhi(g, p);
          // A new role starts a new measure; only a kept role is paid.
          if (job === env.job[i]) r += cfg.role * (phi - env.guard[i]);
          env.job[i] = job;
          env.guard[i] = phi;
        }
        reward[e * MAX_P + i] = r;
      }
      // Whoever is on a rival carrier is paid for the ground the carriers did not cover.
      if (cfg.delay && !over) {
        const slow = g.players.map((c, j) => {
          if (!c.carrying || env.home[j] >= 1) return 1;
          const could = (SPEED * carrySpeed(g, c) * DT * cfg.frameSkip) / 1000;
          return Math.max(0, Math.min(1, 1 - (env.home[j] - homeLeft(g, c)) / could));
        });
        const job = jobs(g);
        for (let i = 0; i < n; i++) {
          const p = g.players[i];
          const { mark } = job[i];
          if (!mark || !mark.carrying || Math.hypot(mark.x - p.x, mark.y - p.y) > DELAY_R) continue;
          if (job[i].job !== 'mark' && job[i].job !== 'solo') continue;
          let least = 1;
          for (let j = 0; j < n; j++) if (j !== i && g.players[j].carrying && !(p.team >= 0 && g.players[j].team === p.team)) least = Math.min(least, slow[j]);
          reward[e * MAX_P + i] += cfg.delay * least;
        }
      }
      for (let j = 0; j < n; j++) env.home[j] = homeLeft(g, g.players[j]);
      if (cfg.teamSpirit) {
        const own = reward.slice(e * MAX_P, e * MAX_P + n);
        for (let i = 0; i < n; i++) {
          const p = g.players[i];
          if (p.team < 0) continue;
          let sum = 0;
          let k = 0;
          for (let j = 0; j < n; j++) {
            if (g.players[j].team !== p.team) continue;
            sum += own[j];
            k++;
          }
          reward[e * MAX_P + i] = (1 - cfg.teamSpirit) * own[i] + (cfg.teamSpirit * sum) / k;
        }
      }
      done[e] = over ? 1 : 0;
      timedOut[e] = over && g.timeout ? 1 : 0;
      if (over) {
        // For tools that count what happened in a round (rl/stats.js).
        if (cfg.onOver) cfg.onOver(g, e);
        reset(e);
      }
      observeEnv(e);
    }
  }

  for (let e = 0; e < E; e++) {
    reset(e);
    observeEnv(e);
  }
  return { cfg, obs, reward, final, done, role, win, timedOut, botAct, steer, taught, stale, act };
}

// ---------- the pipe ----------

const HEAD = 2;

function serve() {
  let buffered = Buffer.alloc(0);
  let envs = null;
  let frame = 0;
  let acts = 0;
  const send = () => {
    const parts = [envs.obs, envs.reward, envs.final, envs.done, envs.role, envs.win, envs.botAct, envs.taught].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength));
    process.stdout.write(Buffer.concat(parts));
  };
  process.stdin.on('data', (chunk) => {
    buffered = buffered.length ? Buffer.concat([buffered, chunk]) : chunk;
    if (!envs) {
      const nl = buffered.indexOf(10);
      if (nl < 0) return;
      envs = createEnvs(JSON.parse(buffered.subarray(0, nl).toString()));
      buffered = buffered.subarray(nl + 1);
      acts = envs.cfg.envs * MAX_P * 3;
      frame = HEAD + acts + envs.cfg.envs * MAX_P;
      process.stdout.write(`${JSON.stringify({ obs: OBS, maxPlayers: MAX_P, envs: envs.cfg.envs })}\n`);
      send();
    }
    while (buffered.length >= frame) {
      envs.cfg.botEnv = buffered[0] / 100;
      const levels = BOT_LEVELS.map((_, i) => i).filter((i) => buffered[1] & (1 << i));
      if (levels.length) envs.cfg.botLevels = levels;
      envs.stale.set(buffered.subarray(HEAD + acts, frame));
      envs.act(new Uint8Array(buffered.subarray(HEAD, HEAD + acts)));
      buffered = buffered.subarray(frame);
      send();
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

if (import.meta.url === `file://${process.argv[1]}`) serve();
