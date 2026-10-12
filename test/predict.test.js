import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step } from '../src/sim/game.js';
import { createPredictor } from '../src/client/predict.js';
import { COUNTDOWN, DT, SPEED, TICK_RATE } from '../src/sim/constants.js';

const IDLE = { mx: 0, my: 0, ax: 0, ay: 0, seq: 0, th: 0 };

// A host and one guest on a slow line, on one clock. The guest sends an input a
// frame, `up` seconds later the host has it, and a snapshot takes `down` seconds
// back. Returns, frame by frame, where the guest's predictor draws its hamster,
// where the newest snapshot has it, and where the host really puts it once that
// frame's input has arrived. `late(f)` is how much longer frame f's packets take.
function play({ up, down, seconds, script, lose = () => false, late = () => 0 }) {
  const host = createGame({ slots: [{ name: 'guest', kind: 'remote' }, { name: 'other', kind: 'human' }], seed: 5 });
  for (let i = 0; i < COUNTDOWN * TICK_RATE + 2 && host.phase === 'countdown'; i++) step(host, []);
  const start = host.tick;
  const predictor = createPredictor();
  const toHost = [];
  const toGuest = [];
  const ticks = [];
  const frames = [];
  let held = { ...IDLE, n: 0 };
  let seen = 0;
  let game = null;
  let newest = -1;
  let n = 0;

  for (let f = 0; f < seconds * TICK_RATE; f++) {
    const now = f * DT;
    // The guest's frame.
    while (toGuest.length && toGuest[0].at <= now) {
      const snap = toGuest.shift();
      // One that was overtaken on the way is thrown out, as the page does.
      if (snap.k < newest) continue;
      newest = snap.k;
      game = snap.game;
      predictor.heard(snap.at, snap.k, snap.ack);
    }
    const input = { ...IDLE, ...script(now), n: ++n };
    predictor.sent(now, input);
    if (!lose(f)) toHost.push({ at: now + up + late(f), input });
    toHost.sort((a, b) => a.at - b.at);
    const view = game && predictor.view(now, game, 0);
    frames.push({ now, view, shown: game && { x: game.players[0].x, y: game.players[0].y } });

    // The host's tick, half a frame later.
    const when = now + DT / 2;
    while (toHost.length && toHost[0].at <= when) {
      const { input: got } = toHost.shift();
      if (got.n > held.n) held = got;
    }
    step(host, [{ mx: held.mx, my: held.my, ax: held.ax, ay: held.ay, bonk: held.seq !== seen, throw: !!held.th }]);
    seen = held.seq;
    const me = host.players[0];
    ticks.push({ when, x: me.x, y: me.y, swing: !!me.swing });
    if (lose(f)) continue;
    toGuest.push({
      at: when + down + late(f + 3),
      k: host.tick - start,
      ack: held.n,
      game: {
        map: host.map,
        time: host.time,
        phase: host.phase,
        countdown: host.countdown,
        homeX: host.homeX,
        nibbler: host.nibbler,
        players: host.players.map((p) => ({ ...p, nest: p.nest, swing: p.swing && { ...p.swing } })),
      },
    });
    toGuest.sort((a, b) => a.at - b.at);
  }
  // The host's tick that first had the input a frame sent.
  const truth = (frame) => ticks.find((tick) => tick.when >= frame.now + up);
  return { frames, truth };
}

// Out of the nest and along the lane, down into a hedge, a swing, and back.
function errand(now) {
  if (now < 0.5) return {};
  if (now < 1.6) return { mx: 1 };
  if (now < 2.2) return { my: 1, seq: now >= 1.9 ? 1 : 0 };
  if (now < 3) return { mx: -1, my: -1, seq: 1 };
  return { seq: 1 };
}

