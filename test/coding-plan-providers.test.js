import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizeLimitSettings, publicLimitSettings } from '../src/limits/catalog.js';
import { assertProviderContract } from '../src/limits/contract.js';
import { clearLimitCache, getPublicLimitSettings, loadSubscriptionLimits, saveLimitSettings } from '../src/limits/service.js';
import { parseGlmQuota, fetchGlmLimits } from '../src/limits/providers/glm.js';
import { parseMiniMaxQuota, fetchMiniMaxLimits } from '../src/limits/providers/minimax.js';
import { parseAlibabaCodingQuota, fetchAlibabaCodingLimits, normalizeAlibabaCookie } from '../src/limits/providers/alibaba-coding.js';
import { planAccountId, quotaDate } from '../src/limits/providers/coding-plan-common.js';
import { normalizeProviderId, renderQuotaReport } from '../src/quota.js';
import { setLocale } from '../src/cli-ui.js';
import { buildSubscriptionInsights } from '../dashboard/src/subscription-insights.js';

const now = new Date('2026-09-12T12:00:00Z');
const options = { now };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const glm = (limits = [{ type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 25 }]) => ({ code: 200, success: true, data: { planName: 'Pro', limits } });
const mini = (models = [{ model_name: 'general', current_interval_total_count: 1000, current_interval_usage_count: 600 }]) => ({ base_resp: { status_code: 0 }, model_remains: models });
const ali = (overrides = {}) => ({ status_code: 0, data: {
  codingPlanInstanceInfos: [{ planName: 'Pro' }],
  codingPlanQuotaInfo: { per5HourUsedQuota: 20, per5HourTotalQuota: 100,
    perWeekUsedQuota: 120, perWeekTotalQuota: 1000, perBillMonthUsedQuota: 500, perBillMonthTotalQuota: 10000 }, ...overrides,
} });
const parsers = { glm: parseGlmQuota, minimax: parseMiniMaxQuota, 'alibaba-coding': parseAlibabaCodingQuota };
const fetchers = { glm: fetchGlmLimits, minimax: fetchMiniMaxLimits, 'alibaba-coding': fetchAlibabaCodingLimits };

test('GLM percentages and MCP counts remain distinct, with no invented raw Token cap', () => {
  const result = parseGlmQuota(glm([
    { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 25 },
    { type: 'CREDIT_LIMIT', unit: 6, number: 1, percentage: 60 },
    { type: 'TIME_LIMIT', unit: 5, number: 1, percentage: 22, usage: 1000, currentValue: 224, remaining: 776 },
  ]), options);
  assert.deepEqual(result.windows.map(w => w.remainingPercent), [75, 40, 77.6]);
  assert.equal(result.windows[0].limit, null);
  assert.equal(result.windows[0].unit, 'quota units');
  assert.equal(result.windows[2].value, 224);
  assert.equal(result.windows[2].unit, 'requests');
  assert.equal(result.windows[2].windowSeconds, null);
  assertProviderContract('glm', result);
});

test('GLM rejects impossible reset timestamps without discarding utilization', () => {
  const raw = { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 25, nextResetTime: now.getTime() + 24 * 3600000 };
  assert.equal(parseGlmQuota(glm([raw]), options).windows[0].resetsAt, null);
  raw.nextResetTime = now.getTime() + 3600000;
  assert.equal(parseGlmQuota(glm([raw]), options).windows[0].resetsAt, '2026-09-12T13:00:00.000Z');
  raw.type = 'TIME_LIMIT'; raw.unit = 0;
  assert.equal(parseGlmQuota(glm([raw]), options).windows[0].windowSeconds, null);
});

test('MiniMax usage_count means remaining, not consumed', () => {
  const window = parseMiniMaxQuota(mini(), options).windows[0];
  assert.equal(window.usedPercent, 40);
  assert.equal(window.remainingPercent, 60);
  assert.equal(window.value, 400);
  assert.equal(window.limit, 1000);
  assert.equal(window.resetsAt, null);
  assert.equal(window.windowSeconds, null);
});

test('MiniMax percent-only Token Plan ignores placeholder counts and boost denominators', () => {
  const result = parseMiniMaxQuota(mini([{ model_name: 'general',
    current_interval_total_count: 0, current_interval_usage_count: 0, current_interval_remaining_percent: '96',
    current_weekly_total_count: 0, current_weekly_usage_count: 0, current_weekly_remaining_percent: '99', weekly_boost_permille: 1500,
    start_time: now.getTime(), end_time: now.getTime() + 18000000,
    weekly_start_time: now.getTime(), weekly_end_time: now.getTime() + 604800000,
  }]), options);
  assert.deepEqual(result.windows.map(w => w.remainingPercent), [96, 99]);
  assert.deepEqual(result.windows.map(w => w.limit), [null, null]);
  assert.deepEqual(result.windows.map(w => w.windowSeconds), [18000, 604800]);
  assertProviderContract('minimax', result);
});

