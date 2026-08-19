import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBenefitCapacityOverview, buildSubscriptionInsights, buildSubscriptionViewUsage, filterBenefitUsageRecords,
  localEvidenceDayKey, nearestBenefitObservation, selectSubscriptionAccounts, subscriptionAttribution,
  subscriptionSourceIds,
} from '../src/subscription-insights.js';

const generatedAt = '2026-08-11T12:00:00.000Z';

function bucket(id, bucketStart, model, tokens, costMicros = tokens * 2) {
  return {
    id, source: 'codex', model, modelCanonical: model, bucketStart,
    inputTokens: tokens, cacheWriteInputTokens: 0, cacheReadInputTokens: 0,
    outputTokens: 0, reasoningOutputTokens: 0, totalTokens: tokens,
    requestCount: 5, costMicros, pricedTokens: tokens, unpricedTokens: 0, assumedTokens: 0,
  };
}

const snapshot = {
  generatedAt,
  buckets: [
    bucket(1, '2026-08-11T09:00:00.000Z', 'gpt-5.6-sol', 1_000, 4_000),
    bucket(2, '2026-08-11T10:00:00.000Z', 'gpt-5.6-terra', 500, 1_000),
    bucket(3, '2026-08-03T10:00:00.000Z', 'gpt-5.6-sol', 9_000, 36_000),
  ],
};

const limits = { generatedAt, providers: [{
  id: 'codex', label: 'Codex', status: 'ok', updatedAt: generatedAt, windows: [{
    id: 'primary', label: '5 小时', usedPercent: 25, remainingPercent: 75,
    resetsAt: '2026-08-11T14:00:00.000Z', windowSeconds: 18_000,
  }],
}] };

test('links a subscription window to local tokens without using usage-page filters', () => {
  const result = buildSubscriptionInsights(snapshot, limits);
  const window = result.providers[0].windows[0];
  assert.equal(window.localTotals.totalTokens, 1_500);
  assert.equal(window.estimatedCapacityTokens, 6_000);
  assert.equal(window.estimatedRemainingTokens, 4_500);
  assert.equal(window.monthlyEquivalentTokens, 864_000);
  assert.equal(window.capacitySummary.basis, 'current-cycle');
  assert.equal(window.capacitySummary.totalTokens, 6_000);
  assert.equal(window.capacitySummary.remainingTokens, 4_500);
  assert.equal(result.providers[0].lifetimeTotals.totalTokens, 10_500);
});

test('preserves provider-reported Token totals as facts instead of estimates', () => {
  const value = structuredClone(limits);
  value.providers[0].windows[0].unit = 'tokens';
  value.providers[0].windows[0].value = 2_500;
  value.providers[0].windows[0].limit = 10_000;
  const summary = buildSubscriptionInsights(snapshot, value).providers[0].windows[0].capacitySummary;
  assert.deepEqual(summary, {
    basis: 'provider', confidence: 'high', totalTokens: 10_000,
    remainingTokens: 7_500, usedTokens: 2_500, sampledCycles: 0,
  });
});

test('uses completed-cycle history when the current Token estimate is weak', () => {
  const usage = {
    generatedAt,
    buckets: [
      bucket('coverage-start', '2026-08-09T07:00:00.000Z', 'gpt-5.6-sol', 1),
      bucket('cycle-one', '2026-08-09T09:00:00.000Z', 'gpt-5.6-sol', 7_999),
      bucket('cycle-two', '2026-08-10T09:00:00.000Z', 'gpt-5.6-sol', 12_000),
      bucket('current-cycle', '2026-08-11T11:00:00.000Z', 'gpt-5.6-sol', 100),
    ],
  };
  const value = structuredClone(limits);
  value.providers[0].windows[0].usedPercent = 1;
  value.providers[0].windows[0].remainingPercent = 99;
  value.history = { observations: [
    { observedAt: '2026-08-09T11:55:00.000Z', providers: [{ id: 'codex', windows: [{
      id: 'primary', label: '5 小时', usedPercent: 80, remainingPercent: 20,
      resetsAt: '2026-08-09T12:00:00.000Z', windowSeconds: 18_000,
    }] }] },
    { observedAt: '2026-08-10T11:55:00.000Z', providers: [{ id: 'codex', windows: [{
      id: 'primary', label: '5 小时', usedPercent: 100, remainingPercent: 0,
      resetsAt: '2026-08-10T12:00:00.000Z', windowSeconds: 18_000,
    }] }] },
  ] };

  const window = buildSubscriptionInsights(usage, value).providers[0].windows[0];
  assert.equal(window.estimationConfidence, 'low');
  assert.equal(window.cycleStats.sampledCycles, 2);
  assert.deepEqual(window.capacitySummary, {
    basis: 'historical-median', confidence: 'medium', totalTokens: 11_000,
    remainingTokens: 10_890, usedTokens: 110, sampledCycles: 2,
  });
});

