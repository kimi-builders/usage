import assert from 'node:assert/strict';
import test from 'node:test';
import { LIMIT_PROVIDER_CATALOG, normalizeLimitSettings } from '../../src/limits/catalog.js';
import { GLM_NOTICE } from '../../src/limits/providers/glm.js';
import { MINIMAX_NOTICE } from '../../src/limits/providers/minimax.js';
import { ALIBABA_NOTICE } from '../../src/limits/providers/alibaba-coding.js';
import { buildSubscriptionInsights } from '../src/subscription-insights.js';
import { quotaProviderCatalogCopy, quotaProviderNotice, quotaWindowDetail, quotaWindowLabel, regionalProviderPatch, regionalDraftDetection, quotaSaveFailures } from '../src/subscription-limits-utils.js';

const ids = ['glm', 'minimax', 'alibaba-coding'];

test('regional Coding Plan setup and quota facts have bilingual copy and localized units', () => {
  for (const id of ids) {
    const entry = LIMIT_PROVIDER_CATALOG.find(p => p.id === id);
    const en = quotaProviderCatalogCopy(entry, false);
    assert.doesNotMatch(en.description + en.localHint, /[\u3400-\u9fff]/);
    assert.match(quotaProviderCatalogCopy(entry, true).description, /[\u3400-\u9fff]/);
    const window = { id: 'unknown', label: '5 小时', value: 12345, limit: 100000, unit: 'quota units' };
    assert.doesNotMatch(quotaWindowLabel(id, window, false), /[\u3400-\u9fff]/);
    assert.match(quotaWindowDetail(id, window, true), /万/);
    assert.match(quotaWindowDetail(id, window, false), /K/);
  }
  for (const notice of [GLM_NOTICE, MINIMAX_NOTICE, ALIBABA_NOTICE]) {
    assert.doesNotMatch(quotaProviderNotice(notice, false), /[\u3400-\u9fff]/);
    assert.equal(quotaProviderNotice(notice, true), notice);
  }
});

test('switching regions preserves separate prices and defaults to that region credential name', () => {
  const provider = LIMIT_PROVIDER_CATALOG.find(p => p.id === 'glm');
  let item = normalizeLimitSettings({ providers: { glm: { site: 'china', entitlementType: 'paid', subscriptionPrice: 49, subscriptionCurrency: 'cny' } } }).providers.glm;
  item = { ...item, ...regionalProviderPatch(provider, item, 'international') };
  assert.equal(item.subscriptionPrice, null);
  assert.equal(item.entitlementType, 'unknown');
  assert.equal(item.environmentVariable, 'Z_AI_API_KEY');
  item = { ...item, entitlementType: 'paid', subscriptionPrice: 15, subscriptionCurrency: 'usd' };
  item = { ...item, ...regionalProviderPatch(provider, item, 'china') };
  assert.equal(item.subscriptionPrice, 49);
  assert.equal(item.subscriptionCurrency, 'cny');
  assert.equal(item.environmentVariable, 'GLM_API_KEY');
  const restored = normalizeLimitSettings({ providers: { glm: item } }).providers.glm;
  assert.equal(restored.regionSubscriptions.international.subscriptionPrice, 15);
  assert.equal(restored.regionSubscriptions.international.subscriptionCurrency, 'usd');
});

test('an unsaved region switch never displays another region as configured', () => {
  const provider = { sites: {}, detection: { state: 'configured', label: 'Saved' } };
  assert.equal(regionalDraftDetection(provider, { site: 'china' }, { site: 'china' }, true).state, 'configured');
  assert.equal(regionalDraftDetection(provider, { site: 'international' }, { site: 'china' }, true).state, 'manual');
  assert.match(regionalDraftDetection(provider, { site: 'international' }, { site: 'china' }, false).label, /save to verify/);
});

test('best-effort authentication and query failures cannot be reported as refresh success', () => {
  assert.deepEqual(quotaSaveFailures({ providers: [
    { id: 'glm', status: 'error', quotaCoverage: 'best-effort', error: { code: 'unauthorized' } },
    { id: 'minimax', status: 'ok', quotaCoverage: 'best-effort' },
  ] }).map(p => p.id), ['glm']);
  assert.deepEqual(quotaSaveFailures(undefined), []);
});

test('model names alone never attribute OpenCode or MiniMax Code tokens to these paid plans', () => {
  const generatedAt = '2026-09-12T12:00:00Z';
  const data = { generatedAt, buckets: [
    { source: 'opencode', model: 'glm-5', totalTokens: 1000, bucketStart: '2026-09-12T11:00:00Z' },
    { source: 'mcode', model: 'minimax-m3', totalTokens: 2000, bucketStart: '2026-09-12T11:00:00Z' },
    { source: 'opencode', model: 'qwen3.7-plus', totalTokens: 3000, bucketStart: '2026-09-12T11:00:00Z' },
  ] };
  const limits = { generatedAt, providers: ids.map(id => ({ id, status: 'ok', updatedAt: generatedAt, windows: [
    { id: 'primary', usedPercent: 25, remainingPercent: 75, windowSeconds: 18000, resetsAt: '2026-09-12T14:00:00Z' },
  ] })) };
  const insight = buildSubscriptionInsights(data, limits, { settings: { providers: Object.fromEntries(ids.map(id => [id, {
    entitlementType: 'paid', subscriptionPrice: 15, subscriptionCurrency: 'usd',
  }])) } });
  for (const result of insight.providers) {
    assert.equal(result.lifetimeTotals.totalTokens, 0);
    assert.equal(result.windows[0].estimatedCapacityTokens, null);
    assert.equal(result.localAttributionAvailable, false);
    assert.equal(result.economics.valueRatio, null);
    assert.equal(result.decisionSignals.some(signal => signal.code === 'value-low'), false);
  }
  assert.equal(insight.portfolio.paidWithoutLocalUsage.length, 0);
});
