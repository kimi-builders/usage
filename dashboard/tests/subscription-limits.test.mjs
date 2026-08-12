import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let module;
let server;
let originalLocalStorageDescriptor;

test.before(async () => {
  originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => '', setItem: () => {} },
  });
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  module = await server.ssrLoadModule('/src/SubscriptionLimits.jsx');
});

test.after(async () => {
  if (originalLocalStorageDescriptor) Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor);
  else delete globalThis.localStorage;
  await server?.close();
});

test('shows a value / limit detail only when both numbers are finite', () => {
  assert.equal(module.limitWindowDetail({ value: 12, limit: 50, unit: 'credits' }), '12 / 50 credits');
  assert.equal(module.limitWindowDetail({ value: 0, limit: 50, unit: 'credits' }), '0 / 50 credits');
  assert.equal(module.limitWindowDetail({ value: null, limit: 50, unit: 'credits' }), null);
  assert.equal(module.limitWindowDetail({ value: '', limit: 50, unit: 'credits' }), null);
  assert.equal(module.limitWindowDetail({ value: Number.NaN, limit: 50, detail: 'Provider detail' }), 'Provider detail');
  assert.equal(module.limitWindowDetail({ value: 12, limit: Number.POSITIVE_INFINITY }), null);
});

test('overview provider tabs control a panel labelled by the active tab', () => {
  const observedAt = '2026-08-11T12:00:00.000Z';
  const markup = renderToStaticMarkup(createElement(module.SubscriptionCenter, {
    data: {
      enabled: true,
      generatedAt: observedAt,
      providers: [{
        id: 'codex', label: 'Codex', status: 'ok', updatedAt: observedAt,
        windows: [{
          id: 'primary', label: '5 hours', usedPercent: 10, remainingPercent: 90,
          resetsAt: '2026-08-11T14:00:00.000Z', windowSeconds: 18_000,
        }],
      }],
      history: { observations: [] },
    },
    usageData: { generatedAt: observedAt, buckets: [] },
    settings: { refreshMinutes: 10, providers: { codex: { entitlementType: 'unknown' } } },
    loading: false,
    error: null,
    onRefresh: () => {},
    onSettings: () => {},
    view: 'overview',
    zh: false,
  }));

  assert.match(markup, /id="subscription-provider-tab-codex"/);
  assert.match(markup, /aria-controls="subscription-limit-panel"/);
  assert.match(markup, /id="subscription-limit-panel" role="tabpanel" aria-labelledby="subscription-provider-tab-codex"/);
});

test('settings filter tabs control their labelled provider panel', () => {
  const markup = renderToStaticMarkup(createElement(module.LimitSettingsDialog, {
    open: true,
    settings: {
      enabled: false,
      refreshMinutes: 10,
      catalog: [],
      providers: {},
      providerOrder: [],
    },
    onClose: () => {},
    onSave: async () => ({}),
    saving: false,
    zh: false,
  }));

  assert.match(markup, /id="limit-provider-settings-tab-detected"/);
  assert.match(markup, /aria-controls="limit-provider-settings-panel"/);
  assert.match(markup, /id="limit-provider-settings-panel" role="tabpanel" aria-labelledby="limit-provider-settings-tab-detected"/);
});
