import test from 'node:test';
import assert from 'node:assert/strict';
import { compact, compactNumber } from '../src/format.js';

test('compact usage numbers follow the selected Chinese or English locale', () => {
  assert.equal(compactNumber(26_200_000_000, 'zh'), '262亿');
  assert.equal(compactNumber(1_600_000, 'zh'), '160万');
  assert.equal(compactNumber(480_600, 'zh'), '48.1万');
  assert.equal(compactNumber(62_769, 'zh'), '6.3万');
  assert.equal(compactNumber(26_200_000_000, 'en'), '26.2B');
  assert.equal(compactNumber(1_600_000, 'en'), '1.6M');
  assert.equal(compactNumber(480_600, 'en'), '480.6K');
});

test('legacy compact output remains English for unaffected surfaces', () => {
  assert.equal(compact(26_200_000_000), '26.2B');
  assert.equal(compactNumber(Number.NaN, 'zh'), '—');
});
