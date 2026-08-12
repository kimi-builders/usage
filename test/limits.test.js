import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLimitSettings, publicLimitSettings } from '../src/limits/catalog.js';
import { normalizeCookieSecret } from '../src/limits/credentials.js';
import { parseClaudeUsage } from '../src/limits/providers/claude.js';
import { parseCodexUsage } from '../src/limits/providers/codex.js';
import { parseCopilotUsage } from '../src/limits/providers/copilot.js';
import { parseCursorUsage } from '../src/limits/providers/cursor.js';
import { parseAntigravityQuota } from '../src/limits/providers/antigravity.js';
import { parseGeminiQuota } from '../src/limits/providers/gemini.js';
import { parseJetBrainsQuota } from '../src/limits/providers/jetbrains.js';
import { parseKimiCodeUsage, parseKimiWebUsage } from '../src/limits/providers/kimi.js';
import { fetchOpenCodeLimits, parseOpenCodeUsage } from '../src/limits/providers/opencode.js';
import { parseQoderUsage } from '../src/limits/providers/qoder.js';
import { parseWarpUsage } from '../src/limits/providers/warp.js';
import { parseWindsurfPlan } from '../src/limits/providers/windsurf.js';
import { clearLimitCache, loadSubscriptionLimits } from '../src/limits/service.js';

const NOW = new Date('2026-08-11T12:00:00.000Z');

test('normalizes quota settings without accepting unknown providers or auth modes', () => {
  assert.equal(normalizeLimitSettings({}).providerOrder[0], 'kimi-code');
  const value = normalizeLimitSettings({
    enabled: true,
    refreshMinutes: 5,
    providerOrder: ['codex', 'malicious', 'codex'],
    providers: {
      codex: { enabled: true, authMode: 'raw-token', customPath: 'x'.repeat(2_000) },
      malicious: { enabled: true, authMode: 'keychain' },
    },
  });
  assert.equal(value.enabled, true);
  assert.equal(value.refreshMinutes, 5);
  assert.equal(value.providers.codex.enabled, true);
  assert.equal(value.providers.codex.authMode, 'local');
  assert.equal(value.providers.codex.customPath.length, 1_024);
  assert.equal(value.providers.malicious, undefined);
  assert.equal(value.providers.trae.enabled, false);
  assert.deepEqual(value.providerOrder.slice(0, 3), ['codex', 'kimi-code', 'claude-code']);
  assert.equal(new Set(value.providerOrder).size, value.providerOrder.length);
  const exposed = publicLimitSettings(value, { keychainAvailable: true, hasSecret: (id) => id === 'warp' });
  assert.deepEqual(exposed.catalog.slice(0, 3).map((item) => item.id), ['codex', 'kimi-code', 'claude-code']);
  assert.equal(exposed.catalog.find((item) => item.id === 'warp').hasSecret, true);
  assert.equal(JSON.stringify(exposed).includes('raw-token'), false);
});

test('normalizes optional subscription spend without inventing prices', () => {
  assert.equal(normalizeLimitSettings({}).providers.codex.subscriptionPrice, null);
  assert.equal(normalizeLimitSettings({}).providers.codex.entitlementType, 'unknown');
  const value = normalizeLimitSettings({ providers: {
    codex: {
      enabled: true, subscriptionPrice: 200.129, subscriptionCurrency: 'usd',
      billingCycle: 'monthly', renewsAt: '2026-09-12',
    },
    'kimi-code': {
      subscriptionPrice: -1, subscriptionCurrency: 'bitcoin',
      billingCycle: 'weekly', renewsAt: 'September',
    },
  } });
  assert.equal(value.providers.codex.entitlementType, 'paid');
  assert.equal(value.providers.codex.subscriptionPrice, 200.13);
  assert.equal(value.providers.codex.renewsAt, '2026-09-12');
  assert.equal(value.providers['kimi-code'].subscriptionPrice, null);
  assert.equal(value.providers['kimi-code'].subscriptionCurrency, 'usd');
  assert.equal(value.providers['kimi-code'].billingCycle, 'monthly');
  assert.equal(value.providers['kimi-code'].renewsAt, '');
});

