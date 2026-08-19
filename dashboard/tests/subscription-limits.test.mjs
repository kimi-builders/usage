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

test('OpenCode Go workspace validation requires an exact per-account ID', () => {
  assert.equal(utils.isValidOpenCodeWorkspaceId(''), false);
  assert.equal(utils.isValidOpenCodeWorkspaceId(null), false);
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

test('quota copy localizes provider fields and normalizes legacy seven-day labels', () => {
  assert.equal(utils.quotaWindowLabel('kimi-code', { id: 'session', label: '5 小时滚动（5H 频限）' }, false), '5-hour rolling (5H rate limit)');
  assert.equal(utils.quotaWindowLabel('kimi-code', { id: 'weekly', label: '7 天' }, true), '每周');
  assert.equal(utils.quotaWindowLabel('kimi-code', { id: 'weekly', label: '7 天' }, false), 'Weekly');
  assert.equal(utils.quotaWindowLabel('codex', {
    id: 'primary', label: '每周', windowSeconds: 604_800,
  }, true), '每周');
  assert.equal(utils.quotaWindowLabel('codex', {
    id: 'secondary', label: '5 小时', windowSeconds: 18_000,
  }, false), '5 hours');
  assert.equal(utils.quotaWindowLabel('codex', {
    id: 'additional-0-primary', label: 'GPT-5.3-Codex-Spark', windowSeconds: 604_800,
  }, true), 'GPT-5.3-Codex-Spark');
  assert.equal(utils.quotaWindowLabel('antigravity', { id: 'gemini-5h', label: 'Gemini 模型 · 5 小时' }, false), 'Gemini models · 5 hours');
  assert.equal(utils.quotaWindowLabel('qoder', { id: 'credits', label: '个人 + 共享 Credits' }, false), 'Personal + shared credits');
  assert.equal(utils.quotaWindowDetail('antigravity', { detail: 'Antigravity 返回的 每周额度池' }, false), 'Antigravity weekly quota pool');
  assert.equal(utils.quotaSourceDisplay('Kimi Web 登录令牌', false), 'Kimi Web token');
  assert.equal(utils.quotaProviderNotice('额度来自 Kimi 账户接口，按请求/订阅窗口展示。', false), 'Quotas come from the Kimi account API and are shown by request or subscription cycle.');
  assert.equal(utils.quotaProviderCatalogCopy({
    id: 'deepseek', label: 'DeepSeek', description: 'API 账户货币余额与 DeepSeek 模型本机用量',
    localHint: '中文提示', detection: { state: 'manual', label: '需要一次手动连接' },
  }, false).description, 'API account balance and local DeepSeek model usage');
  assert.equal(utils.quotaPageError('权益接口暂时不可用', false), 'Could not load benefit data. Try again.');
});

test('English benefits center does not leak built-in Chinese provider copy', () => {
  const observedAt = '2026-08-11T12:00:00.000Z';
  const markup = renderToStaticMarkup(createElement(module.SubscriptionCenter, {
    data: {
      enabled: true,
      generatedAt: observedAt,
      providers: [{
        id: 'kimi-code', label: 'Kimi Code', status: 'ok', updatedAt: observedAt,
        source: 'Kimi Web 登录令牌',
        notice: 'Kimi Code 本机登录可读取 5 小时滚动（5H 频限）与每周额度；订阅总额度需要 Kimi Web 登录令牌。',
        windows: [
          {
            id: 'session', label: '5 小时滚动（5H 频限）', usedPercent: 0, remainingPercent: 100,
            resetsAt: '2026-08-11T15:00:00.000Z', windowSeconds: 18_000,
            value: 0, limit: 100, unit: 'requests',
          },
          {
            id: 'weekly', label: '7 天', usedPercent: 100, remainingPercent: 0,
            resetsAt: '2026-08-18T12:00:00.000Z', windowSeconds: 604_800,
            value: 100, limit: 100, unit: 'requests',
          },
        ],
      }],
      history: { observations: [] },
    },
    usageData: { generatedAt: observedAt, buckets: [] },
    settings: { refreshMinutes: 10, providers: { 'kimi-code': { entitlementType: 'paid', subscriptionPrice: 199, subscriptionCurrency: 'cny' } } },
    loading: false,
    error: null,
    onRefresh: () => {},
    onSettings: () => {},
    view: 'accounts',
    zh: false,
  }));

  assert.match(markup, /5-hour rolling \(5H rate limit\)/);
  assert.match(markup, />Weekly</);
  assert.match(markup, /Kimi Web token/);
  assert.doesNotMatch(markup, /[\u3400-\u9fff]/u);
});

test('DeepSeek renders official money separately from cross-Agent local model usage', () => {
  const observedAt = '2026-08-11T12:00:00.000Z';
  const markup = renderToStaticMarkup(createElement(module.SubscriptionCenter, {
    data: {
      enabled: true,
      generatedAt: observedAt,
      providers: [{
        id: 'deepseek', label: 'DeepSeek', status: 'ok', updatedAt: observedAt,
        source: 'DeepSeek 环境变量', windows: [],
        balances: [{ currency: 'CNY', total: 42.5, granted: 2.5, toppedUp: 40, available: true }],
        notice: 'DeepSeek 公开 API 只返回账户货币余额，不提供 Token、5 小时或每周额度窗口；本机 DeepSeek 模型用量与余额分别展示。',
      }],
      history: { observations: [] },
    },
    usageData: { generatedAt: observedAt, buckets: [{
      id: 'local-deepseek', source: 'cursor', bucketStart: observedAt,
      model: 'deepseek-v4-pro', modelCanonical: 'deepseek-v4-pro',
      inputTokens: 100, cacheWriteInputTokens: 0, cacheReadInputTokens: 0,
      outputTokens: 20, reasoningOutputTokens: 0, totalTokens: 120,
      requestCount: 1, costMicros: 240, pricedTokens: 120, unpricedTokens: 0, assumedTokens: 0,
    }] },
    settings: { refreshMinutes: 10, providers: { deepseek: { entitlementType: 'unknown' } } },
    loading: false, error: null, onRefresh: () => {}, onSettings: () => {}, view: 'accounts', zh: false,
  }));

  assert.match(markup, /DeepSeek API account balance/);
  assert.match(markup, /Provider-reported money, not a Token quota/);
  assert.match(markup, /42\.50/);
  assert.match(markup, /Grouped|grouped|model family/);
  assert.match(markup, /120/);
  assert.doesNotMatch(markup, /Official quota is not observable/);
  assert.doesNotMatch(markup, /[㐀-鿿]/u);
});

test('overview stays portfolio-level and shows comparable capacity plus reset progress', () => {
  const observedAt = new Date().toISOString();
  const resetIn = (milliseconds) => new Date(Date.now() + milliseconds).toISOString();
  const markup = renderToStaticMarkup(createElement(module.SubscriptionCenter, {
    data: {
      enabled: true,
      generatedAt: observedAt,
      providers: [{
        id: 'codex', label: 'Codex', status: 'ok', updatedAt: observedAt,
        windows: [{
          id: 'primary', label: '5 hours', usedPercent: 10, remainingPercent: 90,
          resetsAt: resetIn(30 * 60_000), windowSeconds: 18_000,
          unit: 'tokens', value: 100, limit: 1_000,
        }],
      }, {
        id: 'kimi-code', label: 'Kimi Code', status: 'ok', updatedAt: observedAt,
        windows: [{
          id: 'session', label: '5 小时滚动（5H 频限）', usedPercent: 20, remainingPercent: 80,
          resetsAt: resetIn(2 * 60 * 60_000), windowSeconds: 18_000,
        }, {
          id: 'weekly', label: '每周', usedPercent: 50, remainingPercent: 50,
          resetsAt: resetIn(4 * 86_400_000), windowSeconds: 604_800,
          unit: 'tokens', value: 1_000, limit: 2_000,
        }],
      }],
      history: { observations: [] },
    },
    usageData: { generatedAt: observedAt, buckets: [] },
    settings: { refreshMinutes: 10, providers: {
      codex: { entitlementType: 'paid' },
      'kimi-code': { entitlementType: 'promotion' },
    } },
    loading: false, error: null, onRefresh: () => {}, onSettings: () => {},
    onViewChange: () => {}, view: 'overview', zh: true,
  }));

  assert.match(markup, /即将重置可用 TOKEN/);
  assert.match(markup, /5H 窗口可用 TOKEN/);
  assert.match(markup, /本周可用 TOKEN/);
  assert.match(markup, /已连接账户权益/);
  assert.match(markup, /个人付费核心/);
  assert.match(markup, /零新增支出权益/);
  assert.match(markup, /已关联本机 TOKEN/);
  assert.match(markup, /官方事实可读取/);
  assert.match(markup, /≥900/);
  assert.match(markup, /账户重置进度/);
  assert.match(markup, /role="tablist"/);
  assert.match(markup, /id="benefit-reset-tab-five-hour"/);
  assert.match(markup, /id="benefit-reset-tab-weekly"/);
  assert.match(markup, /aria-selected="true"/);
  assert.match(markup, /role="progressbar"/);
  assert.match(markup, /查看账户权益/);
  assert.doesNotMatch(markup, /账户权益、官方额度\/余额与 Token 分析/);
});

test('account benefits promotes independent rolling and weekly Token capacity before reset', () => {
  const observedAt = new Date().toISOString();
  const resetIn = (milliseconds) => new Date(Date.now() + milliseconds).toISOString();
  const markup = renderToStaticMarkup(createElement(module.SubscriptionCenter, {
    data: {
      enabled: true,
      generatedAt: observedAt,
      providers: [{
        id: 'kimi-code', label: 'Kimi Code', status: 'ok', updatedAt: observedAt,
        windows: [
          {
            id: 'session', label: '5 小时滚动（5H 频限）', usedPercent: 25, remainingPercent: 75,
            resetsAt: resetIn(30 * 60_000), windowSeconds: 18_000,
          },
          {
            id: 'weekly', label: '每周', usedPercent: 50, remainingPercent: 50,
            resetsAt: resetIn(5 * 86_400_000), windowSeconds: 604_800,
          },
        ],
      }],
      history: { observations: [] },
    },
    usageData: { generatedAt: observedAt, buckets: [{
      id: 'local-kimi', source: 'kimi-code', bucketStart: observedAt,
      model: 'kimi-k3', modelCanonical: 'kimi-k3',
      inputTokens: 800_000, cacheWriteInputTokens: 0, cacheReadInputTokens: 0,
      outputTokens: 200_000, reasoningOutputTokens: 0, totalTokens: 1_000_000,
      requestCount: 20, costMicros: 2_000_000, pricedTokens: 1_000_000,
      unpricedTokens: 0, assumedTokens: 0,
    }] },
    settings: { refreshMinutes: 10, providers: { 'kimi-code': { entitlementType: 'paid' } } },
    loading: false, error: null, onRefresh: () => {}, onSettings: () => {}, view: 'accounts', zh: true,
  }));

  assert.match(markup, /周期 Token 容量速览/);
  assert.match(markup, /各窗口是同时生效的独立约束，不能相加/);
  assert.match(markup, /5 小时滚动（5H 频限）/);
  assert.match(markup, />每周</);
  assert.match(markup, /重置前可用 Token/);
  assert.match(markup, /~300万/);
  assert.match(markup, /~100万/);
  assert.match(markup, /即将重置/);
  assert.match(markup, /本周期推算/);
});

test('account benefits provider tabs control a panel labelled by the active tab', () => {
  const observedAt = '2026-08-11T12:00:00.000Z';
  const markup = renderToStaticMarkup(createElement(module.SubscriptionCenter, {
    data: {
      enabled: true,
      generatedAt: observedAt,
      providers: [{
        id: 'codex', label: 'Codex', accountLabel: 'Work', status: 'ok', updatedAt: observedAt,
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
    view: 'accounts',
    zh: false,
  }));

  assert.match(markup, /id="subscription-provider-tab-codex"/);
  assert.match(markup, /aria-controls="subscription-limit-panel"/);
  assert.match(markup, /id="subscription-limit-panel" role="tabpanel" aria-labelledby="subscription-provider-tab-codex"/);
  assert.match(markup, /class="reset-credit" data-state="unknown"/);
  assert.match(markup, /Available count is not observable/);
  assert.match(markup, />Work</);
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
    view: 'accounts',
  };

  const chinese = renderToStaticMarkup(createElement(module.SubscriptionCenter, { ...props, zh: true }));
  const english = renderToStaticMarkup(createElement(module.SubscriptionCenter, { ...props, zh: false }));
  assert.match(chinese, /262亿/);
  assert.match(chinese, /6\.3万 次请求/);
  assert.match(chinese, /本机观测用量/);
  assert.match(chinese, /本周期估算容量/);
  assert.match(chinese, /重置前估算可用/);
  assert.match(chinese, /折算月度容量/);
  assert.doesNotMatch(chinese, /本窗口本机 TOKEN|推算窗口总容量|推算剩余 TOKEN|30 天等效容量/);
  assert.doesNotMatch(chinese, /26\.2B/);
  assert.match(english, /26\.2B/);
  assert.match(english, /62\.8K requests/);
  assert.match(english, /EST\. AVAILABLE BEFORE RESET/);
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

test('English benefit settings localize catalog and detection copy', () => {
  const provider = {
    id: 'kimi-code', label: 'Kimi Code', group: 'recommended', popular: true,
    description: '5 小时滚动（5H 频限）、每周与订阅总额度',
    localHint: '自动复用 Kimi Code CLI 登录；只有查看 Web 订阅总额度时才需要手动令牌。',
    secretKind: 'Kimi 登录令牌', quotaSupport: 'automatic',
    authModes: ['local', 'environment', 'keychain'], defaultEnvironmentVariable: 'KIMI_AUTH_TOKEN',
    supportsKeychain: true, dashboardUrl: 'https://www.kimi.com/code/console',
    detection: { state: 'detected', label: '已检测到 Kimi Code 登录' },
  };
  const markup = renderToStaticMarkup(createElement(settings.LimitSettingsDialog, {
    open: true,
    settings: {
      enabled: true,
      refreshMinutes: 10,
      catalog: [provider],
      providers: { 'kimi-code': {
        enabled: true, authMode: 'local', environmentVariable: 'KIMI_AUTH_TOKEN',
        customPath: '', workspaceId: '', site: 'international', accounts: [], activeAccountId: '',
        entitlementType: 'paid', subscriptionPrice: 199, subscriptionCurrency: 'cny',
        billingCycle: 'monthly', renewsAt: '',
      } },
      providerOrder: ['kimi-code'],
    },
    onClose: () => {},
    onSave: async () => ({}),
    saving: false,
    zh: false,
  }));

  assert.match(markup, /5-hour rolling rate limit, weekly quota, and subscription total/);
  assert.match(markup, /Kimi Code access detected/);
  assert.doesNotMatch(markup, /[\u3400-\u9fff]/u);
});
