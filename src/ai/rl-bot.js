// The RL bot: plays with networks trained in rl/, one for free-for-all rounds
// (rl-solo.bin) and one for team rounds (rl-team.bin), picked by the round it is
// in. It sees what it saw in training (observe.js): itself as it is now and the
// other hamsters REACTION_TICKS late, as the scripted bots do (weights from before
// rl17, without `selfNow` in their meta, see themselves late too). Like in
// training it picks a move every few ticks and holds it in between.

import { mulberry32 } from '../sim/rng.js';
import { MAX_P, OBS, DIRS, REACTION_TICKS, observe, snapshot } from './observe.js';
import { decodePolicy, loadPolicy } from './policy.js';

const FILES = { solo: 'rl-solo.bin', team: 'rl-team.bin' };
const policies = {};
const loading = {};

// The weights' bytes: fetched in a browser, read from disk on the game server
// (Node's fetch does not open file: URLs).
function readWeights(file) {
  const url = new URL(`./${file}`, import.meta.url);
  if (url.protocol === 'file:') {
    return import('node:fs/promises').then((fs) => fs.readFile(url)).then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
  return fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${file} ${r.status}`))));
}

// Starts loading both sets of weights; the bot stands still until one is in.
// Resolves once both have been tried.
export function loadRLPolicy() {
  for (const [mode, file] of Object.entries(FILES)) {
    loading[mode] ||= readWeights(file)
      .then((b) => {
        policies[mode] = loadPolicy(decodePolicy(b));
      })
      .catch((err) => {
        loading[mode] = null;
        console.warn(`RL ${mode} weights did not load`, err);
      });
  }
  return Promise.all(Object.values(loading));
}

// The hamsters as they were, tick by tick, shared by every learned bot in the
// round, so each sees the others REACTION_TICKS late. For weights that learned on
// a view late all over, that whole view is kept too.
const views = new WeakMap();
function seenLate(g) {
  let v = views.get(g);
  if (!v) views.set(g, (v = { tick: -1, past: [] }));
  if (v.tick !== g.tick) {
    const now = snapshot(g);
    if (Object.values(policies).some((p) => !p.meta.selfNow)) {
      now.view = new Float32Array(MAX_P * OBS);
      observe(g, now.view);
    }
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
  const mine = new Float32Array(MAX_P * OBS);

  function think(g, id) {
    // Without team weights, the free-for-all ones play team rounds too.
    const policy = (g.players[id].team >= 0 && policies.team) || policies.solo;
    if (!policy) return { mx: 0, my: 0, bonk: false, throw: false };
    const every = policy.meta.frameSkip || 4;
    const fresh = tick++ % every === 0;
    // Every tick, so the late view has no gaps.
    const then = seenLate(g);
    if (fresh || !choice) {
      let view = then.view;
      if (policy.meta.selfNow || !view) observe(g, (view = mine), 0, then, id);
      choice = policy.act(view.subarray(id * OBS, (id + 1) * OBS), policy.meta.temperature ?? 1, random);
    }
    const [mx, my] = DIRS[choice[0]];
    // A swing is one press, at the start of a choice, as in training.
    return { mx, my, bonk: fresh && choice[1] === 1, throw: choice[2] === 1 };
  }

  return { think };
}
