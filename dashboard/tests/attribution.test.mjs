import test from 'node:test';
import assert from 'node:assert/strict';
import { knownDimension, measurementCoverage } from '../src/attribution.js';

test('measurement coverage is independent of pricing assumptions and excludes estimates', () => {
  assert.equal(measurementCoverage([
    { totalTokens: 60, measurement: 'exact', assumedTokens: 60 },
    { totalTokens: 30, measurement: 'estimated', assumedTokens: 0 },
    { totalTokens: 10, measurement: 'credit' },
  ]), .6);
  assert.equal(measurementCoverage([]), 0);
  for (const value of [null, '', 'unknown', ' Unknown ', 'PRIVATE / UNKNOWN']) assert.equal(knownDimension(value), '');
  assert.equal(knownDimension('my-project'), 'my-project');
});
