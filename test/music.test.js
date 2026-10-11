import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, barsOf, trackSeconds, noteNumber } from '../src/client/music.js';

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

test('the round tune runs for about four minutes before it repeats', () => {
  assert.ok(Math.abs(trackSeconds(TRACKS.game) - 240) < 15, `${trackSeconds(TRACKS.game)}s`);
  assert.equal(noteNumber('A4'), 69);
  assert.equal(noteNumber('Bb5'), 82);
});