test('builds model-only API-equivalent capacity scenarios and preserves uncertainty', () => {
  const window = buildSubscriptionInsights(snapshot, limits).providers[0].windows[0];
  const sol = window.modelScenarios.find((item) => item.id === 'gpt-5.6-sol');
  const terra = window.modelScenarios.find((item) => item.id === 'gpt-5.6-terra');
  assert.equal(sol.capacityTokens, 5_000);
  assert.equal(sol.remainingTokens, 3_750);
  assert.equal(terra.capacityTokens, 10_000);
  assert.equal(window.estimationConfidence, 'high');
});

test('does not fabricate token capacity when the provider reports zero consumption', () => {
  const value = structuredClone(limits);
  value.providers[0].windows[0].usedPercent = 0;
  value.providers[0].windows[0].remainingPercent = 100;
  const window = buildSubscriptionInsights(snapshot, value).providers[0].windows[0];
  assert.equal(window.estimatedCapacityTokens, null);
  assert.equal(window.modelScenarios[0].capacityTokens, null);
});

test('maps subscription providers to collector source ids', () => {
  assert.deepEqual(subscriptionSourceIds('copilot'), ['copilot-cli']);
  assert.deepEqual(subscriptionSourceIds('kimi-code'), ['kimi-code']);
  assert.deepEqual(subscriptionAttribution('deepseek'), {
    kind: 'model-family', sources: [], modelFamily: 'deepseek',
  });
});

test('attributes DeepSeek models across Agents while deduplicating portfolio totals', () => {
  const usage = { generatedAt, buckets: [
    { ...bucket('codex-deepseek', generatedAt, 'deepseek-v4-pro', 300), source: 'codex' },
    { ...bucket('cursor-deepseek', generatedAt, 'provider/model-alias', 200), source: 'cursor', modelProvider: 'deepseek' },
    { ...bucket('codex-gpt', generatedAt, 'gpt-5.6-sol', 100), source: 'codex' },
    { ...bucket('similar-name', generatedAt, 'deep-thought', 900), source: 'cursor' },
  ] };
  const value = { generatedAt, providers: [
    { id: 'codex', label: 'Codex', status: 'ok', updatedAt: generatedAt, windows: [] },
    {
      id: 'deepseek', label: 'DeepSeek', status: 'ok', updatedAt: generatedAt, windows: [],
      balances: [{ currency: 'CNY', total: 12, granted: 2, toppedUp: 10, available: true }],
    },
  ] };
  const result = buildSubscriptionInsights(usage, value);
  const deepseek = result.providers.find((provider) => provider.id === 'deepseek');

  assert.equal(deepseek.lifetimeTotals.totalTokens, 500);
  assert.deepEqual(deepseek.sources.sort(), ['codex', 'cursor']);
  assert.equal(deepseek.balanceObservation.state, 'current');
  assert.equal(deepseek.quotaObservation.state, 'unavailable');
  assert.equal(deepseek.decisionSignals[0].code, 'balance-only');
  assert.equal(result.summary.trackedTokens, 600);
  assert.equal(result.summary.balanceObservableProviders, 1);
  assert.equal(result.summary.officialFactProviders, 1);
  assert.equal(buildSubscriptionViewUsage(usage, deepseek.attribution, 'all').totals.totalTokens, 500);
});