test('MiniMax unavailable/unlimited lanes never become zero-used bars; weekly applies only to text', () => {
  assert.equal(parseMiniMaxQuota(mini([{ model_name: 'general', current_interval_status: 3 }]), options).status, 'empty');
  const result = parseMiniMaxQuota(mini([{ model_name: 'video', current_interval_remaining_percent: 75, current_weekly_remaining_percent: 0 }]), options);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].remainingPercent, 75);
  assert.throws(() => parseMiniMaxQuota(mini([{ model_name: 'general' }]), options), { code: 'invalid_response' });
});

test('Alibaba parses the console envelope including string-wrapped bodies and all three request windows', () => {
  const payload = { successResponse: { body: JSON.stringify(ali()) } };
  const result = parseAlibabaCodingQuota(payload, options);
  assert.deepEqual(result.windows.map(w => w.remainingPercent), [80, 88, 95]);
  assert.deepEqual(result.windows.map(w => w.unit), ['requests', 'requests', 'requests']);
  assert.equal(result.windows[2].windowSeconds, null); // calendar month, not an invented 30-day duration
  assertProviderContract('alibaba-coding', result);
});

test('Alibaba selects one active instance and never borrows another instance quota', () => {
  const old = { status: 'EXPIRED', planName: 'Old', codingPlanQuotaInfo: { per5HourUsedQuota: 90, per5HourTotalQuota: 100 } };
  const active = { status: 'VALID', planName: 'New' };
  const result = parseAlibabaCodingQuota(ali({ codingPlanInstanceInfos: [old, active] }), options);
  assert.equal(result.plan, 'New');
  assert.equal(result.status, 'empty');
  assert.deepEqual(result.windows, []);
  assert.throws(() => parseAlibabaCodingQuota(ali({ codingPlanInstanceInfos: [active, active] }), options), { code: 'invalid_response' });
  assert.throws(() => parseAlibabaCodingQuota(ali({ codingPlanInstanceInfos: [{}, {}] }), options), { code: 'invalid_response' });
  for (const expired of [old, { ...old, status: 'VALID', expireTime: '2026-09-11T12:00:00Z' }]) {
    const single = parseAlibabaCodingQuota(ali({ codingPlanInstanceInfos: [expired] }), options);
    assert.equal(single.status, 'empty');
    assert.deepEqual(single.windows, []);
  }
});

test('Alibaba unknown counters stay unknown; zero usage is valid only with a positive cap', () => {
  assert.equal(parseAlibabaCodingQuota(ali({ codingPlanInstanceInfos: [] }), options).status, 'empty');
  assert.throws(() => parseAlibabaCodingQuota(ali({ codingPlanQuotaInfo: {} }), options), { code: 'invalid_response' });
  const result = parseAlibabaCodingQuota(ali({ codingPlanQuotaInfo: { per5HourUsedQuota: 0, per5HourTotalQuota: 100,
    per5HourQuotaNextRefreshTime: '2026-09-12T10:00:00Z' } }), options);
  assert.equal(result.windows[0].remainingPercent, 100);
  assert.equal(result.windows[0].resetsAt, '2026-09-12T10:00:00.000Z'); // no shifting old resets to now + 5h
});

test('all new parsers fail closed on malformed envelopes and invalid quota numbers', () => {
  for (const parse of Object.values(parsers)) {
    for (const input of [null, {}, [], { data: [] }, { success: false }]) assert.throws(() => parse(input, options));
  }
  for (const value of [-1, '', 'NaN', Infinity, {}, true, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseGlmQuota(glm([{ type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 1, usage: value }]), options));
    assert.throws(() => parseMiniMaxQuota(mini([{ current_interval_total_count: value, current_interval_usage_count: 0 }]), options));
    assert.throws(() => parseAlibabaCodingQuota(ali({ codingPlanQuotaInfo: { per5HourTotalQuota: value, per5HourUsedQuota: 0 } }), options));
  }
  assert.throws(() => parseAlibabaCodingQuota({ status_code: 403, data: ali().data }), { code: 'unauthorized' });
  assert.throws(() => parseAlibabaCodingQuota({ code: 'ConsoleNeedLogin', data: ali().data }), { code: 'unauthorized' });
  assert.throws(() => parseGlmQuota({ ...glm(), code: 401 }), { code: 'unauthorized' });
  assert.throws(() => parseMiniMaxQuota({ ...mini(), base_resp: { status_code: 1004 } }), { code: 'unauthorized' });
});

