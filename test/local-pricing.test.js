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

test('2026-08-19 catalog matches the supplied current model price matrix', () => {
  const cases = [
    ['minimax-m3', '', '', 0.3, 0.06, null, 1.2],
    ['minimax-m2.7', '', '', 0.3, 0.06, 0.375, 1.2],
    ['minimax-m2.5', '', '', 0.3, 0.06, 0.375, 1.2],
    ['glm-5.3', '', '', 1.4, 0.26, null, 4.4],
    ['glm-5.2', '', '', 1.4, 0.26, null, 4.4],
    ['glm-5.1', '', '', 1.4, 0.26, null, 4.4],
    ['glm-5', '', '', 1, 0.2, null, 3.2],
    ['kimi-k2.7-code', '', '', 0.95, 0.19, null, 4],
    ['kimi-k3', '', '', 3, 0.3, null, 15],
    ['kimi-k2.6', '', '', 0.95, 0.16, null, 4],
    ['kimi-k2.5', '', '', 0.6, 0.1, null, 3],
    ['mimo-v2.5', '', '', 0.14, 0.0028, null, 0.28],
    ['mimo-v2.5-pro', '', '', 0.435, 0.003625, null, 0.87],
    ['muse-spark-1.2-contributor', '', '', 0.1, 0.002, null, 0.2],
    ['qwen3.8-max', '', '', 2, 0.25, 2.5, 6],
    ['qwen3.7-max', '', '', 2.5, 0.5, 3.125, 7.5],
    ['qwen3.7-plus', 'short', '', 0.4, 0.04, 0.5, 1.6],
    ['qwen3.7-plus', 'long', '', 1.2, 0.12, 1.5, 4.8],
    ['qwen3.6-plus', 'short', '', 0.5, 0.05, 0.625, 3],
    ['qwen3.6-plus', 'long', '', 2, 0.2, 2.5, 6],
    ['qwen3.5-plus', '', '', 0.2, 0.02, 0.25, 1.2],
    ['deepseek-v4-pro', '', 'off-peak', 0.66, 0.022, null, 1.98],
    ['deepseek-v4-pro', '', 'peak', 1.32, 0.044, null, 3.96],
    ['deepseek-v4-flash', '', 'off-peak', 0.22, 0.007, null, 0.66],
    ['deepseek-v4-flash', '', 'peak', 0.44, 0.014, null, 1.32],
    ['hy3', '', '', 0.14, 0.035, null, 0.58],
    ['claude-fable-5', '', '', 10, 1, 12.5, 50],
    ['claude-opus-5', '', '', 5, 0.5, 6.25, 25],
    ['claude-opus-4-8', '', '', 5, 0.5, 6.25, 25],
    ['claude-opus-4-7', '', '', 5, 0.5, 6.25, 25],
    ['claude-opus-4-6', '', '', 5, 0.5, 6.25, 25],
    ['claude-opus-4-5', '', '', 5, 0.5, 6.25, 25],
    ['claude-sonnet-5', '', '', 2, 0.2, 2.5, 10],
    ['claude-sonnet-4-6', '', '', 3, 0.3, 3.75, 15],
    ['claude-sonnet-4-5', 'short', '', 3, 0.3, 3.75, 15],
    ['claude-sonnet-4-5', 'long', '', 6, 0.6, 7.5, 22.5],
    ['claude-haiku-4-5', '', '', 1, 0.1, 1.25, 5],
    ['gemini-3.7-flash', '', '', 1.5, 0.15, null, 7.5],
    ['gemini-3.6-flash', '', '', 1.5, 0.15, null, 7.5],
    ['gemini-3.5-flash', '', '', 1.5, 0.15, null, 9],
    ['gemini-3.5-flash-lite', '', '', 0.3, 0.03, null, 2.5],
    ['gemini-3.1-pro', 'short', '', 2, 0.2, null, 12],
    ['gemini-3.1-pro', 'long', '', 4, 0.4, null, 18],
    ['gemini-3-flash', '', '', 0.5, 0.05, null, 3],
    ['grok-4.6', 'short', '', 2, 0.5, null, 6],
    ['grok-4.6', 'long', '', 4, 1, null, 12],
    ['grok-4.5', '', '', 2, 0.3, null, 6],
    ['grok-build-0.1', '', '', 1, 0.2, null, 2],
    ['muse-spark-1.2', '', '', 1.25, 0.15, null, 4.25],
    ['gpt-5.6-sol', 'short', '', 5, 0.5, 6.25, 30],
    ['gpt-5.6-sol', 'long', '', 10, 1, 12.5, 45],
    ['gpt-5.6-terra', 'short', '', 2, 0.2, 2.5, 12],
    ['gpt-5.6-terra', 'long', '', 4, 0.4, 5, 18],
    ['gpt-5.6-luna', 'short', '', 0.2, 0.02, 0.25, 1.2],
    ['gpt-5.6-luna', 'long', '', 0.4, 0.04, 0.5, 1.8],
    ['gpt-5.5', 'short', '', 5, 0.5, null, 30],
    ['gpt-5.5', 'long', '', 10, 1, null, 45],
    ['gpt-5.5-pro', '', '', 30, 30, null, 180],
    ['gpt-5.4', 'short', '', 2.5, 0.25, null, 15],
    ['gpt-5.4', 'long', '', 5, 0.5, null, 22.5],
    ['gpt-5.4-pro', '', '', 30, 30, null, 180],
    ['gpt-5.4-mini', '', '', 0.75, 0.075, null, 4.5],
    ['gpt-5.4-nano', '', '', 0.2, 0.02, null, 1.25],
    ['gpt-5.3-codex-spark', '', '', 1.75, 0.175, null, 14],
    ['gpt-5.3-codex', '', '', 1.75, 0.175, null, 14],
    ['gpt-5.2', '', '', 1.75, 0.175, null, 14],
    ['gpt-5.2-codex', '', '', 1.75, 0.175, null, 14],
    ['gpt-5.1', '', '', 1.07, 0.107, null, 8.5],
    ['gpt-5.1-codex', '', '', 1.07, 0.107, null, 8.5],
    ['gpt-5.1-codex-max', '', '', 1.25, 0.125, null, 10],
    ['gpt-5.1-codex-mini', '', '', 0.25, 0.025, null, 2],
    ['gpt-5', '', '', 1.07, 0.107, null, 8.5],
    ['gpt-5-codex', '', '', 1.07, 0.107, null, 8.5],
    ['gpt-5-nano', '', '', 0.05, 0.005, null, 0.4],
  ];
  for (const [model, contextTier, processingTier, input, cacheRead, cacheWrite, output] of cases) {
    const price = matchLocalPrice(bucket({
      model,
      contextTier,
      processingTier,
      bucketStart: '2026-08-19T12:00:00.000Z',
    }));
    const variant = [contextTier, processingTier].filter(Boolean).join('/') || 'default';
    assert.ok(price, `${model}/${variant} should be priced`);
    assert.deepEqual(
      [price.input, price.cacheRead, price.cacheWrite, price.output],
      [input, cacheRead, cacheWrite, output],
      `${model}/${variant}`,
    );
  }
});

