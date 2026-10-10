// Tuning values for the simulation. Distances are world pixels, times are seconds.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

export const HAMSTER_R = 15;
export const SPEED = 185;
// A hamster with a seed in its cheeks is a touch slower, so chasers stay relevant.
export const CARRY_SPEED = 0.93;

export const GATHER_TIME = 2.2;
export const COUNTDOWN = 3;

// Stalemate breaker: after `start` seconds the burrow's edge creeps towards the flower.
export const OVERTIME = { start: 60, speed: 5 };

export const BONK = {
  windup: 0.14, // lunge before the hit lands
  recovery: 0.42, // stuck in place after the hit; a whiff is punishable
  cooldown: 0.8, // from swing start until the next swing
  reach: 46, // centre-to-centre distance that still hits at impact
  arcCos: Math.cos((75 * Math.PI) / 180),
  lunge: 1.0, // speed multiplier during windup
  recoveryMove: 0.15,
  assist: 110, // auto-aim picks the nearest enemy inside this radius
};
