import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const configDir = mkdtempSync(join(tmpdir(), 'kbu-october-pricing-'));
process.env.KBU_USAGE_CONFIG_DIR = configDir;
const { estimateLocalBucketCost, matchLocalPrice } = await import('../src/local/pricing.js');
const { EMBEDDED_PRICE_CATALOG } = await import('../src/pricing/catalog.js');
test.after(() => rmSync(configDir, { recursive: true, force: true }));

function bucket(model, overrides = {}) {
  return { source: 'claude-code', model, bucketStart: '2026-10-08T12:00:00Z',
    inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0, reasoningOutputTokens: 0, ...overrides };
}

test('October catalog matches new model, context and processing-tier rate fixtures', () => {
  const cases = [
    ['gpt-6.1-sol', 'short', 'standard', 2, .1, 2.5, 10],
    ['gpt-6.1-sol', 'long', 'standard', 4, .2, 5, 15],
    ['gpt-6-sol', 'short', 'standard', 2, .2, 2.5, 10],
    ['gpt-6-sol', 'long', 'standard', 4, .4, 5, 15],
    ['gpt-6-luna', 'short', 'standard', .1, .01, .125, .5],
    ['gpt-6-luna', 'long', 'standard', .2, .02, .25, .75],
    ['claude-opus-5-5', '', 'standard', 4, .2, 5, 20],
    ['claude-sonnet-5-5', '', 'standard', 2, .1, 2.5, 10],
    ['claude-haiku-5-5', 'short', 'standard', .1, .01, .125, .5],
    ['claude-haiku-5-5', 'long', 'standard', .5, .05, .625, 2.5],
    ['grok-4.7', 'short', 'standard', 2, .5, null, 6],
    ['grok-4.7', 'long', 'standard', 4, 1, null, 12],
    ['glm-5.3-flash', '', 'standard', .15, .03, null, .5],
    ['glm-5.3-flashx', '', 'standard', .37, .075, null, 1.25],
    ['qwen3.8-flash', '', 'standard', .113, null, .14125, .382],
    ['minimax-m3', 'short', 'standard', .3, .06, null, 1.2],
    ['minimax-m3', 'long', 'standard', .6, .12, null, 2.4],
    ['minimax-m3', 'short', 'priority', .45, .09, null, 1.8],
    ['minimax-m3', 'long', 'priority', .9, .18, null, 3.6],
    ['minimax-m2.7-highspeed', '', 'standard', .6, .06, .375, 2.4],
    ['minimax-m2.5-highspeed', '', 'standard', .6, .03, .375, 2.4],
    ['kimi-k2.7-code-highspeed', '', 'standard', 1.9, .38, null, 8],
  ];
  for (const [model, contextTier, processingTier, ...rates] of cases) {
    const price = matchLocalPrice(bucket(model, { contextTier, processingTier }));
    assert.ok(price, model);
    assert.deepEqual([price.input, price.cacheRead, price.cacheWrite, price.output], rates, `${model}/${contextTier}/${processingTier}`);
  }
  assert.equal(matchLocalPrice(bucket('openai/gpt-6.1-sol-2026-09-29')).input, 2);
  assert.equal(matchLocalPrice(bucket('Claude Opus 5.5')).pattern, 'claude-opus-5-5');
  assert.equal(matchLocalPrice(bucket('anthropic/claude-opus-5.5')).input, 4);
  assert.equal(matchLocalPrice(bucket('claude-sonnet-5.5')).cacheRead, .1);
});

test('historical price windows retain exclusive boundaries and do not overlap', () => {
  const before = { bucketStart: '2026-10-06T23:59:59.999Z' };
  const after = { bucketStart: '2026-10-07T00:00:00.000Z' };
  assert.equal(matchLocalPrice(bucket('claude-sonnet-5-5', before)).cacheRead, .2);
  assert.equal(matchLocalPrice(bucket('claude-sonnet-5-5', after)).cacheRead, .1);
  assert.equal(matchLocalPrice(bucket('minimax-m2.5', { bucketStart: '2026-10-07T23:59:59.999Z' })).cacheRead, .06);
  assert.equal(matchLocalPrice(bucket('minimax-m2.5')).cacheRead, .03);
  const groups = new Map();
  for (const entry of EMBEDDED_PRICE_CATALOG.entries) {
    const key = JSON.stringify([entry.pattern, entry.match, entry.source, entry.contextTier, entry.processingTier]);
    groups.set(key, [...(groups.get(key) || []), entry]);
  }
  for (const [key, entries] of groups) {
    entries.sort((a, b) => Date.parse(a.effectiveFrom) - Date.parse(b.effectiveFrom));
    for (let i = 1; i < entries.length; i++) {
      assert.ok(entries[i - 1].effectiveTo && Date.parse(entries[i - 1].effectiveTo) <= Date.parse(entries[i].effectiveFrom), key);
    }
  }
});

test('DeepSeek legacy aliases preserve historical rates, peak tiers and source restrictions', () => {
  for (const model of ['deepseek-flash', 'deepseek-v4.1-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']) {
    for (const [processingTier, input, cacheRead, output] of [['peak', .3, .006, 1.2], ['off-peak', .15, .003, .6]]) {
      const price = matchLocalPrice(bucket(model, { processingTier }));
      assert.deepEqual([price.input, price.cacheRead, price.output], [input, cacheRead, output], `${model}/${processingTier}`);
    }
  }
  assert.equal(matchLocalPrice(bucket('deepseek-v4-flash', { bucketStart: '2026-09-09T23:59:59.999Z', processingTier: 'peak' })).input, .44);
  assert.equal(matchLocalPrice(bucket('deepseek-v4-flash-vision-exp', { source: 'opencode' })).input, .14);
  assert.equal(matchLocalPrice(bucket('deepseek-v4-pro', { processingTier: 'peak' })).input, 1.32);
});

