export const RANGE_OPTIONS = [
  { id: 'today', zh: '今天', en: 'Today' },
  { id: '24h', zh: '24H', en: '24H' },
  { id: '7d', zh: '7D', en: '7D' },
  { id: '30d', zh: '30D', en: '30D' },
  { id: '90d', zh: '90D', en: '90D' },
  { id: 'all', zh: '全部', en: 'All' },
];

export const TOKEN_FIELDS = [
  'inputTokens',
  'cacheWriteInputTokens',
  'cacheReadInputTokens',
  'outputTokens',
  'reasoningOutputTokens',
];

export function tokenTotal(bucket) {
  return bucket.totalTokens ?? TOKEN_FIELDS.reduce((sum, field) => sum + (bucket[field] || 0), 0);
}

function startOfLocalDay(date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function startOfLocalWeek(date) {
  const value = startOfLocalDay(date);
  const day = value.getDay() || 7;
  value.setDate(value.getDate() - day + 1);
  return value;
}

export function rangeStart(range, now = new Date()) {
  if (range === 'all') return null;
  if (range === 'today') return startOfLocalDay(now);
  const hours = range === '24h' ? 24 : Number.parseInt(range, 10) * 24;
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

function inRange(value, start, end) {
  const time = Date.parse(value);
  return Number.isFinite(time) && (!start || time >= start.getTime()) && time <= end.getTime();
}

function matchesDimensions(bucket, source, model) {
  return (source === 'all' || bucket.source === source)
    && (model === 'all' || (bucket.modelCanonical || bucket.model) === model);
}

function filterData(data, { range, source, model }) {
  const end = new Date(data.generatedAt);
  const start = rangeStart(range, end);
  const buckets = data.buckets.filter((bucket) => (
    inRange(bucket.bucketStart, start, end) && matchesDimensions(bucket, source, model)
  ));
  const sessions = data.sessions.filter((session) => (
    inRange(session.lastMessageAt, start, end) && (source === 'all' || session.source === source)
  ));
  const activityHours = data.activityHours.filter((hour) => (
    inRange(hour.hourStart, start, end) && (source === 'all' || hour.source === source)
  ));
  return { start, end, buckets, sessions, activityHours };
}

export function sumBuckets(buckets) {
  const totals = Object.fromEntries(TOKEN_FIELDS.map((field) => [field, 0]));
  Object.assign(totals, {
    totalTokens: 0,
    requestCount: 0,
    costMicros: 0,
    pricedTokens: 0,
    unpricedTokens: 0,
    assumedTokens: 0,
  });
  for (const bucket of buckets) {
    for (const field of TOKEN_FIELDS) totals[field] += bucket[field] || 0;
    totals.totalTokens += tokenTotal(bucket);
    totals.requestCount += bucket.requestCount || 0;
    totals.costMicros += bucket.costMicros || 0;
    totals.pricedTokens += bucket.pricedTokens || 0;
    totals.unpricedTokens += bucket.unpricedTokens || 0;
    totals.assumedTokens += bucket.assumedTokens || 0;
  }
  return totals;
}

function groupRows(buckets, keyOf) {
  const groups = new Map();
  for (const bucket of buckets) {
    const key = keyOf(bucket) || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bucket);
  }
  const rows = [...groups].map(([id, values]) => ({ id, ...sumBuckets(values) }));
  rows.sort((left, right) => right.totalTokens - left.totalTokens);
  const total = rows.reduce((sum, row) => sum + row.totalTokens, 0);
  return rows.map((row) => ({ ...row, share: total > 0 ? row.totalTokens / total : 0 }));
}

function seriesUnit(range) {
  if (range === 'today' || range === '24h') return 'hour';
  if (range === '7d' || range === '30d') return 'day';
  return 'week';
}

function unitStart(date, unit) {
  const value = new Date(date);
  if (unit === 'hour') value.setMinutes(0, 0, 0);
  else if (unit === 'day') value.setHours(0, 0, 0, 0);
  else return startOfLocalWeek(value);
  return value;
}

function addUnit(date, unit, amount = 1) {
  const value = new Date(date);
  if (unit === 'hour') value.setHours(value.getHours() + amount);
  else if (unit === 'day') value.setDate(value.getDate() + amount);
  else value.setDate(value.getDate() + amount * 7);
  return value;
}

function labelForSeries(date, unit) {
  const value = new Date(date);
  if (unit === 'hour') return value.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return value.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function buildSeries(buckets, range, start, end) {
  const unit = seriesUnit(range);
  const groups = new Map();
  for (const bucket of buckets) {
    const key = unitStart(bucket.bucketStart, unit).toISOString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bucket);
  }
  let first = start ? unitStart(start, unit) : null;
  if (!first && groups.size) first = new Date([...groups.keys()].sort()[0]);
  if (!first) first = unitStart(end, unit);
  const last = unitStart(end, unit);
  const rows = [];
  for (let cursor = first; cursor <= last; cursor = addUnit(cursor, unit)) {
    const key = cursor.toISOString();
    rows.push({ key, label: labelForSeries(key, unit), ...sumBuckets(groups.get(key) || []) });
    if (rows.length > 400) break;
  }
  return rows.map((row, index) => {
    const sample = rows.slice(Math.max(0, index - 6), index + 1);
    return { ...row, rollingAverage: sample.reduce((sum, item) => sum + item.totalTokens, 0) / sample.length };
  });
}

function dailyPeak(buckets) {
  const groups = new Map();
  for (const bucket of buckets) {
    const key = startOfLocalDay(new Date(bucket.bucketStart)).toISOString();
    groups.set(key, (groups.get(key) || 0) + tokenTotal(bucket));
  }
  return Math.max(0, ...groups.values());
}

function buildHeatmap(activityHours) {
  const cells = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const item of activityHours) {
    const date = new Date(item.hourStart);
    const mondayIndex = (date.getDay() + 6) % 7;
    cells[mondayIndex][date.getHours()] += item.activeSeconds || item.userMessageCount * 60;
  }
  const max = Math.max(0, ...cells.flat());
  const slots = cells.flatMap((row, day) => row.map((seconds, hour) => ({ day, hour, seconds })))
    .sort((left, right) => right.seconds - left.seconds)
    .slice(0, 3);
  return { cells, max, slots };
}

