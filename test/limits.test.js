import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLimitSettings, publicLimitSettings } from '../src/limits/catalog.js';
import { normalizeCookieSecret } from '../src/limits/credentials.js';
import { parseClaudeUsage } from '../src/limits/providers/claude.js';
import { parseCodexUsage } from '../src/limits/providers/codex.js';
import {
  fetchCopilotIdentity, parseCopilotUsage, pollCopilotDeviceToken, requestCopilotDeviceCode,
} from '../src/limits/providers/copilot.js';
import { parseCursorUsage } from '../src/limits/providers/cursor.js';
import { parseAntigravityQuota } from '../src/limits/providers/antigravity.js';
import { parseGeminiQuota } from '../src/limits/providers/gemini.js';
import { parseJetBrainsQuota } from '../src/limits/providers/jetbrains.js';
import { parseKimiCodeUsage, parseKimiWebUsage } from '../src/limits/providers/kimi.js';
import { fetchOpenCodeGoLimits, parseOpenCodeGoUsage } from '../src/limits/providers/opencode.js';
import { parseQoderUsage } from '../src/limits/providers/qoder.js';
import { parseWarpUsage } from '../src/limits/providers/warp.js';
import {
  clearLimitCache, createCopilotDeviceController, getPublicLimitSettings,
  loadSubscriptionLimits, saveLimitSettings,
} from '../src/limits/service.js';

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

test('public settings redact local paths and preserve the private value on an unchanged round trip', () => {
  const privatePath = '/Users/sentinel/private/JetBrains2026.2';
  const config = { subscriptionLimits: normalizeLimitSettings({
    providers: { 'jetbrains-ai': { enabled: true, customPath: privatePath } },
  }) };
  const exposed = publicLimitSettings(config.subscriptionLimits, {
    keychainAvailable: false, hasSecret: () => false,
  });
  assert.equal(exposed.providers['jetbrains-ai'].customPathConfigured, true);
  assert.equal(exposed.providers['jetbrains-ai'].customPath.startsWith('/'), false);
  assert.equal(JSON.stringify(exposed).includes(privatePath), false);

  let saved = null;
  const response = saveLimitSettings({ settings: { ...exposed, enabled: true } }, {
    config, save: (value) => { saved = value; }, writeSecret: () => {}, deleteSecret: () => {},
  });
  assert.equal(saved.subscriptionLimits.providers['jetbrains-ai'].customPath, privatePath);
  assert.equal(JSON.stringify(response).includes(privatePath), false);
  assert.equal(response.providers['jetbrains-ai'].customPath.startsWith('/'), false);
});

test('normalizes multi-account settings and keeps OpenCode Cookie separate from Workspace ID', () => {
  const value = normalizeLimitSettings({ providers: {
    opencode: { enabled: true, workspaceId: 'auth=must-not-persist', accounts: [
      { id: 'personal', label: 'Personal', workspaceId: 'https://opencode.ai/workspace/wrk_personal/billing' },
      { id: '../bad', label: 'Bad', workspaceId: 'wrk_bad' },
    ] },
  } });
  assert.equal(value.providers.opencode.workspaceId, '');
  assert.deepEqual(value.providers.opencode.accounts, [{
    id: 'personal', label: 'Personal', externalIdentifier: '', workspaceId: 'wrk_personal',
    entitlementType: 'unknown', subscriptionPrice: null, subscriptionCurrency: 'usd',
    billingCycle: 'monthly', renewsAt: '',
  }]);
  const exposed = publicLimitSettings(value, {
    keychainAvailable: true, hasSecret: (key) => key === 'opencode:personal',
  });
  assert.equal(exposed.providers.opencode.accounts[0].hasSecret, true);
  assert.equal(JSON.stringify(exposed).includes('must-not-persist'), false);
});

