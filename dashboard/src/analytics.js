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

export const EMPTY_FILTERS = {
  range: 'today',
  sources: [],
  models: [],
  efforts: [],
  agentVersions: [],
  projects: [],
  devices: [],
};

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

function localCalendarIndex(date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

export function rangeStart(range, now = new Date()) {
  if (range === 'all') return null;
  if (range === 'today') return startOfLocalDay(now);
  if (range === '24h') return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const days = Number.parseInt(range, 10);
  if (Number.isFinite(days) && days > 0) {
    const today = startOfLocalDay(now);
    return new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  }
  return new Date(now.getTime() - 24 * 60 * 60 * 1000);
}

function selected(values, value) {
  return !values?.length || values.includes(value);
}

function localDeviceId(data) {
  const terminal = data.device?.terminal?.name || 'Terminal';
  const os = data.device?.os?.name || 'OS';
  return `${terminal} · ${os}`;
}

function normalizedFilters(filters = {}) {
  return {
    ...EMPTY_FILTERS,
    ...filters,
    sources: filters.sources || (filters.source && filters.source !== 'all' ? [filters.source] : []),
    models: filters.models || (filters.model && filters.model !== 'all' ? [filters.model] : []),
  };
}

function inRange(value, start, end) {
  const time = Date.parse(value);
  return Number.isFinite(time) && (!start || time >= start.getTime()) && time <= end.getTime();
}

function matchesBucket(bucket, filters, deviceId) {
  const model = bucket.modelCanonical || bucket.model || '';
  return selected(filters.sources, bucket.source)
    && selected(filters.models, model)
    && selected(filters.efforts, bucket.reasoningEffort || '')
    && selected(filters.agentVersions, bucket.agentVersion || '')
    && selected(filters.projects, bucket.project || '')
    && selected(filters.devices, deviceId);
}

function matchesSession(session, filters, deviceId) {
  return selected(filters.sources, session.source)
    && selected(filters.agentVersions, session.agentVersion || '')
    && selected(filters.projects, session.project || '')
    && selected(filters.devices, deviceId);
}

function filterData(data, inputFilters) {
  const filters = normalizedFilters(inputFilters);
  const end = new Date(data.generatedAt);
  const start = rangeStart(filters.range, end);
  const deviceId = localDeviceId(data);
  const buckets = data.buckets.filter((bucket) => (
    inRange(bucket.bucketStart, start, end) && matchesBucket(bucket, filters, deviceId)
  ));
  const sessions = data.sessions.filter((session) => (
    inRange(session.lastMessageAt, start, end) && matchesSession(session, filters, deviceId)
  ));
  // Activity slices currently carry source + time. Model/effort/project/version filters
  // intentionally do not fabricate a split that the source logs cannot support.
  const activityHours = data.activityHours.filter((hour) => (
    inRange(hour.hourStart, start, end)
      && selected(filters.sources, hour.source)
      && selected(filters.devices, deviceId)
  ));
  return { filters, start, end, deviceId, buckets, sessions, activityHours };
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

function groupRows(buckets, keyOf, labelOf = keyOf) {
  const groups = new Map();
  for (const bucket of buckets) {
    const key = keyOf(bucket) ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bucket);
  }
  const rows = [...groups].map(([id, values]) => ({
    id,
    label: labelOf(values[0]),
    ...sumBuckets(values),
  }));
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
  if (unit === 'hour') value.setTime(value.getTime() + amount * 3_600_000);
  else if (unit === 'day') value.setDate(value.getDate() + amount);
  else value.setDate(value.getDate() + amount * 7);
  return value;
}

function labelForSeries(date, unit, range) {
  const value = new Date(date);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hour = String(value.getHours()).padStart(2, '0');
  if (unit === 'hour') return range === 'today' ? `${hour}:00` : `${month}-${day} ${hour}:00`;
  return `${month}-${day}`;
}

function activityByUnit(activityHours, unit) {
  const groups = new Map();
  for (const item of activityHours) {
    const key = unitStart(item.hourStart, unit).toISOString();
    if (!groups.has(key)) groups.set(key, { activeSeconds: 0, engagedSeconds: 0, messageCount: 0, userMessageCount: 0 });
    const row = groups.get(key);
    row.activeSeconds += item.activeSeconds || 0;
    row.engagedSeconds += item.engagedSeconds || 0;
    row.messageCount += item.messageCount || 0;
    row.userMessageCount += item.userMessageCount || 0;
  }
  return groups;
}

function buildSeries(buckets, activityHours, range, start, end) {
  const unit = seriesUnit(range);
  const groups = new Map();
  for (const bucket of buckets) {
    const key = unitStart(bucket.bucketStart, unit).toISOString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bucket);
  }
  const activity = activityByUnit(activityHours, unit);
  let first = start ? unitStart(start, unit) : null;
  const observedKeys = [...new Set([...groups.keys(), ...activity.keys()])].sort();
  if (!first && observedKeys.length) first = new Date(observedKeys[0]);
  if (!first) first = unitStart(end, unit);
  const last = unitStart(end, unit);
  // “24H” is 24 elapsed-hour slots including the current partial hour. Flooring both
  // endpoints of a rolling 24-hour window would otherwise render 25 bars and
  // calendar-hour stepping would lose a bar during the spring DST transition.
  if (range === '24h') first = addUnit(last, 'hour', -23);
  const rows = [];
  for (let cursor = first; cursor <= last; cursor = addUnit(cursor, unit)) {
    const key = cursor.toISOString();
    rows.push({
      key,
      label: labelForSeries(key, unit, range),
      ...sumBuckets(groups.get(key) || []),
      ...(activity.get(key) || { activeSeconds: 0, engagedSeconds: 0, messageCount: 0, userMessageCount: 0 }),
    });
    if (rows.length > 400) break;
  }
  return rows.map((row, index) => {
    const sample = rows.slice(Math.max(0, index - 6), index + 1);
    return {
      ...row,
      cost: row.costMicros / 1e6,
      activeHours: row.activeSeconds / 3600,
      rollingTokens: sample.reduce((sum, item) => sum + item.totalTokens, 0) / sample.length,
      rollingCost: sample.reduce((sum, item) => sum + item.costMicros, 0) / sample.length / 1e6,
      rollingDuration: sample.reduce((sum, item) => sum + item.activeSeconds, 0) / sample.length / 3600,
    };
  });
}

