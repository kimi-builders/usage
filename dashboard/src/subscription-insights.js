import { TOKEN_FIELDS, sumBuckets, tokenTotal } from './analytics.js';
import {
  buildCycleCapacityStats, buildPortfolioReview, buildRenewalReview,
} from './subscription-review.js';

const PROVIDER_SOURCES = {
  'kimi-code': ['kimi-code'],
  codex: ['codex'],
  'claude-code': ['claude-code'],
  cursor: ['cursor'],
  copilot: ['copilot-cli'],
  opencode: ['opencode'],
  antigravity: ['antigravity'],
  qoder: ['qoder'],
  warp: ['warp'],
  'jetbrains-ai': ['jetbrains-ai'],
};

const MODEL_FAMILY_ATTRIBUTIONS = {
  deepseek: 'deepseek',
};

const DAY_SECONDS = 86_400;
const MONTH_SECONDS = DAY_SECONDS * 30;
const EVIDENCE_SKEW_TOLERANCE_MS = 5 * 60 * 1_000;
const QUOTA_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;

export const BENEFIT_VIEW_RANGES = ['30d', '90d', 'all'];

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

function subscriptionSettingsForProvider(provider, settings) {
  const providerSettings = settings?.providers?.[provider.id] || {};
  if (provider.id !== 'opencode' || !Array.isArray(providerSettings.accounts)) return providerSettings;
  const accountId = provider.accountId || providerSettings.activeAccountId;
  return providerSettings.accounts.find((account) => account.id === accountId)
    || providerSettings.accounts.find((account) => account.id === providerSettings.activeAccountId)
    || providerSettings.accounts[0]
    || {};
}

function normalizedSubscriptionFacts(subscription = {}) {
  const entitlementType = normalizedEntitlementType(subscription);
  const isPaid = entitlementType === 'paid';
  const enteredPrice = finite(subscription.subscriptionPrice);
  const price = isPaid && enteredPrice > 0 ? enteredPrice : null;
  const billingCycle = subscription.billingCycle === 'yearly' ? 'yearly' : 'monthly';
  return {
    entitlementType,
    isPaid,
    price,
    monthlyPrice: price == null ? null : billingCycle === 'yearly' ? price / 12 : price,
    currency: subscription.subscriptionCurrency === 'cny' ? 'cny' : 'usd',
    billingCycle,
    renewsAt: isPaid ? subscription.renewsAt || null : null,
  };
}

function subscriptionRecordsForSummary(providers, settings) {
  return providers.flatMap((provider) => {
    if (provider.id !== 'opencode') return [provider.subscription];
    const accounts = settings?.providers?.opencode?.accounts;
    if (!Array.isArray(accounts) || !accounts.length) return [provider.subscription];
    return accounts.map((account) => normalizedSubscriptionFacts(account));
  });
}

function hasQuotaFact(window) {
  return finite(window?.usedPercent) != null
    || finite(window?.remainingPercent) != null
    || (finite(window?.limit) > 0 && finite(window?.value) != null);
}

