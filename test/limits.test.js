import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { normalizeLimitSettings, publicLimitSettings } from '../src/limits/catalog.js';
import { normalizeCookieSecret } from '../src/limits/credentials.js';
import { parseClaudeUsage } from '../src/limits/providers/claude.js';
import { parseCodexUsage } from '../src/limits/providers/codex.js';
import {
  fetchCopilotIdentity, parseCopilotUsage, pollCopilotDeviceToken, requestCopilotDeviceCode,
} from '../src/limits/providers/copilot.js';
import { parseCursorUsage } from '../src/limits/providers/cursor.js';
import { fetchAntigravityLimits, parseAntigravityQuota } from '../src/limits/providers/antigravity.js';
import { fetchDeepSeekLimits, parseDeepSeekBalance } from '../src/limits/providers/deepseek.js';
import { parseJetBrainsQuota } from '../src/limits/providers/jetbrains.js';
import { fetchKimiLimits, parseKimiCodeUsage, parseKimiWebUsage } from '../src/limits/providers/kimi.js';
import { fetchKiroLimits, loadKiroCredentials, parseKiroUsage } from '../src/limits/providers/kiro.js';
import { fetchOpenCodeGoLimits, parseOpenCodeGoUsage } from '../src/limits/providers/opencode.js';
import { parseQoderUsage } from '../src/limits/providers/qoder.js';
import { parseWarpUsage } from '../src/limits/providers/warp.js';
import {
  clearLimitCache, createCopilotDeviceController, getPublicLimitSettings,
  loadSubscriptionLimits, saveLimitSettings,
} from '../src/limits/service.js';
import {
  buildBenefitCapacityOverview, buildSubscriptionInsights, kimiMonthlyBlocking,
} from '../dashboard/src/subscription-insights.js';

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

test('retires Gemini quota settings without losing the user-declared Antigravity benefit', () => {
  const value = normalizeLimitSettings({
    providerOrder: ['codex', 'gemini-cli', 'antigravity', 'kimi-code'],
    providers: {
      'gemini-cli': {
        enabled: true, entitlementType: 'paid', subscriptionPrice: 19.99,
        subscriptionCurrency: 'usd', billingCycle: 'monthly', renewsAt: '2026-09-01',
      },
      antigravity: { enabled: false, authMode: 'local', entitlementType: 'unknown' },
    },
  });
  assert.equal(value.providers['gemini-cli'], undefined);
  assert.equal(value.providerOrder.includes('gemini-cli'), false);
  assert.equal(value.providerOrder.indexOf('antigravity'), 1);
  assert.equal(value.providers.antigravity.enabled, false);
  assert.equal(value.providers.antigravity.entitlementType, 'paid');
  assert.equal(value.providers.antigravity.subscriptionPrice, 19.99);
  assert.equal(value.providers.antigravity.renewsAt, '2026-09-01');
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
    id: 'personal', label: 'Personal', externalIdentifier: '', connectionType: 'workspace', workspaceId: 'wrk_personal',
    entitlementType: 'unknown', subscriptionPrice: null, subscriptionCurrency: 'usd',
    billingCycle: 'monthly', renewsAt: '',
  }]);
  const exposed = publicLimitSettings(value, {
    keychainAvailable: true, hasSecret: (key) => key === 'opencode:personal',
  });
  assert.equal(exposed.providers.opencode.accounts[0].hasSecret, true);
  assert.equal(JSON.stringify(exposed).includes('must-not-persist'), false);
});

test('normalizes OpenCode API key accounts without requiring or retaining a Workspace', () => {
  const value = normalizeLimitSettings({ providers: { opencode: {
    enabled: true,
    accounts: [{
      id: 'api', label: 'API account', connectionType: 'api-key',
      workspaceId: 'not-a-workspace', entitlementType: 'free',
    }],
  } } });
  assert.equal(value.providers.opencode.accounts[0].connectionType, 'api-key');
  assert.equal(value.providers.opencode.accounts[0].workspaceId, '');
  assert.equal(value.providers.opencode.accounts[0].entitlementType, 'free');
});

