import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { comparePricingDataset, CURATED_MODELS } from '../scripts/check-pricing-drift.mjs';

const catalog = JSON.parse(readFileSync(
  new URL('../src/pricing/catalog-v1.json', import.meta.url),
  'utf8',
));

function monitoredModels() {
  return [
    ['gpt-6-astra', 'openai', 10, 1, 12.5, 50, [20, 2, 25, 75]],
    ['gpt-5.6-sol', 'openai', 4, 0.4, 5, 20, [8, 0.8, 10, 30]],
    ['claude-fable-5-1', 'anthropic', 10, 0.25, null, 50, null],
    ['gemini-3.8-flash', 'google', 0.75, 0.075, null, 3.75, null],
    ['grok-4.5', 'xai', 2, 0.3, null, 6, [4, 0.6, null, 12]],
  ].map(([id, provider, inputPerM, cachedInputPerM, cacheWritePerM, outputPerM, long]) => ({
    id,
    provider,
    pricing: {
      inputPerM,
      cachedInputPerM,
      ...(cacheWritePerM === null ? {} : { cacheWritePerM }),
      outputPerM,
      ...(long ? {
        longContext: {
          inputPerM: long[0],
          cachedInputPerM: long[1],
          ...(long[2] === null ? {} : { cacheWritePerM: long[2] }),
          outputPerM: long[3],
        },
      } : {}),
    },
  }));
}

test('pricing monitor compares only curated provider identities against official catalog entries', () => {
  assert.equal(CURATED_MODELS.length, 5);
  const dataset = { lastUpdated: '2026-09-05T12:00:00.000Z', models: monitoredModels() };
  assert.deepEqual(comparePricingDataset(dataset, catalog, {
    now: Date.parse('2026-09-05T13:00:00.000Z'),
  }), []);

  dataset.models.find((model) => model.id === 'gemini-3.8-flash').pricing.inputPerM = 0.8;
  dataset.models.find((model) => model.id === 'grok-4.5').provider = 'reseller';
  const issues = comparePricingDataset(dataset, catalog, {
    now: Date.parse('2026-09-05T13:00:00.000Z'),
  });
  assert.ok(issues.some((issue) => issue.includes('gemini-3.8-flash/base/input')));
  assert.ok(issues.some((issue) => issue.includes('grok-4.5: provider=reseller')));
});

test('pricing monitor rejects stale or structurally incomplete third-party data', () => {
  const stale = comparePricingDataset({
    lastUpdated: '2026-08-01T00:00:00.000Z',
    models: monitoredModels(),
  }, catalog, { now: Date.parse('2026-09-05T13:00:00.000Z') });
  assert.ok(stale.includes('monitor: dataset is older than 72 hours'));

  assert.deepEqual(
    comparePricingDataset({ lastUpdated: 'broken', models: [] }, catalog),
    ['monitor: lastUpdated is missing or invalid'],
  );
});