function timestamp(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function normalizeQuotaWindow(window) {
  const suppliedUsed = finite(window?.usedPercent);
  const suppliedRemaining = finite(window?.remainingPercent);
  const value = finite(window?.value);
  const limit = finite(window?.limit);
  const ratioUsed = suppliedUsed == null && suppliedRemaining == null && limit > 0 && value != null
    ? Math.max(0, Math.min(100, value / limit * 100))
    : null;
  const usedPercent = suppliedUsed
    ?? (suppliedRemaining == null ? ratioUsed : 100 - suppliedRemaining);
  const remainingPercent = suppliedRemaining
    ?? (usedPercent == null ? null : 100 - usedPercent);
  return {
    ...window,
    usedPercent: usedPercent == null ? null : Math.max(0, Math.min(100, usedPercent)),
    remainingPercent: remainingPercent == null ? null : Math.max(0, Math.min(100, remainingPercent)),
  };
}

function evidenceClock(usageObservedAt, quotaObservedAt) {
  if (usageObservedAt == null) return {
    state: 'local-timestamp-missing', lagMs: null, joinEligible: false,
  };
  if (quotaObservedAt == null) return {
    state: 'quota-timestamp-missing', lagMs: null, joinEligible: false,
  };
  const lagMs = quotaObservedAt - usageObservedAt;
  const localStale = lagMs > EVIDENCE_SKEW_TOLERANCE_MS;
  const quotaOlder = lagMs < -EVIDENCE_SKEW_TOLERANCE_MS;
  return {
    state: localStale ? 'local-stale' : quotaOlder ? 'quota-older' : 'aligned',
    lagMs,
    joinEligible: !localStale,
  };
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
  // A reported reset is the cycle boundary even when the observation arrived
  // after it. Moving an expired boundary to `now` would fabricate a new cycle.
  const start = Number.isFinite(reset) ? reset - seconds * 1_000 : now - seconds * 1_000;
  const end = Number.isFinite(reset) && reset <= now ? reset : now;
  return { start, end, seconds };
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

function groupDimension(buckets, keyOf, labelOf = keyOf) {
  const groups = new Map();
  for (const bucket of buckets) {
    const id = keyOf(bucket) || 'unknown';
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(bucket);
  }
  const rows = [...groups].map(([id, values]) => ({
    id,
    label: labelOf(values[0]) || id,
    ...sumBuckets(values),
  })).sort((left, right) => right.totalTokens - left.totalTokens);
  const total = rows.reduce((sum, row) => sum + row.totalTokens, 0);
  return rows.map((row) => ({ ...row, share: total > 0 ? row.totalTokens / total : 0 }));
}

function providerTimeline(buckets) {
  const groups = new Map();
  for (const bucket of buckets) {
    const date = new Date(bucket.bucketStart);
    if (!Number.isFinite(date.getTime())) continue;
    date.setHours(0, 0, 0, 0);
    const key = date.toISOString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bucket);
  }
  return [...groups].sort(([left], [right]) => left.localeCompare(right)).map(([key, values]) => ({
    key,
    ...sumBuckets(values),
  }));
}

function providerActivity(buckets) {
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({
    ...Object.fromEntries(TOKEN_FIELDS.map((field) => [field, 0])),
    totalTokens: 0, requestCount: 0, costMicros: 0, observed: false,
  })));
  for (const bucket of buckets) {
    const date = new Date(bucket.bucketStart);
    if (!Number.isFinite(date.getTime())) continue;
    const cell = cells[(date.getDay() + 6) % 7][date.getHours()];
    cell.observed = true;
    for (const field of TOKEN_FIELDS) cell[field] += bucket[field] || 0;
    cell.totalTokens += tokenTotal(bucket);
    cell.requestCount += bucket.requestCount || 0;
    cell.costMicros += bucket.costMicros || 0;
  }
  return cells;
}

function providerUsageRecords(buckets) {
  return [...buckets].sort((left, right) => Date.parse(right.bucketStart) - Date.parse(left.bucketStart)).map((bucket) => ({
    id: bucket.id || `${bucket.bucketStart}:${bucket.modelCanonical || bucket.model || 'unknown'}`,
    observedAt: bucket.bucketStart,
    source: bucket.source || null,
    model: bucket.modelCanonical || bucket.model || 'unknown',
    reasoningEffort: bucket.reasoningEffort || null,
    project: bucket.project || null,
    agentVersion: bucket.agentVersion || null,
    ...sumBuckets([bucket]),
  }));
}

function normalizedAttribution(value) {
  if (Array.isArray(value)) return { kind: 'source', sources: [...new Set(value)], modelFamily: null };
  if (value?.kind === 'model-family' && value.modelFamily) {
    return { kind: 'model-family', sources: [], modelFamily: String(value.modelFamily).toLowerCase() };
  }
  return {
    kind: 'source',
    sources: [...new Set(Array.isArray(value?.sources) ? value.sources : [])],
    modelFamily: null,
  };
}

function modelIdentity(bucket) {
  return [bucket?.modelCanonical, bucket?.model, bucket?.modelProvider]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ')
    .toLowerCase();
}

