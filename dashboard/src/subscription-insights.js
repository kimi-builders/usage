import { sumBuckets, tokenTotal } from './analytics.js';
import {
  buildCycleCapacityStats, buildPortfolioReview, buildRenewalReview,
} from './subscription-review.js';

const PROVIDER_SOURCES = {
  'kimi-code': ['kimi-code'],
  codex: ['codex'],
  'claude-code': ['claude-code'],
  cursor: ['cursor'],
  copilot: ['copilot-cli'],
  'gemini-cli': ['gemini-cli'],
  opencode: ['opencode'],
  antigravity: ['antigravity'],
  qoder: ['qoder'],
  warp: ['warp'],
  'jetbrains-ai': ['jetbrains-ai'],
  windsurf: ['windsurf'],
};

const DAY_SECONDS = 86_400;
const MONTH_SECONDS = DAY_SECONDS * 30;

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const ENTITLEMENT_TYPES = new Set(['unknown', 'paid', 'free', 'promotion', 'organization']);

function normalizedEntitlementType(subscription) {
  if (ENTITLEMENT_TYPES.has(subscription?.entitlementType)) return subscription.entitlementType;
  // Compatibility with settings saved before entitlement types existed.
  return finite(subscription?.subscriptionPrice) > 0 ? 'paid' : 'unknown';
}

function hasQuotaFact(window) {
  return finite(window?.usedPercent) != null
    || finite(window?.remainingPercent) != null
    || (finite(window?.limit) > 0 && finite(window?.value) != null);
}

function inferredWindowSeconds(window) {
  const provided = finite(window.windowSeconds);
  if (provided > 0) return provided;
  const value = `${window.id || ''} ${window.label || ''}`.toLowerCase();
  if (/5\s*(小时|hour|hr)|five/.test(value)) return 5 * 3_600;
  if (/day|每日|daily/.test(value)) return DAY_SECONDS;
  if (/week|每周|7\s*(天|day)/.test(value)) return 7 * DAY_SECONDS;
  if (/month|月度|每月/.test(value)) return MONTH_SECONDS;
  return null;
}

function windowBounds(window, now) {
  const seconds = inferredWindowSeconds(window);
  if (!seconds) return { start: null, end: now, seconds: null };
  const reset = Date.parse(window.resetsAt);
  const end = Number.isFinite(reset) && reset > now ? reset : now;
  return { start: end - seconds * 1_000, end: now, seconds };
}

function groupModels(buckets) {
  const groups = new Map();
  for (const bucket of buckets) {
    const id = bucket.modelCanonical || bucket.model || 'unknown';
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(bucket);
  }
  const rows = [...groups].map(([id, values]) => {
    const totals = sumBuckets(values);
    return {
      id,
      label: id,
      ...totals,
      effectiveCostMicrosPerToken: totals.totalTokens > 0 && totals.costMicros > 0
        ? totals.costMicros / totals.totalTokens
        : null,
    };
  }).sort((left, right) => right.totalTokens - left.totalTokens);
  const total = rows.reduce((sum, row) => sum + row.totalTokens, 0);
  return rows.map((row) => ({ ...row, share: total > 0 ? row.totalTokens / total : 0 }));
}

function confidence({ coverage, usedPercent, requestCount }) {
  if (coverage >= 0.9 && usedPercent >= 15 && requestCount >= 10) return 'high';
  if (coverage >= 0.5 && usedPercent >= 5 && requestCount >= 3) return 'medium';
  return 'low';
}

