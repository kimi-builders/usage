import { sumBuckets, tokenTotal } from './analytics.js';

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
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
    const recentTotals = sumBuckets(buckets.filter((bucket) => {
      const time = Date.parse(bucket.bucketStart);
      return Number.isFinite(time) && time >= now - MONTH_SECONDS * 1_000 && time <= now;
    }));
    const modelRows = groupModels(buckets);
    const modelRates = modelRows.filter((model) => model.effectiveCostMicrosPerToken);
    const windows = (provider.windows || []).map((window) => enrichWindow(
      window,
      buckets,
      Number.isFinite(sourceHistoryStart) ? sourceHistoryStart : null,
      modelRates,
      now,
    ));
    const primaryWindow = [...windows]
      .filter((window) => window.estimatedCapacityTokens != null && window.windowSeconds)
      .sort((left, right) => right.windowSeconds - left.windowSeconds)[0] || null;
    const subscription = settings?.providers?.[provider.id] || {};
    const price = finite(subscription.subscriptionPrice);
    const monthlyPrice = price == null ? null : subscription.billingCycle === 'yearly' ? price / 12 : price;
    return {
      ...provider,
      sources: [...sources],
      lifetimeTotals,
      recentTotals,
      modelRows,
      windows,
      primaryWindow,
      hasLocalUsage: lifetimeTotals.totalTokens > 0,
      subscription: {
        price,
        monthlyPrice,
        currency: subscription.subscriptionCurrency === 'cny' ? 'cny' : 'usd',
        billingCycle: subscription.billingCycle === 'yearly' ? 'yearly' : 'monthly',
        renewsAt: subscription.renewsAt || null,
      },
    };
  });
  const spendByCurrency = providers.reduce((totals, provider) => {
    const price = provider.subscription.monthlyPrice;
    if (price != null) totals[provider.subscription.currency] += price;
    return totals;
  }, { usd: 0, cny: 0 });
  return {
    providers,
    summary: {
      trackedTokens: providers.reduce((sum, provider) => sum + provider.lifetimeTotals.totalTokens, 0),
      trackedProviders: providers.filter((provider) => provider.hasLocalUsage).length,
      estimableWindows: providers.flatMap((provider) => provider.windows)
        .filter((window) => window.estimatedCapacityTokens != null).length,
      spendByCurrency,
      pricedSubscriptions: providers.filter((provider) => provider.subscription.monthlyPrice != null).length,
    },
  };
}

export function subscriptionSourceIds(providerId) {
  return [...providerSources(providerId)];
}

export function localTokenTotal(buckets) {
  return (buckets || []).reduce((sum, bucket) => sum + tokenTotal(bucket), 0);
}
