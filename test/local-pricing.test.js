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

test('2026-08-14 catalog matches the supplied current model price matrix', () => {
  const cases = [
    ['grok-4.5', '', 2, 0.3, null, 6],
    ['gpt-5.6-luna', 'short', 0.2, 0.02, 0.25, 1.2],
    ['gpt-5.6-luna', 'long', 0.4, 0.04, 0.5, 1.8],
    ['glm-5.3', '', 1.4, 0.26, null, 4.4],
    ['glm-5.2', '', 1.4, 0.26, null, 4.4],
    ['glm-5.1', '', 1.4, 0.26, null, 4.4],
    ['kimi-k3', '', 3, 0.3, null, 15],
    ['kimi-k2.7-code', '', 0.95, 0.19, null, 4],
    ['kimi-k2.6', '', 0.95, 0.16, null, 4],
    ['mimo-v2.5', '', 0.14, 0.0028, null, 0.28],
    ['mimo-v2.5-pro', '', 0.435, 0.003625, null, 0.87],
    ['minimax-m3', '', 0.3, 0.06, null, 1.2],
    ['minimax-m2.7', '', 0.3, 0.06, 0.375, 1.2],
    ['minimax-m2.5', '', 0.3, 0.06, 0.375, 1.2],
    ['qwen3.8-max', '', 2, 0.25, 2.5, 6],
    ['qwen3.7-max', '', 2.5, 0.5, 3.125, 7.5],
    ['qwen3.7-plus', 'short', 0.4, 0.04, 0.5, 1.6],
    ['qwen3.7-plus', 'long', 1.2, 0.12, 1.5, 4.8],
    ['qwen3.6-plus', 'short', 0.5, 0.05, 0.625, 3],
    ['qwen3.6-plus', 'long', 2, 0.2, 2.5, 6],
    ['deepseek-v4-pro', '', 0.435, 0.003625, null, 0.87],
    ['deepseek-v4-flash', '', 0.14, 0.0028, null, 0.28],
    ['hy3', '', 0.14, 0.035, null, 0.58],
  ];
  for (const [model, contextTier, input, cacheRead, cacheWrite, output] of cases) {
    const price = matchLocalPrice(bucket({
      model,
      contextTier,
      bucketStart: '2026-08-14T12:00:00.000Z',
    }));
    assert.ok(price, `${model}/${contextTier || 'default'} should be priced`);
    assert.deepEqual(
      [price.input, price.cacheRead, price.cacheWrite, price.output],
      [input, cacheRead, cacheWrite, output],
      `${model}/${contextTier || 'default'}`,
    );
  }
});

test('updated Kimi K2.6 and MiniMax M3 prices preserve their historical windows', () => {
  const oldKimi = matchLocalPrice(bucket({ model: 'kimi-k2.6', bucketStart: '2026-08-13T12:00:00.000Z' }));
  const newKimi = matchLocalPrice(bucket({ model: 'kimi-k2.6', bucketStart: '2026-08-14T12:00:00.000Z' }));
  assert.equal(oldKimi.cacheRead, null);
  assert.equal(newKimi.cacheRead, 0.16);

  const oldMiniMax = matchLocalPrice(bucket({ model: 'minimax-m3', bucketStart: '2026-08-13T12:00:00.000Z' }));
  const newMiniMax = matchLocalPrice(bucket({ model: 'minimax-m3', bucketStart: '2026-08-14T12:00:00.000Z' }));
  assert.deepEqual([oldMiniMax.input, oldMiniMax.cacheRead, oldMiniMax.output], [0.6, null, 2.4]);
  assert.deepEqual([newMiniMax.input, newMiniMax.cacheRead, newMiniMax.output], [0.3, 0.06, 1.2]);
});

test('display-style model names normalize to catalog slugs', () => {
  const price = matchLocalPrice(bucket({
    model: 'Qwen3.8 Max',
    bucketStart: '2026-08-14T12:00:00.000Z',
  }));
  assert.equal(price.pattern, 'qwen3.8-max');
});

test('explicit cache-write prices are used by local estimates', () => {
  const estimate = estimateLocalBucketCost(bucket({
    model: 'qwen3.8-max',
    bucketStart: '2026-08-14T12:00:00.000Z',
    inputTokens: 0,
    cacheWriteInputTokens: 1_000_000,
  }));
  assert.equal(estimate.costMicros, 2_500_000);
  assert.equal(estimate.priceCacheWrite, 2.5);
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