function enrichWindow(window, buckets, sourceHistoryStart, modelRates, now) {
  const bounds = windowBounds(window, now);
  const observed = bounds.start == null
    ? []
    : buckets.filter((bucket) => {
      const time = Date.parse(bucket.bucketStart);
      return Number.isFinite(time) && time >= bounds.start && time <= bounds.end;
    });
  const totals = sumBuckets(observed);
  const suppliedUsed = finite(window.usedPercent);
  const suppliedRemaining = finite(window.remainingPercent);
  const usedPercent = suppliedUsed ?? (suppliedRemaining == null ? null : 100 - suppliedRemaining);
  const remainingPercent = suppliedRemaining ?? (usedPercent == null ? null : 100 - usedPercent);
  const fractionUsed = usedPercent != null ? Math.max(0, Math.min(1, usedPercent / 100)) : 0;
  const coverage = bounds.start == null || sourceHistoryStart == null
    ? 0
    : sourceHistoryStart <= bounds.start
      ? 1
      : Math.max(0, Math.min(1, (now - sourceHistoryStart) / Math.max(1, now - bounds.start)));
  const estimatedCapacityTokens = fractionUsed >= 0.01 && totals.totalTokens > 0
    ? Math.round(totals.totalTokens / fractionUsed)
    : null;
  const estimatedRemainingTokens = estimatedCapacityTokens != null && remainingPercent != null
    ? Math.round(estimatedCapacityTokens * Math.max(0, Math.min(100, remainingPercent)) / 100)
    : null;
  const equivalentBudgetMicros = fractionUsed >= 0.01 && totals.costMicros > 0
    ? totals.costMicros / fractionUsed
    : null;
  const modelScenarios = modelRates.map((model) => {
    const capacityTokens = equivalentBudgetMicros != null && model.effectiveCostMicrosPerToken
      ? Math.round(equivalentBudgetMicros / model.effectiveCostMicrosPerToken)
      : null;
    return {
      id: model.id,
      capacityTokens,
      remainingTokens: capacityTokens != null && remainingPercent != null
        ? Math.round(capacityTokens * Math.max(0, Math.min(100, remainingPercent)) / 100)
        : null,
      monthlyEquivalentTokens: capacityTokens != null && bounds.seconds
        ? Math.round(capacityTokens * MONTH_SECONDS / bounds.seconds)
        : null,
    };
  });
  return {
    ...window,
    windowSeconds: bounds.seconds,
    observedFrom: bounds.start == null ? null : new Date(bounds.start).toISOString(),
    localTotals: totals,
    modelRows: groupModels(observed),
    historyCoverage: coverage,
    estimatedCapacityTokens,
    estimatedRemainingTokens,
    monthlyEquivalentTokens: estimatedCapacityTokens != null && bounds.seconds
      ? Math.round(estimatedCapacityTokens * MONTH_SECONDS / bounds.seconds)
      : null,
    estimationConfidence: confidence({ coverage, usedPercent: usedPercent || 0, requestCount: totals.requestCount }),
    modelScenarios,
  };
}

function providerSources(providerId) {
  return PROVIDER_SOURCES[providerId] || [providerId];
}

function totalsAtObservation(buckets, window, observedAt, sourceHistoryStart) {
  const end = Date.parse(observedAt);
  const seconds = inferredWindowSeconds(window);
  if (!Number.isFinite(end) || !seconds) return { totals: sumBuckets([]), coverage: 0 };
  const reset = Date.parse(window.resetsAt);
  const start = Number.isFinite(reset) && reset >= end
    ? reset - seconds * 1_000
    : end - seconds * 1_000;
  const totals = sumBuckets(buckets.filter((bucket) => {
    const time = Date.parse(bucket.bucketStart);
    return Number.isFinite(time) && time >= start && time <= end;
  }));
  const coverage = sourceHistoryStart == null
    ? 0
    : sourceHistoryStart <= start ? 1 : Math.max(0, Math.min(1, (end - sourceHistoryStart) / Math.max(1, end - start)));
  return { totals, coverage };
}

function historyWindows(history, providerId, buckets, sourceHistoryStart) {
  const groups = new Map();
  for (const observation of history?.observations || []) {
    const provider = observation.providers?.find((item) => item.id === providerId);
    for (const window of provider?.windows || []) {
      if (!groups.has(window.id)) groups.set(window.id, []);
      const local = totalsAtObservation(buckets, window, observation.observedAt, sourceHistoryStart);
      groups.get(window.id).push({
        ...window,
        observedAt: observation.observedAt,
        localTotals: local.totals,
        localCoverage: local.coverage,
      });
    }
  }
  for (const points of groups.values()) {
    points.sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
  }
  return groups;
}

