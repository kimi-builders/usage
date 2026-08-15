import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let module;
let server;

test.before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  module = await server.ssrLoadModule('/src/UsagePoster.jsx');
});

test.after(async () => {
  await server?.close();
});

const emptyHeatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({
  observed: false,
  totalTokens: 0,
})));

const report = {
  start: new Date('2026-08-01T00:00:00.000Z'),
  end: new Date('2026-08-14T00:00:00.000Z'),
  buckets: [],
  series: [],
  heatmap: { cells: emptyHeatmap },
  totals: {
    totalTokens: 26_200_000_000,
    inputTokens: 1_600_000,
    cacheWriteInputTokens: 0,
    cacheReadInputTokens: 26_000_000_000,
    outputTokens: 480_600,
    reasoningOutputTokens: 62_769,
    requestCount: 62_769,
    costMicros: 50_570_000,
  },
  lifetimeTotals: { totalTokens: 45_820_000_000 },
  activeSeconds: 10_020,
  cacheHitRate: .97,
  peakTokens: 480_600,
  sessions: [],
  sourceRows: [],
  modelRows: [],
  weeklyStreaks: { current: 2, longest: 3 },
  streaks: { current: 4, longest: 8 },
  topModel: 'kimi-k3',
  topReasoning: 'high',
  inputLeverage: 12.3,
};

function render(zh) {
  return renderToStaticMarkup(createElement(module.UsagePoster, {
    report,
    range: '30d',
    identity: { name: 'Local Builder', handle: 'local', avatar: '' },
    generatedAt: '2026-08-14T00:00:00.000Z',
    zh,
  }));
}

test('Chinese usage poster uses Chinese copy and compact units', () => {
  const markup = render(true);
  assert.match(markup, /TOKEN 流向/);
  assert.match(markup, /262亿/);
  assert.match(markup, /6\.3万 次请求/);
  assert.doesNotMatch(markup, /TOKEN FLOW/);
});

test('English usage poster restores English copy and K\/M\/B units', () => {
  const markup = render(false);
  assert.match(markup, /TOKEN FLOW/);
  assert.match(markup, /26\.2B/);
  assert.match(markup, /62\.8K REQUESTS/);
  assert.match(markup, /API-EQUIVALENT VALUE/);
  assert.doesNotMatch(markup, /TOKEN 流向|次请求|262亿/);
});