test('does not leak OpenCode connection fields into other account providers', () => {
  const value = normalizeLimitSettings({ providers: { copilot: {
    accounts: [{ id: 'github', label: 'GitHub', externalIdentifier: 'octocat' }],
  } } });
  assert.equal(Object.hasOwn(value.providers.copilot.accounts[0], 'connectionType'), false);
  assert.equal(value.providers.copilot.accounts[0].workspaceId, '');
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
    detectCredentials: true,
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

test('public settings recognize a saved OpenCode API-key account without a Workspace', () => {
  const config = { subscriptionLimits: normalizeLimitSettings({ providers: { opencode: {
    enabled: true,
    accounts: [{ id: 'api', label: 'API account', connectionType: 'api-key' }],
    activeAccountId: 'api',
  } } }) };
  const exposed = getPublicLimitSettings(config, {
    detectCredentials: true,
    keychainAvailable: true,
    readSecret: (key) => key === 'opencode:api' ? 'sk-opencode-test' : null,
  });
  assert.equal(exposed.providers.opencode.accounts[0].workspaceId, '');
  assert.equal(exposed.providers.opencode.accounts[0].hasSecret, true);
  assert.equal(exposed.catalog.find((provider) => provider.id === 'opencode').detection.state, 'configured');
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

test('OpenCode Go API key accounts use the official usage endpoint without a Workspace', async () => {
  const requests = [];
  const result = await fetchOpenCodeGoLimits({
    settings: {
      authMode: 'environment', environmentVariable: 'OPENCODE_API_KEY',
      connectionType: 'api-key', workspaceId: '', accountLabel: 'Personal',
    },
    environment: { OPENCODE_API_KEY: 'go_secret' },
    fetcher: async (url, init) => {
      requests.push({ url: String(url), authorization: init.headers.Authorization });
      return new Response(JSON.stringify({ usage: {
        rolling: { percent: 18, resetsAt: '2026-08-12T02:00:00.000Z' },
        weekly: { percent: 33, resetsAt: '2026-08-18T00:00:00.000Z' },
      } }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(new URL(requests[0].url).pathname, '/zen/go/v1/usage');
  assert.equal(requests[0].authorization, 'Bearer go_secret');
  assert.deepEqual(result.windows.map((window) => window.remainingPercent), [82, 67]);
  assert.match(result.notice, /官方 API/);
});

test('OpenCode Go API key mode fails before network access when the key is missing', async () => {
  let requested = false;
  await assert.rejects(fetchOpenCodeGoLimits({
    settings: { authMode: 'environment', environmentVariable: 'OPENCODE_API_KEY', connectionType: 'api-key' },
    environment: {},
    fetcher: async () => { requested = true; return new Response('{}'); },
  }), (error) => error.code === 'not_configured');
  assert.equal(requested, false);
});

test('OpenCode Go API key 403 becomes an empty state with a machine-readable notEntitled reason', async () => {
  // A valid key without an active Go subscription is not a login failure: the
  // client gets the reason instead of parsing prose or a neutral error.
  let requested = 0;
  const result = await fetchOpenCodeGoLimits({
    settings: {
      authMode: 'environment', environmentVariable: 'OPENCODE_API_KEY',
      connectionType: 'api-key', workspaceId: '', accountLabel: 'Personal',
    },
    environment: { OPENCODE_API_KEY: 'go_secret' },
    fetcher: async () => {
      requested += 1;
      return new Response(JSON.stringify({ code: 'forbidden' }), { status: 403 });
    },
  });
  assert.equal(requested, 1);
  assert.equal(result.status, 'empty');
  assert.equal(result.emptyReason, 'notEntitled');
  assert.deepEqual(result.windows, []);
  assert.match(result.notice, /订阅/);
});

test('OpenCode Go API key 401 stays an unauthorized error instead of an empty state', async () => {
  await assert.rejects(fetchOpenCodeGoLimits({
    settings: { authMode: 'environment', environmentVariable: 'OPENCODE_API_KEY', connectionType: 'api-key' },
    environment: { OPENCODE_API_KEY: 'go_secret' },
    fetcher: async () => new Response('{}', { status: 401 }),
  }), (error) => error.code === 'unauthorized');
});

test('reads Kiro CLI token and profile from its read-only SQLite state', () => {
  const payload = Buffer.from(JSON.stringify({ exp: 4_102_444_800 })).toString('base64url');
  const token = `header.${payload}.signature`;
  const seen = [];
  const credentials = loadKiroCredentials({ KIRO_DATA_DIR: '/safe/kiro' }, {
    exists: () => true,
    query: (path, sql) => {
      seen.push([path, sql]);
      if (sql.includes('auth_kv')) return [{ value: JSON.stringify({ access_token: token }) }];
      return [{ value: JSON.stringify({ arn: 'arn:aws:codewhisperer:us-east-1:123:profile/test' }) }];
    },
  });
  assert.equal(credentials.found, true);
  assert.equal(credentials.fresh, true);
  assert.equal(credentials.profileArn, 'arn:aws:codewhisperer:us-east-1:123:profile/test');
  assert.equal(seen[0][0], join(resolve('/safe/kiro'), 'data.sqlite3'));
  assert.equal(seen.length, 2);
});

test('maps Kiro plan and overage credits without treating them as Token quota', () => {
  const result = parseKiroUsage({
    usageBreakdownList: [{
      resourceType: 'CREDIT', currentUsageWithPrecision: 48, usageLimitWithPrecision: 100,
      currentOveragesWithPrecision: 8, overageCapWithPrecision: 20,
      nextDateReset: 1_788_220_800, bonuses: [],
    }],
    overageConfiguration: { overageStatus: 'ENABLED' },
  }, {}, { now: NOW });
  assert.deepEqual(result.windows.map((window) => [window.id, window.value, window.limit]), [
    ['monthly', 40, 100], ['overage', 8, 20],
  ]);
  assert.deepEqual(result.windows.map((window) => window.remainingPercent), [60, 60]);
  assert.equal(result.windows[0].unit, 'credits');
});

test('Kiro rejects invalid overage components instead of turning them into zero or hiding them', () => {
  const payload = (overrides) => ({
    usageBreakdownList: [{
      resourceType: 'CREDIT', currentUsageWithPrecision: 48, usageLimitWithPrecision: 100,
      currentOveragesWithPrecision: 8, overageCapWithPrecision: 20,
      nextDateReset: 1_788_220_800, bonuses: [], ...overrides,
    }],
    overageConfiguration: { overageStatus: 'ENABLED' },
  });
  for (const input of [
    payload({ currentOveragesWithPrecision: -5 }),
    payload({ overageCapWithPrecision: -1 }),
    payload({ currentOveragesWithPrecision: 21 }),
  ]) {
    assert.throws(
      () => parseKiroUsage(input, {}, { now: NOW }),
      (error) => error?.code === 'invalid_response',
    );
  }
});

test('Kiro bonus credits suppress an unverifiable plan split', () => {
  const result = parseKiroUsage({
    usageBreakdownList: [{
      resourceType: 'CREDIT', currentUsageWithPrecision: 70, usageLimitWithPrecision: 100,
      currentOveragesWithPrecision: 5, overageCapWithPrecision: 20,
      nextDateReset: 1_788_220_800,
      bonuses: [{ amount: 25 }],
    }],
    overageConfiguration: { overageStatus: 'ENABLED' },
  }, {}, { now: NOW });
  assert.deepEqual(result.windows.map((window) => window.id), ['overage']);
  assert.match(result.notice, /无法可靠拆分/);
});

test('Kiro quota lookup uses the official API contract and local CLI login only', async () => {
  const seen = [];
  const result = await fetchKiroLimits({
    credentialLoader: () => ({
      found: true, fresh: true, accessToken: 'kiro-token',
      profileArn: 'arn:aws:codewhisperer:us-east-1:123:profile/test',
    }),
    fetcher: async (url, init) => {
      seen.push({ url: String(url), init });
      return new Response(JSON.stringify({ usageBreakdownList: [{
        resourceType: 'CREDIT', currentUsageWithPrecision: 25, usageLimitWithPrecision: 100,
        nextDateReset: 1_788_220_800,
      }] }), { status: 200 });
    },
  });
  assert.equal(new URL(seen[0].url).hostname, 'codewhisperer.us-east-1.amazonaws.com');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer kiro-token');
  assert.equal(seen[0].init.headers['X-Amz-Target'], 'AmazonCodeWhispererService.GetUsageLimits');
  assert.deepEqual(JSON.parse(seen[0].init.body), {
    profileArn: 'arn:aws:codewhisperer:us-east-1:123:profile/test',
  });
  assert.equal(result.windows[0].remainingPercent, 75);
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
    user: { membership: { level: 'LEVEL_ADVANCED' } }, version: 'GOODS_VERSION_V1',
  }, { now: NOW });
  assert.equal(local.plan, 'Allegro');
  assert.equal(local.windows[0].windowSeconds, 18_000);
  assert.equal(local.windows[0].label, '5 小时滚动（5H 频限）');
  assert.equal(local.windows[0].remainingPercent, 80);
  assert.equal(local.windows[1].label, '每周');
  assert.equal(local.windows[1].usedPercent, 30);
  assert.match(local.notice, /只显示接口返回的窗口/);

  const web = parseKimiWebUsage({
    usages: [{
      scope: 'FEATURE_CODING', detail: { limit: '200', used: '40' },
      limits: [{
        window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' },
        detail: { limit: '100', remaining: '80', resetTime: '2026-08-11T15:00:00Z' },
      }],
    }],
  }, {
    subscriptionBalance: { amountUsedRatio: 0.46, expireTime: '2026-09-01T00:00:00Z' },
    ratelimitCode7d: { ratio: 0.25, resetTime: '2026-08-18T00:00:00Z' },
  }, { now: NOW, planPayload: { subscription: {
    active: true, status: 'SUBSCRIPTION_STATUS_ACTIVE', goods: { title: 'Kimi Code Max' },
  } } });
  assert.equal(web.plan, 'Kimi Code Max');
  assert.deepEqual(web.windows.map((item) => item.remainingPercent), [80, 80, 75, 54]);
  assert.equal(web.windows[0].label, '5 小时滚动（5H 频限）');
  assert.equal(web.windows[1].label, '每周');
  assert.equal(web.windows[2].label, 'Code 每周');
});

test('parses the Kimi Code 2.x keyed usages response', () => {
  const result = parseKimiCodeUsage({
    usages: {
      limit_5h: { used_ratio: 0.3, reset_time: '2026-08-11T18:00:00Z' },
      limit_7d: { used_ratio: 0.2, resetTime: '2026-08-17T00:00:00Z' },
      limit_month_total: { used_ratio: 0.4, reset_at: '2026-09-01T00:00:00Z' },
      limit_month_code: { used_ratio: '0.25', reset_in: 7_200 },
    },
    user: { membership: { level: 'LEVEL_ADVANCED' } },
  }, { now: NOW });
  assert.equal(result.status, 'ok');
  assert.equal(result.plan, 'Allegro');
  assert.deepEqual(result.windows.map((window) => window.id),
    ['session', 'weekly', 'month-total', 'month-code']);
  assert.deepEqual(result.windows.map((window) => window.usedPercent), [30, 20, 40, 25]);
  result.windows.forEach((window) => {
    assert.ok(Math.abs(window.usedPercent + window.remainingPercent - 100) < 0.001);
  });
  assert.equal(result.windows[0].windowSeconds, 18_000);
  assert.equal(result.windows[1].windowSeconds, 604_800);
  assert.equal(result.windows[2].windowSeconds, null);
  assert.equal(result.windows[3].windowSeconds, null);
  assert.equal(result.windows[0].resetsAt, '2026-08-11T18:00:00.000Z');
  assert.equal(result.windows[2].resetsAt, '2026-09-01T00:00:00.000Z');
  assert.equal(result.windows[3].resetsAt, new Date(NOW.getTime() + 7_200_000).toISOString());
  assert.match(result.notice, /未返回周额度不代表查询失败/);
  assert.doesNotMatch(result.notice, /Kimi Web 登录令牌/);

  // A hybrid response keeps one window per id and the keyed map wins it.
  const hybrid = parseKimiCodeUsage({
    usages: { limit_5h: { used_ratio: 0.3, reset_time: '2026-08-11T18:00:00Z' } },
    limits: [{ window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' }, detail: { limit: '100', remaining: '80' } }],
    usage: { limit: '100', used: '10' },
  }, { now: NOW });
  assert.deepEqual(hybrid.windows.map((window) => window.id), ['session', 'weekly']);
  assert.equal(hybrid.windows[0].usedPercent, 30);

  // Ratios that are missing or unparseable are skipped, not guessed.
  assert.deepEqual(parseKimiCodeUsage({
    usages: { limit_5h: { reset_time: '2026-08-11T18:00:00Z' }, limit_7d: { used_ratio: 'soon' } },
  }, { now: NOW }).status, 'empty');
});

test('Kimi monthly pool exhaustion projects shorter windows as blocked while raw observations stay intact', () => {
  const snapshot = parseKimiCodeUsage({
    usages: {
      limit_5h: { used_ratio: 0.2, reset_time: '2026-08-11T15:00:00Z' },
      limit_7d: { used_ratio: 0.3, resetTime: '2026-08-17T00:00:00Z' },
      limit_month_total: { used_ratio: 1, reset_at: '2026-09-01T00:00:00Z' },
      limit_month_code: { used_ratio: 0.9 },
    },
    user: { membership: { level: 'LEVEL_ADVANCED' } },
  }, { now: NOW });
  const insight = buildSubscriptionInsights(
    { generatedAt: NOW.toISOString(), buckets: [] },
    { generatedAt: NOW.toISOString(), providers: [snapshot] });
  const windows = Object.fromEntries(insight.providers[0].windows.map((window) => [window.id, window]));
  // The blocked state is a derived display marker: raw percents survive and
  // are never rewritten into the projection.
  assert.equal(windows.session.blockedByMonthly, true);
  assert.equal(windows.session.usedPercent, 20);
  assert.equal(windows.session.blockedResetsAt, '2026-09-01T00:00:00.000Z');
  assert.equal(windows.session.pace, null);
  assert.equal(windows.weekly.blockedByMonthly, true);
  assert.equal(windows['month-total'].blockedByMonthly, undefined);
  assert.equal(windows['month-code'].blockedByMonthly, undefined);

  // Blocked windows cannot advertise "available before reset"; the monthly
  // pool itself still lists in the reset overview.
  const overview = buildBenefitCapacityOverview(insight.providers, NOW.getTime());
  assert.equal(overview.resetRows.some((row) => row.windowId === 'session'), false);
  assert.equal(overview.resetRows.some((row) => row.windowId === 'month-total'), true);

  // An unknown monthly reset must not promise an earlier recovery time.
  const unknownReset = buildSubscriptionInsights(
    { generatedAt: NOW.toISOString(), buckets: [] },
    { generatedAt: NOW.toISOString(), providers: [parseKimiCodeUsage({
      usages: { limit_5h: { used_ratio: 0.2 }, limit_month_total: { used_ratio: 1 } },
    }, { now: NOW })] });
  const unknownSession = unknownReset.providers[0].windows.find((window) => window.id === 'session');
  assert.equal(unknownSession.blockedByMonthly, true);
  assert.equal(unknownSession.blockedResetsAt, null);

  // Available or already-reset monthly pools never block.
  assert.equal(kimiMonthlyBlocking([
    { id: 'month-total', remainingPercent: 0.1, resetsAt: null },
  ], { now: NOW.getTime() }), null);
  assert.equal(kimiMonthlyBlocking([
    { id: 'month-total', remainingPercent: 0, resetsAt: '2026-08-11T11:00:00Z' },
    { id: 'session', remainingPercent: 100, resetsAt: null },
  ], { now: NOW.getTime() }), null);
  const blocking = kimiMonthlyBlocking([
    { id: 'month-total', remainingPercent: 0, resetsAt: '2026-09-01T00:00:00Z' },
    { id: 'month-code', remainingPercent: 0, resetsAt: '2026-08-20T00:00:00Z' },
    { id: 'session', remainingPercent: 80, resetsAt: '2026-08-11T15:00:00Z' },
    { id: 'weekly', remainingPercent: 70, resetsAt: '2026-08-17T00:00:00Z' },
  ], { now: NOW.getTime() });
  assert.equal(blocking.resetsAt, '2026-09-01T00:00:00.000Z'); // latest blocker horizon
  assert.deepEqual([...blocking.windowIds].sort(), ['session', 'weekly']);

  // The Kimi Web subscription total binds the shorter windows the same way.
  const web = parseKimiWebUsage({
    usages: [{ scope: 'FEATURE_CODING', limits: [{
      window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' },
      detail: { limit: '100', remaining: '80', resetTime: '2026-08-11T15:00:00Z' },
    }] }],
  }, { subscriptionBalance: { amountUsedRatio: 1, expireTime: '2026-09-01T00:00:00Z' } }, { now: NOW });
  const webInsight = buildSubscriptionInsights(
    { generatedAt: NOW.toISOString(), buckets: [] },
    { generatedAt: NOW.toISOString(), providers: [web] });
  const webWindows = Object.fromEntries(webInsight.providers[0].windows.map((window) => [window.id, window]));
  assert.equal(webWindows.session.blockedByMonthly, true);
  assert.equal(webWindows.session.usedPercent, 20);
  assert.equal(webWindows.total.blockedByMonthly, undefined);
});

test('Kimi preserves completed optional subscription facts when another enrichment fails', async () => {
  const usage = {
    usages: [{
      scope: 'FEATURE_CODING', detail: { limit: '200', used: '40' },
      limits: [{
        window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' },
        detail: { limit: '100', remaining: '80' },
      }],
    }],
  };
  const fetchWith = (failedEndpoint) => fetchKimiLimits({
    settings: { authMode: 'environment', environmentVariable: 'KIMI_TEST_TOKEN' },
    environment: { KIMI_TEST_TOKEN: 'test-token' },
    fetcher: async (url) => {
      const endpoint = String(url);
      if (endpoint.includes('GetUsages')) return new Response(JSON.stringify(usage), { status: 200 });
      if (new URL(endpoint).pathname.endsWith(failedEndpoint)) {
        return new Response('{"error":"unavailable"}', { status: 503 });
      }
      if (endpoint.includes('GetSubscriptionStats')) return new Response(JSON.stringify({
        subscriptionBalance: { amountUsedRatio: 0.4 },
      }), { status: 200 });
      if (endpoint.includes('GetSubscription')) return new Response(JSON.stringify({ subscription: {
        active: true, status: 'SUBSCRIPTION_STATUS_ACTIVE', goods: { title: 'Kimi Code Ultra' },
      } }), { status: 200 });
      throw new Error(`unexpected endpoint ${endpoint}`);
    },
  });

  const withoutStats = await fetchWith('GetSubscriptionStats');
  assert.equal(withoutStats.plan, 'Kimi Code Ultra');
  assert.equal(withoutStats.windows.some((window) => window.id === 'total'), false);

  const withoutPlan = await fetchWith('GetSubscription');
  assert.equal(withoutPlan.plan, null);
  assert.equal(withoutPlan.windows.find((window) => window.id === 'total')?.usedPercent, 40);
});

test('Kimi keeps unknown membership levels without inventing a plan name', () => {
  assert.equal(parseKimiCodeUsage({
    usage: { limit: '100', used: '1' },
    user: { membership: { level: 'LEVEL_FUTURE' } }, version: 'GOODS_VERSION_V2',
  }, { now: NOW }).plan, 'LEVEL_FUTURE');
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

test('maps Antigravity local quota summary to exact five-hour and weekly pools', () => {
  const result = parseAntigravityQuota({ response: { groups: [
    { displayName: 'Gemini Models', buckets: [
      { bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.9, resetTime: '2026-08-18T00:00:00Z' },
      { bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.62, resetTime: '2026-08-11T15:00:00Z' },
    ] },
    { displayName: 'Claude and GPT models', buckets: [
      { bucketId: '3p-weekly', window: 'weekly', remainingFraction: 0.74, resetTime: '2026-08-18T00:00:00Z' },
      { bucketId: '3p-5h', window: '5h', remainingFraction: 0.41, resetTime: '2026-08-11T14:00:00Z' },
    ] },
  ] } }, { source: 'agy 本机服务' }, { now: NOW });
  assert.deepEqual(result.windows.map((item) => item.id), ['gemini-5h', 'gemini-weekly', '3p-5h', '3p-weekly']);
  assert.deepEqual(result.windows.map((item) => item.windowSeconds), [18_000, 604_800, 18_000, 604_800]);
  assert.deepEqual(result.windows.map((item) => item.remainingPercent), [62, 90, 41, 74]);
  assert.equal(result.source, 'agy 本机服务');
});

test('maps DeepSeek currency balances without inventing a Token quota window', () => {
  const result = parseDeepSeekBalance({
    is_available: true,
    balance_infos: [
      { currency: 'USD', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' },
      { currency: 'CNY', total_balance: '42.50', granted_balance: '2.50', topped_up_balance: '40.00' },
    ],
  }, { now: NOW });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.windows, []);
  assert.deepEqual(result.balances.map((balance) => balance.currency), ['CNY', 'USD']);
  assert.deepEqual(result.balances[0], {
    currency: 'CNY', total: 42.5, granted: 2.5, toppedUp: 40, available: true,
  });
  assert.match(result.notice, /货币余额/);
  assert.match(result.notice, /不提供 Token/);
});

test('DeepSeek balance parser fails closed on malformed money or duplicate currencies', () => {
  assert.throws(() => parseDeepSeekBalance({
    is_available: true,
    balance_infos: [{
      currency: 'CNY', total_balance: 'secret', granted_balance: '0', topped_up_balance: '0',
    }],
  }), (error) => error?.code === 'invalid_response');
  assert.throws(() => parseDeepSeekBalance({
    is_available: false,
    balance_infos: [
      { currency: 'USD', total_balance: '0', granted_balance: '0', topped_up_balance: '0' },
      { currency: 'usd', total_balance: '0', granted_balance: '0', topped_up_balance: '0' },
    ],
  }), (error) => error?.code === 'invalid_response');
});

test('DeepSeek balance fetch uses only the public endpoint and configured API key', async () => {
  const requests = [];
  const result = await fetchDeepSeekLimits({
    settings: { authMode: 'environment', environmentVariable: 'DEEPSEEK_TEST_KEY' },
    environment: { DEEPSEEK_TEST_KEY: 'test-only-key' },
    fetcher: async (url, init) => {
      requests.push({ url: String(url), authorization: init.headers.Authorization, method: init.method });
      return new Response(JSON.stringify({
        is_available: true,
        balance_infos: [{
          currency: 'USD', total_balance: '9.25', granted_balance: '1.25', topped_up_balance: '8.00',
        }],
      }), { status: 200 });
    },
  });
  assert.deepEqual(requests, [{
    url: 'https://api.deepseek.com/user/balance', authorization: 'Bearer test-only-key', method: 'GET',
  }]);
  assert.equal(result.source, 'DeepSeek 环境变量');
  assert.equal(result.balances[0].total, 9.25);
  assert.equal(JSON.stringify(result).includes('test-only-key'), false);
});

test('prefers a running agy loopback quota service without reading OAuth credentials', async () => {
  const calls = [];
  const run = (command) => {
    if (command === 'ps') return { status: 0, stdout: '71061 /Users/test/.local/bin/agy\n' };
    if (command === 'lsof') return { status: 0, stdout: 'agy 71061 user 10u IPv4 0t0 TCP 127.0.0.1:63130 (LISTEN)\n' };
    return { status: 1, stdout: '' };
  };
  const localRequester = async (request) => {
    calls.push(request);
    return { response: { groups: [{ displayName: 'Gemini Models', buckets: [
      { bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.5 },
    ] }] } };
  };
  const result = await fetchAntigravityLimits({
    settings: { authMode: 'local' }, environment: { CODEXBAR_HOME: '/definitely/absent' },
    run, platform: 'darwin', localRequester,
  });
  assert.equal(result.source, 'agy 本机服务');
  assert.equal(result.windows[0].id, 'gemini-5h');
  assert.equal(calls[0].port, 63130);
  assert.equal(calls[0].protocol, 'https:');
  assert.match(calls[0].path, /RetrieveUserQuotaSummary$/);
});

const idTokenWith = (payload) => [
  Buffer.from('{"alg":"none"}').toString('base64url'),
  Buffer.from(JSON.stringify(payload)).toString('base64url'),
  'test-signature',
].join('.');

test('Antigravity OAuth path prefers the grouped quota summary endpoint with Starter weekly pools', async () => {
  const requested = [];
  const result = await fetchAntigravityLimits({
    settings: { authMode: 'environment', environmentVariable: 'ANTIGRAVITY_TEST_OAUTH' },
    environment: { ANTIGRAVITY_TEST_OAUTH: JSON.stringify({
      access_token: 'synthetic-access-token', project_id: 'synthetic-project',
      id_token: idTokenWith({ email: 'builder@example.com' }),
    }) },
    fetcher: async (url, init) => {
      requested.push(new URL(url).pathname);
      assert.equal(new URL(url).hostname, String(url).includes('retrieveUserQuotaSummary')
        ? 'daily-cloudcode-pa.googleapis.com' : 'cloudcode-pa.googleapis.com');
      assert.equal(init.headers.Authorization, 'Bearer synthetic-access-token');
      if (String(url).includes('loadCodeAssist')) {
        return new Response(JSON.stringify({ planInfo: { planType: 'starter' } }), { status: 200 });
      }
      if (String(url).includes('retrieveUserQuotaSummary')) {
        return new Response(JSON.stringify({ response: { groups: [
          { displayName: 'Gemini Models', buckets: [
            { bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.9, resetTime: '2026-08-18T00:00:00Z' },
          ] },
          { displayName: 'Claude and GPT models', buckets: [
            { bucketId: '3p-weekly', window: 'weekly', remainingFraction: 0.75 },
          ] },
        ] } }), { status: 200 });
      }
      throw new Error(`unexpected endpoint requested: ${url}`);
    },
  });
  assert.deepEqual(requested, ['/v1internal:loadCodeAssist', '/v1internal:retrieveUserQuotaSummary']);
  assert.equal(result.source, 'Antigravity OAuth JSON');
  assert.equal(result.account, 'builder@example.com');
  assert.equal(result.plan, 'starter');
  assert.deepEqual(result.windows.map((item) => item.id), ['gemini-weekly', '3p-weekly']);
  assert.deepEqual(result.windows.map((item) => item.windowSeconds), [604_800, 604_800]);
  assert.deepEqual(result.windows.map((item) => item.remainingPercent), [90, 75]);
  assert.equal(JSON.stringify(result).includes('synthetic-access-token'), false);
});

test('Antigravity OAuth path falls back to the per-model chain when the summary endpoint fails', async () => {
  const requested = [];
  const result = await fetchAntigravityLimits({
    settings: { authMode: 'environment', environmentVariable: 'ANTIGRAVITY_TEST_OAUTH' },
    environment: { ANTIGRAVITY_TEST_OAUTH: JSON.stringify({ access_token: 'synthetic-access-token' }) },
    fetcher: async (url) => {
      const endpoint = new URL(url).pathname;
      assert.equal(new URL(url).hostname, endpoint.includes('retrieveUserQuotaSummary')
        ? 'daily-cloudcode-pa.googleapis.com' : 'cloudcode-pa.googleapis.com');
      requested.push(endpoint);
      if (endpoint.includes('loadCodeAssist')) {
        return new Response(JSON.stringify({ planInfo: { planType: 'pro' } }), { status: 200 });
      }
      if (endpoint.includes('retrieveUserQuotaSummary')) {
        return new Response('HTTP 500', { status: 500 });
      }
      return new Response(JSON.stringify({
        models: { 'gemini-3-pro': { quotaInfo: { remainingFraction: 0.62, resetTime: '2026-08-12T00:00:00Z' } } },
      }), { status: 200 });
    },
  });
  assert.deepEqual(requested, [
    '/v1internal:loadCodeAssist', '/v1internal:retrieveUserQuotaSummary', '/v1internal:fetchAvailableModels',
  ]);
  assert.equal(result.plan, 'pro');
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].id, 'gemini');
  assert.equal(result.windows[0].remainingPercent, 62);
});

test('Antigravity OAuth path keeps a logged-out summary response instead of degrading the error', async () => {
  const requested = [];
  await assert.rejects(fetchAntigravityLimits({
    settings: { authMode: 'environment', environmentVariable: 'ANTIGRAVITY_TEST_OAUTH' },
    environment: { ANTIGRAVITY_TEST_OAUTH: JSON.stringify({ access_token: 'synthetic-access-token' }) },
    fetcher: async (url) => {
      requested.push(new URL(url).pathname);
      if (String(url).includes('loadCodeAssist')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response('HTTP 401', { status: 401 });
    },
  }), (error) => error?.code === 'unauthorized');
  assert.deepEqual(requested, ['/v1internal:loadCodeAssist', '/v1internal:retrieveUserQuotaSummary']);
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
    'id', 'label', 'status', 'emptyReason', 'account', 'plan', 'source', 'notice', 'resetCredits',
    'balances', 'creditBalance', 'cloudCredits', 'subscriptionDates', 'updatedAt', 'windows', 'quotaCoverage',
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

test('subscription limit service queries an OpenCode API-key account without a Workspace', async () => {
  clearLimitCache();
  const seen = [];
  const result = await loadSubscriptionLimits({
    force: true,
    config: { subscriptionLimits: {
      enabled: true, providerOrder: ['opencode'], providers: { opencode: {
        enabled: true,
        accounts: [{ id: 'api', label: 'API account', connectionType: 'api-key' }],
        activeAccountId: 'api',
      } },
    } },
    historyLoader: () => ({ schemaVersion: 1, observations: [] }),
    historyRecorder: () => {},
    fetchers: { opencode: async ({ settings }) => {
      seen.push([settings.accountId, settings.connectionType, settings.workspaceId, settings.credentialKey]);
      return {
        id: 'opencode', label: 'OpenCode Go', status: 'ok', updatedAt: NOW.toISOString(),
        account: settings.accountLabel, source: 'OpenCode Go API Key', windows: [],
      };
    } },
  });
  assert.deepEqual(seen, [['api', 'api-key', '', 'opencode:api']]);
  assert.equal(result.providers[0].accounts[0].status, 'ok');
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

test('Cursor HTTP 403 responses enter a six-hour cooldown that manual refresh and cache clears lift', async () => {
  clearLimitCache();
  let calls = 0;
  let clock = NOW.valueOf();
  const config = { subscriptionLimits: {
    enabled: true, refreshMinutes: 10,
    providerOrder: ['cursor'],
    providers: { cursor: { enabled: true } },
  } };
  const options = {
    config,
    historyLoader: () => ({ schemaVersion: 1, observations: [] }),
    historyRecorder: () => {},
    now: () => clock,
    fetchers: { cursor: async () => {
      calls++;
      throw Object.assign(new Error('forbidden'), { code: 'unauthorized', status: 403 });
    } },
  };
  const first = await loadSubscriptionLimits({ force: true, ...options });
  assert.equal(calls, 1);
  assert.equal(first.providers[0].error.code, 'forbidden');
  assert.match(first.providers[0].error.message, /手动刷新可立即重试/);

  // Within the TTL cache the payload is served without new requests.
  await loadSubscriptionLimits(options);
  assert.equal(calls, 1);

  // After the cache expires, the cooldown keeps the automatic refresh from re-requesting.
  clock += 11 * 60_000;
  const cooled = await loadSubscriptionLimits(options);
  assert.equal(calls, 1);
  assert.equal(cooled.providers[0].error.code, 'forbidden');

  // A manual refresh retries immediately, even inside the cooldown window.
  clock += 60_000;
  await loadSubscriptionLimits({ force: true, ...options });
  assert.equal(calls, 2);

  // Six hours after the last forbidden answer the automatic refresh retries again.
  clock += 6 * 60 * 60_000 + 11 * 60_000;
  await loadSubscriptionLimits(options);
  assert.equal(calls, 3);

  // Clearing the cache (as settings saves do) lifts the cooldown before it expires.
  clearLimitCache();
  await loadSubscriptionLimits(options);
  assert.equal(calls, 4);
});

test('non-Cursor 403 failures never inherit Cursor cooldown and accounts keep refreshing', async () => {
  clearLimitCache();
  let clock = NOW.valueOf();
  const calls = [];
  const config = { subscriptionLimits: {
    enabled: true, refreshMinutes: 10,
    providerOrder: ['opencode'],
    providers: { opencode: {
      enabled: true,
      accounts: [
        { id: 'blocked', label: 'Blocked', connectionType: 'api-key' },
        { id: 'healthy', label: 'Healthy', connectionType: 'api-key' },
      ],
      activeAccountId: 'healthy',
    } },
  } };
  const options = {
    config,
    historyLoader: () => ({ schemaVersion: 1, observations: [] }),
    historyRecorder: () => {},
    now: () => clock,
    fetchers: { opencode: async ({ settings }) => {
      calls.push(settings.accountId);
      if (settings.accountId === 'blocked') {
        throw Object.assign(new Error('forbidden'), { code: 'unauthorized', status: 403 });
      }
      return {
        id: 'opencode', label: 'OpenCode Go', status: 'ok', updatedAt: NOW.toISOString(),
        source: 'test', windows: [],
      };
    } },
  };
  const first = await loadSubscriptionLimits({ force: true, ...options });
  assert.deepEqual(calls, ['blocked', 'healthy']);
  assert.equal(first.providers[0].accounts[0].error.code, 'unauthorized');
  assert.equal(first.providers[0].accounts[1].status, 'ok');

  // After the cache expires both accounts retry; only Cursor has a cooldown.
  clock += 11 * 60_000;
  const cooled = await loadSubscriptionLimits(options);
  assert.deepEqual(calls, ['blocked', 'healthy', 'blocked', 'healthy']);
  assert.equal(cooled.providers[0].accounts[0].error.code, 'unauthorized');
  assert.equal(cooled.providers[0].accounts[1].status, 'ok');

  // Once the cooldown lapses the blocked account is queried again.
  clock += 6 * 60 * 60_000 + 1 * 60_000;
  await loadSubscriptionLimits(options);
  assert.deepEqual(calls, ['blocked', 'healthy', 'blocked', 'healthy', 'blocked', 'healthy']);
});

test('loading public settings never probes credentials unless detection is explicitly requested', () => {
  let calls = 0;
  const exposed = getPublicLimitSettings({ subscriptionLimits: { enabled: false } }, {
    environment: {}, keychainAvailable: true,
    readSecret: () => { calls++; throw new Error('must not read'); },
    run: () => { calls++; throw new Error('must not execute'); },
  });
  assert.equal(calls, 0);
  assert.ok(exposed.catalog.every((provider) => provider.detection.state === 'unchecked'
    && provider.credentialState === 'unchecked' && provider.hasSecret === null));
});

test('public credentials distinguish unchecked, present, and absent without implicit probes', () => {
  const config = { subscriptionLimits: { providers: {
    opencode: { accounts: [{ id: 'saved', label: 'Saved', connectionType: 'api-key' }, { id: 'missing', label: 'Missing', connectionType: 'api-key' }] },
  } } };
  let reads = 0;
  const options = { keychainAvailable: true, environment: {}, readSecret: (key) => {
    reads++;
    return key === 'opencode:saved' || key === 'minimax:china' ? 'test-secret' : null;
  } };
  const unchecked = getPublicLimitSettings(config, options);
  assert.equal(reads, 0);
  assert.deepEqual(unchecked.providers.opencode.accounts.map(account => account.credentialState), ['unchecked', 'unchecked']);
  assert.deepEqual(unchecked.catalog.find(provider => provider.id === 'minimax').siteCredentialStates, { china: 'unchecked', international: 'unchecked' });
  const checked = getPublicLimitSettings(config, { ...options, detectCredentials: true, run: () => ({ status: 1 }), platform: 'linux' });
  assert.ok(reads > 0);
  assert.deepEqual(checked.providers.opencode.accounts.map(account => [account.credentialState, account.hasSecret]), [['present', true], ['absent', false]]);
  assert.deepEqual(checked.catalog.find(provider => provider.id === 'minimax').siteCredentialStates, { china: 'present', international: 'absent' });
  assert.doesNotMatch(JSON.stringify(checked), /test-secret/);
});

test('saving unchanged unprobed OpenCode accounts preserves stored credentials and allows metadata edits', () => {
  const current = { subscriptionLimits: { enabled: false, providers: { opencode: {
    accounts: [{ id: 'saved', label: 'Saved', connectionType: 'api-key' }],
  } } } };
  const settings = getPublicLimitSettings(current, { keychainAvailable: true, readSecret: () => { throw new Error('Unexpected credential probe'); } });
  settings.providers.opencode.accounts[0].label = 'Renamed';
  settings.providers.opencode.accounts[0].entitlementType = 'paid';
  settings.providers.opencode.accounts[0].subscriptionPrice = 25;
  let saved;
  const result = saveLimitSettings({ settings }, { config: current,
    save: value => { saved = value; },
    writeSecret: () => { throw new Error('Unexpected credential write'); },
    deleteSecret: () => { throw new Error('Unexpected credential deletion'); },
  });
  assert.equal(saved.subscriptionLimits.providers.opencode.accounts[0].label, 'Renamed');
  assert.equal(saved.subscriptionLimits.providers.opencode.accounts[0].subscriptionPrice, 25);
  assert.equal(result.providers.opencode.accounts[0].credentialState, 'unchecked');
});