export function buildHeatmap(buckets, activityHours) {
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({
    totalTokens: 0,
    costMicros: 0,
    activeSeconds: 0,
    engagedSeconds: 0,
    messageCount: 0,
    userMessageCount: 0,
    inputTokens: 0,
    cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    observed: false,
  })));
  for (const bucket of buckets) {
    const date = new Date(bucket.bucketStart);
    const cell = cells[(date.getDay() + 6) % 7][date.getHours()];
    cell.observed = true;
    cell.totalTokens += tokenTotal(bucket);
    cell.costMicros += bucket.costMicros || 0;
    for (const field of TOKEN_FIELDS) cell[field] += bucket[field] || 0;
  }
  for (const item of activityHours) {
    const date = new Date(item.hourStart);
    const cell = cells[(date.getDay() + 6) % 7][date.getHours()];
    cell.observed = true;
    cell.activeSeconds += item.activeSeconds || 0;
    cell.engagedSeconds += item.engagedSeconds || 0;
    cell.messageCount += item.messageCount || 0;
    cell.userMessageCount += item.userMessageCount || 0;
  }
  return { cells };
}

function metricOf(cell, metric) {
  if (metric === 'cost') return cell.costMicros;
  if (metric === 'duration') return cell.activeSeconds;
  if (metric === 'prompts') return cell.userMessageCount;
  return cell.totalTokens;
}