test('duplicate windows and oversized arrays do not enter the quota contract', () => {
  assert.throws(() => parseGlmQuota(glm(Array(65).fill(glm().data.limits[0])), options));
  assert.throws(() => parseGlmQuota(glm(Array(2).fill(glm().data.limits[0])), options));
  assert.throws(() => parseMiniMaxQuota(mini(Array(2).fill(mini().model_remains[0])), options));
  assert.throws(() => parseMiniMaxQuota(mini(Array(33).fill(mini().model_remains[0])), options));
  assert.throws(() => parseAlibabaCodingQuota(ali({ codingPlanInstanceInfos: Array(33).fill({}) }), options));
});

test('provider timestamps accept explicit zones and epochs, never local wall-clock guesses', () => {
  assert.equal(quotaDate('2026-09-12 20:00'), null);
  assert.equal(quotaDate('2026-09-12T20:00:00+08:00'), now.toISOString());
  assert.equal(quotaDate(now.getTime()), now.toISOString());
  assert.equal(quotaDate(now.getTime() / 1000), now.toISOString());
  assert.equal(quotaDate('bad'), null);
});

test('quota timestamps reject sentinel epochs and dates before 2020, retaining valid seconds, milliseconds and fractions', () => {
  for (const value of [0, 1, 0.5, 1.25, 999999999, 1577836799, '0', '1', '0.5', '999999999',
    999999999000, 1577836799999, '2001-09-09T01:46:39Z', 4102444800, 4102444800000,
    '2100-01-01T00:00:00Z', -1, NaN, Infinity, true, {}, [], '  ']) {
    assert.equal(quotaDate(value), null, String(value));
  }
  assert.equal(quotaDate(1577836800), '2020-01-01T00:00:00.000Z');
  assert.equal(quotaDate(1577836800000), '2020-01-01T00:00:00.000Z');
  for (const value of [now.getTime(), now.getTime() / 1000, String(now.getTime()), String(now.getTime() / 1000)]) {
    assert.equal(quotaDate(value), now.toISOString());
  }
  for (const value of [now.getTime() + 125, now.getTime() / 1000 + 0.125, String(now.getTime() / 1000 + 0.125)]) {
    assert.equal(quotaDate(value), '2026-09-12T12:00:00.125Z');
  }
});

test('unset MiniMax timestamps and Alibaba expiry sentinels do not turn quotas into expired records', () => {
  for (const sentinel of [0, '0', 1, 0.5, 999999999, 999999999000]) {
    const minimax = parseMiniMaxQuota(mini([{ ...mini().model_remains[0], start_time: sentinel, end_time: sentinel }]), options);
    assert.equal(minimax.windows[0].resetsAt, null);
    assert.equal(minimax.windows[0].windowSeconds, null);
    assert.equal(minimax.windows[0].usedPercent, 40);
    const alibaba = parseAlibabaCodingQuota(ali({ codingPlanInstanceInfos: [{ status: 'VALID', expireTime: sentinel }] }), options);
    assert.equal(alibaba.status, 'ok');
    assert.equal(alibaba.windows.length, 3);
    const glmQuota = parseGlmQuota(glm([{ ...glm().data.limits[0], nextResetTime: sentinel }]), options);
    assert.equal(glmQuota.windows[0].resetsAt, null);
    const generatedAt = now.toISOString();
    const insight = buildSubscriptionInsights({ generatedAt, buckets: [] }, {
      generatedAt, providers: [minimax, alibaba, glmQuota],
    });
    for (const provider of insight.providers) {
      for (const window of provider.windows) assert.equal(window.expired, false);
    }
  }
});

test('new providers are opt-in and missing credentials cause no network requests', async () => {
  const settings = normalizeLimitSettings({});
  for (const [id, fetchProvider] of Object.entries(fetchers)) {
    assert.equal(settings.providers[id].enabled, false);
    await assert.rejects(fetchProvider({ settings: settings.providers[id], environment: {}, fetcher: () => assert.fail('network') }), { code: 'not_configured' });
  }
});