test('selects a provider account without mixing its quota facts or history', () => {
  const multi = {
    generatedAt,
    providers: [{
      id: 'codex', label: 'Codex', quotaCoverage: 'supported', activeAccountId: 'personal',
      accounts: [
        { id: 'codex', accountId: 'personal', accountLabel: 'Personal', status: 'ok', updatedAt: generatedAt, windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 20, remainingPercent: 80 }] },
        { id: 'codex', accountId: 'work', accountLabel: 'Work', status: 'ok', updatedAt: generatedAt, windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 70, remainingPercent: 30 }] },
      ],
    }],
    history: { observations: [{ observedAt: generatedAt, providers: [
      { id: 'codex', accountId: 'personal', windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 15, remainingPercent: 85 }] },
      { id: 'codex', accountId: 'work', windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 65, remainingPercent: 35 }] },
    ] }] },
  };
  const selected = selectSubscriptionAccounts(multi, { codex: 'work' });
  const provider = buildSubscriptionInsights(snapshot, selected).providers[0];
  assert.equal(provider.accountId, 'work');
  assert.equal(provider.windows[0].usedPercent, 70);
  assert.deepEqual(provider.windows[0].historyPoints.map((point) => point.usedPercent), [65]);
});

test('summarizes like-for-like capacity across accounts without duplicating local estimates', () => {
  const now = Date.parse('2026-08-19T12:00:00.000Z');
  const personalFiveHour = {
    id: 'session', label: '5 hours', windowSeconds: 18_000,
    resetsAt: '2026-08-19T12:30:00.000Z', remainingPercent: 75, usedPercent: 25,
    capacitySummary: {
      basis: 'current-cycle', confidence: 'medium', totalTokens: 400,
      remainingTokens: 300, usedTokens: 100, sampledCycles: 0,
    },
  };
  const personalWeekly = {
    id: 'weekly', label: 'Weekly', windowSeconds: 604_800,
    resetsAt: '2026-08-23T12:00:00.000Z', remainingPercent: 50, usedPercent: 50,
    capacitySummary: {
      basis: 'provider', confidence: 'high', totalTokens: 2_000,
      remainingTokens: 1_000, usedTokens: 1_000, sampledCycles: 0,
    },
  };
  const providers = [{
    id: 'opencode', label: 'OpenCode Go', accountId: 'personal', accountLabel: 'Personal',
    windows: [personalFiveHour, personalWeekly],
    accounts: [
      { accountId: 'personal', accountLabel: 'Personal', windows: [personalFiveHour, personalWeekly] },
      { accountId: 'work', accountLabel: 'Work', windows: [
        {
          id: 'session', label: '5 hours', windowSeconds: 18_000,
          resetsAt: '2026-08-19T14:00:00.000Z', unit: 'tokens', value: 100, limit: 1_000,
          remainingPercent: 90, usedPercent: 10,
        },
        {
          id: 'weekly', label: 'Weekly', windowSeconds: 604_800,
          resetsAt: '2026-08-25T12:00:00.000Z', remainingPercent: 50, usedPercent: 50,
        },
      ] },
    ],
  }, {
    id: 'deepseek', label: 'DeepSeek', windows: [],
    balanceObservation: { state: 'current' },
  }];

  const overview = buildBenefitCapacityOverview(providers, now);
  assert.deepEqual(overview.expiringSoon, {
    remainingTokens: 300, totalTokens: 400, windowCount: 1,
    knownWindowCount: 1, complete: true, estimated: true,
  });
  assert.deepEqual(overview.fiveHour, {
    remainingTokens: 1_200, totalTokens: 1_400, windowCount: 2,
    knownWindowCount: 2, complete: true, estimated: true,
  });
  assert.deepEqual(overview.weekly, {
    remainingTokens: 1_000, totalTokens: 2_000, windowCount: 2,
    knownWindowCount: 1, complete: false, estimated: false,
  });
  assert.equal(overview.accountCount, 3);
  assert.equal(overview.resetAccountCount, 2);
  assert.equal(overview.resetRows.length, 4);
  assert.equal(overview.resetRows[1].accountLabel, 'Work');
  assert.deepEqual(overview.withoutReset.map((row) => row.label), ['DeepSeek']);
});