test('keeps OpenCode subscription metadata per account and migrates legacy spend only once', () => {
  const migrated = normalizeLimitSettings({ providers: { opencode: {
    entitlementType: 'paid', subscriptionPrice: 20, subscriptionCurrency: 'usd',
    billingCycle: 'monthly', renewsAt: '2026-09-01', activeAccountId: 'work',
    accounts: [
      { id: 'personal', label: 'Personal', workspaceId: 'wrk_personal' },
      { id: 'work', label: 'Work', workspaceId: 'wrk_work' },
    ],
  } } });
  const provider = migrated.providers.opencode;
  assert.equal(provider.entitlementType, 'unknown');
  assert.equal(provider.subscriptionPrice, null);
  assert.equal(provider.accounts[0].entitlementType, 'unknown');
  assert.equal(provider.accounts[0].subscriptionPrice, null);
  assert.equal(provider.accounts[1].entitlementType, 'paid');
  assert.equal(provider.accounts[1].subscriptionPrice, 20);
  assert.equal(provider.accounts[1].renewsAt, '2026-09-01');

  const isolated = normalizeLimitSettings({ providers: { opencode: {
    activeAccountId: 'personal', accounts: [
      {
        id: 'personal', label: 'Personal', workspaceId: 'wrk_personal',
        entitlementType: 'free', subscriptionPrice: 99,
      },
      {
        id: 'work', label: 'Work', workspaceId: 'wrk_work',
        entitlementType: 'paid', subscriptionPrice: 45, subscriptionCurrency: 'cny',
        billingCycle: 'yearly', renewsAt: '2027-01-02',
      },
    ],
  } } });
  assert.equal(isolated.providers.opencode.accounts[0].entitlementType, 'free');
  assert.equal(isolated.providers.opencode.accounts[0].subscriptionPrice, null);
  assert.equal(isolated.providers.opencode.accounts[1].subscriptionPrice, 45);
  assert.equal(isolated.providers.opencode.accounts[1].subscriptionCurrency, 'cny');
  assert.equal(isolated.providers.opencode.accounts[1].billingCycle, 'yearly');
});

test('public settings recognize a saved OpenCode account Cookie after reload', () => {
  const config = { subscriptionLimits: normalizeLimitSettings({ providers: { opencode: {
    enabled: true,
    accounts: [{ id: 'personal', label: 'Personal', workspaceId: 'wrk_personal' }],
    activeAccountId: 'personal',
  } } }) };
  const reads = [];
  const exposed = getPublicLimitSettings(config, {
    keychainAvailable: true,
    readSecret: (key) => {
      reads.push(key);
      return key === 'opencode:personal' ? 'auth=saved-cookie' : null;
    },
  });
  assert.equal(exposed.providers.opencode.accounts[0].hasSecret, true);
  assert.equal(exposed.catalog.find((provider) => provider.id === 'opencode').detection.state, 'configured');
  assert.ok(reads.includes('opencode:personal'));
});

test('saves each account credential under its own key and deletes removed accounts', () => {
  const writes = [];
  const deletes = [];
  let saved;
  const current = { subscriptionLimits: normalizeLimitSettings({ providers: { opencode: {
    accounts: [{ id: 'old', label: 'Old', workspaceId: 'wrk_old' }], activeAccountId: 'old',
  } } }) };
  saveLimitSettings({
    settings: { enabled: true, providers: { opencode: {
      enabled: true, accounts: [{ id: 'new', label: 'New', workspaceId: 'wrk_new' }], activeAccountId: 'new',
    } } },
    accountSecrets: { opencode: { new: 'auth=new-cookie' } },
  }, {
    config: current,
    save: (value) => { saved = value; },
    writeSecret: (key, value) => writes.push([key, value]),
    deleteSecret: (key) => deletes.push(key),
  });
  assert.deepEqual(writes, [['opencode:new', 'auth=new-cookie']]);
  assert.ok(deletes.includes('opencode:old'));
  assert.equal(saved.subscriptionLimits.providers.opencode.accounts[0].workspaceId, 'wrk_new');
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
    qoder: { entitlementType: 'promotion' },
    warp: { entitlementType: 'organization' },
    codex: { entitlementType: 'invalid', subscriptionPrice: null },
  } });
  assert.equal(value.providers.cursor.entitlementType, 'free');
  assert.equal(value.providers.cursor.subscriptionPrice, null);
  assert.equal(value.providers.cursor.renewsAt, '');
  assert.equal(value.providers.qoder.entitlementType, 'promotion');
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

