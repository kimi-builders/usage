import { tokenTotal } from './analytics.js';

export const TOKEN_MILESTONES = [1e9, 5e9, 10e9, 50e9, 100e9];

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function validDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function startOfLocalDay(value) {
  const date = validDate(value);
  if (!date) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function addLocalDays(value, amount) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

export function localDateKey(value) {
  const date = validDate(value);
  return date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : '';
}

function localHourKey(value) {
  const date = validDate(value);
  return date ? `${localDateKey(date)}T${pad(date.getHours())}` : '';
}

function bucketValue(bucket, metric) {
  return metric === 'cost'
    ? Math.max(0, finite(bucket?.costMicros)) / 1e6
    : Math.max(0, finite(tokenTotal(bucket || {})));
}

export function percentile95(values) {
  const rows = values.map(Number).filter((value) => Number.isFinite(value) && value >= 0).sort((left, right) => left - right);
  if (!rows.length) return 0;
  return rows[Math.max(0, Math.ceil(rows.length * .95) - 1)];
}

export function budgetSignature(budget, now = new Date()) {
  if (!budget || !['tokens', 'cost'].includes(budget.metric) || !(finite(budget.target) > 0)) return '';
  return `${localDateKey(now).slice(0, 7)}:${budget.metric}:${finite(budget.target)}`;
}

export function analyzeBudget(data, budget, now = new Date()) {
  const currentTime = validDate(now) || new Date();
  const validBudget = budget && ['tokens', 'cost'].includes(budget.metric) && finite(budget.target) > 0;
  if (!validBudget) return { configured: false, metric: null, target: 0, current: 0, progress: 0 };

  const monthStart = new Date(currentTime.getFullYear(), currentTime.getMonth(), 1);
  const nextMonth = new Date(currentTime.getFullYear(), currentTime.getMonth() + 1, 1);
  const current = (data?.buckets || []).reduce((sum, bucket) => {
    const time = validDate(bucket?.bucketStart);
    return time && time >= monthStart && time <= currentTime ? sum + bucketValue(bucket, budget.metric) : sum;
  }, 0);
  const elapsedDays = Math.max(0, (currentTime.getTime() - monthStart.getTime()) / 86_400_000);
  const monthDays = new Date(currentTime.getFullYear(), currentTime.getMonth() + 1, 0).getDate();
  const mayProject = elapsedDays >= 3 && current > 0;
  const dailyAverage = mayProject ? current / elapsedDays : null;
  const projected = mayProject ? dailyAverage * monthDays : null;
  let hitDate = null;
  if (mayProject && projected > budget.target) {
    const hitDay = Math.max(1, Math.ceil(budget.target / dailyAverage));
    hitDate = new Date(currentTime.getFullYear(), currentTime.getMonth(), hitDay, 12);
    if (hitDate >= nextMonth) hitDate = null;
  }
  return {
    configured: true,
    metric: budget.metric,
    target: finite(budget.target),
    current,
    progress: Math.max(0, current / finite(budget.target)),
    elapsedDays,
    monthDays,
    mayProject,
    dailyAverage,
    projected,
    hitDate,
    exceeded: current >= finite(budget.target),
    overPace: Boolean(hitDate),
    signature: budgetSignature(budget, currentTime),
  };
}

function attribution(buckets) {
  const sourceTotals = new Map();
  const projectTotals = new Map();
  for (const bucket of buckets) {
    const total = Math.max(0, finite(tokenTotal(bucket)));
    if (bucket.source) sourceTotals.set(bucket.source, (sourceTotals.get(bucket.source) || 0) + total);
    if (bucket.project) projectTotals.set(bucket.project, (projectTotals.get(bucket.project) || 0) + total);
  }
  const top = (rows) => [...rows].sort((left, right) => right[1] - left[1])[0]?.[0] || null;
  return { source: top(sourceTotals), project: top(projectTotals) };
}

export function spikeSignature(spike) {
  if (!spike) return '';
  if (spike.kind === 'hour') return `hour:${spike.dateKey}:${pad(spike.hour)}`;
  return `session:${spike.dateKey}:${spike.source || 'unknown'}:${spike.sessionKey || spike.totalTokens}`;
}

export function analyzeSpikes(data, now = new Date()) {
  const currentTime = validDate(now) || new Date();
  const todayStart = startOfLocalDay(currentTime);
  const baselineStart = addLocalDays(todayStart, -30);
  const hourlyGroups = new Map();
  const baselineDays = new Set();
  const todayGroups = new Map();

  for (const bucket of data?.buckets || []) {
    const time = validDate(bucket?.bucketStart);
    if (!time || time > currentTime) continue;
    const total = Math.max(0, finite(tokenTotal(bucket)));
    if (time >= baselineStart && time < todayStart) {
      const key = localHourKey(time);
      baselineDays.add(localDateKey(time));
      hourlyGroups.set(key, (hourlyGroups.get(key) || 0) + total);
    } else if (time >= todayStart) {
      const key = localHourKey(time);
      const group = todayGroups.get(key) || { dateKey: localDateKey(time), hour: time.getHours(), totalTokens: 0, buckets: [] };
      group.totalTokens += total;
      group.buckets.push(bucket);
      todayGroups.set(key, group);
    }
  }

  const sampleDays = baselineDays.size;
  if (sampleDays < 7) {
    return { status: 'building', sampleDays, requiredDays: 7, hourlyP95: 0, sessionP95: 0, hourly: [], sessions: [] };
  }

  const hourlyP95 = percentile95([...hourlyGroups.values()]);
  const hourlyThreshold = Math.max(3 * hourlyP95, 1_000_000);
  const hourly = [...todayGroups.values()].filter((group) => group.totalTokens > hourlyThreshold).map((group) => {
    const details = attribution(group.buckets);
    const spike = {
      kind: 'hour', ...group, ...details,
      ratio: hourlyP95 > 0 ? group.totalTokens / hourlyP95 : null,
      baselineP95: hourlyP95,
      threshold: hourlyThreshold,
    };
    delete spike.buckets;
    return { ...spike, signature: spikeSignature(spike) };
  }).sort((left, right) => right.totalTokens - left.totalTokens);

  const baselineSessions = [];
  const todaySessions = [];
  for (const session of data?.sessions || []) {
    const time = validDate(session?.lastMessageAt);
    const totalTokens = Math.max(0, finite(session?.totalTokens));
    if (!time || !totalTokens || time > currentTime) continue;
    if (time >= baselineStart && time < todayStart) baselineSessions.push(totalTokens);
    else if (time >= todayStart) todaySessions.push({ session, time, totalTokens });
  }
  const sessionP95 = percentile95(baselineSessions);
  const sessionThreshold = Math.max(3 * sessionP95, 5_000_000);
  const sessions = baselineSessions.length ? todaySessions.filter(({ totalTokens }) => totalTokens > sessionThreshold).map(({ session, time, totalTokens }, index) => {
    const spike = {
      kind: 'session', dateKey: localDateKey(time), hour: time.getHours(), totalTokens,
      source: session.source || null, project: session.project || null,
      sessionKey: session.id || session.sessionId || `${pad(time.getHours())}-${index}`,
      ratio: sessionP95 > 0 ? totalTokens / sessionP95 : null,
      baselineP95: sessionP95,
      threshold: sessionThreshold,
    };
    return { ...spike, signature: spikeSignature(spike) };
  }).sort((left, right) => right.totalTokens - left.totalTokens) : [];

  return { status: 'ready', sampleDays, requiredDays: 7, hourlyP95, sessionP95, hourlyThreshold, sessionThreshold, hourly, sessions };
}

export function milestoneSignature(value) {
  return `tokens:${value}`;
}

function dailyTokenSeries(data, now) {
  const groups = new Map();
  for (const bucket of data?.buckets || []) {
    const time = validDate(bucket?.bucketStart);
    if (!time || time > now) continue;
    const key = localDateKey(time);
    groups.set(key, (groups.get(key) || 0) + Math.max(0, finite(tokenTotal(bucket))));
  }
  return [...groups].map(([key, totalTokens]) => ({ key, totalTokens })).sort((left, right) => left.key.localeCompare(right.key));
}

export function analyzeMilestones(data, now = new Date(), seen = []) {
  const currentTime = validDate(now) || new Date();
  const series = dailyTokenSeries(data, currentTime);
  const totalsByDay = new Map(series.map((row) => [row.key, row.totalTokens]));
  const todayStart = startOfLocalDay(currentTime);
  let cursor = totalsByDay.get(localDateKey(todayStart)) > 0 ? todayStart : addLocalDays(todayStart, -1);
  let streak = 0;
  while ((totalsByDay.get(localDateKey(cursor)) || 0) > 0) {
    streak += 1;
    cursor = addLocalDays(cursor, -1);
  }

  let cumulative = 0;
  const crossings = new Map();
  let peakDay = null;
  for (const row of series) {
    const previous = cumulative;
    cumulative += row.totalTokens;
    if (!peakDay || row.totalTokens > peakDay.totalTokens) peakDay = row;
    for (const value of TOKEN_MILESTONES) {
      if (previous < value && cumulative >= value && !crossings.has(value)) crossings.set(value, row.key);
    }
  }
  const achieved = TOKEN_MILESTONES.filter((value) => cumulative >= value);
  const nextMilestone = TOKEN_MILESTONES.find((value) => cumulative < value) || null;
  const recentStart = addLocalDays(todayStart, -6);
  const recentStartKey = localDateKey(recentStart);
  const seenSet = new Set(seen);
  const celebrations = achieved.filter((value) => {
    const crossedOn = crossings.get(value);
    return crossedOn && crossedOn >= recentStartKey && crossedOn <= localDateKey(currentTime) && !seenSet.has(milestoneSignature(value));
  }).map((value) => ({ value, crossedOn: crossings.get(value), signature: milestoneSignature(value) }));

  return {
    lifetimeTokens: cumulative,
    streak,
    achieved,
    nextMilestone,
    progress: nextMilestone ? Math.max(0, Math.min(1, cumulative / nextMilestone)) : 1,
    peakDay,
    crossings: Object.fromEntries(crossings),
    celebrations,
    series,
  };
}