test('keeps actual subscription spend separate from API-equivalent value', () => {
  const settings = { providers: { codex: {
    subscriptionPrice: 2400, subscriptionCurrency: 'usd', billingCycle: 'yearly', renewsAt: '2027-01-01',
  } } };
  const result = buildSubscriptionInsights(snapshot, limits, { settings });
  assert.equal(result.providers[0].subscription.monthlyPrice, 200);
  assert.equal(result.providers[0].subscription.renewsAt, '2027-01-01');
  assert.deepEqual(result.summary.spendByCurrency, { usd: 200, cny: 0 });
  assert.equal(result.summary.pricedSubscriptions, 1);
});

test('uses the selected OpenCode account subscription without sharing metadata', () => {
  const openCodeLimits = {
    generatedAt,
    providers: [{
      id: 'opencode', label: 'OpenCode Go', activeAccountId: 'personal',
      accounts: [
        { id: 'opencode', accountId: 'personal', accountLabel: 'Personal', status: 'ok', windows: [] },
        { id: 'opencode', accountId: 'work', accountLabel: 'Work', status: 'ok', windows: [] },
      ],
    }],
  };
  const settings = { providers: { opencode: {
    activeAccountId: 'personal', entitlementType: 'paid', subscriptionPrice: 999,
    accounts: [
      { id: 'personal', entitlementType: 'free', subscriptionPrice: null },
      { id: 'work', entitlementType: 'paid', subscriptionPrice: 30, subscriptionCurrency: 'usd', billingCycle: 'monthly' },
    ],
  } } };
  const personal = buildSubscriptionInsights(snapshot, selectSubscriptionAccounts(openCodeLimits, { opencode: 'personal' }), { settings }).providers[0];
  const personalResult = buildSubscriptionInsights(snapshot, selectSubscriptionAccounts(openCodeLimits, { opencode: 'personal' }), { settings });
  const workResult = buildSubscriptionInsights(snapshot, selectSubscriptionAccounts(openCodeLimits, { opencode: 'work' }), { settings });
  const work = workResult.providers[0];
  assert.equal(personal.subscription.entitlementType, 'free');
  assert.equal(personal.subscription.monthlyPrice, null);
  assert.equal(work.subscription.entitlementType, 'paid');
  assert.equal(work.subscription.monthlyPrice, 30);
  assert.equal(personalResult.summary.subscriptionAccounts, 2);
  assert.deepEqual(personalResult.summary.entitlementCounts, {
    paid: 1, free: 1, promotion: 0, organization: 0, unknown: 0,
  });
  assert.deepEqual(personalResult.summary.spendByCurrency, { usd: 30, cny: 0 });
  assert.equal(personalResult.summary.pricedSubscriptions, 1);
  assert.equal(personalResult.summary.trackedTokens, workResult.summary.trackedTokens);
});

test('links sanitized quota history to local tokens and calculates current-cycle pace', () => {
  const value = structuredClone(limits);
  value.providers[0].windows[0].usedPercent = 30;
  value.providers[0].windows[0].remainingPercent = 70;
  value.history = { observations: [
    { observedAt: '2026-08-11T10:00:00.000Z', providers: [{ id: 'codex', windows: [{
      id: 'primary', label: '5 小时', usedPercent: 10, remainingPercent: 90,
      resetsAt: '2026-08-11T14:00:00.000Z', windowSeconds: 18_000,
    }] }] },
    { observedAt: '2026-08-11T12:00:00.000Z', providers: [{ id: 'codex', windows: [{
      id: 'primary', label: '5 小时', usedPercent: 30, remainingPercent: 70,
      resetsAt: '2026-08-11T14:00:00.000Z', windowSeconds: 18_000,
    }] }] },
  ] };
  const provider = buildSubscriptionInsights(snapshot, value).providers[0];
  assert.equal(provider.windows[0].historyPoints.length, 2);
  assert.equal(provider.windows[0].historyPoints[1].localTotals.totalTokens, 1_500);
  assert.equal(provider.windows[0].historyPoints[1].localCoverage, 1);
  assert.equal(provider.windows[0].cycleStats.observedCycles, 1);
  assert.equal(provider.windows[0].cycleStats.sampledCycles, 0);
  assert.equal(provider.windows[0].pace.burnPercentPerHour, 10);
  assert.equal(provider.windows[0].pace.projectedFinalPercent, 50);
});