export function heatmapView(heatmap, metric) {
  const values = heatmap.cells.flat().map((cell) => metricOf(cell, metric));
  const max = Math.max(0, ...values);
  const slots = heatmap.cells.flatMap((row, day) => row.map((cell, hour) => ({
    day,
    hour,
    cell,
    value: metricOf(cell, metric),
  }))).filter((slot) => slot.value > 0)
    .sort((left, right) => right.value - left.value)
    .slice(0, 5);
  return { max, peak: slots[0] || null, slots };
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

function previousData(data, selection) {
  if (!selection.start) return null;
  const span = selection.end.getTime() - selection.start.getTime();
  const end = new Date(selection.start.getTime() - 1);
  const start = new Date(end.getTime() - span);
  const buckets = data.buckets.filter((bucket) => (
    inRange(bucket.bucketStart, start, end) && matchesBucket(bucket, selection.filters, selection.deviceId)
  ));
  const sessions = data.sessions.filter((session) => (
    inRange(session.lastMessageAt, start, end) && matchesSession(session, selection.filters, selection.deviceId)
  ));
  const activityHours = data.activityHours.filter((hour) => (
    inRange(hour.hourStart, start, end)
      && selected(selection.filters.sources, hour.source)
      && selected(selection.filters.devices, selection.deviceId)
  ));
  return {
    totals: sumBuckets(buckets),
    sessions: sessions.length,
    activeSeconds: activityHours.reduce((sum, hour) => sum + (hour.activeSeconds || 0), 0),
    engagedSeconds: activityHours.reduce((sum, hour) => sum + (hour.engagedSeconds || 0), 0),
    messageCount: activityHours.reduce((sum, hour) => sum + (hour.messageCount || 0), 0),
    userMessageCount: activityHours.reduce((sum, hour) => sum + (hour.userMessageCount || 0), 0),
  };
}

function streaks(buckets, end) {
  const days = new Set(buckets.filter((bucket) => tokenTotal(bucket) > 0).map((bucket) => startOfLocalDay(bucket.bucketStart).toISOString()));
  let longest = 0;
  let running = 0;
  let previous = null;
  for (const key of [...days].sort()) {
    const current = new Date(key);
    running = previous && localCalendarIndex(current) - localCalendarIndex(previous) === 1 ? running + 1 : 1;
    longest = Math.max(longest, running);
    previous = current;
  }
  let current = 0;
  const cursor = startOfLocalDay(end);
  while (days.has(cursor.toISOString())) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { current, longest };
}

function weeklyStreaks(buckets, end) {
  const weeks = new Set(buckets.filter((bucket) => tokenTotal(bucket) > 0).map((bucket) => startOfLocalWeek(bucket.bucketStart).toISOString()));
  let longest = 0;
  let running = 0;
  let previous = null;
  for (const key of [...weeks].sort()) {
    const current = new Date(key);
    running = previous && localCalendarIndex(current) - localCalendarIndex(previous) === 7 ? running + 1 : 1;
    longest = Math.max(longest, running);
    previous = current;
  }
  let current = 0;
  const cursor = startOfLocalWeek(end);
  while (weeks.has(cursor.toISOString())) {
    current += 1;
    cursor.setDate(cursor.getDate() - 7);
  }
  return { current, longest };
}

function buildWeeklySeries(buckets, activityHours, end) {
  const endWeek = startOfLocalWeek(end);
  const start = addUnit(endWeek, 'week', -11);
  const bucketGroups = new Map();
  for (const bucket of buckets) {
    const key = startOfLocalWeek(bucket.bucketStart).toISOString();
    if (!bucketGroups.has(key)) bucketGroups.set(key, []);
    bucketGroups.get(key).push(bucket);
  }
  const activity = activityByUnit(activityHours, 'week');
  const rows = [];
  for (let cursor = start; cursor <= endWeek; cursor = addUnit(cursor, 'week')) {
    const key = cursor.toISOString();
    const totals = sumBuckets(bucketGroups.get(key) || []);
    rows.push({
      key,
      label: labelForSeries(key, 'week', 'all'),
      ...totals,
      cost: totals.costMicros / 1e6,
      activeHours: (activity.get(key)?.activeSeconds || 0) / 3600,
    });
  }
  return rows;
}

function recordKey(bucket, grain) {
  const date = new Date(bucket.bucketStart);
  const time = grain === 'day'
    ? startOfLocalDay(date).toISOString()
    : new Date(Math.floor(date.getTime() / 1_800_000) * 1_800_000).toISOString();
  return [
    time,
    bucket.source,
    bucket.modelCanonical || bucket.model || '',
    bucket.model || '',
    bucket.reasoningEffort || '',
    bucket.agentVersion || '',
    bucket.modelProvider || '',
    bucket.project || '',
    bucket.status || '',
  ].join('\u0001');
}

export function buildRecords(buckets, grain = 'day') {
  const groups = new Map();
  for (const bucket of buckets) {
    const key = recordKey(bucket, grain);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bucket);
  }
  return [...groups.values()].map((values) => {
    const sample = values[0];
    const totals = sumBuckets(values);
    return {
      id: recordKey(sample, grain),
      time: grain === 'day' ? startOfLocalDay(sample.bucketStart).toISOString() : new Date(Math.floor(Date.parse(sample.bucketStart) / 1_800_000) * 1_800_000).toISOString(),
      source: sample.source,
      model: sample.model,
      modelCanonical: sample.modelCanonical,
      modelProvider: sample.modelProvider,
      reasoningEffort: sample.reasoningEffort,
      agentVersion: sample.agentVersion,
      project: sample.project,
      status: values.some((item) => item.status === 'unpriced') ? 'unpriced' : values.some((item) => item.status === 'partial') ? 'partial' : 'priced',
      ...totals,
    };
  }).sort((left, right) => right.time.localeCompare(left.time));
}

