// The policy runner lives with the game, which plays it as the RL bot.
export * from '../src/ai/policy.js';
import { loadPolicy } from '../src/ai/policy.js';

// Each policy decides every meta.frameSkip ticks, as it was trained to. A round
// with several runs at the shortest of them; one that decides less often keeps
// its move in between, without pressing bonk or throw again.
export function pacing(policies) {
  const every = (p) => p?.meta?.frameSkip || 4;
  const skip = Math.min(4, ...policies.filter(Boolean).map(every));
  return { skip, due: (p, step) => step % Math.max(1, Math.round(every(p) / skip)) === 0 };
}

// Puts a policy's move for one seat into `actions` at `at`: a new decision when
// one is due, else the last move held.
export function seatMove(actions, at, p, obs, due) {
  if (due) actions.set(p.act(obs, p.meta.temperature ?? 1), at);
  else actions[at + 1] = actions[at + 2] = 0;
}

// Policies from before rl17 learned on a view that was late all over, themselves
// included; the ones since see themselves as they are now (`selfNow` in their
// meta). Tells the environment which view each seat a policy plays is to get.
export function seatViews(envs, MAX_P, seatPolicy) {
  for (let s = 0; s < envs.stale.length; s++) {
    const p = seatPolicy(s % MAX_P);
    envs.stale[s] = p && !p.meta.selfNow ? 1 : 0;
  }
}

// A policy file given as path or as path@temperature: 0.7 plays the likelier
// moves more often than it was trained to, 1 as trained.
export function readPolicy(spec, readFileSync) {
  const [path, temperature] = spec.split('@');
  const p = loadPolicy(JSON.parse(readFileSync(path, 'utf8')));
  if (temperature) p.meta.temperature = Number(temperature);
  return p;
}
