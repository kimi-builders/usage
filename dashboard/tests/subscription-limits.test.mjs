import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let module;
let utils;
let settings;
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
  utils = await server.ssrLoadModule('/src/subscription-limits-utils.js');
  settings = await server.ssrLoadModule('/src/LimitSettingsDialog.jsx');
});

test.after(async () => {
  if (originalLocalStorageDescriptor) Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor);
  else delete globalThis.localStorage;
  await server?.close();
});

test('shows a value / limit detail only when both numbers are finite', () => {
  assert.equal(utils.limitWindowDetail({ value: 12, limit: 50, unit: 'credits' }), '12 / 50 credits');
  assert.equal(utils.limitWindowDetail({ value: 0, limit: 50, unit: 'credits' }), '0 / 50 credits');
  assert.equal(utils.limitWindowDetail({ value: null, limit: 50, unit: 'credits' }), null);
  assert.equal(utils.limitWindowDetail({ value: '', limit: 50, unit: 'credits' }), null);
  assert.equal(utils.limitWindowDetail({ value: Number.NaN, limit: 50, detail: 'Provider detail' }), 'Provider detail');
  assert.equal(utils.limitWindowDetail({ value: 12, limit: Number.POSITIVE_INFINITY }), null);
});

test('secret dirty detection supports flat and nested account credential maps', () => {
  assert.equal(utils.hasEnteredSecrets({ codex: '  ' }), false);
  assert.equal(utils.hasEnteredSecrets({ codex: 'token' }), true);
  assert.equal(utils.hasEnteredSecrets({ opencode: { accountA: '  ', accountB: 'auth=cookie' } }), true);
  assert.equal(utils.hasEnteredSecrets({ opencode: { accountA: '' }, copilot: {} }), false);
  assert.equal(utils.hasEnteredSecrets(null), false);
});

test('OpenCode Go workspace validation is exact and consistently allows auto-discovery', () => {
  assert.equal(utils.isValidOpenCodeWorkspaceId(''), true);
  assert.equal(utils.isValidOpenCodeWorkspaceId(null), true);
  assert.equal(utils.isValidOpenCodeWorkspaceId('wrk_01M027SPTN5G825MYDRZ0Q0TS2'), true);
  assert.equal(utils.isValidOpenCodeWorkspaceId('xwrk_example'), false);
  assert.equal(utils.isValidOpenCodeWorkspaceId('wrk_example!'), false);
  assert.equal(utils.isValidOpenCodeWorkspaceId('wrk_'), false);
});

test('reset-credit UI distinguishes available, observed zero, and unknown counts', () => {
  assert.deepEqual(utils.resetCreditPresentation({ availableCount: 2 }, false), {
    state: 'available', value: '2', detail: null,
  });
  assert.deepEqual(utils.resetCreditPresentation({ availableCount: 0 }, false), {
    state: 'zero', value: '0', detail: 'Observed available count: 0',
  });
  assert.deepEqual(utils.resetCreditPresentation({ availableCount: null }, false), {
    state: 'unknown', value: '—', detail: 'Available count is not observable',
  });
  assert.equal(utils.resetCreditPresentation({ availableCount: '0' }, false).state, 'unknown');
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
  assert.match(markup, /class="reset-credit" data-state="unknown"/);
  assert.match(markup, /Available count is not observable/);
  assert.match(markup, /<details class="subscription-deep-dive">/);
});

test('benefits center follows Chinese compact units while English keeps K/M/B', () => {
  const observedAt = '2026-08-11T12:00:00.000Z';
  const props = {
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
    usageData: {
      generatedAt: observedAt,
      buckets: [{
        id: 'large-local-bucket', source: 'codex', model: 'gpt-5.6-sol',
        modelCanonical: 'gpt-5.6-sol', bucketStart: observedAt,
        inputTokens: 26_200_000_000, cacheWriteInputTokens: 0,
        cacheReadInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0,
        totalTokens: 26_200_000_000, requestCount: 62_769,
        costMicros: 1_000_000, pricedTokens: 26_200_000_000,
        unpricedTokens: 0, assumedTokens: 0,
      }],
    },
    settings: { refreshMinutes: 10, providers: { codex: { entitlementType: 'unknown' } } },
    loading: false,
    error: null,
    onRefresh: () => {},
    onSettings: () => {},
    view: 'overview',
  };

  const chinese = renderToStaticMarkup(createElement(module.SubscriptionCenter, { ...props, zh: true }));
  const english = renderToStaticMarkup(createElement(module.SubscriptionCenter, { ...props, zh: false }));
  assert.match(chinese, /262亿/);
  assert.match(chinese, /6\.3万 次请求/);
  assert.doesNotMatch(chinese, /26\.2B/);
  assert.match(english, /26\.2B/);
  assert.match(english, /62\.8K requests/);
});

test('settings filter tabs control their labelled provider panel', () => {
  const markup = renderToStaticMarkup(createElement(settings.LimitSettingsDialog, {
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
