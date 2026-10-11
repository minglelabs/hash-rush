import test from 'node:test';
import assert from 'node:assert/strict';
import { mvpScore, pickMvp } from '../src/client/mvp.js';

test('bonks, seeds, goals and super plays each add to the MVP score; being bonked does not', () => {
  assert.equal(mvpScore([4, 9, 0, 0, 0]), 4);
  assert.equal(mvpScore([0, 0, 3, 0, 0]), 6);
  assert.equal(mvpScore([0, 0, 0, 2, 0]), 10);
  assert.equal(mvpScore([0, 0, 0, 0, 2]), 6);
  assert.equal(mvpScore([3, 5, 2, 1, 1]), 15);
  assert.equal(mvpScore([0, 0, 0, 0, 0, 3]), 6);
  assert.equal(mvpScore([]), 0);
});

test('the top score is the MVP', () => {
  assert.deepEqual(pickMvp([['a', [3, 0, 0, 0, 0]], ['b', [0, 4, 1, 1, 0]], ['c', [6, 1, 0, 0, 0]]]), ['b']);
});

test('level on points, the one bonked less is the MVP, and a full tie is shared', () => {
  assert.deepEqual(pickMvp([['a', [5, 3, 0, 0, 0]], ['b', [5, 1, 0, 0, 0]], ['c', [1, 0, 0, 0, 0]]]), ['b']);
  assert.deepEqual(pickMvp([['a', [5, 3, 0, 0, 0]], ['b', [5, 1, 0, 0, 0]], ['c', [0, 1, 0, 1, 0]]]), ['b', 'c']);
  assert.deepEqual(pickMvp([['a', [2, 2, 0, 0, 0]], ['b', [5, 1, 0, 0, 0]], ['c', [5, 3, 0, 0, 0]]]), ['b']);
});

test('nobody is the MVP before anything has happened', () => {
  assert.deepEqual(pickMvp([['a', [0, 2, 0, 0, 0]], ['b', []]]), []);
});