test('builds traceable pace, value, and model-concentration signals', () => {
  const value = structuredClone(limits);
  value.providers[0].windows[0].usedPercent = 90;
  value.providers[0].windows[0].remainingPercent = 10;
  const settings = { providers: { codex: {
    subscriptionPrice: 0.01, subscriptionCurrency: 'usd', billingCycle: 'monthly',
  } } };
  const result = buildSubscriptionInsights(snapshot, value, { settings });
  const codes = result.providers[0].decisionSignals.map((signal) => signal.code);
  assert.ok(codes.includes('pace-high'));
  assert.ok(codes.includes('value-high'));
  assert.ok(codes.includes('model-concentration'));
  assert.equal(result.summary.historyObservations, 0);
  assert.ok(result.providers[0].economics.costPerMillionTokens > 0);
});

test('does not turn an unset subscription price into a zero-dollar plan', () => {
  const result = buildSubscriptionInsights(snapshot, limits, { settings: { providers: { codex: { subscriptionPrice: null } } } });
  assert.equal(result.providers[0].subscription.monthlyPrice, null);
  assert.equal(result.summary.pricedSubscriptions, 0);
});

test('keeps free benefits out of spend and renewal analysis while retaining usage value', () => {
  const result = buildSubscriptionInsights(snapshot, limits, { settings: { providers: { codex: {
    entitlementType: 'free', subscriptionPrice: 200, subscriptionCurrency: 'usd',
    billingCycle: 'monthly', renewsAt: '2026-09-01',
  } } } });
  const provider = result.providers[0];
  assert.equal(provider.subscription.entitlementType, 'free');
  assert.equal(provider.subscription.isPaid, false);
  assert.equal(provider.subscription.monthlyPrice, null);
  assert.equal(provider.renewalReview.applicable, false);
  assert.ok(provider.economics.apiEquivalentUsd > 0);
  assert.deepEqual(result.summary.spendByCurrency, { usd: 0, cny: 0 });
  assert.equal(result.summary.entitlementCounts.free, 1);
  assert.equal(result.portfolio.benefitProviders[0].id, 'codex');
  assert.equal(result.portfolio.paidWithoutLocalUsage.length, 0);
});

test('marks hidden official quota as unobservable without losing local token analytics', () => {
  const unavailable = { providers: [{
    id: 'codex', label: 'Codex', status: 'error', windows: [], quotaCoverage: 'best-effort',
    error: { code: 'not_configured', message: 'No official quota available' },
  }] };
  const result = buildSubscriptionInsights(snapshot, unavailable);
  const provider = result.providers[0];
  assert.equal(provider.quotaObservation.state, 'unavailable');
  assert.equal(provider.quotaObservation.bestEffort, true);
  assert.equal(provider.lifetimeTotals.totalTokens, 10_500);
  assert.ok(provider.decisionSignals.some((signal) => signal.code === 'quota-unobservable'));
  assert.equal(result.summary.quotaUnavailableProviders, 1);
  assert.equal(result.summary.quotaObservableProviders, 0);
});

test('reports an exhausted window as a fact instead of a future-risk prediction', () => {
  const value = structuredClone(limits);
  value.providers[0].windows[0].usedPercent = 100;
  value.providers[0].windows[0].remainingPercent = 0;
  const codes = buildSubscriptionInsights(snapshot, value).providers[0].decisionSignals.map((signal) => signal.code);
  assert.ok(codes.includes('exhausted'));
  assert.equal(codes.includes('pace-high'), false);
});

test('keeps historical quota charts available when the current provider request fails', () => {
  const value = {
    providers: [{ id: 'codex', label: 'Codex', status: 'error', windows: [] }],
    history: { observations: [{
      observedAt: '2026-08-11T11:00:00.000Z',
      providers: [{ id: 'codex', windows: [{
        id: 'primary', label: '5 小时', usedPercent: 20, remainingPercent: 80,
        resetsAt: '2026-08-11T14:00:00.000Z', windowSeconds: 18_000,
      }] }],
    }] },
  };
  const provider = buildSubscriptionInsights(snapshot, value).providers[0];
  assert.equal(provider.windows[0].stale, true);
  assert.equal(provider.quotaObservation.state, 'historical');
  assert.equal(provider.windows[0].historyPoints.length, 1);
  assert.equal(provider.windows[0].pace, null);
  assert.equal(provider.decisionSignals.some((signal) => signal.code === 'pace-high'), false);
});