test('keeps free and promotional benefits out of paid spend fields', () => {
  const value = normalizeLimitSettings({ providers: {
    cursor: {
      entitlementType: 'free', subscriptionPrice: 20, subscriptionCurrency: 'usd',
      billingCycle: 'monthly', renewsAt: '2026-09-12',
    },
    windsurf: { entitlementType: 'promotion' },
    warp: { entitlementType: 'organization' },
    codex: { entitlementType: 'invalid', subscriptionPrice: null },
  } });
  assert.equal(value.providers.cursor.entitlementType, 'free');
  assert.equal(value.providers.cursor.subscriptionPrice, null);
  assert.equal(value.providers.cursor.renewsAt, '');
  assert.equal(value.providers.windsurf.entitlementType, 'promotion');
  assert.equal(value.providers.warp.entitlementType, 'organization');
  assert.equal(value.providers.codex.entitlementType, 'unknown');
});

test('accepts copied Cookie headers and cURL fragments without retaining unrelated cookies', () => {
  assert.equal(normalizeCookieSecret("curl 'https://cursor.com/api/usage-summary' -H 'Cookie: ignored=x; WorkosCursorSessionToken=user%3A%3Ajwt; theme=dark'", ['WorkosCursorSessionToken']), 'WorkosCursorSessionToken=user%3A%3Ajwt');
  assert.equal(normalizeCookieSecret('Cookie: auth=abc; __Host-auth=def; tracking=no', ['auth', '__Host-auth']), 'auth=abc; __Host-auth=def');
});

test('maps Claude OAuth subscription windows and scoped model limits', () => {
  const result = parseClaudeUsage({
    five_hour: { utilization: 27.5, resets_at: '2026-08-11T16:00:00Z' },
    seven_day: { utilization: 8, resets_at: '2026-08-18T00:00:00Z' },
    limits: [{ percent: 12, resets_at: '2026-08-18T00:00:00Z', scope: { model: { display_name: 'Fable' } } }],
  }, { plan: 'max' }, { now: NOW });
  assert.equal(result.plan, 'max');
  assert.deepEqual(result.windows.map((window) => window.label), ['5 小时', '每周', 'Fable · 每周']);
  assert.equal(result.windows[0].remainingPercent, 72.5);
});

test('maps Cursor plan credits and on-demand allowance from cents', () => {
  const result = parseCursorUsage({
    billingCycleEnd: '2026-09-01T00:00:00Z', membershipType: 'pro',
    individualUsage: {
      plan: { enabled: true, used: 7384, limit: 10000, totalPercentUsed: 73.84 },
      onDemand: { enabled: true, used: 250, limit: 2000 },
    },
  }, { email: 'builder@example.com' }, { now: NOW });
  assert.equal(result.account, 'builder@example.com');
  assert.equal(result.windows[0].value, 73.84);
  assert.equal(result.windows[0].limit, 100);
  assert.equal(result.windows[1].remainingPercent, 87.5);
});

test('maps GitHub Copilot premium and chat quotas without fake unlimited bars', () => {
  const result = parseCopilotUsage({
    copilot_plan: 'pro', quota_reset_date: '2026-09-01T00:00:00Z',
    quota_snapshots: {
      premium_interactions: { entitlement: 300, remaining: 120, percent_remaining: 40 },
      chat: { unlimited: true, entitlement: 0, remaining: 0 },
    },
  }, {}, { now: NOW });
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].usedPercent, 60);
  assert.match(result.notice, /Unlimited/);
});

test('merges Qoder personal and shared credits', () => {
  const result = parseQoderUsage({
    totalQuota: { quotaSummary: { usedValue: 20, limitValue: 100, remainingValue: 80, unit: 'credits' } },
    sharedQuota: { quotaSummary: { usedValue: 10, limitValue: 50, remainingValue: 40, unit: 'credits' } },
    nextResetAt: '2026-09-01T00:00:00Z',
  }, {}, { now: NOW });
  assert.equal(result.windows[0].value, 30);
  assert.equal(result.windows[0].limit, 150);
  assert.equal(result.windows[0].remainingPercent, 80);
});

test('maps OpenCode rolling and weekly quota payloads', () => {
  const result = parseOpenCodeUsage(JSON.stringify({ data: {
    rollingUsage: { usagePercent: 22, resetInSec: 1800 },
    weeklyUsage: { usagePercent: 41, resetInSec: 7200 },
  } }), { now: NOW });
  assert.deepEqual(result.windows.map((window) => window.remainingPercent), [78, 59]);
  assert.equal(result.windows[0].resetsAt, '2026-08-11T12:30:00.000Z');
});