test('a guest sees its hamster where the host is about to put it, not a round trip behind', () => {
  const { frames, truth } = play({ up: 0.12, down: 0.15, seconds: 3.6, script: errand });
  let worst = 0;
  let behind = 0;
  for (const frame of frames) {
    const real = truth(frame);
    if (!frame.view || !real || frame.now < 1) continue;
    worst = Math.max(worst, Math.hypot(frame.view.x - real.x, frame.view.y - real.y));
    behind = Math.max(behind, Math.hypot(frame.shown.x - real.x, frame.shown.y - real.y));
  }
  // A snapshot alone trails by what a hamster runs in a round trip.
  assert.ok(behind > SPEED * 0.2, `snapshots only trailed by ${behind}`);
  // Played ahead, it is within a tick or two of the truth.
  assert.ok(worst < 2.5 * SPEED * DT, `off by ${worst}`);
});

test('a swing shows the moment the button goes down, once', () => {
  const { frames } = play({ up: 0.12, down: 0.15, seconds: 3.6, script: errand });
  const swinging = frames.filter((f) => f.view).map((f) => ({ now: f.now, on: !!f.view.swing }));
  const first = swinging.find((f) => f.on);
  // Pressed at 1.9 s: seen within two frames, not 0.27 s later.
  assert.ok(first && first.now < 1.9 + 2.5 * DT, `first seen at ${first && first.now}`);
  let starts = 0;
  for (let i = 1; i < swinging.length; i++) if (swinging[i].on && !swinging[i - 1].on) starts++;
  assert.equal(starts, 1);
});

test('a hamster that is standing still is drawn where the snapshot has it', () => {
  const { frames } = play({ up: 0.2, down: 0.2, seconds: 1.5, script: () => ({}) });
  const frame = frames.at(-1);
  assert.ok(frame.view);
  assert.ok(Math.hypot(frame.view.x - frame.shown.x, frame.view.y - frame.shown.y) < 1e-6);
});

test('nothing is guessed before the host has answered an input', () => {
  const { frames } = play({ up: 0.12, down: 0.15, seconds: 0.2, script: () => ({ mx: 1 }) });
  assert.ok(frames.every((f) => !f.view));
});

test('lost packets on the way do not throw the hamster about', () => {
  // Every seventh frame loses both its input and its snapshot.
  const { frames, truth } = play({ up: 0.12, down: 0.15, seconds: 3.6, script: errand, lose: (f) => f % 7 === 3 });
  let worst = 0;
  for (const frame of frames) {
    const real = truth(frame);
    if (!frame.view || !real || frame.now < 1) continue;
    worst = Math.max(worst, Math.hypot(frame.view.x - real.x, frame.view.y - real.y));
  }
  assert.ok(worst < 4 * SPEED * DT, `off by ${worst}`);
});

test('on a jittery line the hamster is never jumped about, and still ends up right', () => {
  // Packets take up to 40 ms longer, each its own amount, and overtake one another.
  const late = (f) => (((f * 7919) % 13) / 12) * 0.04;
  const { frames, truth } = play({ up: 0.12, down: 0.15, seconds: 3.6, script: errand, late });
  const drawn = frames.filter((f) => f.view && f.now >= 1);
  let jump = 0;
  let worst = 0;
  for (let i = 1; i < drawn.length; i++) {
    jump = Math.max(jump, Math.hypot(drawn[i].view.x - drawn[i - 1].view.x, drawn[i].view.y - drawn[i - 1].view.y));
    const real = truth(drawn[i]);
    if (real) worst = Math.max(worst, Math.hypot(drawn[i].view.x - real.x, drawn[i].view.y - real.y));
  }
  // No frame moves it further than a hamster catching up could run.
  assert.ok(jump <= 2 * SPEED * DT + 0.5 + 1e-9, `jumped ${jump}`);
  assert.ok(worst < 6 * SPEED * DT, `off by ${worst}`);
  // Standing still at the end, it is where the host has it.
  const end = frames.at(-1);
  assert.ok(Math.hypot(end.view.x - end.shown.x, end.view.y - end.shown.y) < 0.5);
});