export function benefitUsageMatches(bucket, attribution) {
  const scope = normalizedAttribution(attribution);
  return matchesNormalizedAttribution(bucket, scope);
}

function matchesNormalizedAttribution(bucket, scope) {
  if (scope.kind === 'model-family') {
    const escaped = scope.modelFamily.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`).test(modelIdentity(bucket));
  }
  return scope.sources.includes(bucket?.source);
}

export function filterBenefitUsageBuckets(snapshot, attribution) {
  const scope = normalizedAttribution(attribution);
  return (Array.isArray(snapshot?.buckets) ? snapshot.buckets : [])
    .filter((bucket) => matchesNormalizedAttribution(bucket, scope));
}

function normalizedBenefitRange(range) {
  return BENEFIT_VIEW_RANGES.includes(range) ? range : 'all';
}

function benefitReferenceTime(snapshot, now, buckets) {
  const explicit = Number.isFinite(now) ? now : null;
  const generated = timestamp(snapshot?.generatedAt);
  if (explicit != null) return explicit;
  if (generated != null) return generated;
  return buckets.reduce((latest, bucket) => {
    const time = timestamp(bucket.bucketStart);
    return time == null ? latest : Math.max(latest, time);
  }, Number.NEGATIVE_INFINITY);
}

export function localEvidenceDayKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function filterBenefitUsageRecords(records, range = 'all', referenceAt = null) {
  const normalized = normalizedBenefitRange(range);
  const values = Array.isArray(records) ? records : [];
  if (normalized === 'all') return [...values];
  const fallback = values.reduce((latest, row) => {
    const time = timestamp(row.observedAt);
    return time == null ? latest : Math.max(latest, time);
  }, Number.NEGATIVE_INFINITY);
  const end = timestamp(referenceAt) ?? (Number.isFinite(referenceAt) ? referenceAt : null)
    ?? (Number.isFinite(fallback) ? fallback : null);
  if (end == null) return [];
  const days = normalized === '30d' ? 30 : 90;
  const start = end - days * DAY_SECONDS * 1_000;
  return values.filter((row) => {
    const time = timestamp(row.observedAt);
    return time != null && time >= start && time <= end;
  });
}

export function nearestBenefitObservation(records, observedAt) {
  const target = timestamp(observedAt);
  if (target == null) return null;
  return (Array.isArray(records) ? records : []).reduce((nearest, row) => {
    const time = timestamp(row.observedAt);
    if (time == null) return nearest;
    const distance = Math.abs(time - target);
    return nearest == null || distance < nearest.distance ? { row, distance } : nearest;
  }, null)?.row || null;
}

// Activity and distribution views may choose a local evidence window without
// changing quota, value, capacity, or decision signals built from full history.
export function buildSubscriptionViewUsage(snapshot, attribution, range = 'all', { now = null, windowStart = null, windowEnd = null } = {}) {
  const normalized = normalizedBenefitRange(range);
  const scope = normalizedAttribution(attribution);
  const allBuckets = filterBenefitUsageBuckets(snapshot, scope);
  const sources = new Set(scope.kind === 'source'
    ? scope.sources
    : allBuckets.map((bucket) => bucket.source).filter(Boolean));
  const referenceAt = benefitReferenceTime(snapshot, now, allBuckets);
  // A custom window (single-week mode) wins over the rolling range windows.
  const custom = Number.isFinite(windowStart) && Number.isFinite(windowEnd) && windowEnd > windowStart;
  const days = normalized === '30d' ? 30 : normalized === '90d' ? 90 : null;
  const start = custom ? windowStart : days == null || !Number.isFinite(referenceAt)
    ? null
    : referenceAt - days * DAY_SECONDS * 1_000;
  const end = custom ? windowEnd : referenceAt;
  const buckets = !custom && normalized === 'all' ? allBuckets : allBuckets.filter((bucket) => {
    const time = timestamp(bucket.bucketStart);
    if (time == null) return false;
    return start != null && time >= start && time <= end;
  });
  return {
    range: normalized,
    sources: [...sources],
    attribution: scope,
    evidenceStart: start == null ? null : new Date(start).toISOString(),
    evidenceEnd: Number.isFinite(end) ? new Date(end).toISOString() : null,
    bucketCount: buckets.length,
    totals: sumBuckets(buckets),
    activity: providerActivity(buckets),
    modelRows: groupModels(buckets),
    projectRows: groupDimension(buckets, (bucket) => bucket.project || 'private', (bucket) => bucket.project || 'Private / hidden'),
    effortRows: groupDimension(buckets, (bucket) => bucket.reasoningEffort || 'not-recorded', (bucket) => bucket.reasoningEffort || 'Not recorded'),
  };
}

function confidence({ coverage, usedPercent, requestCount }) {
  if (coverage >= 0.9 && usedPercent >= 15 && requestCount >= 10) return 'high';
  if (coverage >= 0.5 && usedPercent >= 5 && requestCount >= 3) return 'medium';
  return 'low';
}

function enrichWindow(window, buckets, sourceHistoryStart, modelRates, quotaObservedAt, usageObservedAt, providerStale = false) {
  const normalized = normalizeQuotaWindow(window);
  const reset = timestamp(normalized.resetsAt);
  const expired = reset != null && quotaObservedAt != null && reset <= quotaObservedAt;
  const bounds = quotaObservedAt == null
    ? { start: null, end: null, seconds: inferredWindowSeconds(normalized) }
    : windowBounds(normalized, quotaObservedAt);
  const clock = evidenceClock(usageObservedAt, quotaObservedAt);
  const cycleEligible = clock.joinEligible && !expired;
  const localEnd = bounds.end == null || usageObservedAt == null
    ? null
    : Math.min(bounds.end, usageObservedAt);
  const observed = bounds.start == null
    ? []
    : buckets.filter((bucket) => {
      const time = Date.parse(bucket.bucketStart);
      return Number.isFinite(time) && localEnd != null && time >= bounds.start && time <= localEnd;
    });
  const totals = sumBuckets(observed);
  const usedPercent = finite(normalized.usedPercent);
  const remainingPercent = finite(normalized.remainingPercent);
  const fractionUsed = usedPercent != null ? Math.max(0, Math.min(1, usedPercent / 100)) : 0;
  const observedCoverage = bounds.start == null || bounds.end == null || sourceHistoryStart == null || localEnd == null
    ? 0
    : Math.max(0, Math.min(1,
      (localEnd - Math.max(bounds.start, sourceHistoryStart)) / Math.max(1, bounds.end - bounds.start),
    ));
  const coverage = cycleEligible ? observedCoverage : 0;
  const estimatedCapacityTokens = cycleEligible && fractionUsed >= 0.01 && totals.totalTokens > 0
    ? Math.round(totals.totalTokens / fractionUsed)
    : null;
  const estimatedRemainingTokens = estimatedCapacityTokens != null && remainingPercent != null
    ? Math.round(estimatedCapacityTokens * Math.max(0, Math.min(100, remainingPercent)) / 100)
    : null;
  const equivalentBudgetMicros = cycleEligible && fractionUsed >= 0.01 && totals.costMicros > 0
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
    ...normalized,
    stale: Boolean(normalized.stale) || expired || providerStale,
    expired,
    windowSeconds: bounds.seconds,
    observedFrom: bounds.start == null ? null : new Date(bounds.start).toISOString(),
    evidenceObservedAt: quotaObservedAt == null ? null : new Date(quotaObservedAt).toISOString(),
    evidenceClock: clock,
    localTotals: totals,
    modelRows: groupModels(observed),
    historyCoverage: coverage,
    localObservedCoverage: observedCoverage,
    localObserved: observed.length > 0 || observedCoverage > 0,
    estimatedCapacityTokens,
    estimatedRemainingTokens,
    monthlyEquivalentTokens: estimatedCapacityTokens != null && bounds.seconds
      ? Math.round(estimatedCapacityTokens * MONTH_SECONDS / bounds.seconds)
      : null,
    estimationConfidence: confidence({ coverage, usedPercent, requestCount: totals.requestCount }),
    modelScenarios,
  };
}

function providerSources(providerId) {
  return PROVIDER_SOURCES[providerId] || [providerId];
}

function providerAttribution(providerId) {
  const modelFamily = MODEL_FAMILY_ATTRIBUTIONS[providerId];
  return modelFamily
    ? { kind: 'model-family', sources: [], modelFamily }
    : { kind: 'source', sources: providerSources(providerId), modelFamily: null };
}

function totalsAtObservation(buckets, window, observedAt, sourceHistoryStart, usageObservedAt) {
  const end = Date.parse(observedAt);
  const seconds = inferredWindowSeconds(window);
  const clock = evidenceClock(usageObservedAt, Number.isFinite(end) ? end : null);
  if (!Number.isFinite(end) || !seconds) return {
    totals: sumBuckets([]), coverage: 0, observedCoverage: 0, evidenceClock: clock,
  };
  const reset = Date.parse(window.resetsAt);
  const start = Number.isFinite(reset) && reset >= end
    ? reset - seconds * 1_000
    : end - seconds * 1_000;
  const localEnd = usageObservedAt == null ? null : Math.min(end, usageObservedAt);
  const localBuckets = buckets.filter((bucket) => {
    const time = Date.parse(bucket.bucketStart);
    return Number.isFinite(time) && localEnd != null && time >= start && time <= localEnd;
  });
  const totals = sumBuckets(localBuckets);
  const observedCoverage = sourceHistoryStart == null || localEnd == null
    ? 0
    : Math.max(0, Math.min(1,
      (localEnd - Math.max(start, sourceHistoryStart)) / Math.max(1, end - start),
    ));
  return {
    totals,
    coverage: clock.joinEligible ? observedCoverage : 0,
    observedCoverage,
    observed: localBuckets.length > 0 || observedCoverage > 0,
    evidenceClock: clock,
  };
}

function historyWindows(history, providerId, accountId, buckets, sourceHistoryStart, usageObservedAt) {
  const groups = new Map();
  for (const observation of history?.observations || []) {
    const provider = observation.providers?.find((item) => (
      item.id === providerId && (accountId ? item.accountId === accountId : !item.accountId)
    ));
    const hasProviderTime = Object.prototype.hasOwnProperty.call(provider || {}, 'observedAt');
    const providerTime = timestamp(provider?.observedAt);
    const legacyTime = hasProviderTime ? null : timestamp(observation.observedAt);
    const observedAt = providerTime ?? legacyTime;
    if (observedAt == null) continue;
    const providerObservedAt = new Date(observedAt).toISOString();
    for (const window of provider?.windows || []) {
      const normalized = normalizeQuotaWindow(window);
      if (!hasQuotaFact(normalized)) continue;
      if (!groups.has(normalized.id)) groups.set(normalized.id, []);
      const local = totalsAtObservation(buckets, normalized, providerObservedAt, sourceHistoryStart, usageObservedAt);
      groups.get(normalized.id).push({
        ...normalized,
        observedAt: providerObservedAt,
        localTotals: local.totals,
        localCoverage: local.coverage,
        localObservedCoverage: local.observedCoverage,
        localObserved: local.observed,
        localEvidenceState: local.evidenceClock.state,
        evidenceClock: local.evidenceClock,
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
  if (!seconds || !Number.isFinite(reset) || reset <= now || usedPercent == null) return null;
  const start = reset - seconds * 1_000;
  const elapsedFraction = Math.max(0, Math.min(1, (now - start) / (seconds * 1_000)));
  if (elapsedFraction < 0.03) return {
    elapsedFraction, projectedFinalPercent: null, burnPercentPerHour: null, projectedExhaustAt: null,
  };
  const currentCycle = (window.historyPoints || []).filter((point) => (
    point.resetsAt === window.resetsAt && Date.parse(point.observedAt) <= now
      && finite(point.usedPercent) != null
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
  if (provider.balanceObservation?.state === 'current' && provider.quotaObservation?.state === 'unavailable') {
    signals.push({
      code: 'balance-only', tone: 'info', localTokens: provider.lifetimeTotals.totalTokens,
      currencies: provider.balanceObservation.currencies,
    });
  } else if (provider.quotaObservation?.state === 'unavailable') {
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
      usedPercent: finite(exhaustedWindow.usedPercent), evidenceObservedAt: exhaustedWindow.evidenceObservedAt,
      evidenceTimestampSource: provider.evidenceClock?.quotaTimestampSource || null, ...(exhaustedWindow.pace || {}) });
  } else if (paceWindow?.pace.elapsedFraction >= 0.1 && paceWindow.pace.projectedFinalPercent >= 110) {
    signals.push({ code: 'pace-high', tone: 'warning', windowId: paceWindow.id, windowLabel: paceWindow.label,
      usedPercent: finite(paceWindow.usedPercent), evidenceObservedAt: paceWindow.evidenceObservedAt,
      evidenceTimestampSource: provider.evidenceClock?.quotaTimestampSource || null, ...paceWindow.pace });
  } else if (paceWindow?.pace.elapsedFraction >= 0.5 && paceWindow.pace.projectedFinalPercent <= 45) {
    signals.push({ code: 'pace-low', tone: 'neutral', windowId: paceWindow.id, windowLabel: paceWindow.label,
      usedPercent: finite(paceWindow.usedPercent), evidenceObservedAt: paceWindow.evidenceObservedAt,
      evidenceTimestampSource: provider.evidenceClock?.quotaTimestampSource || null, ...paceWindow.pace });
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
  now = null, settings = null,
} = {}) {
  const explicitNow = Number.isFinite(now) ? now : null;
  const usageGeneratedAt = timestamp(snapshot?.generatedAt);
  const usageObservedAt = usageGeneratedAt ?? explicitNow;
  const usageReferenceAt = usageObservedAt ?? Date.now();
  const allBuckets = Array.isArray(snapshot?.buckets) ? snapshot.buckets : [];
  const providers = (limits?.providers || []).map((provider) => {
    const providerObservedAt = timestamp(provider.updatedAt);
    const quotaObservedAt = providerObservedAt;
    const quotaTimestampSource = providerObservedAt != null ? 'provider.updatedAt' : null;
    const providerEvidenceClock = evidenceClock(usageObservedAt, quotaObservedAt);
    const providerStale = quotaObservedAt != null
      && usageReferenceAt - quotaObservedAt > QUOTA_STALE_AFTER_MS;
    const attribution = providerAttribution(provider.id);
    const buckets = allBuckets.filter((bucket) => matchesNormalizedAttribution(bucket, attribution));
    const sources = new Set(attribution.kind === 'source'
      ? attribution.sources
      : buckets.map((bucket) => bucket.source).filter(Boolean));
    const sourceHistoryStart = buckets.reduce((earliest, bucket) => {
      const time = Date.parse(bucket.bucketStart);
      return Number.isFinite(time) ? Math.min(earliest, time) : earliest;
    }, Number.POSITIVE_INFINITY);
    const lifetimeTotals = sumBuckets(buckets);
    const recentBuckets = buckets.filter((bucket) => {
      const time = Date.parse(bucket.bucketStart);
      return Number.isFinite(time) && time >= usageReferenceAt - MONTH_SECONDS * 1_000 && time <= usageReferenceAt;
    });
    const recentTotals = sumBuckets(recentBuckets);
    const modelRows = groupModels(buckets);
    const recentModelRows = groupModels(recentBuckets);
    const projectRows = groupDimension(buckets, (bucket) => bucket.project || 'private', (bucket) => bucket.project || 'Private / hidden');
    const effortRows = groupDimension(buckets, (bucket) => bucket.reasoningEffort || 'not-recorded', (bucket) => bucket.reasoningEffort || 'Not recorded');
    const agentVersionRows = groupDimension(buckets, (bucket) => bucket.agentVersion || 'unknown', (bucket) => bucket.agentVersion || 'Unknown');
    const modelRates = modelRows.filter((model) => model.effectiveCostMicrosPerToken);
    const currentWindows = (provider.windows || []).map((window) => enrichWindow(
      window,
      buckets,
      Number.isFinite(sourceHistoryStart) ? sourceHistoryStart : null,
      modelRates,
      quotaObservedAt,
      usageObservedAt,
      providerStale,
    ));
    // OpenCode Go connection, quota facts, and subscription metadata all
    // belong to the selected account. Never read provider-shared cost fields.
    const subscription = subscriptionSettingsForProvider(provider, settings);
    const subscriptionFacts = normalizedSubscriptionFacts(subscription);
    const { monthlyPrice } = subscriptionFacts;
    const normalizedHistoryStart = Number.isFinite(sourceHistoryStart) ? sourceHistoryStart : null;
    const history = historyWindows(
      limits?.history, provider.id, provider.accountId || null,
      buckets, normalizedHistoryStart, usageObservedAt,
    );
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
        cycleStats: buildCycleCapacityStats(historyPoints, modelRows, quotaObservedAt ?? usageReferenceAt),
      };
      return { ...value, pace: value.stale || quotaObservedAt == null ? null : windowPace(value, quotaObservedAt) };
    });
    const currentQuotaWindows = enrichedWindows.filter((window) => !window.stale && hasQuotaFact(window));
    const historicalQuotaWindows = enrichedWindows.filter((window) => (
      window.stale && (hasQuotaFact(window) || (window.historyPoints || []).some(hasQuotaFact))
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
      observedAt: quotaObservedAt == null ? null : new Date(quotaObservedAt).toISOString(),
    };
    const balanceObservation = {
      state: provider.status === 'ok' && Array.isArray(provider.balances) && provider.balances.length
        ? 'current' : 'unavailable',
      currencies: Array.isArray(provider.balances) ? provider.balances.length : 0,
      observedAt: quotaObservedAt == null ? null : new Date(quotaObservedAt).toISOString(),
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
      attribution,
      lifetimeTotals,
      recentTotals,
      modelRows,
      recentModelRows,
      projectRows,
      effortRows,
      agentVersionRows,
      timeline: providerTimeline(buckets),
      activity: providerActivity(buckets),
      usageRecords: providerUsageRecords(buckets),
      observationLog: [...(history.values())].flat().sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt)),
      windows: enrichedWindows,
      primaryWindow,
      hasLocalUsage: lifetimeTotals.totalTokens > 0,
      subscription: subscriptionFacts,
      economics,
      quotaObservation,
      balanceObservation,
      evidenceClock: {
        ...providerEvidenceClock,
        usageObservedAt: usageObservedAt == null ? null : new Date(usageObservedAt).toISOString(),
        quotaObservedAt: quotaObservedAt == null ? null : new Date(quotaObservedAt).toISOString(),
        quotaTimestampSource,
        toleranceMs: EVIDENCE_SKEW_TOLERANCE_MS,
      },
    };
    const withReview = { ...value, renewalReview: buildRenewalReview({
      buckets,
      subscription: value.subscription,
      sourceHistoryStart: normalizedHistoryStart,
      now: usageReferenceAt,
    }) };
    return { ...withReview, decisionSignals: decisionSignals(withReview) };
  });
  // Subscription counts and spend are account facts. OpenCode Go may have
  // multiple accounts, so count every configured account once. Local Token
  // evidence remains provider-level and is intentionally not duplicated.
  const subscriptionRecords = subscriptionRecordsForSummary(providers, settings);
  const spendByCurrency = subscriptionRecords.reduce((totals, subscription) => {
    const price = subscription.monthlyPrice;
    if (subscription.isPaid && price != null) totals[subscription.currency] += price;
    return totals;
  }, { usd: 0, cny: 0 });
  const selectedSpendByCurrency = providers.reduce((totals, provider) => {
    const price = provider.subscription.monthlyPrice;
    if (provider.subscription.isPaid && price != null) totals[provider.subscription.currency] += price;
    return totals;
  }, { usd: 0, cny: 0 });
  const portfolio = buildPortfolioReview(providers, usageReferenceAt);
  // A model-family view (currently DeepSeek) intentionally overlaps Agent
  // benefit views. Portfolio totals use the union of matching local buckets so
  // the same observation is never counted twice.
  const trackedBuckets = allBuckets.filter((bucket) => providers.some((provider) => (
    matchesNormalizedAttribution(bucket, provider.attribution)
  )));
  const recentTrackedBuckets = trackedBuckets.filter((bucket) => {
    const time = Date.parse(bucket.bucketStart);
    return Number.isFinite(time) && time >= usageReferenceAt - MONTH_SECONDS * 1_000 && time <= usageReferenceAt;
  });
  const trackedTotals = sumBuckets(trackedBuckets);
  const recentTrackedTotals = sumBuckets(recentTrackedBuckets);
  const entitlementCounts = Object.fromEntries(
    ['paid', 'free', 'promotion', 'organization', 'unknown'].map((type) => [
      type, subscriptionRecords.filter((subscription) => subscription.entitlementType === type).length,
    ]),
  );
  return {
    providers,
    portfolio,
    summary: {
      trackedTokens: trackedTotals.totalTokens,
      trackedProviders: providers.filter((provider) => provider.hasLocalUsage).length,
      estimableWindows: providers.flatMap((provider) => provider.windows)
        .filter((window) => window.estimatedCapacityTokens != null).length,
      subscriptionAccounts: subscriptionRecords.length,
      spendByCurrency,
      pricedSubscriptions: subscriptionRecords.filter((subscription) => (
        subscription.isPaid && subscription.monthlyPrice != null
      )).length,
      entitlementCounts,
      classifiedProviders: subscriptionRecords.length - entitlementCounts.unknown,
      benefitProviders: entitlementCounts.free + entitlementCounts.promotion + entitlementCounts.organization,
      quotaObservableProviders: providers.filter((provider) => provider.quotaObservation.state === 'current').length,
      quotaHistoricalProviders: providers.filter((provider) => provider.quotaObservation.state === 'historical').length,
      quotaUnavailableProviders: providers.filter((provider) => provider.quotaObservation.state === 'unavailable').length,
      balanceObservableProviders: providers.filter((provider) => provider.balanceObservation.state === 'current').length,
      officialFactProviders: providers.filter((provider) => (
        provider.quotaObservation.state === 'current' || provider.balanceObservation.state === 'current'
      )).length,
      recentTokens: recentTrackedTotals.totalTokens,
      apiEquivalentUsd: recentTrackedTotals.costMicros / 1_000_000,
      portfolioValueRatio: selectedSpendByCurrency.usd > 0
        ? providers.filter((provider) => provider.subscription.isPaid
          && provider.subscription.currency === 'usd' && provider.subscription.monthlyPrice > 0)
          .reduce((sum, provider) => sum + provider.economics.apiEquivalentUsd, 0) / selectedSpendByCurrency.usd
        : null,
      historyObservations: limits?.history?.observations?.length || 0,
    },
  };
}

export function subscriptionSourceIds(providerId) {
  return [...providerSources(providerId)];
}

export function subscriptionAttribution(providerId) {
  return providerAttribution(providerId);
}

export function selectSubscriptionAccounts(limits, selections = {}) {
  if (!limits || !Array.isArray(limits.providers)) return limits;
  return {
    ...limits,
    providers: limits.providers.map((provider) => {
      if (!Array.isArray(provider.accounts) || !provider.accounts.length) return provider;
      const requested = selections[provider.id];
      const active = provider.accounts.find((account) => account.accountId === requested)
        || provider.accounts.find((account) => account.accountId === provider.activeAccountId)
        || provider.accounts[0];
      return {
        ...active,
        id: provider.id,
        label: provider.label,
        accounts: provider.accounts,
        activeAccountId: active.accountId,
        quotaCoverage: provider.quotaCoverage,
      };
    }),
  };
}

export function localTokenTotal(buckets) {
  return (buckets || []).reduce((sum, bucket) => sum + tokenTotal(bucket), 0);
}
