import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateLocalBucketCost, matchLocalPrice } from '../src/local/pricing.js';

function bucket(overrides = {}) {
  return {
    source: 'codex',
    model: 'gpt-5.6-terra',
    bucketStart: '2026-08-01T00:00:00.000Z',
    inputTokens: 1_000_000,
    cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    ...overrides,
  };
}

test('local pricing uses the longest historical model prefix', () => {
  const price = matchLocalPrice(bucket());
  assert.equal(price.pattern, 'gpt-5.6-terra');
  assert.equal(price.input, 2);
  assert.equal(estimateLocalBucketCost(bucket()).costMicros, 2_000_000);
});

test('GPT-5.6 long-context requests use the explicit long tier', () => {
  const item = bucket({ contextTier: 'long' });
  const price = matchLocalPrice(item);
  assert.equal(price.contextTier, 'long');
  assert.equal(price.input, 4);
  assert.equal(estimateLocalBucketCost(item).assumedTokens, 0);
});

test('missing GPT-5.6 context is transparent short-tier assumption', () => {
  const estimate = estimateLocalBucketCost(bucket());
  assert.equal(estimate.assumedTokens, 1_000_000);
  assert.equal(estimate.status, 'priced');
});

test('Claude cache-write TTL partitions use provider-specific rates', () => {
  const item = bucket({
    source: 'claude-code',
    model: 'claude-opus-5',
    bucketStart: '2026-08-01T00:00:00.000Z',
    inputTokens: 0,
    cacheWriteInputTokens: 2_000_000,
    cacheWrite5mInputTokens: 1_000_000,
    cacheWrite1hInputTokens: 1_000_000,
  });
  assert.equal(estimateLocalBucketCost(item).costMicros, 16_250_000);
});

test('unmatched models keep tokens and report unpriced instead of free', () => {
  const estimate = estimateLocalBucketCost(bucket({ model: 'unknown-private-model' }));
  assert.deepEqual(estimate, {
    costMicros: 0,
    status: 'unpriced',
    pricedTokens: 0,
    unpricedTokens: 1_000_000,
    assumedTokens: 0,
    priceVersion: null,
  });
});

