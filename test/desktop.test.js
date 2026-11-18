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

import { roundAchievements, ACHIEVEMENTS, mapAchievement, steamName } from '../src/client/desktop.js';

test('a won round earns the first-win, map, team and versus-people achievements', () => {
  const { record, got } = roundAchievements(null, { won: true, map: 'desert', team: true, people: 2 }, ['meadow', 'desert']);
  assert.deepEqual(record, { wins: 1, maps: ['desert'] });
  assert.deepEqual(got, [ACHIEVEMENTS.first, 'WIN_MAP_DESERT', ACHIEVEMENTS.team, ACHIEVEMENTS.people]);
});

test('ten wins and a win on every map earn their own', () => {
  const { got } = roundAchievements({ wins: 9, maps: ['desert'] }, { won: true, map: 'meadow', team: false, people: 0 }, ['meadow', 'desert']);
  assert.ok(got.includes(ACHIEVEMENTS.ten));
  assert.ok(got.includes(ACHIEVEMENTS.allMaps));
  assert.ok(!got.includes(ACHIEVEMENTS.fifty));
  assert.equal(mapAchievement('meadow'), 'WIN_MAP_MEADOW');
});

test('a lost round earns nothing new and keeps the record', () => {
  const { record, got } = roundAchievements({ wins: 3, maps: ['meadow'] }, { won: false, map: 'desert', team: false, people: 1 }, ['meadow', 'desert']);
  assert.deepEqual(record, { wins: 3, maps: ['meadow'] });
  assert.deepEqual(got, []);
});

test('a Steam name fits a hamster', () => {
  assert.equal(steamName('  LongSteamPersona '), 'LongStea');
  assert.equal(steamName(undefined), '');
});