export function filterOptions(data) {
  const unique = (values) => [...new Set(values.filter((value) => value !== null && value !== undefined))];
  const byUsage = (valueOf) => {
    const totals = new Map();
    for (const bucket of data.buckets) {
      const value = valueOf(bucket);
      totals.set(value, (totals.get(value) || 0) + tokenTotal(bucket));
    }
    return [...totals].sort((left, right) => right[1] - left[1]).map(([value]) => value);
  };
  return {
    sources: byUsage((bucket) => bucket.source),
    models: byUsage((bucket) => bucket.modelCanonical || bucket.model || ''),
    efforts: byUsage((bucket) => bucket.reasoningEffort || ''),
    agentVersions: byUsage((bucket) => bucket.agentVersion || ''),
    projects: byUsage((bucket) => bucket.project || ''),
    devices: [localDeviceId(data)],
    rawModels: unique(data.buckets.map((bucket) => bucket.model)),
  };
}

export function availableModels(data, source = 'all') {
  return filterOptions({
    ...data,
    buckets: source === 'all' ? data.buckets : data.buckets.filter((bucket) => bucket.source === source),
  }).models;
}

export function analyze(data, inputFilters) {
  const selectedData = filterData(data, inputFilters);
  const { filters, buckets, sessions, activityHours } = selectedData;
  const totals = sumBuckets(buckets);
  const inputSide = totals.inputTokens + totals.cacheWriteInputTokens + totals.cacheReadInputTokens;
  const freshInput = totals.inputTokens + totals.cacheWriteInputTokens;
  const activeSeconds = activityHours.reduce((sum, hour) => sum + (hour.activeSeconds || 0), 0);
  const engagedSeconds = activityHours.reduce((sum, hour) => sum + (hour.engagedSeconds || 0), 0);
  const messageCount = activityHours.reduce((sum, hour) => sum + (hour.messageCount || 0), 0);
  const userMessageCount = activityHours.reduce((sum, hour) => sum + (hour.userMessageCount || 0), 0);
  const sourceRows = groupRows(buckets, (bucket) => bucket.source);
  const modelRows = groupRows(buckets, (bucket) => bucket.modelCanonical || bucket.model || '');
  const projectRows = groupRows(buckets, (bucket) => bucket.project || '', (bucket) => bucket.project || 'PRIVATE / UNKNOWN');
  const allDimensionBuckets = data.buckets.filter((bucket) => matchesBucket(bucket, filters, selectedData.deviceId));
  const allDimensionActivity = data.activityHours.filter((hour) => selected(filters.sources, hour.source) && selected(filters.devices, selectedData.deviceId));
  const lifetimeTotals = sumBuckets(allDimensionBuckets);
  const series = buildSeries(buckets, activityHours, filters.range, selectedData.start, selectedData.end);
  const previous = previousData(data, selectedData);
  const heatmap = buildHeatmap(buckets, activityHours);
  const recordsByDay = buildRecords(buckets, 'day');
  const recordsByBucket = buildRecords(buckets, 'bucket');
  return {
    ...selectedData,
    totals,
    lifetimeTotals,
    previous,
    cacheHitRate: inputSide > 0 ? totals.cacheReadInputTokens / inputSide : null,
    inputLeverage: freshInput > 0 ? totals.totalTokens / freshInput : null,
    pricingCoverage: totals.totalTokens > 0 ? totals.pricedTokens / totals.totalTokens : 0,
    activeSeconds,
    engagedSeconds,
    messageCount,
    userMessageCount,
    avgRequestSeconds: totals.requestCount > 0 ? activeSeconds / totals.requestCount : 0,
    sourceRows,
    modelRows,
    projectRows,
    deviceRows: totals.totalTokens ? [{ id: selectedData.deviceId, label: selectedData.deviceId, ...totals, share: 1 }] : [],
    series,
    weeklySeries: buildWeeklySeries(allDimensionBuckets, allDimensionActivity, selectedData.end),
    seriesUnit: seriesUnit(filters.range),
    peakTokens: Math.max(0, ...series.map((item) => item.totalTokens)),
    heatmap,
    topModel: modelRows[0]?.id || null,
    topReasoning: topReasoning(buckets),
    toolCount: sourceRows.length,
    streaks: streaks(allDimensionBuckets, selectedData.end),
    weeklyStreaks: weeklyStreaks(allDimensionBuckets, selectedData.end),
    records: recordsByBucket,
    recordsByDay,
    recordsByBucket,
  };
}