test('GLM uses the explicitly selected official host and ignores endpoint overrides', async () => {
  for (const [site, host] of [['china', 'open.bigmodel.cn'], ['international', 'api.z.ai']]) {
    const result = await fetchGlmLimits({ settings: { site, authMode: 'environment', environmentVariable: 'KEY' },
      environment: { KEY: 'fixture-key', ZAI_BASE_URL: 'https://attacker.example' }, fetcher: async (url, init) => {
        assert.equal(url.hostname, host); assert.equal(url.pathname, '/api/monitor/usage/quota/limit');
        assert.equal(init.headers.Authorization, 'Bearer fixture-key'); assert.equal(init.redirect, 'error');
        return json(glm());
      } });
    assert.match(result.accountId, /^[a-f0-9]{32}$/);
  }
});

test('MiniMax compatibility retry is same-region only, and never hides a transport failure', async () => {
  for (const [site, host] of [['china', 'api.minimaxi.com'], ['international', 'api.minimax.io']]) {
    const calls = [];
    const result = await fetchMiniMaxLimits({ settings: { site, authMode: 'environment', environmentVariable: 'KEY' }, environment: { KEY: 'fixture-key' },
      fetcher: async (url, init) => { calls.push(url.pathname); assert.equal(url.hostname, host); assert.equal(init.redirect, 'error');
        return calls.length === 1 ? json({}, 404) : json(mini()); } });
    assert.equal(result.windows[0].usedPercent, 40);
    assert.deepEqual(calls, ['/v1/token_plan/remains', '/v1/api/openplatform/coding_plan/remains']);
  }
  let calls = 0;
  await assert.rejects(fetchMiniMaxLimits({ settings: { site: 'china', authMode: 'environment', environmentVariable: 'KEY' }, environment: { KEY: 'private-key' },
    fetcher: async () => { calls++; throw new Error('private-key'); } }), error => error.code === 'network_error' && !error.message.includes('private-key'));
  assert.equal(calls, 1);
});

test('Alibaba Cookie headers and literal cURL arguments normalize without executing commands', () => {
  for (const input of ['sid=test; sec_token=fixture', 'Cookie: sid=test; sec_token=fixture',
    'curl https://example.test -H "Cookie: sid=test; sec_token=fixture"',
    "curl https://example.test -b 'sid=test; sec_token=fixture'"]) {
    assert.equal(normalizeAlibabaCookie(input), 'sid=test; sec_token=fixture');
  }
  for (const input of ['sk-not-a-cookie', 'curl https://example.test?token=bad', 'curl https://example.test -b cookies.txt', 'not a name=value']) assert.equal(normalizeAlibabaCookie(input), null);
});

test('Alibaba console requests use region-specific dashboard/RPC hosts and a read-only action', async () => {
  for (const [site, host, rpc, region, commodity] of [
    ['china', 'bailian.console.aliyun.com', 'bailian-cs.console.aliyun.com', 'cn-beijing', 'cn'],
    ['international', 'modelstudio.console.alibabacloud.com', 'bailian-singapore-cs.alibabacloud.com', 'ap-southeast-1', 'intl'],
  ]) {
    const calls = [];
    const result = await fetchAlibabaCodingLimits({ settings: { site, authMode: 'environment', environmentVariable: 'COOKIE' },
      environment: { COOKIE: 'sid=fixture; csrf=fixture-csrf', ALIBABA_CODING_PLAN_HOST: 'https://attacker.example' }, fetcher: async (url, init) => {
        calls.push(url.hostname); assert.equal(init.redirect, 'error'); assert.equal(init.headers.Cookie, 'sid=fixture; csrf=fixture-csrf');
        if (init.method === 'GET') { assert.equal(url.hostname, host); return new Response('<script>var config={sec_token:"fixture-sec"}</script>'); }
        assert.equal(url.hostname, rpc); assert.equal(url.pathname, '/data/api.json');
        assert.match(url.searchParams.get('api'), /queryCodingPlanInstanceInfoV2$/);
        assert.equal(init.headers.Origin, `https://${host}`); assert.equal(init.headers['x-xsrf-token'], 'fixture-csrf');
        const body = new URLSearchParams(init.body); assert.equal(body.get('region'), region); assert.equal(body.get('sec_token'), 'fixture-sec');
        const params = JSON.parse(body.get('params'));
        assert.deepEqual(params.Data.queryCodingPlanInstanceInfoRequest, { commodityCode: `sfm_codingplan_public_${commodity}`, onlyLatestOne: true });
        return json(ali());
      } });
    assert.equal(result.status, 'ok'); assert.deepEqual(calls, [host, rpc]);
    assert.doesNotMatch(JSON.stringify(result), /fixture/);
  }
});