test('OpenCode retries server functions with POST when GET payloads are incomplete', async () => {
  const requests = [];
  const responses = [
    '{}', '{"workspace":"wrk_demo"}', '{}',
    JSON.stringify({ data: {
      rollingUsage: { usagePercent: 10, resetInSec: 300 },
      weeklyUsage: { usagePercent: 20, resetInSec: 600 },
    } }),
  ];
  const result = await fetchOpenCodeLimits({
    settings: { authMode: 'environment', environmentVariable: 'OPENCODE_COOKIE', workspaceId: '' },
    environment: { OPENCODE_COOKIE: 'auth=session' },
    fetcher: async (url, init) => {
      requests.push({ url: String(url), method: init.method, body: init.body });
      return new Response(responses.shift(), { status: 200 });
    },
  });
  assert.deepEqual(requests.map((request) => request.method), ['GET', 'POST', 'GET', 'POST']);
  assert.equal(new URL(requests[1].url).search, '');
  assert.equal(requests[1].body, '[]');
  assert.equal(requests[3].body, '["wrk_demo"]');
  assert.deepEqual(result.windows.map((window) => window.remainingPercent), [90, 80]);
});

test('maps Windsurf local cache quota and legacy counters', () => {
  const quota = parseWindsurfPlan({
    planName: 'Pro', quotaUsage: {
      dailyRemainingPercent: 72, weeklyRemainingPercent: 41,
      dailyResetAtUnix: 1786500000, weeklyResetAtUnix: 1787000000,
    },
  }, { now: NOW });
  assert.equal(quota.plan, 'Pro');
  assert.deepEqual(quota.windows.map((window) => window.remainingPercent), [72, 41]);

  const legacy = parseWindsurfPlan({ usage: {
    messages: 100, usedMessages: 25, flowActions: 50, remainingFlowActions: 30,
  } }, { now: NOW });
  assert.deepEqual(legacy.windows.map((window) => window.usedPercent), [25, 40]);
});

test('maps Codex subscription windows, model-specific limits, spend control, and reset credits', () => {
  const result = parseCodexUsage({
    plan_type: 'pro',
    rate_limit: {
      primary_window: { used_percent: 27, reset_at: 1786500000, limit_window_seconds: 18_000 },
      secondary_window: { used_percent: 5, reset_at: 1787000000, limit_window_seconds: 604_800 },
    },
    individual_limit: { limit: 100, used: 18, reset_at: 1789000000 },
    additional_rate_limits: [{
      limit_name: 'Codex Spark Weekly',
      rate_limit: { secondary_window: { used_percent: 0, reset_at: 1787001000, limit_window_seconds: 604_800 } },
    }],
    credits: { balance: '12.5' },
  }, { email: 'builder@example.com', plan: 'plus' }, {
    now: NOW,
    resetCredits: { available_count: 1, credits: [{ status: 'available', expires_at: '2026-08-12T12:00:00Z' }] },
  });
  assert.equal(result.plan, 'pro');
  assert.equal(result.account, 'builder@example.com');
  assert.equal(result.windows.length, 4);
  assert.equal(result.windows[0].remainingPercent, 73);
  assert.equal(result.windows[0].label, '5 小时');
  assert.equal(result.windows[3].label, 'Codex Spark Weekly · 每周');
  assert.equal(result.balance.value, 12.5);
  assert.equal(result.resetCredits.availableCount, 1);
});