test('builds provider-scoped trend, rhythm, distribution, and local record evidence', () => {
  const provider = buildSubscriptionInsights(snapshot, limits).providers[0];
  assert.equal(provider.timeline.length, 2);
  assert.equal(provider.timeline.at(-1).totalTokens, 1_500);
  assert.equal(provider.activity.length, 7);
  const activityTotal = provider.activity.flat().reduce((sum, cell) => sum + cell.totalTokens, 0);
  assert.equal(activityTotal, 10_500);
  assert.equal(provider.projectRows[0].id, 'private');
  assert.equal(provider.effortRows[0].id, 'not-recorded');
  assert.equal(provider.usageRecords.length, 3);
  assert.equal(provider.usageRecords[0].model, 'gpt-5.6-terra');
});

test('keeps token-type facts in provider rhythm cells for consistent hover detail', () => {
  const value = structuredClone(snapshot);
  Object.assign(value.buckets[0], {
    inputTokens: 100,
    cacheWriteInputTokens: 200,
    cacheReadInputTokens: 300,
    outputTokens: 250,
    reasoningOutputTokens: 150,
    totalTokens: 1_000,
  });
  const provider = buildSubscriptionInsights(value, limits).providers[0];
  const date = new Date(value.buckets[0].bucketStart);
  const cell = provider.activity[(date.getDay() + 6) % 7][date.getHours()];
  assert.deepEqual({
    input: cell.inputTokens,
    cacheWrite: cell.cacheWriteInputTokens,
    cacheRead: cell.cacheReadInputTokens,
    output: cell.outputTokens,
    reasoning: cell.reasoningOutputTokens,
  }, { input: 100, cacheWrite: 200, cacheRead: 300, output: 250, reasoning: 150 });
});

test('uses the provider observation clock for quota pace and suppresses stale cross-source estimates', () => {
  const value = structuredClone(limits);
  value.generatedAt = '2026-08-11T13:00:00.000Z';
  value.providers[0].updatedAt = '2026-08-11T13:00:00.000Z';
  const provider = buildSubscriptionInsights(snapshot, value).providers[0];
  const window = provider.windows[0];

  assert.equal(provider.evidenceClock.usageObservedAt, generatedAt);
  assert.equal(provider.evidenceClock.quotaObservedAt, '2026-08-11T13:00:00.000Z');
  assert.equal(provider.evidenceClock.state, 'local-stale');
  assert.equal(window.evidenceClock.joinEligible, false);
  assert.equal(window.estimatedCapacityTokens, null);
  assert.equal(window.modelScenarios.every((scenario) => scenario.capacityTokens == null), true);
  assert.equal(window.pace.elapsedFraction, 0.8);
  assert.equal(window.pace.projectedFinalPercent, 31.25);
  assert.equal(provider.decisionSignals.find((signal) => signal.code === 'pace-low').evidenceObservedAt, '2026-08-11T13:00:00.000Z');
});

test('does not replace a missing provider observation time with its container or wall clock', () => {
  const value = structuredClone(limits);
  value.generatedAt = '2026-08-11T13:00:00.000Z';
  delete value.providers[0].updatedAt;
  const provider = buildSubscriptionInsights(snapshot, value, { now: Date.parse(value.generatedAt) }).providers[0];

  assert.equal(provider.evidenceClock.quotaObservedAt, null);
  assert.equal(provider.evidenceClock.quotaTimestampSource, null);
  assert.equal(provider.windows[0].pace, null);
  assert.equal(provider.windows[0].estimatedCapacityTokens, null);
});

test('uses provider history time, not its compacted container time, for local-token joining', () => {
  const usage = structuredClone(snapshot);
  usage.buckets.push(bucket(4, '2026-08-11T11:30:00.000Z', 'gpt-5.6-sol', 2_000, 8_000));
  const value = structuredClone(limits);
  value.history = { observations: [{
    observedAt: '2026-08-11T12:30:00.000Z',
    providers: [{
      id: 'codex', observedAt: '2026-08-11T10:00:00.000Z', windows: [{
        id: 'primary', label: '5 小时', usedPercent: 10, remainingPercent: 90,
        resetsAt: '2026-08-11T14:00:00.000Z', windowSeconds: 18_000,
      }],
    }],
  }] };

  const point = buildSubscriptionInsights(usage, value).providers[0].windows[0].historyPoints[0];
  assert.equal(point.observedAt, '2026-08-11T10:00:00.000Z');
  assert.equal(point.localEvidenceState, 'quota-older');
  assert.equal(point.localTotals.totalTokens, 1_500);
  assert.equal(point.localCoverage, 1);
});

