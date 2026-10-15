// The RL bot: plays with networks trained in rl/, one for free-for-all rounds
// (rl-solo.bin) and one for team rounds (rl-team.bin), picked by the round it is
// in. It sees what it saw in training (observe.js) and, like there, picks a move
// every few ticks and holds it in between.

import { mulberry32 } from '../sim/rng.js';
import { MAX_P, OBS, DIRS, REACTION_TICKS, observe } from './observe.js';
import { decodePolicy, loadPolicy } from './policy.js';

const FILES = { solo: 'rl-solo.bin', team: 'rl-team.bin' };
const policies = {};
const loading = {};

// Starts fetching both sets of weights; the bot stands still until one is in.
export function loadRLPolicy() {
  for (const [mode, file] of Object.entries(FILES)) {
    loading[mode] ||= fetch(new URL(`./${file}`, import.meta.url))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${file} ${r.status}`))))
      .then((b) => {
        policies[mode] = loadPolicy(decodePolicy(b));
      })
      .catch((err) => {
        loading[mode] = null;
        console.warn(`RL ${mode} weights did not load`, err);
      });
  }
}

// What the round looked like, tick by tick, shared by every learned bot in it, so
// each sees it REACTION_TICKS late without working it out more than once a tick.
const views = new WeakMap();
function seenLate(g) {
  let v = views.get(g);
  if (!v) views.set(g, (v = { tick: -1, past: [] }));
  if (v.tick !== g.tick) {
    const now = new Float32Array(MAX_P * OBS);
    observe(g, now);
    v.past.push(now);
    if (v.past.length > REACTION_TICKS + 1) v.past.shift();
    v.tick = g.tick;
  }
  return v.past[0];
}

export function createRLBot({ seed = 1 } = {}) {
  loadRLPolicy();
  const random = mulberry32(seed);
  let choice = null;
  let tick = 0;

  function think(g, id) {
    // Without team weights, the free-for-all ones play team rounds too.
    const policy = (g.players[id].team >= 0 && policies.team) || policies.solo;
    if (!policy) return { mx: 0, my: 0, bonk: false, throw: false };
    const every = policy.meta.frameSkip || 4;
    const fresh = tick++ % every === 0;
    // Every tick, so the late view has no gaps.
    const seen = seenLate(g);
    if (fresh || !choice) choice = policy.act(seen.subarray(id * OBS, (id + 1) * OBS), 1, random);
    const [mx, my] = DIRS[choice[0]];
    // A swing is one press, at the start of a choice, as in training.
    return { mx, my, bonk: fresh && choice[1] === 1, throw: choice[2] === 1 };
  }

  return { think };
}