function topReasoning(buckets) {
  const groups = new Map();
  for (const bucket of buckets) {
    const effort = bucket.reasoningEffort;
    if (!effort) continue;
    groups.set(effort, (groups.get(effort) || 0) + tokenTotal(bucket));
  }
  return [...groups].sort((left, right) => right[1] - left[1])[0]?.[0] || null;
}

function previousData(data, selected, filters) {
  if (!selected.start) return null;
  const span = selected.end.getTime() - selected.start.getTime();
  const end = new Date(selected.start.getTime() - 1);
  const start = new Date(end.getTime() - span);
  const buckets = data.buckets.filter((bucket) => (
    inRange(bucket.bucketStart, start, end) && matchesDimensions(bucket, filters.source, filters.model)
  ));
  const activityHours = data.activityHours.filter((hour) => (
    inRange(hour.hourStart, start, end) && (filters.source === 'all' || hour.source === filters.source)
  ));
  return {
    totals: sumBuckets(buckets),
    activeSeconds: activityHours.reduce((sum, hour) => sum + hour.activeSeconds, 0),
    messageCount: activityHours.reduce((sum, hour) => sum + hour.messageCount, 0),
    userMessageCount: activityHours.reduce((sum, hour) => sum + hour.userMessageCount, 0),
  };
}

function streaks(buckets, end) {
  const days = new Set(buckets.filter((bucket) => tokenTotal(bucket) > 0).map((bucket) => startOfLocalDay(bucket.bucketStart).toISOString()));
  let longest = 0;
  let running = 0;
  let previous = null;
  for (const key of [...days].sort()) {
    const current = new Date(key);
    running = previous && current.getTime() - previous.getTime() === 86_400_000 ? running + 1 : 1;
    longest = Math.max(longest, running);
    previous = current;
  }
  let current = 0;
  let cursor = startOfLocalDay(end);
  while (days.has(cursor.toISOString())) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  const weeks = new Set(buckets.filter((bucket) => tokenTotal(bucket) > 0).map((bucket) => startOfLocalWeek(bucket.bucketStart).toISOString()));
  let weeklyCurrent = 0;
  const weekCursor = startOfLocalWeek(end);
  while (weeks.has(weekCursor.toISOString())) {
    weeklyCurrent += 1;
    weekCursor.setDate(weekCursor.getDate() - 7);
  }
  return { current, longest, weeklyCurrent };
}