function windowPace(window, now) {
  const seconds = inferredWindowSeconds(window);
  const reset = Date.parse(window.resetsAt);
  const usedPercent = finite(window.usedPercent);
  if (!seconds || !Number.isFinite(reset) || usedPercent == null) return null;
  const start = reset - seconds * 1_000;
  const elapsedFraction = Math.max(0, Math.min(1, (now - start) / (seconds * 1_000)));
  if (elapsedFraction < 0.03) return {
    elapsedFraction, projectedFinalPercent: null, burnPercentPerHour: null, projectedExhaustAt: null,
  };
  const currentCycle = (window.historyPoints || []).filter((point) => (
    point.resetsAt === window.resetsAt && Date.parse(point.observedAt) <= now
  ));
  const first = currentCycle[0];
  const last = currentCycle.at(-1);
  const hours = first && last ? (Date.parse(last.observedAt) - Date.parse(first.observedAt)) / 3_600_000 : 0;
  const delta = first && last ? finite(last.usedPercent) - finite(first.usedPercent) : 0;
  const burnPercentPerHour = hours >= 0.25 && delta >= 0 ? delta / hours : null;
  const remainingHours = Math.max(0, (reset - now) / 3_600_000);
  const projectedFinalPercent = burnPercentPerHour != null
    ? usedPercent + burnPercentPerHour * remainingHours
    : usedPercent / elapsedFraction;
  const projectedExhaustAt = burnPercentPerHour > 0 && usedPercent < 100
    ? new Date(now + (100 - usedPercent) / burnPercentPerHour * 3_600_000).toISOString()
    : null;
  return {
    elapsedFraction,
    projectedFinalPercent,
    burnPercentPerHour,
    projectedExhaustAt,
  };
}

function decisionSignals(provider) {
  const signals = [];
  if (provider.quotaObservation?.state === 'unavailable') {
    signals.push({
      code: 'quota-unobservable', tone: 'info',
      bestEffort: provider.quotaObservation.bestEffort,
      localTokens: provider.lifetimeTotals.totalTokens,
    });
  } else if (provider.quotaObservation?.state === 'historical') {
    signals.push({
      code: 'quota-historical', tone: 'neutral',
      localTokens: provider.lifetimeTotals.totalTokens,
    });
  }
  const exhaustedWindow = [...provider.windows].filter((window) => !window.stale && finite(window.usedPercent) >= 99)
    .sort((left, right) => (right.windowSeconds || 0) - (left.windowSeconds || 0))[0];
  const paceWindow = [...provider.windows].filter((window) => !window.stale && window.pace?.projectedFinalPercent != null)
    .sort((left, right) => (right.windowSeconds || 0) - (left.windowSeconds || 0))[0];
  if (exhaustedWindow) {
    signals.push({ code: 'exhausted', tone: 'warning', windowId: exhaustedWindow.id, windowLabel: exhaustedWindow.label,
      usedPercent: finite(exhaustedWindow.usedPercent), ...(exhaustedWindow.pace || {}) });
  } else if (paceWindow?.pace.elapsedFraction >= 0.1 && paceWindow.pace.projectedFinalPercent >= 110) {
    signals.push({ code: 'pace-high', tone: 'warning', windowId: paceWindow.id, windowLabel: paceWindow.label,
      usedPercent: finite(paceWindow.usedPercent), ...paceWindow.pace });
  } else if (paceWindow?.pace.elapsedFraction >= 0.5 && paceWindow.pace.projectedFinalPercent <= 45) {
    signals.push({ code: 'pace-low', tone: 'neutral', windowId: paceWindow.id, windowLabel: paceWindow.label,
      usedPercent: finite(paceWindow.usedPercent), ...paceWindow.pace });
  }
  if (provider.economics.valueRatio != null && provider.economics.valueRatio >= 1.5) {
    signals.push({ code: 'value-high', tone: 'positive', valueRatio: provider.economics.valueRatio,
      apiEquivalentUsd: provider.economics.apiEquivalentUsd, monthlyPrice: provider.subscription.monthlyPrice });
  } else if (provider.economics.valueRatio != null && provider.economics.valueRatio < 0.75) {
    signals.push({ code: 'value-low', tone: 'neutral', valueRatio: provider.economics.valueRatio,
      apiEquivalentUsd: provider.economics.apiEquivalentUsd, monthlyPrice: provider.subscription.monthlyPrice });
  }
  if (provider.modelRows.length > 1 && provider.modelRows[0].share >= 0.75) {
    signals.push({ code: 'model-concentration', tone: 'info', model: provider.modelRows[0].label,
      share: provider.modelRows[0].share });
  }
  return signals;
}

