import { loadConfig } from './config.js';
import { collectLocalSnapshot } from './local/snapshot.js';
import { createDashboardData } from './local/dashboard-data.js';
import {
  c,
  formatCurrency,
  formatDuration,
  formatNumber,
  formatPercent,
  formatTokens,
  getLocale,
  pad,
  renderBar,
  renderTable,
  stringWidth,
  t,
} from './cli-ui.js';

function parsePeriod(periodArg = '7d') {
  const str = String(periodArg || '7d').toLowerCase().trim();
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStartMs = today.getTime();

  if (str === 'today') {
    return { name: 'today', startMs: todayStartMs, endMs: now, days: 1 };
  }
  if (str === '24h') {
    return { name: '24h', startMs: now - 24 * 3600 * 1000, endMs: now, days: 1 };
  }
  if (str === '7d' || str === '7') {
    return { name: '7d', startMs: todayStartMs - 6 * 86400 * 1000, endMs: now, days: 7 };
  }
  if (str === '30d' || str === '30') {
    return { name: '30d', startMs: todayStartMs - 29 * 86400 * 1000, endMs: now, days: 30 };
  }
  if (str === '90d' || str === '90') {
    return { name: '90d', startMs: todayStartMs - 89 * 86400 * 1000, endMs: now, days: 90 };
  }
  if (str === 'all' || str === 'all-time') {
    return { name: 'all', startMs: 0, endMs: now, days: null };
  }
  const numeric = Number(str.replace(/d$/, ''));
  if (Number.isFinite(numeric) && numeric > 0) {
    return { name: `${numeric}d`, startMs: todayStartMs - (numeric - 1) * 86400 * 1000, endMs: now, days: numeric };
  }
  return { name: '7d', startMs: todayStartMs - 6 * 86400 * 1000, endMs: now, days: 7 };
}