test('maps Kimi Code local and web quota shapes', () => {
  const local = parseKimiCodeUsage({
    usage: { limit: '1000', used: '300', resetTime: '2026-08-18T12:00:00Z' },
    limits: [{ window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' }, detail: { limit: '100', remaining: '80', reset_at: '2026-08-11T15:00:00Z' } }],
  }, { now: NOW });
  assert.equal(local.windows[0].windowSeconds, 18_000);
  assert.equal(local.windows[0].remainingPercent, 80);
  assert.equal(local.windows[1].usedPercent, 30);

  const web = parseKimiWebUsage({
    usages: [{ scope: 'FEATURE_CODING', detail: { limit: '200', used: '40' }, limits: [] }],
  }, {
    subscriptionBalance: { amountUsedRatio: 0.46, expireTime: '2026-09-01T00:00:00Z' },
    ratelimitCode7d: { ratio: 0.25, resetTime: '2026-08-18T00:00:00Z' },
  }, { now: NOW });
  assert.deepEqual(web.windows.map((item) => item.remainingPercent), [80, 75, 54]);
});

test('maps Warp GraphQL request and bonus credits', () => {
  const result = parseWarpUsage({ data: { user: { user: {
    requestLimitInfo: { isUnlimited: false, nextRefreshTime: '2026-08-14T00:00:00Z', requestLimit: 1500, requestsUsedSinceLastRefresh: 684 },
    bonusGrants: [{ requestCreditsGranted: 200, requestCreditsRemaining: 50, expiration: '2026-08-20T00:00:00Z' }],
    workspaces: [],
  } } } }, { now: NOW });
  assert.ok(Math.abs(result.windows[0].remainingPercent - 54.4) < 1e-9);
  assert.equal(result.windows[1].remainingPercent, 25);
  assert.equal(result.windows[1].limit, 200);
});

test('keeps the most constrained Gemini quota bucket per model', () => {
  const result = parseGeminiQuota({ buckets: [
    { modelId: 'gemini-2.5-pro', remainingFraction: 0.8, resetTime: '2026-08-12T00:00:00Z' },
    { modelId: 'gemini-2.5-pro', remainingFraction: 0.45, resetTime: '2026-08-11T18:00:00Z' },
    { modelId: 'gemini-2.5-flash', remainingFraction: 1 },
  ] }, { claims: { email: 'g@example.com' } }, { now: NOW });
  assert.equal(result.account, 'g@example.com');
  assert.equal(result.windows.length, 2);
  assert.equal(result.windows.find((item) => item.id === 'gemini-2.5-pro').remainingPercent, 45);
});

test('groups Antigravity quotas by model family and keeps the tightest model', () => {
  const result = parseAntigravityQuota({ buckets: [
    { modelId: 'gemini-3-pro', remainingFraction: 0.9, resetTime: '2026-08-12T00:00:00Z' },
    { modelId: 'gemini-3-flash', remainingFraction: 0.62, resetTime: '2026-08-11T18:00:00Z' },
    { modelId: 'claude-sonnet-4-5', remainingFraction: 0.74, resetTime: '2026-08-12T00:00:00Z' },
    { modelId: 'gpt-oss-120b', remainingFraction: 0.41, resetTime: '2026-08-11T17:00:00Z' },
  ] }, { email: 'builder@example.com', plan: 'Google AI Pro' }, { now: NOW });
  assert.equal(result.account, 'builder@example.com');
  assert.equal(result.windows.length, 2);
  assert.equal(result.windows[0].remainingPercent, 62);
  assert.equal(result.windows[1].remainingPercent, 41);
  assert.match(result.windows[1].detail, /gpt-oss-120b/);
});

test('parses JetBrains local XML without network access', () => {
  const quota = JSON.stringify({ type: 'PRO', current: '12', maximum: '100', tariffQuota: { available: '88' } }).replaceAll('"', '&quot;');
  const refill = JSON.stringify({ next: '2026-09-01T00:00:00Z' }).replaceAll('"', '&quot;');
  const xml = `<application><component name="AIAssistantQuotaManager2"><option name="quotaInfo" value="${quota}"/><option name="nextRefill" value="${refill}"/></component></application>`;
  const result = parseJetBrainsQuota(xml, { label: 'WebStorm', version: '2026.2' }, { now: NOW });
  assert.equal(result.windows[0].usedPercent, 12);
  assert.equal(result.windows[0].remainingPercent, 88);
  assert.equal(result.source, 'WebStorm 2026.2');
});

test('subscription limit service isolates provider failures and does not expose credentials', async () => {
  clearLimitCache();
  let recorded = null;
  const config = { subscriptionLimits: {
    enabled: true, refreshMinutes: 10,
    providerOrder: ['warp', 'codex'],
    providers: { codex: { enabled: true }, warp: { enabled: true, authMode: 'environment', environmentVariable: 'SECRET_WARP' } },
  } };
  const result = await loadSubscriptionLimits({
    force: true,
    config,
    historyLoader: () => ({ schemaVersion: 1, observations: [] }),
    historyRecorder: (snapshot) => { recorded = snapshot; },
    environment: { SECRET_WARP: 'super-secret-value' },
    fetchers: {
      codex: async () => ({ id: 'codex', label: 'Codex', status: 'ok', windows: [], updatedAt: NOW.toISOString() }),
      warp: async () => { const error = new Error('Warp needs attention'); error.code = 'unauthorized'; throw error; },
    },
  });
  assert.equal(result.providers[0].id, 'warp');
  assert.equal(result.providers[0].error.code, 'unauthorized');
  assert.equal(result.providers[0].quotaCoverage, 'best-effort');
  assert.equal(result.providers[1].id, 'codex');
  assert.equal(result.providers[1].status, 'ok');
  assert.equal(result.summary.needsAttention, 1);
  assert.equal(result.history.observations.length, 0);
  assert.equal(recorded.providers[1].id, 'codex');
  assert.equal(JSON.stringify(result).includes('super-secret-value'), false);
});
