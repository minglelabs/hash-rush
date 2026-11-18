import test from 'node:test';
import assert from 'node:assert/strict';
import { isDesktop, linkBase, WEB_HOME } from '../src/client/desktop.js';

test('the desktop app is told apart by what its preload leaves behind', () => {
  assert.equal(isDesktop({}), false);
  assert.equal(isDesktop({ hashRushDesktop: { platform: 'win32' } }), true);
});

test('invite links from the desktop app point at the web game', () => {
  const loc = { origin: 'app://hash-rush', pathname: '/index.html' };
  assert.equal(linkBase(loc, true), WEB_HOME);
  assert.equal(linkBase({ origin: 'https://minglelabs.github.io', pathname: '/hash-rush/' }, false), 'https://minglelabs.github.io/hash-rush/');
});
