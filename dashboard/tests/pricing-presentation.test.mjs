import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { modelDisplayName, modelGlyphId } from '../src/model-meta.js';
import { cacheWritePriceLabel, modelPriceRows } from '../src/pricing-details.js';
import { analyze, EMPTY_FILTERS } from '../src/analytics.js';

const configDir = mkdtempSync(join(tmpdir(), 'kbu-price-ui-'));
process.env.KBU_USAGE_CONFIG_DIR = configDir;
const { estimateLocalBucketCost } = await import('../../src/local/pricing.js');
let server;
let PricingMatches, DistributionCard, UsageAttributionSummary, RecordsSection;
test.before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)),
    cacheDir: join(configDir, 'vite'), logLevel: 'silent', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
  ({ PricingMatches } = await server.ssrLoadModule('/src/PricingMatches.jsx'));
  ({ DistributionCard } = await server.ssrLoadModule('/src/UsageCharts.jsx'));
  ({ UsageAttributionSummary } = await server.ssrLoadModule('/src/UsageAttributionSummary.jsx'));
  ({ RecordsSection } = await server.ssrLoadModule('/src/UsageRecords.jsx'));
});
test.after(async () => { await server?.close(); rmSync(configDir, { recursive: true, force: true }); });

function priced(model, overrides = {}) {
  const raw = { source: 'opencode', model, modelCanonical: model, project: 'fixture',
    bucketStart: '2026-10-08T12:00:00Z', inputTokens: 1_000_000, outputTokens: 0,
    cacheWriteInputTokens: 0, cacheReadInputTokens: 0, reasoningOutputTokens: 0,
    requestCount: 1, measurement: 'exact', ...overrides };
  return { ...raw, totalTokens: raw.inputTokens + raw.cacheWriteInputTokens + raw.cacheReadInputTokens + raw.outputTokens,
    ...estimateLocalBucketCost(raw) };
}
const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));

test('model marks follow canonical family, never the Agent or reseller', () => {
  assert.equal(modelGlyphId({ model: 'vendor/MiMo_V2.6_Pro', source: 'codex', modelProvider: 'other' }), 'xiaomimimo');
  assert.equal(modelGlyphId({ model: 'anything', modelCanonical: 'vendor/step-5-preview' }), 'stepfun');
  assert.equal(modelGlyphId({ model: 'unknown', modelProvider: 'stepfun', source: 'opencode' }), '');
  assert.equal(modelGlyphId('step-by-step'), '');
  assert.equal(modelGlyphId('mimosa'), '');
  assert.equal(modelDisplayName('vendor/mimo-v2.6-pro-ultraspeed'), 'MiMo V2.6 Pro UltraSpeed');
  assert.equal(modelDisplayName('unknown/model-v1'), 'unknown/model-v1');
});

test('pricing rows retain multiple historical/tier matches and deduplicate identical tariffs', () => {
  const old = priced('claude-sonnet-5-5', { bucketStart: '2026-10-06T12:00:00Z' });
  const current = priced('claude-sonnet-5-5');
  const standard = priced('mimo-v2.6-pro');
  const batch = priced('mimo-v2.6-pro', { processingTier: 'batch' });
  const rows = modelPriceRows({ buckets: [old, current, standard, batch, { ...current, requestCount: 2 }] });
  assert.equal(rows.length, 4);
  assert.equal(new Set(rows.map(row => row.key)).size, 4);
  assert.deepEqual(rows.filter(row => row.model === 'claude-sonnet-5-5').map(row => row.bucket.priceCacheRead), [.2, .1]);
  assert.match(cacheWritePriceLabel(priced('kimi-k3'), true), /5m \$3\/M · 1h \$6\/M/);
  assert.match(cacheWritePriceLabel(priced('kimi-k3'), false), /unknown TTL/);
  assert.equal(cacheWritePriceLabel({ pricePattern: 'free', priceInput: 1, priceCacheWrite: 0 }, true), '$0/M');
  assert.equal(cacheWritePriceLabel({}, true), '—');
});

test('pricing explanation renders model-specific bilingual provenance, not a generic Kimi disclaimer', () => {
  const report = { buckets: [priced('step-5-preview'), priced('stepaudio-3-chat-preview'),
    priced('mimo-v2.6-pro', { processingTier: 'batch' }), priced('qwen3.8-flash'),
    priced('kimi-k3', { cacheWriteInputTokens: 1_000_000 })] };
  for (const zh of [true, false]) {
    const html = render(PricingMatches, { report, zh });
    assert.match(html, /7\.16/);
    assert.match(html, /2026-08-08/);
    assert.match(html, /https:\/\/platform\.stepfun\.com/);
    assert.match(html, /standard|batch/);
    assert.match(html, /5m \$3\/M · 1h \$6\/M/);
    assert.match(html, zh ? /未计价，不是免费/ : /unpriced, not free/);
    assert.match(html, zh ? /免费/ : /free/i);
    assert.match(html, zh ? /未记录缓存 TTL/ : /Cache TTL missing/);
    assert.doesNotMatch(html, /K2\.8/);
    if (!zh) assert.doesNotMatch(html, /未计价|免费|阶跃/);
  }
});

test('MiMo and StepFun marks appear in model distribution, attribution and both record layouts', () => {
  for (const model of ['mimo-v2.6-pro', 'step-5-preview', 'unknown-model']) {
    const data = { generatedAt: '2026-10-08T20:00:00Z', buckets: [priced(model)], sessions: [], activityHours: [], sources: [], device: {} };
    const report = analyze(data, { ...EMPTY_FILTERS, range: 'all' });
    const props = { report, zh: true, currency: 'usd', device: 'fixture' };
    const outputs = [render(DistributionCard, { ...props, type: 'model', rows: report.modelRows }),
      render(UsageAttributionSummary, props), render(RecordsSection, props)];
    for (const html of outputs) {
      assert.ok(html.includes(modelDisplayName(model)));
      if (model === 'unknown-model') assert.doesNotMatch(html, /title="(?:MiMo|StepFun)"/);
      else assert.match(html, /tool-glyph--model/);
    }
    if (model !== 'unknown-model') assert.equal((outputs[2].match(/tool-glyph--model/g) || []).length, 2);
  }
});

test('model distribution distinguishes unknown, partially priced and explicitly free usage', () => {
  const rows = [
    { id: 'unknown-model', totalTokens: 1000, costMicros: 0, pricedTokens: 0, unpricedTokens: 1000 },
    { id: 'qwen3.8-flash', totalTokens: 1000, costMicros: 113_000, pricedTokens: 500, unpricedTokens: 500 },
    { id: 'stepaudio-3-chat-preview', totalTokens: 1000, costMicros: 0, pricedTokens: 1000, unpricedTokens: 0 },
  ];
  for (const zh of [true, false]) {
    const html = render(DistributionCard, { type: 'model', rows, zh, currency: 'usd' });
    assert.match(html, zh ? /未定价/ : /Unpriced/);
    assert.match(html, zh ? /部分计价/ : /partial/);
    assert.equal((html.match(/\$0\.00/g) || []).length, 1);
  }
});
