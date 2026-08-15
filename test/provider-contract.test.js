import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LIMIT_PROVIDER_CATALOG } from '../src/limits/catalog.js';
import { assertProviderContract } from '../src/limits/contract.js';
import { parseAntigravityQuota } from '../src/limits/providers/antigravity.js';
import { parseClaudeUsage } from '../src/limits/providers/claude.js';
import { parseCodexUsage } from '../src/limits/providers/codex.js';
import { parseCopilotUsage } from '../src/limits/providers/copilot.js';
import { parseCursorUsage } from '../src/limits/providers/cursor.js';
import { parseGeminiQuota } from '../src/limits/providers/gemini.js';
import { parseJetBrainsQuota } from '../src/limits/providers/jetbrains.js';
import { parseKimiCodeUsage } from '../src/limits/providers/kimi.js';
import { parseOpenCodeGoUsage } from '../src/limits/providers/opencode.js';
import { parseQoderUsage } from '../src/limits/providers/qoder.js';
import { parseWarpUsage } from '../src/limits/providers/warp.js';
import { clearLimitCache, loadSubscriptionLimits } from '../src/limits/service.js';

const NOW = new Date('2026-08-12T12:00:00.000Z');
const fixtureUrl = new URL('./fixtures/limits/provider-contracts.json', import.meta.url);
const fixtureText = readFileSync(fixtureUrl, 'utf8');
const fixture = JSON.parse(fixtureText);

const PARSERS = {
  codex: (input) => parseCodexUsage(input, { plan: 'pro' }, { now: NOW }),
  'claude-code': (input) => parseClaudeUsage(input, { plan: 'max' }, { now: NOW }),
  'kimi-code': (input) => parseKimiCodeUsage(input, { now: NOW }),
  cursor: (input) => parseCursorUsage(input, {}, { now: NOW }),
  copilot: (input) => parseCopilotUsage(input, {}, { now: NOW }),
  'gemini-cli': (input) => parseGeminiQuota(input, { claims: {}, plan: 'free' }, { now: NOW }),
  antigravity: (input) => parseAntigravityQuota(input, {}, { now: NOW }),
  opencode: (input) => parseOpenCodeGoUsage(JSON.stringify(input), { now: NOW }),
  qoder: (input) => parseQoderUsage(input, {}, { now: NOW }),
  warp: (input) => parseWarpUsage(input, { now: NOW }),
  'jetbrains-ai': (input) => parseJetBrainsQuota(input, { label: 'WebStorm', version: '2026.2' }, { now: NOW }),
};