function buildWeeklySeries(buckets, end) {
  const endWeek = startOfLocalWeek(end);
  const start = addUnit(endWeek, 'week', -11);
  const groups = new Map();
  for (const bucket of buckets) {
    const key = startOfLocalWeek(bucket.bucketStart).toISOString();
    groups.set(key, (groups.get(key) || 0) + tokenTotal(bucket));
  }
  const rows = [];
  for (let cursor = start; cursor <= endWeek; cursor = addUnit(cursor, 'week')) {
    const key = cursor.toISOString();
    rows.push({ key, label: labelForSeries(key, 'week'), totalTokens: groups.get(key) || 0 });
  }
  return rows;
}

export function availableModels(data, source = 'all') {
  const totals = new Map();
  for (const bucket of data.buckets) {
    if (source !== 'all' && bucket.source !== source) continue;
    const id = bucket.modelCanonical || bucket.model;
    totals.set(id, (totals.get(id) || 0) + tokenTotal(bucket));
  }
  return [...totals].sort((left, right) => right[1] - left[1]).map(([id]) => id);
}

export function analyze(data, filters) {
  const selected = filterData(data, filters);
  const totals = sumBuckets(selected.buckets);
  const inputSide = totals.inputTokens + totals.cacheWriteInputTokens + totals.cacheReadInputTokens;
  const freshInput = totals.inputTokens + totals.cacheWriteInputTokens;
  const activeSeconds = selected.activityHours.reduce((sum, hour) => sum + hour.activeSeconds, 0);
  const engagedSeconds = selected.activityHours.reduce((sum, hour) => sum + hour.engagedSeconds, 0);
  const messageCount = selected.activityHours.reduce((sum, hour) => sum + hour.messageCount, 0);
  const userMessageCount = selected.activityHours.reduce((sum, hour) => sum + hour.userMessageCount, 0);
  const sourceRows = groupRows(selected.buckets, (bucket) => bucket.source);
  const modelRows = groupRows(selected.buckets, (bucket) => bucket.modelCanonical || bucket.model);
  const projectRows = groupRows(selected.buckets, (bucket) => bucket.project || 'PRIVATE / UNKNOWN');
  const allDimensionBuckets = data.buckets.filter((bucket) => matchesDimensions(bucket, filters.source, filters.model));
  const lifetimeTotals = sumBuckets(allDimensionBuckets);
  const series = buildSeries(selected.buckets, filters.range, selected.start, selected.end);
  const previous = previousData(data, selected, filters);
  const heatmap = buildHeatmap(selected.activityHours);
  return {
    ...selected,
    totals,
    lifetimeTotals,
    previous,
    cacheHitRate: inputSide > 0 ? totals.cacheReadInputTokens / inputSide : 0,
    inputLeverage: freshInput > 0 ? totals.totalTokens / freshInput : 0,
    pricingCoverage: totals.totalTokens > 0 ? totals.pricedTokens / totals.totalTokens : 0,
    activeSeconds,
    engagedSeconds,
    messageCount,
    userMessageCount,
    avgRequestSeconds: totals.requestCount > 0 ? engagedSeconds / totals.requestCount : 0,
    sourceRows,
    modelRows,
    projectRows,
    deviceRows: totals.totalTokens ? [{ id: 'LOCAL DEVICE', ...totals, share: 1 }] : [],
    series,
    weeklySeries: buildWeeklySeries(allDimensionBuckets, selected.end),
    seriesUnit: seriesUnit(filters.range),
    peakTokens: dailyPeak(selected.buckets),
    heatmap,
    topModel: modelRows[0]?.id || null,
    topReasoning: topReasoning(selected.buckets),
    toolCount: sourceRows.length,
    streaks: streaks(allDimensionBuckets, selected.end),
    records: [...selected.buckets].sort((left, right) => right.bucketStart.localeCompare(left.bucketStart)),
  };
}
