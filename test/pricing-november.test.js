import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kbu-november-pricing-'));
process.env.KBU_USAGE_CONFIG_DIR = dir;
test.after(() => rmSync(dir, { recursive: true, force: true }));
const { estimateLocalBucketCost, matchLocalPrice, LOCAL_PRICE_CATALOG } = await import('../src/local/pricing.js');
const at = '2026-11-22T12:00:00Z';
const price = (model, extra = {}) => matchLocalPrice({ model, bucketStart: at, ...extra });

test('renaming profiles does not change past estimates; old v1 leaf lookups use the same rates', () => {
  for (const suffix of ['k3.1-pro', 'k3.1-pro-highspeed']) {
    const model = 'KFC/' + suffix;
    const bucket = { source: 'kimi-code', model, modelCanonical: model.toLowerCase(), bucketStart: at,
      inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadInputTokens: 1_000_000,
      cacheWriteInputTokens: 0, reasoningOutputTokens: 0 };
    const estimate = estimateLocalBucketCost(bucket);
    assert.equal(estimate.status, 'priced');
    assert.equal(estimate.pricePattern, 'kimi-' + suffix);
    assert.equal(estimate.costMicros, suffix.endsWith('highspeed') ? 24_200_000 : 12_200_000);
    const compatibility = LOCAL_PRICE_CATALOG.find(p => p.pattern === suffix);
    assert.deepEqual(compatibility, { ...price('kimi-' + suffix), pattern: suffix, source: null });
    for (const name of [suffix, 'ABC/' + suffix, 'org/私有网关/' + suffix.toUpperCase()]) {
      const result = estimateLocalBucketCost({ ...bucket, source: 'opencode', model: name, modelCanonical: name });
      assert.equal(result.pricePattern, estimate.pricePattern);
      assert.equal(result.costMicros, estimate.costMicros);
    }
  }
  assert.equal(price('KFC/k3.1-pro-custom', { source: 'kimi-code' }), null);
  assert.equal(price('gpt-5.6-sol/unknown'), null);
  assert.equal(price('gpt-5.6-sol/'), null);
  assert.equal(price('gpt-5.6-sol/ABC/gpt-6.2-astra').pattern, 'gpt-6.2-astra');
});

test('official GPT-6.2 rates keep model, context, processing tier and launch date distinct', () => {
  for (const [model, ctx, input, read, write, output] of [
    ['gpt-6.2-astra', 'short', 8, .4, 10, 40], ['gpt-6.2-astra', 'long', 16, .8, 20, 60],
    ['gpt-6.2-sol', 'short', 2, .1, 2.5, 10], ['gpt-6.2-sol', 'long', 4, .2, 5, 15],
  ]) {
    for (const [processingTier, factor] of [['standard', 1], ['batch', .5], ['priority', 2], ['ultrafast', 3]]) {
      const hit = price('openai/' + model, { contextTier: ctx, processingTier });
      assert.deepEqual([hit.input, hit.cacheRead, hit.cacheWrite, hit.output], [input, read, write, output].map(n => Number((n * factor).toFixed(4))));
    }
    for (const [bucketStart, factor] of [['2027-03-01T07:59:59Z', 3], ['2027-03-01T08:00:00Z', 6]]) {
      const hit = price(model, { bucketStart, processingTier: 'ultrafast', contextTier: ctx });
      assert.deepEqual([hit.input, hit.cacheRead, hit.cacheWrite, hit.output], [input, read, write, output].map(n => Number((n * factor).toFixed(4))));
    }
    assert.equal(price(model, { bucketStart: '2026-11-16T23:59:59Z' }), null);
    assert.equal(price(model + '-custom'), null);
    assert.equal(price(model, { processingTier: 'flex' }), null);
  }
});

test('recent model releases keep exact variants, price periods and cache legs separate', () => {
  for (const [model, input, read, output] of [
    ['claude-fable-5.2', 8, .2, 40], ['claude-mythos-5-2', 8, .2, 40],
    ['gemini-4-carbon', 2, .1, 10], ['gemini-4-neon', 3, .15, 15],
    ['gemini-4-hydrogen', 1.5, .075, 7.5], ['MiniMax-M3.1-Flash', .15, .015, .6],
  ]) {
    const hit = price(model);
    assert.deepEqual([hit.input, hit.cacheRead, hit.output], [input, read, output]);
    assert.equal(price(model, { bucketStart: new Date(Date.parse(hit.effectiveFrom) - 1).toISOString() }), null);
  }
  const claude = price('claude-fable-5.2');
  assert.deepEqual([claude.cacheWrite5m, claude.cacheWrite1h], [10, 16]);
  assert.equal(price('gemini-4-carbon', { bucketStart: '2026-12-01T00:00:00Z' }).input, 4);
});