test('region credentials and public detection remain isolated without exposing secrets', () => {
  const settings = normalizeLimitSettings({ providers: { glm: { site: 'international' } } });
  assert.equal(settings.providers.glm.environmentVariable, 'Z_AI_API_KEY');
  const shown = getPublicLimitSettings({ subscriptionLimits: settings }, { environment: {}, readSecret: key => key === 'glm:china' ? 'private-value' : null, run: () => ({ status: 1 }) });
  const provider = shown.catalog.find(p => p.id === 'glm');
  assert.equal(provider.hasSecret, false);
  assert.deepEqual(provider.siteSecrets, { china: true, international: false });
  assert.equal(provider.detection.state, 'manual');
  assert.doesNotMatch(JSON.stringify(shown), /private-value/);
  const storage = new Map(); let saved;
  saveLimitSettings({ settings, secrets: { glm: 'new-private' }, clearSecrets: ['minimax'] }, {
    config: {}, save: value => { saved = value; }, writeSecret: (key, value) => storage.set(key, value), deleteSecret: key => storage.set(key, null),
  });
  assert.equal(storage.get('glm:international'), 'new-private');
  assert.equal(storage.get('minimax:china'), null);
  assert.equal(storage.has('glm:china'), false);
  assert.doesNotMatch(JSON.stringify(saved), /new-private/);
});

test('region subscription declarations normalize independently and never persist unknown fields', () => {
  const result = normalizeLimitSettings({ providers: { glm: { site: 'china', entitlementType: 'paid', subscriptionPrice: 49, subscriptionCurrency: 'cny',
    regionSubscriptions: { international: { entitlementType: 'paid', subscriptionPrice: 15, subscriptionCurrency: 'usd', cookie: 'private-sentinel-value' } } } } });
  assert.equal(result.providers.glm.regionSubscriptions.china.subscriptionPrice, 49);
  assert.equal(result.providers.glm.regionSubscriptions.international.subscriptionPrice, 15);
  assert.doesNotMatch(JSON.stringify(publicLimitSettings(result)), /private-sentinel-value/);
});

test('quota history identities change with region or credential, but errors retain the same identity', async () => {
  const settings = normalizeLimitSettings({ enabled: true, providers: { glm: { enabled: true } } });
  const history = { schemaVersion: 1, observations: [] }; let recorded;
  const base = { force: true, config: { subscriptionLimits: settings }, historyLoader: () => history, historyRecorder: value => { recorded = value; }, environment: { GLM_API_KEY: 'fixture-first' } };
  clearLimitCache();
  const success = await loadSubscriptionLimits({ ...base, fetcher: async () => json(glm()) });
  const firstId = success.providers[0].accountId;
  assert.match(firstId, /^[a-f0-9]{32}$/);
  assert.equal(recorded.providers[0].accountId, firstId);
  const failure = await loadSubscriptionLimits({ ...base, fetcher: async () => json({}, 401) });
  assert.equal(failure.providers[0].accountId, firstId);
  assert.equal(failure.providers[0].error.code, 'unauthorized');
  assert.notEqual(firstId, planAccountId('glm', { site: 'international' }, 'fixture-first'));
  assert.notEqual(firstId, planAccountId('glm', { site: 'china' }, 'fixture-second'));
  assert.doesNotMatch(JSON.stringify(success), /fixture-first/);
});

test('sanitized provider contract fixtures include the new integrations', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/limits/provider-contracts.json', import.meta.url)));
  for (const [id, parse] of Object.entries(parsers)) {
    const entry = fixture.providers.find(p => p.id === id);
    assert.ok(entry, id); assertProviderContract(id, parse(entry.input, options));
  }
});

test('CLI aliases and rendered quota labels support both languages', () => {
  assert.equal(normalizeProviderId('z.ai'), 'glm');
  assert.equal(normalizeProviderId('bailian'), 'alibaba-coding');
  const data = { generatedAt: now.toISOString(), providers: [parseGlmQuota(glm(), options), parseMiniMaxQuota(mini(), options), parseAlibabaCodingQuota(ali(), options)] };
  try {
    setLocale('en');
    assert.doesNotMatch(renderQuotaReport(data), /[\u3400-\u9fff]/);
    setLocale('zh');
    assert.match(renderQuotaReport(data), /次请求/);
  } finally { setLocale('zh'); }
});