export function buildSubscriptionInsights(snapshot, limits, {
  now = Date.parse(snapshot?.generatedAt) || Date.now(), settings = null,
} = {}) {
  const allBuckets = Array.isArray(snapshot?.buckets) ? snapshot.buckets : [];
  const providers = (limits?.providers || []).map((provider) => {
    const sources = new Set(providerSources(provider.id));
    const buckets = allBuckets.filter((bucket) => sources.has(bucket.source));
    const sourceHistoryStart = buckets.reduce((earliest, bucket) => {
      const time = Date.parse(bucket.bucketStart);
      return Number.isFinite(time) ? Math.min(earliest, time) : earliest;
    }, Number.POSITIVE_INFINITY);
    const lifetimeTotals = sumBuckets(buckets);
    const recentBuckets = buckets.filter((bucket) => {
      const time = Date.parse(bucket.bucketStart);
      return Number.isFinite(time) && time >= now - MONTH_SECONDS * 1_000 && time <= now;
    });
    const recentTotals = sumBuckets(recentBuckets);
    const modelRows = groupModels(buckets);
    const recentModelRows = groupModels(recentBuckets);
    const modelRates = modelRows.filter((model) => model.effectiveCostMicrosPerToken);
    const currentWindows = (provider.windows || []).map((window) => enrichWindow(
      window,
      buckets,
      Number.isFinite(sourceHistoryStart) ? sourceHistoryStart : null,
      modelRates,
      now,
    ));
    const subscription = settings?.providers?.[provider.id] || {};
    const entitlementType = normalizedEntitlementType(subscription);
    const isPaid = entitlementType === 'paid';
    const enteredPrice = finite(subscription.subscriptionPrice);
    const price = isPaid && enteredPrice > 0 ? enteredPrice : null;
    const monthlyPrice = price == null ? null : subscription.billingCycle === 'yearly' ? price / 12 : price;
    const normalizedHistoryStart = Number.isFinite(sourceHistoryStart) ? sourceHistoryStart : null;
    const history = historyWindows(limits?.history, provider.id, buckets, normalizedHistoryStart);
    const baseWindows = currentWindows.length ? currentWindows : [...history.values()].map((points) => {
      const latest = points.at(-1);
      return {
        ...latest,
        stale: true,
        localTotals: latest?.localTotals || sumBuckets([]),
        modelRows: [], modelScenarios: [], estimatedCapacityTokens: null,
        estimatedRemainingTokens: null, monthlyEquivalentTokens: null,
      };
    });
    const enrichedWindows = baseWindows.map((window) => {
      const historyPoints = history.get(window.id) || [];
      const value = {
        ...window,
        historyPoints,
        cycleStats: buildCycleCapacityStats(historyPoints, modelRows, now),
      };
      return { ...value, pace: value.stale ? null : windowPace(value, now) };
    });
    const currentQuotaWindows = enrichedWindows.filter((window) => !window.stale && hasQuotaFact(window));
    const historicalQuotaWindows = enrichedWindows.filter((window) => (
      window.stale && (window.historyPoints || []).some(hasQuotaFact)
    ));
    const quotaObservation = {
      state: currentQuotaWindows.length
        ? 'current'
        : historicalQuotaWindows.length ? 'historical'
          : provider.status === 'error' ? 'unavailable' : 'unavailable',
      currentWindows: currentQuotaWindows.length,
      historicalWindows: historicalQuotaWindows.length,
      errorCode: provider.status === 'error' ? provider.error?.code || 'provider_error' : null,
      bestEffort: provider.quotaCoverage === 'best-effort',
    };
    const primaryWindow = [...enrichedWindows]
      .filter((window) => window.estimatedCapacityTokens != null && window.windowSeconds)
      .sort((left, right) => right.windowSeconds - left.windowSeconds)[0] || null;
    const economics = {
      apiEquivalentUsd: recentTotals.costMicros / 1_000_000,
      costPerMillionTokens: monthlyPrice != null && recentTotals.totalTokens > 0
        ? monthlyPrice / recentTotals.totalTokens * 1_000_000
        : null,
      valueRatio: monthlyPrice > 0 && (subscription.subscriptionCurrency || 'usd') === 'usd'
        ? (recentTotals.costMicros / 1_000_000) / monthlyPrice
        : null,
    };
    const value = {
      ...provider,
      sources: [...sources],
      lifetimeTotals,
      recentTotals,
      modelRows,
      recentModelRows,
      windows: enrichedWindows,
      primaryWindow,
      hasLocalUsage: lifetimeTotals.totalTokens > 0,
      subscription: {
        entitlementType,
        isPaid,
        price,
        monthlyPrice,
        currency: subscription.subscriptionCurrency === 'cny' ? 'cny' : 'usd',
        billingCycle: subscription.billingCycle === 'yearly' ? 'yearly' : 'monthly',
        renewsAt: isPaid ? subscription.renewsAt || null : null,
      },
      economics,
      quotaObservation,
    };
    const withReview = { ...value, renewalReview: buildRenewalReview({
      buckets,
      subscription: value.subscription,
      sourceHistoryStart: normalizedHistoryStart,
      now,
    }) };
    return { ...withReview, decisionSignals: decisionSignals(withReview) };
  });
  const spendByCurrency = providers.reduce((totals, provider) => {
    const price = provider.subscription.monthlyPrice;
    if (provider.subscription.isPaid && price != null) totals[provider.subscription.currency] += price;
    return totals;
  }, { usd: 0, cny: 0 });
  const portfolio = buildPortfolioReview(providers, now);
  const entitlementCounts = Object.fromEntries(
    ['paid', 'free', 'promotion', 'organization', 'unknown'].map((type) => [
      type, providers.filter((provider) => provider.subscription.entitlementType === type).length,
    ]),
  );
  return {
    providers,
    portfolio,
    summary: {
      trackedTokens: providers.reduce((sum, provider) => sum + provider.lifetimeTotals.totalTokens, 0),
      trackedProviders: providers.filter((provider) => provider.hasLocalUsage).length,
      estimableWindows: providers.flatMap((provider) => provider.windows)
        .filter((window) => window.estimatedCapacityTokens != null).length,
      spendByCurrency,
      pricedSubscriptions: providers.filter((provider) => (
        provider.subscription.isPaid && provider.subscription.monthlyPrice != null
      )).length,
      entitlementCounts,
      classifiedProviders: providers.length - entitlementCounts.unknown,
      benefitProviders: entitlementCounts.free + entitlementCounts.promotion + entitlementCounts.organization,
      quotaObservableProviders: providers.filter((provider) => provider.quotaObservation.state === 'current').length,
      quotaHistoricalProviders: providers.filter((provider) => provider.quotaObservation.state === 'historical').length,
      quotaUnavailableProviders: providers.filter((provider) => provider.quotaObservation.state === 'unavailable').length,
      recentTokens: providers.reduce((sum, provider) => sum + provider.recentTotals.totalTokens, 0),
      apiEquivalentUsd: providers.reduce((sum, provider) => sum + provider.economics.apiEquivalentUsd, 0),
      portfolioValueRatio: spendByCurrency.usd > 0
        ? providers.filter((provider) => provider.subscription.isPaid
          && provider.subscription.currency === 'usd' && provider.subscription.monthlyPrice > 0)
          .reduce((sum, provider) => sum + provider.economics.apiEquivalentUsd, 0) / spendByCurrency.usd
        : null,
      historyObservations: limits?.history?.observations?.length || 0,
    },
  };
}

export function subscriptionSourceIds(providerId) {
  return [...providerSources(providerId)];
}

export function localTokenTotal(buckets) {
  return (buckets || []).reduce((sum, bucket) => sum + tokenTotal(bucket), 0);
}
