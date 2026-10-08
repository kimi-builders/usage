import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeCloudCredits, claudeResetCredits, claudeSubscriptionDates, fetchClaudeSubscriptionDates } from '../src/limits/providers/claude-benefits.js';
import { fetchClaudeLimits, parseClaudeUsage } from '../src/limits/providers/claude.js';
import { assertProviderContract } from '../src/limits/contract.js';
import { compactLimitHistory } from '../src/limits/history.js';

const now = new Date('2026-10-08T12:00:00Z');
const grant = extra => ({ resets_left: 2, resets_total: 3, paused: false, starts_at: '2026-10-01T00:00:00Z', ends_at: '2026-11-01T00:00:00Z', grant_id: 'do-not-export', ...extra });
const dates = extra => ({ status: 'active', next_charge_at: null, next_charge_date: '2026-11-01', plan_ending_at: null, plan_ending_before: null, ...extra });
const profile = { account: { uuid: '11111111-1111-1111-1111-111111111111' }, organization: { uuid: '22222222-2222-2222-2222-222222222222' } };
const account = { uuid: profile.account.uuid, memberships: [{ organization: profile.organization }] };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('Claude reset inventory filters invalid, future, paused, and expired grants; zero differs from unknown', () => {
  const value = claudeResetCredits({ eligible: true, grants: [grant({ usable_now: false }), grant({ paused: true }), grant({ resets_left: -1 }), grant({ starts_at: '2027-01-01T00:00:00Z' }), grant({ ends_at: now.toISOString() }), grant({ starts_at: 'invalid' })] }, now);
  assert.deepEqual(value, { availableCount: 2, nextExpiry: '2026-11-01T00:00:00.000Z' });
  assert.equal(claudeResetCredits({ eligible: false, grants: [] }, now), null);
  assert.equal(claudeResetCredits({ eligible: true, grants: Array(201).fill(grant()) }, now), null);
  assert.equal(claudeResetCredits({ eligible: true, grants: [grant({ resets_left: 51, resets_total: 51 })] }, now), null);
  assert.equal(claudeResetCredits({ eligible: true, grants: [] }, now).availableCount, 0);
});

test('Claude promotional cloud credits use dollars, authoritative remaining and no redemption metadata', () => {
  const value = claudeCloudCredits({ limit_dollars: 50, used_dollars: 10, remaining_dollars: 30, locked_reason: 'private-reason', resets_at: '2026-11-01T00:00:00Z' });
  assert.deepEqual(value, { limit: 50, used: 20, remaining: 30, locked: true, expiresAt: '2026-11-01T00:00:00.000Z' });
  for (const bad of [{ limit_dollars: 0 }, { limit_dollars: 10, used_dollars: 11 }, { limit_dollars: 10, remaining_dollars: -1 }, { limit_dollars: 10, used_dollars: 0, resets_at: 'invalid' }]) assert.equal(claudeCloudCredits(bad), null);
});

test('Claude renewal calendar dates stay date-only, ending overrides renewal, unknown shape fails closed', () => {
  assert.deepEqual(claudeSubscriptionDates(dates()), { renewsAt: '2026-11-01', expiresAt: null });
  assert.deepEqual(claudeSubscriptionDates(dates({ plan_ending_before: '2026-11-02' })), { renewsAt: null, expiresAt: '2026-11-02' });
  assert.deepEqual(claudeSubscriptionDates(dates({ status: 'canceled' })), { renewsAt: null, expiresAt: null });
  assert.equal(claudeSubscriptionDates(dates({ next_charge_date: '2026-02-30' })), null);
  assert.equal(claudeSubscriptionDates({ status: 'active' }), null);
});

test('Claude optional web metadata verifies OAuth and Cookie ownership before and after lookup', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push(String(url)); assert.equal(options.redirect, 'error');
    if (new URL(url).host === 'api.anthropic.com') { assert.equal(options.headers.Cookie, undefined); return response(profile); }
    assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers.Cookie, 'sessionKey=fixture');
    return response(String(url).endsWith('/account') ? account : dates());
  };
  assert.deepEqual(await fetchClaudeSubscriptionDates('fixture-oauth', 'sessionKey=fixture', { fetcher }), { renewsAt: '2026-11-01', expiresAt: null });
  assert.equal(calls.length, 5);
  let count = 0;
  assert.equal(await fetchClaudeSubscriptionDates('fixture', 'sessionKey=fixture', { fetcher: async url => {
    count++; return response(String(url).endsWith('/profile') ? profile : { ...account, uuid: '33333333-3333-3333-3333-333333333333' });
  } }), null);
  assert.equal(count, 2);
  let webReads = 0;
  assert.equal(await fetchClaudeSubscriptionDates('fixture', 'sessionKey=fixture', { fetcher: async url => response(String(url).endsWith('/profile') ? profile : String(url).endsWith('/account') ? (++webReads === 1 ? account : {}) : dates()) }), null);
});

test('Claude optional failures retain quota; plain OAuth never contacts web; flag fallback is bounded', async () => {
  const usage = { five_hour: { utilization: 10 }, cedar_ember: { eligible: true, grants: [grant()] }, iguana_necktie: { limit_dollars: 50, used_dollars: 1 } };
  const calls = [];
  const opts = { settings: { authMode: 'environment', environmentVariable: 'CLAUDE_FIXTURE' }, environment: { CLAUDE_FIXTURE: 'fixture-token' }, now };
  const result = await fetchClaudeLimits({ ...opts, fetcher: async url => { calls.push(String(url)); return response(usage); } });
  assert.equal(calls.length, 1); assert.match(calls[0], /cedar_ember=1/);
  assert.equal(result.resetCredits.availableCount, 2); assert.equal(result.subscriptionDates, null);
  const optional = await fetchClaudeLimits({ ...opts, environment: { CLAUDE_FIXTURE: JSON.stringify({ accessToken: 'fixture', sessionCookie: 'sessionKey=fixture' }) }, fetcher: async url => response(String(url).includes('/usage') ? usage : {}, String(url).includes('/usage') ? 200 : 401) });
  assert.equal(optional.windows.length, 1); assert.equal(optional.subscriptionDates, null);
  let tries = 0;
  const fallback = await fetchClaudeLimits({ ...opts, fetcher: async () => ++tries === 1 ? response({}, 400) : response(usage) });
  assert.equal(tries, 2); assert.equal(fallback.status, 'ok');
  tries = 0;
  await assert.rejects(fetchClaudeLimits({ ...opts, fetcher: async () => { tries++; return response({}, 401); } }), { code: 'unauthorized' });
  assert.equal(tries, 1);
});

test('Claude browser contract and history exclude raw grants, promo secrets, and new derived quota windows', () => {
  const parsed = parseClaudeUsage({ five_hour: { utilization: 10 }, cedar_ember: { eligible: true, grants: [grant()] }, iguana_necktie: { limit_dollars: 50, used_dollars: 1, locked_reason: 'do-not-export' } }, {}, { now });
  parsed.subscriptionDates = claudeSubscriptionDates(dates());
  const safe = assertProviderContract('claude-code', parsed);
  assert.equal(safe.windows.length, 1); assert.equal(safe.cloudCredits.remaining, 49);
  assert.doesNotMatch(JSON.stringify(safe), /do-not-export|grant_id|locked_reason/);
  const history = compactLimitHistory([{ observedAt: now.toISOString(), providers: [safe] }], { now: +now });
  assert.equal(history.length, 1);
  assert.doesNotMatch(JSON.stringify(history), /cloudCredits|subscriptionDates|resetCredits|do-not-export/);
});
