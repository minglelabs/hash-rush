import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, PLAYLISTS, barsOf, trackSeconds, noteNumber, createMusic } from '../src/client/music.js';

test('every bar of every tune is eight valid eighth notes over one or two chords', () => {
  for (const [name, track] of Object.entries(TRACKS)) {
    for (const bar of barsOf(track)) {
      assert.ok(bar.chords.length === 1 || bar.chords.length === 2, name);
      if (!bar.mel) continue;
      assert.equal(bar.mel.length, 8, `${name}: ${bar.mel.join(' ')}`);
      for (const token of bar.mel) if (token !== '.' && token !== '-') assert.ok(noteNumber(token) > 50, token);
    }
  }
});

test('a round has six tunes of about two minutes each', () => {
  assert.equal(PLAYLISTS.game.length, 6);
  for (const name of PLAYLISTS.game) assert.ok(Math.abs(trackSeconds(TRACKS[name]) - 120) < 12, `${name}: ${trackSeconds(TRACKS[name])}s`);
  for (const list of Object.values(PLAYLISTS)) for (const name of list) assert.ok(TRACKS[name], name);
  assert.equal(noteNumber('A4'), 69);
  assert.equal(noteNumber('Bb5'), 82);
});

test('the round playlist plays on from one tune to a different one', () => {
  // A stand-in audio context: only the clock matters here.
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = () => ({ frequency: param(), gain: param(), Q: param(), connect: (to) => to, disconnect() {}, start() {}, stop() {}, getChannelData: () => new Float32Array(8) });
  const ctx = { state: 'running', currentTime: 0, sampleRate: 16, destination: node(), createOscillator: node, createGain: node, createBiquadFilter: node, createBufferSource: node, createBuffer: node };
  const real = { document: globalThis.document, setInterval: globalThis.setInterval };
  globalThis.document = { hidden: false };
  let tick = null;
  globalThis.setInterval = (fn) => ((tick = fn), 1);
  try {
    const music = createMusic(() => ctx);
    music.set('game');
    const heard = [music.now()];
    // Ten minutes of play, a second at a time.
    for (let s = 0; s < 600; s++) {
      ctx.currentTime += 1;
      tick();
      if (music.now() !== heard.at(-1)) heard.push(music.now());
    }
    assert.ok(heard.length >= 4, heard.join());
    for (let i = 1; i < heard.length; i++) assert.notEqual(heard[i], heard[i - 1]);
    for (const name of heard) assert.ok(PLAYLISTS.game.includes(name), name);
    assert.equal(new Set(heard).size, heard.length, `no tune comes back before all six have played: ${heard.join()}`);

    // A trip to the lobby does not start the list over: the next tunes are the ones not heard yet.
    music.set('lobby');
    ctx.currentTime += 1;
    tick();
    assert.equal(music.now(), 'lobby');
    music.set('game');
    for (let s = 0; s < 400 && new Set(heard).size < 6; s++) {
      ctx.currentTime += 1;
      tick();
      if (music.now() !== heard.at(-1)) {
        assert.ok(!heard.includes(music.now()), `${music.now()} repeated after ${heard.join()}`);
        heard.push(music.now());
      }
    }
    assert.equal(new Set(heard).size, 6, heard.join());
  } finally {
    globalThis.document = real.document;
    globalThis.setInterval = real.setInterval;
  }
});

test('out of sight the music plays nothing new and fades what it had, then goes on with the same tune', () => {
  // Records where the tune's volume is sent and how many notes start.
  const targets = [];
  let started = 0;
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime: (v) => targets.push(v), cancelScheduledValues() {} });
  const node = () => ({ frequency: param(), gain: param(), Q: param(), connect: (to) => to, disconnect() {}, start: () => started++, stop() {}, getChannelData: () => new Float32Array(8) });
  const ctx = { state: 'running', currentTime: 0, sampleRate: 16, destination: node(), createOscillator: node, createGain: node, createBiquadFilter: node, createBufferSource: node, createBuffer: node };
  const real = { setInterval: globalThis.setInterval };
  let tick = null;
  globalThis.setInterval = (fn) => ((tick = fn), 1);
  try {
    let away = false;
    const music = createMusic(() => ctx, () => away);
    music.set('game');
    const tune = music.now();
    assert.ok(started > 0);

    away = true;
    music.hush(true);
    assert.equal(targets.at(-1), 0);
    const before = started;
    for (let s = 0; s < 5; s++) {
      ctx.currentTime += 1;
      tick();
    }
    assert.equal(started, before, 'nothing new is played out of sight');

    away = false;
    music.hush(false);
    assert.equal(targets.at(-1), 1);
    ctx.currentTime += 1;
    tick();
    assert.ok(started > before);
    assert.equal(music.now(), tune);

    // The screen changed while out of sight: the old tune stays faded and the new one takes over.
    away = true;
    music.hush(true);
    music.set('lobby');
    const said = targets.length;
    away = false;
    music.hush(false);
    assert.equal(targets.length, said);
    ctx.currentTime += 1;
    tick();
    assert.equal(music.now(), 'lobby');
  } finally {
    globalThis.setInterval = real.setInterval;
  }
});