test('Cursor derives a missing total from amount facts instead of averaging unrelated lanes', () => {
  const result = parseCursorUsage({
    billingCycleEnd: '2026-09-01T00:00:00Z',
    individualUsage: {
      plan: {
        enabled: true,
        used: 10,
        limit: 100,
        autoPercentUsed: 10,
        apiPercentUsed: 90,
      },
    },
  }, {}, { now: NOW });
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].id, 'plan');
  assert.equal(result.windows[0].usedPercent, 10);
  assert.equal(result.windows[0].value, 0.1);
  assert.equal(result.windows[0].limit, 1);
});

test('Cursor keeps lane percentages separate when no total amount fact exists', () => {
  const result = parseCursorUsage({
    billingCycleEnd: '2026-09-01T00:00:00Z',
    individualUsage: {
      plan: { enabled: true, autoPercentUsed: 10, apiPercentUsed: 90 },
    },
  }, {}, { now: NOW });
  assert.deepEqual(
    result.windows.map(({ id, usedPercent, value, limit }) => ({ id, usedPercent, value, limit })),
    [
      { id: 'plan-auto', usedPercent: 10, value: null, limit: null },
      { id: 'plan-api', usedPercent: 90, value: null, limit: null },
    ],
  );
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

test('maps GitHub Copilot legacy monthly and limited quota counters', () => {
  const result = parseCopilotUsage({
    copilot_plan: 'free', quota_reset_date: '2026-09-01',
    monthly_quotas: { completions: 50, chat: '25' },
    limited_user_quotas: { completions: 15, chat: '5' },
  }, {}, { now: NOW });
  assert.deepEqual(result.windows.map(({ id, usedPercent, remainingPercent }) => ({
    id, usedPercent, remainingPercent,
  })), [
    { id: 'premium', usedPercent: 70, remainingPercent: 30 },
    { id: 'chat', usedPercent: 80, remainingPercent: 20 },
  ]);
});

test('keeps GitHub Copilot token billing observable without inventing a quota bar', () => {
  const result = parseCopilotUsage({
    copilot_plan: 'business', token_based_billing: true,
    quota_snapshots: { premium_interactions: { unlimited: true, entitlement: 0, remaining: 0 } },
  }, {}, { now: NOW });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.windows, []);
  assert.match(result.notice, /不会用虚假的 100%/);
});

test('uses GitHub device authorization without exposing device secrets', async () => {
  const requests = [];
  const device = await requestCopilotDeviceCode({ fetcher: async (url, init) => {
    requests.push({ url: String(url), body: init.body });
    return new Response(JSON.stringify({
      device_code: 'private-device-code', user_code: 'ABCD-EFGH',
      verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5,
    }), { status: 200 });
  } });
  assert.equal(device.userCode, 'ABCD-EFGH');
  assert.match(requests[0].body, /client_id=/);
  const pending = await pollCopilotDeviceToken({
    deviceCode: device.deviceCode, clientId: device.clientId,
    fetcher: async () => new Response('{"error":"authorization_pending"}', { status: 200 }),
  });
  assert.equal(pending.status, 'pending');
  const identity = await fetchCopilotIdentity('secret-token', { fetcher: async (url, init) => {
    assert.equal(String(url), 'https://api.github.com/user');
    assert.equal(init.headers.Authorization, 'Bearer secret-token');
    return new Response('{"login":"builder","id":42}', { status: 200 });
  } });
  assert.deepEqual(identity, { login: 'builder', id: '42' });
});

test('Copilot device controller stores multiple accounts but never returns OAuth tokens', async () => {
  let config = {};
  const secrets = new Map();
  let identity = 0;
  const controller = createCopilotDeviceController({
    requestCode: async () => ({
      deviceCode: `private-${identity}`, userCode: `CODE-${identity}`, verificationUri: 'https://github.com/login/device',
      expiresIn: 900, interval: 1, clientId: 'client',
    }),
    pollToken: async () => ({ status: 'connected', token: `token-${identity}` }),
    identityLoader: async () => ({ login: `builder-${identity}`, id: String(++identity) }),
    configLoader: () => config,
    configSaver: (next) => { config = next; },
    secretWriter: (key, value) => secrets.set(key, value),
    now: () => 1_000,
  });
  for (let index = 0; index < 2; index += 1) {
    const started = await controller({ action: 'start' });
    assert.equal(started.status, 'pending');
    assert.equal(JSON.stringify(started).includes('private-'), false);
    const connected = await controller({ action: 'poll' });
    assert.equal(connected.status, 'connected');
    assert.equal(JSON.stringify(connected).includes('token-'), false);
  }
  assert.equal(config.subscriptionLimits.providers.copilot.accounts.length, 2);
  assert.equal(secrets.size, 2);
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

test('maps OpenCode Go rolling, weekly, and monthly quota payloads', () => {
  const result = parseOpenCodeGoUsage(JSON.stringify({ data: {
    rollingUsage: { usagePercent: 22, resetInSec: 1800 },
    weeklyUsage: { usagePercent: 41, resetInSec: 7200 },
    monthlyUsage: { usagePercent: 12.5, resetInSec: 172800 },
  } }), { now: NOW });
  assert.equal(result.label, 'OpenCode Go');
  assert.deepEqual(result.windows.map((window) => window.remainingPercent), [78, 59, 87.5]);
  assert.equal(result.windows[0].resetsAt, '2026-08-11T12:30:00.000Z');
});

test('OpenCode Go queries the Workspace paired with its Cookie', async () => {
  const requests = [];
  const result = await fetchOpenCodeGoLimits({
    settings: { authMode: 'environment', environmentVariable: 'OPENCODE_COOKIE', workspaceId: 'wrk_override' },
    environment: { OPENCODE_COOKIE: 'auth=session' },
    fetcher: async (url, init) => {
      requests.push({ url: String(url), method: init.method });
      return new Response('<script>weeklyUsage:{usagePercent:30,resetInSec:600}</script>', { status: 200 });
    },
  });
  assert.deepEqual(requests.map((request) => request.method), ['GET']);
  assert.equal(new URL(requests[0].url).pathname, '/workspace/wrk_override/go');
  assert.equal(result.windows[0].remainingPercent, 70);
});

test('OpenCode Go refuses quota lookup when its account Workspace is missing', async () => {
  let requested = false;
  await assert.rejects(fetchOpenCodeGoLimits({
    settings: { authMode: 'environment', environmentVariable: 'OPENCODE_COOKIE', workspaceId: '' },
    environment: { OPENCODE_COOKIE: 'auth=session' },
    fetcher: async () => { requested = true; return new Response('{}', { status: 200 }); },
  }), (error) => error.code === 'not_configured' && /Workspace ID/.test(error.message));
  assert.equal(requested, false);
});

test('OpenCode Go rejects a malformed Workspace before any network request', async () => {
  let requested = false;
  await assert.rejects(fetchOpenCodeGoLimits({
    settings: { authMode: 'environment', environmentVariable: 'OPENCODE_COOKIE', workspaceId: 'workspace_wrong' },
    environment: { OPENCODE_COOKIE: 'auth=session' },
    fetcher: async () => { requested = true; return new Response('{}', { status: 200 }); },
  }), (error) => error.code === 'not_configured');
  assert.equal(requested, false);
});

test('OpenCode Go keeps each Cookie paired with its own Workspace request', async () => {
  const pairs = [];
  for (const [workspaceId, cookie] of [['wrk_personal', 'auth=personal'], ['wrk_work', 'auth=work']]) {
    await fetchOpenCodeGoLimits({
      settings: { authMode: 'environment', environmentVariable: 'OPENCODE_COOKIE', workspaceId },
      environment: { OPENCODE_COOKIE: cookie },
      fetcher: async (url, init) => {
        pairs.push([new URL(url).pathname, init.headers.Cookie]);
        return new Response('<script>weeklyUsage:{usagePercent:30,resetInSec:600}</script>', { status: 200 });
      },
    });
  }
  assert.deepEqual(pairs, [
    ['/workspace/wrk_personal/go', 'auth=personal'],
    ['/workspace/wrk_work/go', 'auth=work'],
  ]);
});

test('normalizes OpenCode Go fractional percentages and used-limit payloads', () => {
  const result = parseOpenCodeGoUsage(JSON.stringify({ data: {
    rollingWindow: { utilization: 0.25, resetInSeconds: 300 },
    weeklyWindow: { used: 30, limit: 120, resetsInSeconds: 600 },
  } }), { now: NOW });
  assert.deepEqual(result.windows.map((window) => window.usedPercent), [25, 25]);
});

test('parses OpenCode Go usage embedded as quoted JSON inside an HTML page', () => {
  const result = parseOpenCodeGoUsage('<script>window.data={"rollingUsage":{"usagePercent":18,"resetInSec":120},"weeklyUsage":{"usagePercent":33,"resetInSec":600}}</script>', { now: NOW });
  assert.deepEqual(result.windows.map((window) => window.remainingPercent), [82, 67]);
  assert.equal(result.windows[0].resetsAt, '2026-08-11T12:02:00.000Z');
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

test('Codex reset-credit parsing preserves real zero and leaves invalid counts unknown', () => {
  const payload = { rate_limit: { primary_window: {
    used_percent: 27, reset_at: 1786500000, limit_window_seconds: 18_000,
  } } };
  assert.equal(parseCodexUsage(payload, {}, {
    now: NOW, resetCredits: { available_count: 0 },
  }).resetCredits.availableCount, 0);
  assert.equal(parseCodexUsage(payload, {}, {
    now: NOW, resetCredits: { available_count: '0' },
  }).resetCredits.availableCount, null);
  assert.equal(parseCodexUsage(payload, {}, {
    now: NOW, resetCredits: null,
  }).resetCredits, null);
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
      codex: async () => ({
        id: 'codex', label: 'Codex', status: 'ok', windows: [], updatedAt: NOW.toISOString(),
        account: 'builder@example.com', source: '/Users/private/.codex/auth.json',
        credential: 'sentinel-provider-secret', rawResponse: { token: 'sentinel-provider-secret' },
      }),
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
  assert.equal(JSON.stringify(result).includes('sentinel-provider-secret'), false);
  assert.equal(JSON.stringify(result).includes('/Users/private'), false);
  assert.equal(result.providers[1].account, 'b•••@example.com');
  assert.deepEqual(Object.keys(result.providers[1]), [
    'id', 'label', 'status', 'account', 'plan', 'source', 'notice', 'resetCredits',
    'updatedAt', 'windows', 'quotaCoverage',
  ]);
});

test('subscription limit service queries and isolates every configured account', async () => {
  clearLimitCache();
  const seen = [];
  const result = await loadSubscriptionLimits({
    force: true,
    config: { subscriptionLimits: {
      enabled: true, providerOrder: ['opencode'], providers: { opencode: {
        enabled: true, accounts: [
          { id: 'personal', label: 'Personal', workspaceId: 'wrk_personal' },
          { id: 'work', label: 'Work', workspaceId: 'wrk_work' },
        ], activeAccountId: 'work',
      } },
    } },
    historyLoader: () => ({ schemaVersion: 1, observations: [] }),
    historyRecorder: () => {},
    fetchers: { opencode: async ({ settings }) => {
      seen.push([settings.accountId, settings.workspaceId, settings.credentialKey]);
      return {
        id: 'opencode', label: 'OpenCode Go', status: 'ok', updatedAt: NOW.toISOString(),
        account: settings.accountLabel, source: 'test', windows: [{
          id: 'weekly', label: 'Weekly', usedPercent: settings.accountId === 'work' ? 70 : 20,
          remainingPercent: settings.accountId === 'work' ? 30 : 80,
        }],
      };
    } },
  });
  assert.deepEqual(seen, [
    ['personal', 'wrk_personal', 'opencode:personal'],
    ['work', 'wrk_work', 'opencode:work'],
  ]);
  assert.equal(result.providers[0].activeAccountId, 'work');
  assert.equal(result.providers[0].windows[0].usedPercent, 70);
  assert.deepEqual(result.providers[0].accounts.map((account) => account.accountId), ['personal', 'work']);
});

test('subscription limit service never queries an incomplete OpenCode account', async () => {
  clearLimitCache();
  let requested = false;
  const result = await loadSubscriptionLimits({
    force: true,
    config: { subscriptionLimits: {
      enabled: true, providerOrder: ['opencode'], providers: { opencode: {
        enabled: true,
        accounts: [{ id: 'unnamed', label: '', workspaceId: 'wrk_personal' }],
        activeAccountId: 'unnamed',
      } },
    } },
    historyLoader: () => ({ schemaVersion: 1, observations: [] }),
    historyRecorder: () => {},
    fetchers: { opencode: async () => { requested = true; } },
  });
  assert.equal(requested, false);
  assert.equal(result.providers[0].accounts[0].status, 'error');
  assert.equal(result.providers[0].accounts[0].error.code, 'not_configured');
});
