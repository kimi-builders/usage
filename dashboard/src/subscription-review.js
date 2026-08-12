import { sumBuckets } from './analytics.js';

const DAY_MS = 86_400_000;
const MONTH_SECONDS = 30 * 86_400;

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function summarizeNumbers(values) {
  if (!values.length) return { low: null, median: null, high: null };
  return {
    low: Math.round(quantile(values, 0.25)),
    median: Math.round(quantile(values, 0.5)),
    high: Math.round(quantile(values, 0.75)),
  };
}

function addCalendarCycle(value, billingCycle, amount, anchorDay = new Date(value).getUTCDate()) {
  const date = new Date(value);
  date.setUTCDate(1);
  if (billingCycle === 'yearly') date.setUTCFullYear(date.getUTCFullYear() + amount);
  else date.setUTCMonth(date.getUTCMonth() + amount);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(anchorDay, lastDay));
  return date;
}

function renewalPeriod(renewsAt, billingCycle, now) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(renewsAt || '')) return null;
  let end = new Date(`${renewsAt}T12:00:00.000Z`);
  if (!Number.isFinite(end.getTime())) return null;
  const anchorDay = end.getUTCDate();
  for (let index = 0; end.getTime() <= now && index < 240; index += 1) {
    end = addCalendarCycle(end, billingCycle, 1, anchorDay);
  }
  const start = addCalendarCycle(end, billingCycle, -1, anchorDay);
  return { start: start.getTime(), end: end.getTime() };
}

function modelFamily(model) {
  const id = String(model || '').toLowerCase();
  if (!id || id === 'unknown') return null;
  if (/^(gpt|codex|chatgpt|o[1345](?:-|$))/.test(id)) return { id: 'openai', label: 'OpenAI' };
  if (id.includes('claude')) return { id: 'anthropic', label: 'Claude' };
  if (id.includes('kimi') || id.includes('moonshot')) return { id: 'kimi', label: 'Kimi' };
  if (id.includes('gemini')) return { id: 'google', label: 'Gemini' };
  if (id.includes('deepseek')) return { id: 'deepseek', label: 'DeepSeek' };
  if (id.includes('qwen')) return { id: 'qwen', label: 'Qwen' };
  return { id: `model:${id}`, label: model };
}

function familyDistribution(modelRows) {
  const groups = new Map();
  for (const row of modelRows || []) {
    const family = modelFamily(row.id || row.label);
    if (!family || !(row.totalTokens > 0)) continue;
    const current = groups.get(family.id) || { ...family, totalTokens: 0 };
    current.totalTokens += row.totalTokens;
    groups.set(family.id, current);
  }
  const total = [...groups.values()].reduce((sum, row) => sum + row.totalTokens, 0);
  return [...groups.values()].map((row) => ({
    ...row,
    share: total > 0 ? row.totalTokens / total : 0,
  })).sort((left, right) => right.share - left.share);
}

function overlap(leftRows, rightRows) {
  const left = new Map(familyDistribution(leftRows).map((row) => [row.id, row]));
  const right = new Map(familyDistribution(rightRows).map((row) => [row.id, row]));
  const ids = new Set([...left.keys(), ...right.keys()]);
  let shared = 0;
  let union = 0;
  const families = [];
  for (const id of ids) {
    const leftShare = left.get(id)?.share || 0;
    const rightShare = right.get(id)?.share || 0;
    const common = Math.min(leftShare, rightShare);
    shared += common;
    union += Math.max(leftShare, rightShare);
    if (common >= 0.1) families.push({
      id,
      label: left.get(id)?.label || right.get(id)?.label || id,
      sharedShare: common,
    });
  }
  return { score: union > 0 ? shared / union : 0, families };
}