function formatDate(dateMs) {
  const date = new Date(dateMs);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day}`;
}

function formatFullDate(dateMs) {
  const date = new Date(dateMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function computeStats(dashboardData, options = {}) {
  const period = parsePeriod(options.period || options.days);
  const sourceFilter = options.source ? String(options.source).toLowerCase() : null;
  const modelFilter = options.model ? String(options.model).toLowerCase() : null;
  const projectFilter = options.project ? String(options.project).toLowerCase() : null;

  const filteredBuckets = [];
  for (const bucket of dashboardData.buckets) {
    const time = Date.parse(bucket.bucketStart);
    if (time < period.startMs || time > period.endMs) continue;
    if (sourceFilter && bucket.source.toLowerCase() !== sourceFilter) continue;
    if (modelFilter && !bucket.model.toLowerCase().includes(modelFilter)) continue;
    if (projectFilter && (bucket.project || '').toLowerCase() !== projectFilter) continue;
    filteredBuckets.push(bucket);
  }

  const filteredSessions = [];
  for (const session of dashboardData.sessions) {
    const start = Date.parse(session.firstMessageAt);
    const end = Date.parse(session.lastMessageAt);
    const latest = Number.isFinite(end) ? end : start;
    if (latest < period.startMs || (Number.isFinite(start) && start > period.endMs)) continue;
    if (sourceFilter && session.source.toLowerCase() !== sourceFilter) continue;
    if (projectFilter && (session.project || '').toLowerCase() !== projectFilter) continue;
    filteredSessions.push(session);
  }

  // Totals
  const totals = {
    totalTokens: 0,
    inputTokens: 0,
    cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    costMicros: 0,
    pricedTokens: 0,
    unpricedTokens: 0,
    requestCount: 0,
    activeSeconds: 0,
    durationSeconds: 0,
    sessionCount: filteredSessions.length,
    bucketCount: filteredBuckets.length,
  };

  for (const bucket of filteredBuckets) {
    totals.totalTokens += bucket.totalTokens || 0;
    totals.inputTokens += bucket.inputTokens || 0;
    totals.cacheWriteInputTokens += bucket.cacheWriteInputTokens || 0;
    totals.cacheReadInputTokens += bucket.cacheReadInputTokens || 0;
    totals.outputTokens += bucket.outputTokens || 0;
    totals.reasoningOutputTokens += bucket.reasoningOutputTokens || 0;
    totals.costMicros += bucket.costMicros || 0;
    totals.pricedTokens += bucket.pricedTokens || 0;
    totals.unpricedTokens += bucket.unpricedTokens || 0;
    totals.requestCount += bucket.requestCount || 0;
  }

  if (Array.isArray(dashboardData.activityHours)) {
    for (const hour of dashboardData.activityHours) {
      const time = Date.parse(hour.hourStart);
      if (time < period.startMs || time > period.endMs) continue;
      if (sourceFilter && hour.source.toLowerCase() !== sourceFilter) continue;
      totals.activeSeconds += hour.activeSeconds || 0;
      totals.durationSeconds += hour.engagedSeconds || 0;
    }
  } else {
    for (const session of filteredSessions) {
      totals.activeSeconds += Number(session.activeSeconds || 0);
      totals.durationSeconds += Number(session.durationSeconds || 0);
    }
  }

  totals.cost = totals.costMicros / 1e6;
  totals.priceCoverage = totals.totalTokens > 0
    ? (totals.pricedTokens / totals.totalTokens) * 100
    : 100;

  // Daily Breakdown
  const dailyMap = new Map();
  for (const bucket of filteredBuckets) {
    const dayKey = formatFullDate(Date.parse(bucket.bucketStart));
    if (!dailyMap.has(dayKey)) {
      dailyMap.set(dayKey, {
        day: dayKey,
        tokens: 0,
        costMicros: 0,
        requests: 0,
        models: new Map(),
      });
    }
    const dayData = dailyMap.get(dayKey);
    dayData.tokens += bucket.totalTokens || 0;
    dayData.costMicros += bucket.costMicros || 0;
    dayData.requests += bucket.requestCount || 0;
    const modelKey = bucket.modelCanonical || bucket.model;
    dayData.models.set(modelKey, (dayData.models.get(modelKey) || 0) + (bucket.totalTokens || 0));
  }

  const daily = [...dailyMap.values()]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((item) => {
      let topModel = '';
      let topModelTokens = 0;
      for (const [model, tokens] of item.models.entries()) {
        if (tokens > topModelTokens) {
          topModel = model;
          topModelTokens = tokens;
        }
      }
      return {
        day: item.day,
        tokens: item.tokens,
        cost: item.costMicros / 1e6,
        requests: item.requests,
        topModel,
        topModelTokens,
      };
    });

  // Model Breakdown
  const modelMap = new Map();
  for (const bucket of filteredBuckets) {
    const modelKey = bucket.modelCanonical || bucket.model;
    if (!modelMap.has(modelKey)) {
      modelMap.set(modelKey, {
        model: modelKey,
        rawModel: bucket.model,
        tokens: 0,
        costMicros: 0,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
      });
    }
    const data = modelMap.get(modelKey);
    data.tokens += bucket.totalTokens || 0;
    data.costMicros += bucket.costMicros || 0;
    data.requests += bucket.requestCount || 0;
    data.inputTokens += (bucket.inputTokens || 0) + (bucket.cacheReadInputTokens || 0);
    data.outputTokens += (bucket.outputTokens || 0) + (bucket.reasoningOutputTokens || 0);
  }

  const models = [...modelMap.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .map((item) => ({
      model: item.model,
      tokens: item.tokens,
      cost: item.costMicros / 1e6,
      requests: item.requests,
      share: totals.totalTokens > 0 ? (item.tokens / totals.totalTokens) * 100 : 0,
    }));

  // Source / Agent Breakdown
  const sourceMap = new Map();
  for (const bucket of filteredBuckets) {
    if (!sourceMap.has(bucket.source)) {
      sourceMap.set(bucket.source, {
        source: bucket.source,
        tokens: 0,
        costMicros: 0,
        requests: 0,
        sessions: 0,
        activeSeconds: 0,
      });
    }
    const data = sourceMap.get(bucket.source);
    data.tokens += bucket.totalTokens || 0;
    data.costMicros += bucket.costMicros || 0;
    data.requests += bucket.requestCount || 0;
  }
  for (const session of filteredSessions) {
    if (sourceMap.has(session.source)) {
      const data = sourceMap.get(session.source);
      data.sessions += 1;
    }
  }
  if (Array.isArray(dashboardData.activityHours)) {
    for (const hour of dashboardData.activityHours) {
      const time = Date.parse(hour.hourStart);
      if (time < period.startMs || time > period.endMs) continue;
      if (sourceFilter && hour.source.toLowerCase() !== sourceFilter) continue;
      if (sourceMap.has(hour.source)) {
        sourceMap.get(hour.source).activeSeconds += hour.activeSeconds || 0;
      }
    }
  } else {
    for (const session of filteredSessions) {
      if (sourceMap.has(session.source)) {
        sourceMap.get(session.source).activeSeconds += Number(session.activeSeconds || 0);
      }
    }
  }

  const sources = [...sourceMap.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .map((item) => ({
      source: item.source,
      tokens: item.tokens,
      cost: item.costMicros / 1e6,
      requests: item.requests,
      sessions: item.sessions,
      activeSeconds: item.activeSeconds,
      share: totals.totalTokens > 0 ? (item.tokens / totals.totalTokens) * 100 : 0,
    }));

  // Project Breakdown
  const projectMap = new Map();
  for (const bucket of filteredBuckets) {
    if (!bucket.project) continue;
    if (!projectMap.has(bucket.project)) {
      projectMap.set(bucket.project, {
        project: bucket.project,
        tokens: 0,
        costMicros: 0,
        requests: 0,
        sessions: 0,
      });
    }
    const data = projectMap.get(bucket.project);
    data.tokens += bucket.totalTokens || 0;
    data.costMicros += bucket.costMicros || 0;
    data.requests += bucket.requestCount || 0;
  }
  for (const session of filteredSessions) {
    if (session.project && projectMap.has(session.project)) {
      projectMap.get(session.project).sessions += 1;
    }
  }
  const projects = [...projectMap.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .map((item) => ({
      project: item.project,
      tokens: item.tokens,
      cost: item.costMicros / 1e6,
      requests: item.requests,
      sessions: item.sessions,
      share: totals.totalTokens > 0 ? (item.tokens / totals.totalTokens) * 100 : 0,
    }));

  return {
    period,
    totals,
    daily,
    models,
    sources,
    projects,
  };
}

export function renderStatsReport(stats) {
  const isZh = getLocale() === 'zh';
  const { period, totals, daily, models, sources, projects } = stats;

  const lines = [];
  const divider = c.dim('─'.repeat(Math.min(74, (process.stdout.columns || 80) - 2)));

  // Title
  const periodLabel = period.name === 'all'
    ? (isZh ? '全部历史' : 'All Time')
    : period.name === 'today'
      ? (isZh ? '今日' : 'Today')
      : period.name === '24h'
        ? (isZh ? '近 24 小时' : 'Last 24 Hours')
        : isZh
          ? `近 ${period.days} 天`
          : `Last ${period.days} Days`;

  const dateRangeStr = period.startMs > 0
    ? `(${formatFullDate(period.startMs)} ~ ${formatFullDate(period.endMs)})`
    : '';

  lines.push(`\n${c.bold(c.cyan(`◆ ${periodLabel} ${isZh ? '用量概况' : 'Usage Analytics'}`))} ${c.dim(dateRangeStr)}`);
  lines.push(divider);

  // Overview Table
  const overviewRows = [
    [
      isZh ? '• Token 总计' : '• Total Tokens',
      c.bold(c.cyan(formatTokens(totals.totalTokens, { compact: true }))),
      `${isZh ? '输入' : 'Input'}: ${formatTokens(totals.inputTokens)} · ${isZh ? '输出' : 'Output'}: ${formatTokens(totals.outputTokens)} · ${isZh ? '缓存读' : 'Cache Read'}: ${formatTokens(totals.cacheReadInputTokens)}`,
    ],
    [
      isZh ? '• 标准 API 估算' : '• Est. API Cost',
      c.bold(c.green(formatCurrency(totals.cost))),
      `${isZh ? '定价覆盖率' : 'Coverage'}: ${formatPercent(totals.priceCoverage, { fromFraction: false })}${totals.unpricedTokens > 0 ? ` (${isZh ? '未定价' : 'Unpriced'}: ${formatTokens(totals.unpricedTokens)})` : ''}`,
    ],
    [
      isZh ? '• 活跃时长' : '• Active Duration',
      c.bold(formatDuration(totals.activeSeconds)),
      `${isZh ? '共' : 'Total'} ${totals.sessionCount} ${isZh ? '个会话' : 'sessions'} · ${totals.requestCount} ${isZh ? '次请求' : 'requests'}`,
    ],
  ];

  for (const [label, val, detail] of overviewRows) {
    lines.push(`  ${pad(label, 20)} ${pad(val, 14)} ${c.dim(detail)}`);
  }
  lines.push(divider);

  // Daily Trend Chart
  if (daily.length > 0) {
    const chartTitle = isZh ? '▸ 每日 Token 趋势 (Top Models)' : '▸ Daily Token Trend (Top Models)';
    lines.push(`\n${c.bold(chartTitle)}`);
    const maxDayTokens = Math.max(...daily.map((d) => d.tokens), 1);
    for (const d of daily) {
      const dayLabel = formatDate(Date.parse(d.day));
      const bar = renderBar(d.tokens, maxDayTokens, 16, { color: 'cyan' });
      const tokenStr = pad(formatTokens(d.tokens), 8, 'right');
      const topModelStr = d.topModel ? `[${d.topModel.slice(0, 24)}]` : '';
      lines.push(`  ${dayLabel} ${pad(bar, 16)} ${tokenStr}  ${c.dim(topModelStr)}`);
    }
  }

  // Model Rankings
  if (models.length > 0) {
    const modelTitle = isZh ? '▸ 模型消耗排行 (Top Models)' : '▸ Model Breakdown (Top Models)';
    lines.push(`\n${c.bold(modelTitle)}`);
    const modelCols = [
      { key: 'model', header: isZh ? '模型名称' : 'Model', align: 'left', minWidth: 24 },
      { key: 'tokens', header: 'Tokens', align: 'right', format: (val) => formatTokens(val) },
      { key: 'share', header: isZh ? '占比' : 'Share', align: 'right', format: (val) => formatPercent(val, { fromFraction: false }) },
      { key: 'cost', header: isZh ? '预估费用' : 'Est. Cost', align: 'right', format: (val) => formatCurrency(val) },
    ];
    lines.push(renderTable({ columns: modelCols, rows: models.slice(0, 8), divider: '─' }));
  }

  // Source / Agent Breakdown
  if (sources.length > 0) {
    const sourceTitle = isZh ? '▸ Agent 来源分布' : '▸ Agent Sources Breakdown';
    lines.push(`\n${c.bold(sourceTitle)}`);
    const sourceCols = [
      { key: 'source', header: isZh ? 'Agent 来源' : 'Agent Source', align: 'left', minWidth: 16 },
      { key: 'tokens', header: 'Tokens', align: 'right', format: (val) => formatTokens(val) },
      { key: 'cost', header: isZh ? '费用' : 'Cost', align: 'right', format: (val) => formatCurrency(val) },
      { key: 'sessions', header: isZh ? '会话数' : 'Sessions', align: 'right', format: (val) => formatNumber(val) },
      { key: 'activeSeconds', header: isZh ? '活跃时长' : 'Active Time', align: 'right', format: (val) => formatDuration(val) },
    ];
    lines.push(renderTable({ columns: sourceCols, rows: sources, divider: '─' }));
  }

  // Project Breakdown (if any)
  if (projects.length > 0) {
    const projectTitle = isZh ? '▸ 项目用量排行 (Top Projects)' : '▸ Project Breakdown (Top Projects)';
    lines.push(`\n${c.bold(projectTitle)}`);
    const projectCols = [
      { key: 'project', header: isZh ? '项目名' : 'Project', align: 'left', minWidth: 20 },
      { key: 'tokens', header: 'Tokens', align: 'right', format: (val) => formatTokens(val) },
      { key: 'cost', header: isZh ? '费用' : 'Cost', align: 'right', format: (val) => formatCurrency(val) },
      { key: 'sessions', header: isZh ? '会话' : 'Sessions', align: 'right', format: (val) => formatNumber(val) },
    ];
    lines.push(renderTable({ columns: projectCols, rows: projects.slice(0, 5), divider: '─' }));
  }

  lines.push('');
  return lines.join('\n');
}

export async function runStats(options = {}) {
  const config = loadConfig();
  const snapshot = await collectLocalSnapshot({ config });
  const dashboardData = createDashboardData(snapshot, { config });
  const stats = computeStats(dashboardData, options);

  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
    return stats;
  }

  const report = renderStatsReport(stats);
  console.log(report);
  return stats;
}