test('cache TTL is priced separately and missing TTL is an explicit bounded assumption', () => {
  for (const model of ['kimi-k3', 'kimi-k2.8-preview']) {
    const estimate = estimateLocalBucketCost(bucket(model, { inputTokens: 0, cacheWriteInputTokens: 1_000_000, cacheWrite1hInputTokens: 1_000_000 }));
    assert.equal(estimate.costMicros, 6_000_000);
    const unknown = estimateLocalBucketCost(bucket(model, { inputTokens: 0, cacheWriteInputTokens: 1_000_000 }));
    assert.equal(unknown.costMicros, 3_000_000);
    assert.equal(unknown.assumedTokens, 1_000_000);
    assert.ok(unknown.priceAssumptions.includes('cache-write-ttl'));
  }
  const provisional = estimateLocalBucketCost(bucket('kimi-k2.8-preview'));
  assert.equal(provisional.priceProvisional, true);
  assert.ok(provisional.priceNote.zh && provisional.priceNote.en);
  assert.ok(provisional.priceAssumptions.includes('provisional-price'));
  assert.equal(estimateLocalBucketCost(bucket('claude-opus-5-5', { inputTokens: 0, cacheWriteInputTokens: 1_000_000, cacheWrite1hInputTokens: 1_000_000 })).costMicros, 8_000_000);
});

test('unknown Qwen cache price is unpriced, not a free rate', () => {
  const estimate = estimateLocalBucketCost(bucket('qwen3.8-flash', { cacheReadInputTokens: 1_000_000 }));
  assert.equal(estimate.status, 'partial');
  assert.equal(estimate.costMicros, 113_000);
  assert.equal(estimate.unpricedTokens, 1_000_000);
  assert.equal(estimate.priceCacheRead, null);
});

test('MiMo 2.6 variants and batch prices are exact with explicit temporary cache-write terms', () => {
  for (const [model, processingTier, input, cacheRead, output] of [
    ['mimo-v2.6-pro', 'standard', .435, .0036, .87],
    ['mimo-v2.6-flash', 'standard', .14, .0028, .28],
    ['mimo-v2.6-pro-ultraspeed', 'standard', 4.35, .036, 8.7],
    ['mimo-v2.6-pro', 'batch', .2175, .0018, .435],
    ['mimo-v2.6-flash', 'batch', .07, .0014, .14],
  ]) {
    const estimate = estimateLocalBucketCost(bucket(model, { processingTier, cacheWriteInputTokens: 1_000_000 }));
    assert.deepEqual([estimate.priceInput, estimate.priceCacheRead, estimate.priceOutput], [input, cacheRead, output], `${model}/${processingTier}`);
    assert.equal(estimate.priceCacheWrite, 0);
    assert.equal(estimate.costMicros, input * 1_000_000);
    assert.ok(estimate.priceNote.zh && estimate.priceNote.en);
  }
  assert.equal(matchLocalPrice(bucket('mimo-v2.6-pro-ultraspeed', { processingTier: 'batch' })), null);
  assert.equal(matchLocalPrice(bucket('mimo-v2.6-pro-custom')), null);
  assert.equal(matchLocalPrice(bucket('mimo-v2.5-pro', { bucketStart: '2026-10-07T23:59:59.999Z' })).cacheRead, .003625);
  assert.ok(matchLocalPrice(bucket('mimo-v2.5-pro', { bucketStart: '2026-10-21T01:59:59.999Z' })));
  assert.equal(matchLocalPrice(bucket('mimo-v2.5-pro', { bucketStart: '2026-10-21T02:00:00.000Z' })), null);
});

test('StepFun keeps original CNY rates, FX provenance and non-token products unpriced', () => {
  for (const [model, input, cacheRead, output] of [
    ['step-5-preview', 7, .35, 20], ['step-3.7-flash', 1.35, .27, 8.1],
    ['step-3.5-flash', .7, .14, 2.1], ['step-3.5-flash-2603', .7, .14, 2.1],
    ['step-1o-turbo-vision', 2.5, .5, 8],
  ]) {
    const estimate = estimateLocalBucketCost(bucket(model));
    assert.deepEqual([estimate.priceInput, estimate.priceCacheRead, estimate.priceOutput], [input, cacheRead, output].map((value) => Number((value / 7.16).toFixed(12))), model);
    assert.equal(estimate.priceProvisional, true);
    assert.equal(estimate.assumedTokens, 1_000_000);
    assert.match(estimate.priceNote.zh, /7\.16/);
    assert.match(estimate.priceNote.en, /2026-08-08/);
    assert.ok(estimate.priceNote.zh.includes(String(input)));
  }
  for (const model of ['stepaudio-3-realtime-preview', 'stepaudio-3-chat-preview']) {
    const estimate = estimateLocalBucketCost(bucket(model));
    assert.equal(estimate.status, 'priced');
    assert.equal(estimate.costMicros, 0);
    assert.match(estimate.priceNote.zh, /免费/);
  }
  for (const model of ['step-2', 'step-3.5-flash-custom', 'stepaudio-3-tts', 'stepaudio-3-asr-max', 'stepaudio-3-gen-preview']) {
    assert.equal(estimateLocalBucketCost(bucket(model)).status, 'unpriced', model);
  }
});