export function buildCycleCapacityStats(historyPoints, modelRows, now = Date.now()) {
  const grouped = new Map();
  for (const point of historyPoints || []) {
    const reset = Date.parse(point.resetsAt);
    const seconds = finite(point.windowSeconds);
    if (!Number.isFinite(reset) || !(seconds > 0)) continue;
    const key = `${new Date(reset).toISOString()}:${seconds}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(point);
  }

  const cycles = [...grouped.values()].map((points) => {
    points.sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
    const last = [...points].reverse().find((point) => finite(point.usedPercent) != null) || points.at(-1);
    const reset = Date.parse(last?.resetsAt);
    const observed = Date.parse(last?.observedAt);
    const seconds = finite(last?.windowSeconds);
    const usedPercent = finite(last?.usedPercent);
    const tolerance = Math.max(45 * 60 * 1_000, Math.min(DAY_MS, seconds * 1_000 * 0.2));
    const completed = reset <= now;
    const nearEnd = completed && observed <= reset + 5 * 60 * 1_000 && reset - observed <= tolerance;
    const localTokens = finite(last?.localTotals?.totalTokens) || 0;
    const localCostMicros = finite(last?.localTotals?.costMicros) || 0;
    const localCoverage = Math.max(0, Math.min(1, finite(last?.localCoverage) || 0));
    const eligible = nearEnd && usedPercent >= 5 && localTokens > 0 && localCoverage >= 0.9;
    const capacityTokens = eligible ? Math.round(localTokens / (usedPercent / 100)) : null;
    const equivalentBudgetMicros = eligible && localCostMicros > 0
      ? localCostMicros / (usedPercent / 100)
      : null;
    return {
      resetAt: last?.resetsAt || null,
      observedAt: last?.observedAt || null,
      windowSeconds: seconds,
      usedPercent,
      localTokens,
      localCoverage,
      completed,
      nearEnd,
      eligible,
      capacityTokens,
      equivalentBudgetMicros,
    };
  }).sort((left, right) => Date.parse(left.resetAt) - Date.parse(right.resetAt));

  const eligible = cycles.filter((cycle) => cycle.eligible);
  const capacities = summarizeNumbers(eligible.map((cycle) => cycle.capacityTokens));
  const iqrRatio = capacities.median > 0
    ? (capacities.high - capacities.low) / capacities.median
    : null;
  const stability = iqrRatio == null ? 'unknown' : iqrRatio <= 0.25 ? 'steady' : iqrRatio <= 0.6 ? 'variable' : 'volatile';
  const confidence = eligible.length >= 4 && stability !== 'volatile'
    ? 'high'
    : eligible.length >= 2 ? 'medium' : eligible.length === 1 ? 'low' : 'none';
  const windowSeconds = eligible.at(-1)?.windowSeconds || cycles.at(-1)?.windowSeconds || null;
  const modelScenarios = (modelRows || []).filter((model) => model.effectiveCostMicrosPerToken > 0).map((model) => {
    const values = eligible.map((cycle) => cycle.equivalentBudgetMicros)
      .filter((budget) => budget > 0)
      .map((budget) => budget / model.effectiveCostMicrosPerToken);
    const range = summarizeNumbers(values);
    return {
      id: model.id,
      ...range,
      monthlyMedian: range.median != null && windowSeconds
        ? Math.round(range.median * MONTH_SECONDS / windowSeconds)
        : null,
    };
  });

  return {
    observedCycles: cycles.length,
    completedCycles: cycles.filter((cycle) => cycle.completed).length,
    sampledCycles: eligible.length,
    confidence,
    stability,
    iqrRatio,
    windowSeconds,
    ...capacities,
    monthlyMedian: capacities.median != null && windowSeconds
      ? Math.round(capacities.median * MONTH_SECONDS / windowSeconds)
      : null,
    cycles: cycles.slice(-12),
    modelScenarios,
  };
}

export function buildRenewalReview({ buckets, subscription, sourceHistoryStart, now = Date.now() }) {
  const period = renewalPeriod(subscription?.renewsAt, subscription?.billingCycle, now);
  if (!period) return {
    configured: false, periodStart: null, periodEnd: null, daysRemaining: null,
    elapsedFraction: null, coverage: 0, totals: sumBuckets([]), projectedTokens: null,
    projectedApiEquivalentUsd: null, projectedValueRatio: null,
  };
  const totals = sumBuckets((buckets || []).filter((bucket) => {
    const time = Date.parse(bucket.bucketStart);
    return Number.isFinite(time) && time >= period.start && time <= Math.min(now, period.end);
  }));
  const elapsedFraction = Math.max(0, Math.min(1, (now - period.start) / Math.max(1, period.end - period.start)));
  const coverage = sourceHistoryStart == null
    ? 0
    : sourceHistoryStart <= period.start ? 1 : Math.max(0, Math.min(1, (now - sourceHistoryStart) / Math.max(1, now - period.start)));
  const mayProject = elapsedFraction >= 0.1 && coverage >= 0.9;
  const projectedTokens = mayProject ? Math.round(totals.totalTokens / elapsedFraction) : null;
  const projectedApiEquivalentUsd = mayProject ? totals.costMicros / 1_000_000 / elapsedFraction : null;
  const cyclePrice = subscription?.price > 0 ? subscription.price : null;
  const projectedValueRatio = cyclePrice && subscription?.currency === 'usd' && projectedApiEquivalentUsd != null
    ? projectedApiEquivalentUsd / cyclePrice
    : null;
  return {
    configured: true,
    periodStart: new Date(period.start).toISOString(),
    periodEnd: new Date(period.end).toISOString(),
    daysRemaining: Math.max(0, Math.ceil((period.end - now) / DAY_MS)),
    elapsedFraction,
    coverage,
    totals,
    projectedTokens,
    projectedApiEquivalentUsd,
    projectedValueRatio,
    cyclePrice,
  };
}

export function buildPortfolioReview(providers, now = Date.now()) {
  const overlaps = [];
  for (let leftIndex = 0; leftIndex < providers.length; leftIndex += 1) {
    const left = providers[leftIndex];
    if (!(left.recentTotals?.totalTokens > 0)) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < providers.length; rightIndex += 1) {
      const right = providers[rightIndex];
      if (!(right.recentTotals?.totalTokens > 0)) continue;
      const result = overlap(left.recentModelRows, right.recentModelRows);
      if (result.score < 0.5 || !result.families.length) continue;
      overlaps.push({
        leftId: left.id, leftLabel: left.label,
        rightId: right.id, rightLabel: right.label,
        score: result.score,
        families: result.families,
        recentTokens: left.recentTotals.totalTokens + right.recentTotals.totalTokens,
        bothPriced: left.subscription.monthlyPrice != null && right.subscription.monthlyPrice != null,
      });
    }
  }
  overlaps.sort((left, right) => right.score - left.score);
  const upcomingRenewals = providers.filter((provider) => (
    provider.renewalReview?.configured && provider.renewalReview.daysRemaining <= 30
  )).sort((left, right) => left.renewalReview.daysRemaining - right.renewalReview.daysRemaining);
  const paidWithoutLocalUsage = providers.filter((provider) => (
    provider.subscription.monthlyPrice != null && provider.recentTotals.totalTokens === 0
  ));
  const configuredRenewals = providers.filter((provider) => provider.renewalReview?.configured).length;
  const pricedSubscriptions = providers.filter((provider) => provider.subscription.monthlyPrice != null).length;
  return {
    generatedAt: new Date(now).toISOString(),
    overlaps: overlaps.slice(0, 6),
    upcomingRenewals,
    paidWithoutLocalUsage,
    configuredRenewals,
    pricedSubscriptions,
    readyProviders: providers.filter((provider) => (
      provider.renewalReview?.configured && provider.subscription.monthlyPrice != null
    )).length,
  };
}