test('keeps legacy container times readable but drops an explicitly invalid provider time', () => {
  const value = structuredClone(limits);
  value.history = { observations: [{
    observedAt: '2026-08-11T10:00:00.000Z',
    providers: [{ id: 'codex', windows: [{
      id: 'primary', label: '5 小时', usedPercent: 10, remainingPercent: 90,
      resetsAt: '2026-08-11T14:00:00.000Z', windowSeconds: 18_000,
    }] }],
  }, {
    observedAt: '2026-08-11T11:00:00.000Z',
    providers: [{ id: 'codex', observedAt: null, windows: [{
      id: 'primary', label: '5 小时', usedPercent: 20, remainingPercent: 80,
      resetsAt: '2026-08-11T14:00:00.000Z', windowSeconds: 18_000,
    }] }],
  }] };

  const points = buildSubscriptionInsights(snapshot, value).providers[0].windows[0].historyPoints;
  assert.deepEqual(points.map((point) => point.observedAt), ['2026-08-11T10:00:00.000Z']);
});

test('derives quota complements without turning missing percentages into zero', () => {
  const value = structuredClone(limits);
  delete value.providers[0].windows[0].remainingPercent;
  value.providers[0].windows.push({
    id: 'unknown-ratio', label: 'Unknown ratio', usedPercent: null, remainingPercent: null,
    resetsAt: '2026-08-11T14:00:00.000Z', windowSeconds: 18_000,
  });
  value.history = { observations: [
    { observedAt: '2026-08-11T11:00:00.000Z', providers: [{ id: 'codex', windows: [{
      id: 'primary', label: '5 小时', remainingPercent: 80,
      resetsAt: '2026-08-11T14:00:00.000Z', windowSeconds: 18_000,
    }] }] },
  ] };
  const provider = buildSubscriptionInsights(snapshot, value).providers[0];
  const window = provider.windows.find((item) => item.id === 'primary');
  const unknown = provider.windows.find((item) => item.id === 'unknown-ratio');

  assert.equal(window.usedPercent, 25);
  assert.equal(window.remainingPercent, 75);
  assert.equal(window.historyPoints[0].usedPercent, 20);
  assert.equal(window.historyPoints[0].remainingPercent, 80);
  assert.equal(unknown.usedPercent, null);
  assert.equal(unknown.remainingPercent, null);
});

test('marks quota history newer than the local snapshot ineligible for cross-cycle joining', () => {
  const value = structuredClone(limits);
  value.history = { observations: [{
    observedAt: '2026-08-11T13:00:00.000Z', providers: [{ id: 'codex', windows: [{
      id: 'primary', label: '5 小时', usedPercent: 30,
      resetsAt: '2026-08-11T14:00:00.000Z', windowSeconds: 18_000,
    }] }],
  }] };
  const point = buildSubscriptionInsights(snapshot, value).providers[0].windows[0].historyPoints[0];

  assert.equal(point.localEvidenceState, 'local-stale');
  assert.ok(point.localObservedCoverage > 0);
  assert.equal(point.localCoverage, 0);
});

test('keeps an expired quota cycle historical without emitting current pace advice', () => {
  const value = structuredClone(limits);
  value.providers[0].windows[0].usedPercent = 20;
  value.providers[0].windows[0].remainingPercent = 80;
  value.providers[0].windows[0].resetsAt = generatedAt;
  value.history = { observations: [{
    observedAt: '2026-08-11T11:50:00.000Z', providers: [{ id: 'codex', windows: [{
      id: 'primary', label: '5 小时', usedPercent: 18, remainingPercent: 82,
      resetsAt: generatedAt, windowSeconds: 18_000,
    }] }],
  }] };

  const provider = buildSubscriptionInsights(snapshot, value).providers[0];
  const window = provider.windows[0];
  const codes = provider.decisionSignals.map((signal) => signal.code);

  assert.equal(window.resetsAt, generatedAt);
  assert.equal(window.expired, true);
  assert.equal(window.stale, true);
  assert.equal(window.pace, null);
  assert.equal(window.estimatedCapacityTokens, null);
  assert.equal(window.historyPoints.length, 1);
  assert.equal(provider.quotaObservation.state, 'historical');
  assert.equal(provider.quotaObservation.currentWindows, 0);
  assert.equal(provider.quotaObservation.historicalWindows, 1);
  assert.ok(codes.includes('quota-historical'));
  assert.equal(codes.some((code) => ['pace-low', 'pace-high', 'exhausted'].includes(code)), false);
});

