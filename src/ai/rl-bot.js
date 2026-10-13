// The RL bots: play with networks trained in rl/, each level from its own weights
// file (RL from rl-policy.bin, RL2 from rl2-policy.bin). A bot sees what it saw in
// training (observe.js) and, like there, picks a move every few ticks and holds it.

import { mulberry32 } from '../sim/rng.js';
import { MAX_P, OBS, DIRS, observe } from './observe.js';
import { decodePolicy, loadPolicy } from './policy.js';

const FILES = { rl: 'rl-policy.bin', rl2: 'rl2-policy.bin' };
const policies = {};
const loading = {};

// Starts fetching a level's weights; its bot stands still until they are in.
export function loadRLPolicy(level = 'rl') {
  const file = FILES[level];
  loading[level] ||= fetch(new URL(`./${file}`, import.meta.url))
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${file} ${r.status}`))))
    .then((b) => {
      policies[level] = loadPolicy(decodePolicy(b));
    })
    .catch((err) => {
      loading[level] = null;
      console.warn(`${level} bot weights did not load`, err);
    });
  return loading[level];
}

export function createRLBot({ seed = 1, level = 'rl' } = {}) {
  loadRLPolicy(level);
  const random = mulberry32(seed);
  const seen = new Float32Array(MAX_P * OBS);
  let choice = null;
  let tick = 0;

  function think(g, id) {
    const policy = policies[level];
    if (!policy) return { mx: 0, my: 0, bonk: false, throw: false };
    const every = policy.meta.frameSkip || 4;
    const fresh = tick++ % every === 0;
    if (fresh || !choice) {
      observe(g, seen);
      choice = policy.act(seen.subarray(id * OBS, (id + 1) * OBS), 1, random);
    }
    const [mx, my] = DIRS[choice[0]];
    // A swing is one press, at the start of a choice, as in training.
    return { mx, my, bonk: fresh && choice[1] === 1, throw: choice[2] === 1 };
  }

  return { think };
}