function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: expected ${expected}, received ${actual}`);
}

test('quota fixture manifest is sanitized and covers the complete provider catalog', () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.sanitized, true);
  assert.match(fixture.lastReviewedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(
    new Set(fixture.providers.map((provider) => provider.id)),
    new Set(LIMIT_PROVIDER_CATALOG.map((provider) => provider.id)),
  );
  assert.doesNotMatch(fixtureText, /Bearer\s|Cookie:|access[_-]?token|refresh[_-]?token|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i);
  for (const provider of fixture.providers) {
    assert.equal(typeof provider.upstreamShape, 'string');
    assert.ok(provider.upstreamShape.length > 0);
    if (provider.invalidBehavior !== 'unsupported') assert.ok(provider.input != null);
  }
});

for (const provider of fixture.providers.filter((entry) => entry.invalidBehavior !== 'unsupported')) {
  test(`${provider.id} sanitized success fixture satisfies the stable quota contract`, () => {
    const result = assertProviderContract(provider.id, PARSERS[provider.id](provider.input));
    assert.equal(result.status, provider.expected.status);
    assert.deepEqual(result.windows.map((window) => window.id), provider.expected.windowIds);
    result.windows.forEach((window, index) => {
      assertClose(window.remainingPercent, provider.expected.remainingPercents[index], `${provider.id} window ${window.id}`);
    });
  });

  test(`${provider.id} malformed fixture fails closed as declared`, () => {
    if (provider.invalidBehavior === 'throws') {
      assert.throws(() => PARSERS[provider.id](provider.invalidInput), (error) => error?.code === 'invalid_response');
      return;
    }
    const result = assertProviderContract(provider.id, PARSERS[provider.id](provider.invalidInput));
    assert.equal(result.status, 'empty');
    assert.deepEqual(result.windows, []);
  });
}

test('runtime contract rejects provider drift before it reaches history or the dashboard', async () => {
  clearLimitCache();
  const result = await loadSubscriptionLimits({
    force: true,
    config: { subscriptionLimits: {
      enabled: true,
      providerOrder: ['codex'],
      providers: { codex: { enabled: true } },
    } },
    historyLoader: () => ({ schemaVersion: 1, observations: [] }),
    historyRecorder: () => {},
    fetchers: {
      codex: async () => ({
        id: 'codex', label: 'Codex', status: 'ok', updatedAt: NOW.toISOString(),
        windows: [{ id: 'primary', label: '5 小时', usedPercent: 90, remainingPercent: 90 }],
      }),
    },
  });
  assert.equal(result.providers[0].status, 'error');
  assert.equal(result.providers[0].error.code, 'invalid_response');
  assert.deepEqual(result.providers[0].windows, []);
});

test('contract rejects duplicate windows, invalid dates, and negative quota values', () => {
  const base = {
    id: 'codex', label: 'Codex', status: 'ok', updatedAt: NOW.toISOString(),
    windows: [{
      id: 'primary', label: '5 小时', usedPercent: 25, remainingPercent: 75,
      resetsAt: '2026-08-12T15:00:00.000Z', value: 25, limit: 100, unit: 'requests',
    }],
  };
  assert.throws(() => assertProviderContract('codex', { ...base, updatedAt: 'not-a-date' }), /updatedAt/);
  assert.throws(() => assertProviderContract('codex', { ...base, windows: [...base.windows, base.windows[0]] }), /重复/);
  assert.throws(() => assertProviderContract('codex', {
    ...base, windows: [{ ...base.windows[0], value: -1 }],
  }), /不能为负数/);
});

test('contract returns an exact browser allowlist and redacts account and path hints', () => {
  const sentinel = 'sentinel-provider-secret';
  const result = assertProviderContract('codex', {
    id: 'codex', label: 'Codex', status: 'ok', updatedAt: NOW.toISOString(),
    account: 'builder@example.com', plan: 'pro', source: '/Users/private/.codex/auth.json',
    credential: sentinel, rawResponse: { token: sentinel },
    notice: 'Provider-reported subscription quota; not an API rate limit.',
    resetCredits: {
      availableCount: 3.9, nextExpiry: '2026-08-13T12:00:00Z', secret: sentinel,
    },
    windows: [{
      id: 'primary', label: '5 小时', usedPercent: 25, remainingPercent: 75,
      resetsAt: '2026-08-12T15:00:00.000Z', detail: '/private/secret/quota.json',
      providerExtra: sentinel,
    }],
  });
  assert.deepEqual(Object.keys(result), [
    'id', 'label', 'status', 'account', 'plan', 'source', 'notice', 'resetCredits',
    'updatedAt', 'windows',
  ]);
  assert.deepEqual(Object.keys(result.windows[0]), [
    'id', 'label', 'usedPercent', 'remainingPercent', 'resetsAt', 'windowSeconds',
    'value', 'limit', 'unit', 'detail',
  ]);
  assert.equal(result.account, 'b•••@example.com');
  assert.equal(result.source.startsWith('/'), false);
  assert.equal(result.windows[0].detail.startsWith('/'), false);
  assert.equal(result.notice, 'Provider-reported subscription quota; not an API rate limit.');
  assert.deepEqual(result.resetCredits, {
    availableCount: 3, nextExpiry: '2026-08-13T12:00:00.000Z',
  });
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  assert.equal(JSON.stringify(result).includes('/Users/private'), false);
});

test('optional quota facts are bounded and fail closed without widening the contract', () => {
  const result = assertProviderContract('codex', {
    id: 'codex', label: 'Codex', status: 'empty', updatedAt: NOW.toISOString(), windows: [],
    notice: ` ${'n'.repeat(400)} `,
    resetCredits: { availableCount: Number.POSITIVE_INFINITY, nextExpiry: 'not-a-date' },
  });
  assert.equal(result.notice.length, 300);
  assert.deepEqual(result.resetCredits, { availableCount: null, nextExpiry: null });
});

test('reset-credit count preserves observed zero and keeps missing or invalid values unknown', () => {
  const base = {
    id: 'codex', label: 'Codex', status: 'empty', updatedAt: NOW.toISOString(), windows: [],
  };
  assert.equal(assertProviderContract('codex', {
    ...base, resetCredits: { availableCount: 0 },
  }).resetCredits.availableCount, 0);
  assert.equal(assertProviderContract('codex', {
    ...base, resetCredits: { availableCount: null },
  }).resetCredits.availableCount, null);
  assert.equal(assertProviderContract('codex', {
    ...base, resetCredits: { availableCount: '0' },
  }).resetCredits.availableCount, null);
});

test('optional provider display text redacts embedded absolute paths', () => {
  const result = assertProviderContract('codex', {
    id: 'codex', label: 'Codex', status: 'empty', updatedAt: NOW.toISOString(), windows: [],
    source: 'loaded from /Users/sentinel/.codex/auth.json',
    notice: 'Private detail at /private/sentinel/quota.json is omitted.',
  });
  assert.equal(JSON.stringify(result).includes('/Users/sentinel'), false);
  assert.equal(JSON.stringify(result).includes('/private/sentinel'), false);
  assert.match(result.source, /\[local path\]/);
  assert.match(result.notice, /\[local path\]/);
});
