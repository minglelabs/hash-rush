// Tuning values for the simulation. Distances are world pixels, times are seconds.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

export const HAMSTER_R = 15;
export const SPEED = 185;
// A hamster with a seed in its cheeks is a touch slower, so chasers stay relevant.
export const CARRY_SPEED = 0.9;
// A seed carrier this close to the home edge is "almost home": the alarm goes off,
// and stopping it there is a big play.
export const ALARM_RANGE = 190;
// From where the alarm goes off, the seed weighs heavier still.
export const LAST_STRETCH = { range: ALARM_RANGE, speed: 0.8 };

export const GATHER_TIME = 2.2;
// The more hamsters crowd the flower, the quicker a seed comes loose: four is
// the baseline, and eight nibble in half the time.
export const gatherTime = (players) => (GATHER_TIME * 4) / Math.max(4, players);
export const COUNTDOWN = 3;

// Stalemate breaker: after `start` seconds the burrow's edge creeps towards the flower.
// At `end` the round is called on bonks instead.
export const OVERTIME = { start: 40, speed: 6.5, end: 105 };

export const BONK = {
  windup: 0.14, // standing still before the hit lands
  recovery: 0.42, // stuck in place after the hit; a whiff is punishable
  cooldown: 0.8, // from swing start until the next swing
  // Centre-to-centre distance that still hits at impact. Two hamsters touch at
  // 2 * HAMSTER_R, so the target has to be right next to the attacker.
  reach: 2 * HAMSTER_R + 10,
  arcCos: Math.cos((75 * Math.PI) / 180),
  recoveryMove: 0.15,
  chain: 2, // a bonk this soon after the last one makes it a double, then a triple
  assist: 80, // auto-aim picks the nearest enemy inside this radius
};

// A seed carrier can give the seed up as a weapon: hold the bonk button to wind up,
// let go to throw it the way the hamster faces. It knocks out every rival along
// its path, four hamsters long. `friendlyFire` decides whether team-mates in the
// way go down too.
export const THROW = { charge: 0.4, range: 8 * HAMSTER_R, width: HAMSTER_R + 6, friendlyFire: false };