test('free-looking labels never become zero-cost pricing facts', () => {
  for (const model of ['big-pickle', 'nemotron-3-ultra-free', 'nemotron-3.5-lightning-free']) {
    assert.equal(matchLocalPrice(bucket({
      model,
      bucketStart: '2026-08-19T12:00:00.000Z',
    })), null, `${model} should remain unpriced without a supplied API-equivalent rate`);
  }

  const equivalents = [
    ['mimo-v2.5-free', 0.14],
    ['hy3-free', 0.14],
    ['muse-spark-1.2-contributor-free', 0.1],
  ];
  for (const [model, input] of equivalents) {
    const price = matchLocalPrice(bucket({ model, bucketStart: '2026-08-19T12:00:00.000Z' }));
    assert.ok(price, `${model} should use its supplied paid API-equivalent rate`);
    assert.equal(price.input, input);
  }
});

test('the new matrix preserves historical price windows without zeroing paid models', () => {
  const oldGpt = matchLocalPrice(bucket({ model: 'gpt-5.1', bucketStart: '2026-08-18T12:00:00.000Z' }));
  const newGpt = matchLocalPrice(bucket({ model: 'gpt-5.1', bucketStart: '2026-08-19T12:00:00.000Z' }));
  assert.equal(oldGpt.input, 1.25);
  assert.equal(newGpt.input, 1.07);

  assert.ok(matchLocalPrice(bucket({ model: 'mimo-v2.5', bucketStart: '2026-08-18T12:00:00.000Z' })));
  assert.ok(matchLocalPrice(bucket({ model: 'mimo-v2.5', bucketStart: '2026-08-19T12:00:00.000Z' })));
  assert.ok(matchLocalPrice(bucket({ model: 'glm-5.3', bucketStart: '2026-08-19T12:00:00.000Z' })));
});

test('Claude decimal display labels match hyphenated canonical IDs', () => {
  const price = matchLocalPrice(bucket({
    source: 'claude-code',
    model: 'Claude Sonnet 4.6',
    bucketStart: '2026-08-19T12:00:00.000Z',
  }));
  assert.equal(price.pattern, 'claude-sonnet-4-6');
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

test('Gemini prices use the supplied matrix and leave unspecified Pro labels unpriced', () => {
  const flash = matchLocalPrice(bucket({
    source: 'antigravity',
    model: 'gemini-3.5-flash',
    bucketStart: '2026-08-19T12:00:00.000Z',
  }));
  assert.deepEqual(
    [flash.input, flash.cacheRead, flash.output],
    [1.5, 0.15, 9],
  );

  const shortPro = matchLocalPrice(bucket({
    source: 'antigravity',
    model: 'gemini-3.1-pro',
    contextTier: 'short',
    bucketStart: '2026-08-19T12:00:00.000Z',
  }));
  const longPro = matchLocalPrice(bucket({
    source: 'antigravity',
    model: 'gemini-3.1-pro-preview',
    contextTier: 'long',
    bucketStart: '2026-08-19T12:00:00.000Z',
  }));
  assert.deepEqual([shortPro.input, shortPro.cacheRead, shortPro.output], [2, 0.2, 12]);
  assert.deepEqual([longPro.input, longPro.cacheRead, longPro.output], [4, 0.4, 18]);

  const flash37 = matchLocalPrice(bucket({
    source: 'antigravity',
    model: 'gemini-3.7-flash',
    bucketStart: '2026-08-19T12:00:00.000Z',
  }));
  assert.deepEqual([flash37.input, flash37.cacheRead, flash37.output], [1.5, 0.15, 7.5]);

  for (const model of ['gemini-3.7-pro', 'gemini-3.5-pro']) {
    assert.equal(matchLocalPrice(bucket({
      source: 'antigravity',
      model,
      bucketStart: '2026-08-19T12:00:00.000Z',
    })), null, `${model} must remain unpriced because it is absent from the supplied matrix`);
  }
});
