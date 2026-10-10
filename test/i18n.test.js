import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, pickLanguage, stringsFor } from '../src/client/i18n.js';

test('Korean, Japanese and Chinese browsers get their own language, the rest English', () => {
  const cases = {
    'ko-KR': 'ko',
    ko: 'ko',
    'ja-JP': 'ja',
    'zh-CN': 'zh-Hans',
    zh: 'zh-Hans',
    'zh-Hans-HK': 'zh-Hans',
    'zh-SG': 'zh-Hans',
    'zh-TW': 'zh-Hant',
    'zh-HK': 'zh-Hant',
    'zh-Hant': 'zh-Hant',
    'zh-Hant-CN': 'zh-Hant',
    'en-US': 'en',
    'fr-FR': 'en',
    'de': 'en',
    '': 'en',
  };
  for (const [tag, want] of Object.entries(cases)) assert.equal(pickLanguage(tag), want, tag);
});

test('every language has the same strings as Korean', () => {
  const shape = (v) => (Array.isArray(v) ? `array:${v.length}` : v && typeof v === 'object' ? Object.keys(v).sort().join() : typeof v);
  const base = stringsFor('ko');
  for (const code of LANGUAGES) {
    const table = stringsFor(code);
    assert.deepEqual(Object.keys(table).sort(), Object.keys(base).sort(), code);
    for (const key of Object.keys(base)) assert.equal(shape(table[key]), shape(base[key]), `${code}.${key}`);
  }
});
