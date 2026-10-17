// The policy runner lives with the game, which plays it as the RL bot.
export * from '../src/ai/policy.js';

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
  if (due) actions.set(p.act(obs), at);
  else actions[at + 1] = actions[at + 2] = 0;
}