test('treats a provider observation older than 24 hours as historical evidence', () => {
  const value = structuredClone(limits);
  value.providers[0].updatedAt = '2026-08-10T11:59:59.000Z';
  value.providers[0].windows[0].resetsAt = '2026-08-16T00:00:00.000Z';

  const provider = buildSubscriptionInsights(snapshot, value).providers[0];

  assert.equal(provider.windows[0].stale, true);
  assert.equal(provider.quotaObservation.state, 'historical');
  assert.equal(provider.quotaObservation.currentWindows, 0);
  assert.equal(provider.windows[0].pace, null);
});

test('scopes benefit activity and distribution without changing provider attribution', () => {
  const end = Date.parse(generatedAt);
  const usage = { generatedAt, buckets: [
    bucket('inside', new Date(end - 29 * 86_400_000).toISOString(), 'gpt-inside', 300),
    bucket('boundary', new Date(end - 30 * 86_400_000).toISOString(), 'gpt-boundary', 200),
    bucket('outside', new Date(end - 30 * 86_400_000 - 1).toISOString(), 'gpt-outside', 100),
    { ...bucket('other', generatedAt, 'claude', 9_000), source: 'claude-code' },
  ] };
  const all = buildSubscriptionViewUsage(usage, ['codex'], 'all');
  const month = buildSubscriptionViewUsage(usage, ['codex'], '30d');

  assert.equal(all.totals.totalTokens, 600);
  assert.equal(month.totals.totalTokens, 500);
  assert.deepEqual(month.modelRows.map((row) => row.id), ['gpt-inside', 'gpt-boundary']);
  assert.equal(month.sources.includes('claude-code'), false);
  assert.equal(buildSubscriptionInsights(usage, limits).providers[0].lifetimeTotals.totalTokens, 600);
});

test('benefit view ranges are empty-safe and invalid values preserve the all-history default', () => {
  const empty = buildSubscriptionViewUsage({ generatedAt, buckets: [] }, ['codex'], '30d');
  assert.equal(empty.totals.totalTokens, 0);
  assert.equal(empty.activity.flat().some((cell) => cell.observed), false);
  const fallback = buildSubscriptionViewUsage(snapshot, ['codex'], 'unexpected');
  assert.equal(fallback.range, 'all');
  assert.equal(fallback.totals.totalTokens, 10_500);
});

test('local evidence day keys honor the machine timezone and record windows include their boundary', () => {
  assert.equal(localEvidenceDayKey(new Date(2026, 7, 11, 23, 59)), '2026-08-11');
  assert.equal(localEvidenceDayKey(new Date(2026, 7, 12, 0, 1)), '2026-08-12');
  const end = Date.parse(generatedAt);
  const records = [
    { observedAt: new Date(end - 30 * 86_400_000).toISOString(), id: 'boundary' },
    { observedAt: new Date(end - 30 * 86_400_000 - 1).toISOString(), id: 'outside' },
  ];
  assert.deepEqual(filterBenefitUsageRecords(records, '30d', generatedAt).map((row) => row.id), ['boundary']);
});

test('quota evidence drilldown locates the nearest sanitized observation', () => {
  const rows = [
    { observedAt: '2026-08-11T10:00:00.000Z', id: 'early' },
    { observedAt: '2026-08-11T10:08:00.000Z', id: 'near' },
    { observedAt: 'invalid', id: 'invalid' },
  ];
  assert.equal(nearestBenefitObservation(rows, '2026-08-11T10:06:00.000Z').id, 'near');
  assert.equal(nearestBenefitObservation(rows, 'invalid'), null);
});
