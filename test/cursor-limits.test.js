import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCursorLimits, parseCursorUsage } from '../src/limits/providers/cursor.js';
import { assertProviderContract } from '../src/limits/contract.js';
import { parseAntigravityQuota } from '../src/limits/providers/antigravity.js';

const now = new Date('2026-10-25T12:00:00Z');
const summary = { membershipType: 'unified_ultra', limitType: 'user', billingCycleEnd: '2026-11-01T00:00:00Z',
  individualUsage: { plan: { used: 2000, limit: 2000, totalPercentUsed: 100 }, onDemand: { used: 0, limit: 10000 } } };
const weeklyUsage = { isUnified: true, hasNonZeroIncludedLimit: true, includedLimitZero: false,
  usagePercent: 8, currentPeriodStart: '2026-10-24T00:00:00Z', nextResetTimestampUtc: '2026-10-31T00:00:00Z' };
const monthlyUsage = { availability: 'available', monthlyUsage: { usedCents: 1234, limitCents: 5000,
  periodStart: '2026-10-01T00:00:00Z', resetsAt: '2026-11-01T00:00:00Z' } };
const parse = options => assertProviderContract('cursor', parseCursorUsage(summary, {}, { now, ...options }));

test('Cursor unified weekly quota replaces stale monthly total, not personal additional spend', () => {
  const result = parse({ weeklyUsage, monthlyUsage });
  assert.equal(result.windows.length, 2);
  assert.equal(result.windows[0].id, 'unified-weekly');
  assert.equal(result.windows[0].usedPercent, 8);
  assert.equal(result.windows[0].value, null);
  assert.equal(result.windows[0].windowSeconds, 604800);
  assert.equal(result.windows[1].value, 12.34);
  assert.equal(result.windows[1].limit, 50);
  assert.equal(result.windows[1].windowSeconds, 31 * 86400);
});

test('Cursor enterprise X subscriptions also use an explicit unified weekly pool', () => {
  const enterprise = { ...summary, membershipType: 'enterprise', limitType: 'team' };
  const result = assertProviderContract('cursor', parseCursorUsage(enterprise, {}, { now, weeklyUsage, monthlyUsage }));
  assert.equal(result.windows[0].id, 'unified-weekly');
  assert.equal(result.windows[0].usedPercent, 8);
  assert.equal(result.windows[1].value, 0); // personal billing never applied to a team
});

test('Cursor invalid, expired, future and trial-only weekly evidence cannot replace the plan', () => {
  for (const overrides of [{ isUnified: false }, { includedLimitZero: true, sandTrialExpiresAt: '2026-11-01T00:00:00Z' },
    { nextResetTimestampUtc: now.toISOString() }, { nextResetTimestampUtc: null }, { nextResetTimestampUtc: '2027-01-01T00:00:00Z' },
    { currentPeriodStart: '2026-12-01T00:00:00Z' },
    { usagePercent: null }, { usagePercent: true }, { usagePercent: -1 }, { usagePercent: 'NaN' }]) {
    assert.equal(parse({ weeklyUsage: { ...weeklyUsage, ...overrides } }).windows[0].id, 'plan');
  }
  assert.equal(parse({ weeklyUsage: { ...weeklyUsage, usagePercent: 0 } }).windows[0].usedPercent, 0);
});

test('Cursor monthly evidence validates period and amounts and never infers a fixed month', () => {
  for (const change of [{ usedCents: -1 }, { limitCents: null }, { usedCents: true }, { periodStart: null },
    { periodStart: true }, { periodStart: '1970-01-01T00:00:00Z' }, { periodStart: '2026-01-01T00:00:00Z' },
    { periodStart: '2026-02-30T00:00:00Z' },
    { resetsAt: now.toISOString() }, { periodStart: '2026-11-01T00:00:00Z' }]) {
    const result = parse({ monthlyUsage: { ...monthlyUsage, monthlyUsage: { ...monthlyUsage.monthlyUsage, ...change } } });
    assert.equal(result.windows[1].value, 0);
    assert.equal(result.windows[1].limit, 100);
  }
  assert.equal(parse({ monthlyUsage: { ...monthlyUsage, availability: 'unavailable' } }).windows[1].value, 0);
});

test('Cursor reads optional quota endpoints with the same explicit cookie; failure preserves legacy quota', async () => {
  for (const kind of ['personal', 'enterprise', 'legacy']) {
    const calls = [];
    const result = await fetchCursorLimits({ now, settings: { authMode: 'environment', environmentVariable: 'CURSOR_TEST' },
      environment: { CURSOR_TEST: 'WorkosCursorSessionToken=synthetic' }, fetcher: async (url, init) => {
        const parsed = new URL(url); calls.push(parsed.pathname);
        assert.equal(parsed.origin, 'https://cursor.com');
        assert.equal(init.headers.Cookie, 'WorkosCursorSessionToken=synthetic');
        assert.equal(init.redirect, 'error');
        if (parsed.pathname === '/api/usage-summary') return Response.json(kind === 'personal' ? summary
          : { ...summary, membershipType: kind === 'enterprise' ? 'enterprise' : 'pro', limitType: kind === 'enterprise' ? 'team' : 'user' });
        if (parsed.pathname === '/api/auth/me') return Response.json({ email: 'fixture@example.com' });
        if (parsed.pathname.endsWith('get-sand-usage-status')) {
          assert.equal(init.method, 'POST'); assert.equal(init.body, '{}');
          return Response.json({ ...weeklyUsage, isUnified: kind !== 'legacy' });
        }
        assert.equal(parsed.search, '?scope=user');
        return new Response('unavailable', { status: 500 });
      } });
    assert.equal(calls.length, kind === 'personal' ? 4 : 3);
    assert.equal(result.windows[0].id, kind === 'legacy' ? 'plan' : 'unified-weekly');
    assert.equal(result.windows[1].value, 0);
    assert.doesNotMatch(JSON.stringify(result), /synthetic/);
  }
});

test('Antigravity versioned quota groups keep their own names and disabled/unknown pools stay unknown', () => {
  const result = assertProviderContract('antigravity', parseAntigravityQuota({ groups: [
    { displayName: 'Gemini models', buckets: [{ bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.9 }] },
    { displayName: 'Gemini 4 Argon', buckets: [{ bucketId: 'argon-weekly', window: 'weekly', remainingFraction: 0.2 },
      { bucketId: 'disabled', disabled: true, remainingFraction: 0 }, { bucketId: 'unknown', remainingFraction: null }] },
  ] }));
  assert.deepEqual(result.windows.map(window => window.id), ['gemini-weekly', 'argon-weekly']);
  assert.match(result.windows[1].label, /Gemini 4 Argon/);
});
