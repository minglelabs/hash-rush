// Lets a guest's own hamster answer a key at once instead of a round trip later.
//
// The host stays in charge: its snapshots say where everyone is. But a snapshot
// shows the guest's hamster as it was before its latest inputs got there, so this
// plays those inputs forward from the snapshot with the real simulation and draws
// the guest's own hamster where the host is about to put it. Everyone else stays
// where the snapshot has them, and stands in the way there.
//
// Two clocks make that steady. `offset` is when the host's tick 0 would have
// arrived here, so tick k arrives at k * DT + offset. `lag` is how long an input
// takes to come back inside a snapshot. Both are averaged, so one late packet does
// not shake the hamster.

import { step } from '../sim/game.js';
import { DT, SPEED } from '../sim/constants.js';
import { gatesNow } from '../sim/hazards.js';

// Never play further ahead than this many ticks.
const MAX_AHEAD = 60;
// How much of each new sample the clocks take on.
const EASE = 0.1;
// A sample this far off (s) is a hiccup and not noise: go straight to it.
const JUMP = 0.25;
// Seconds of sent inputs kept for playing forward.
const KEEP = 2;
// A step longer than this is a trip home, not a walk: it is not drawn half way.
const TELEPORT = 40;
// When the host turns out to disagree by a little, the hamster is not jumped to
// the right place: it gets there at this many times its running speed.
const CATCH_UP = 2;

const ease = (was, sample) => (was === null || Math.abs(sample - was) > JUMP ? sample : was + (sample - was) * EASE);

export function createPredictor() {
  let history = [];
  let offset = null;
  let lag = null;
  let tick = -1;
  let acked = 0;
  // Where the hamster was last drawn, and when.
  let drawn = null;

  return {
    // A new round: the host counts its ticks from 0 again. The line is the same line.
    reset() {
      offset = null;
      tick = -1;
    },
    // An input on its way to the host, numbered, at `now` seconds.
    sent(now, input) {
      history.push({ ...input, at: now });
      while (history.length > 1 && now - history[0].at > KEEP) history.shift();
    },
    // A snapshot of the host's tick `k`, made with my input number `ack`.
    heard(now, k, ack) {
      if (k > tick) {
        tick = k;
        offset = ease(offset, now - k * DT);
      }
      if (ack > acked && offset !== null) {
        acked = ack;
        const input = history.find((h) => h.n === ack);
        if (input) lag = ease(lag, k * DT + offset - input.at);
      }
    },
    // Seconds from pressing a key to seeing the host act on it, or null if unknown.
    lag: () => lag,
    // Where hamster `me` is by now, going by `game` as the last snapshot left it.
    // Null when there is nothing to add to the snapshot.
    view(now, game, me) {
      const ahead = lag === null || offset === null || game.phase === 'over' ? 0 : Math.min(MAX_AHEAD, (now - offset + lag) / DT - tick);
      if (!(ahead > 0)) {
        drawn = null;
        return null;
      }
      const whole = Math.floor(ahead);

      const g = {
        map: game.map,
        tick,
        time: game.time,
        phase: game.phase,
        countdown: game.countdown,
        homeX: game.homeX,
        // The map's own trouble is the host's to decide.
        hazards: [],
        hazardAt: {},
        calm: true,
        gates: gatesNow(game.map, game.time, game.homeX),
        nibbler: game.nibbler,
        rng: () => 0,
        winner: null,
        winners: [],
        timeout: false,
        events: [],
        // The others only stand there: nothing they were about to do happens here.
        players: game.players.map((p) => ({
          ...p,
          swing: p.id === me && p.swing ? { ...p.swing } : null,
          charge: p.id === me ? p.charge : 0,
          bonkHeld: false,
          chain: 0,
          chainUntil: 0,
        })),
      };
      const mine = g.players[me];

      // The host has had everything up to the acknowledged input. What it has not
      // had yet goes in tick by tick, each at the time it would get there.
      let i = Math.max(0, history.findIndex((h) => h.n >= acked));
      let seq = history.length ? history[i].seq : 0;
      const inputs = [];
      const play = (j) => {
        const due = (tick + j) * DT + offset - lag;
        while (i + 1 < history.length && history[i + 1].at <= due) i++;
        const h = history[i];
        inputs[me] = h ? { mx: h.mx, my: h.my, ax: h.ax, ay: h.ay, bonk: h.seq !== seq, throw: !!h.th } : undefined;
        if (h) seq = h.seq;
        step(g, inputs);
      };
      for (let j = 1; j <= whole; j++) play(j);
      const at = { x: mine.x, y: mine.y, vx: mine.vx, vy: mine.vy, fx: mine.fx, fy: mine.fy, swing: mine.swing && { ...mine.swing }, cooldown: mine.cooldown, charge: mine.charge };
      // Part of the way into the next tick, so it moves smoothly at any frame rate.
      play(whole + 1);
      const part = ahead - whole;
      if (Math.hypot(mine.x - at.x, mine.y - at.y) < TELEPORT) {
        at.x += (mine.x - at.x) * part;
        at.y += (mine.y - at.y) * part;
      }
      if (drawn) {
        const far = Math.hypot(at.x - drawn.x, at.y - drawn.y);
        const reach = CATCH_UP * SPEED * (now - drawn.now) + 0.5;
        if (far > reach && far < TELEPORT) {
          at.x = drawn.x + ((at.x - drawn.x) * reach) / far;
          at.y = drawn.y + ((at.y - drawn.y) * reach) / far;
        }
      }
      drawn = { x: at.x, y: at.y, now };
      return at;
    },
  };
}
