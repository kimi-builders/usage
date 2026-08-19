import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { collectLocalSnapshot } from './local/snapshot.js';
import { createDashboardData } from './local/dashboard-data.js';
import { computeStats } from './stats.js';
import { c, formatBytes, formatNumber, getLocale, t } from './cli-ui.js';

function escapeCsvField(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

export function formatBucketsCsv(buckets) {
  const headers = [
    'source',
    'model',
    'model_canonical',
    'model_provider',
    'reasoning_effort',
    'agent_version',
    'bucket_start',
    'input_tokens',
    'cache_write_input_tokens',
    'cache_read_input_tokens',
    'output_tokens',
    'reasoning_output_tokens',
    'total_tokens',
    'cost_usd',
    'request_count',
    'project',
  ];

  const rows = [headers.join(',')];
  for (const b of buckets) {
    const costUsd = b.costMicros != null ? (b.costMicros / 1e6).toFixed(4) : '0.0000';
    const row = [
      escapeCsvField(b.source),
      escapeCsvField(b.model),
      escapeCsvField(b.modelCanonical || ''),
      escapeCsvField(b.modelProvider || ''),
      escapeCsvField(b.reasoningEffort || ''),
      escapeCsvField(b.agentVersion || ''),
      escapeCsvField(b.bucketStart),
      b.inputTokens || 0,
      b.cacheWriteInputTokens || 0,
      b.cacheReadInputTokens || 0,
      b.outputTokens || 0,
      b.reasoningOutputTokens || 0,
      b.totalTokens || 0,
      costUsd,
      b.requestCount || 0,
      escapeCsvField(b.project || ''),
    ];
    rows.push(row.join(','));
  }
  return rows.join('\n');
}

export function formatSessionsCsv(sessions) {
  const headers = [
    'source',
    'project',
    'first_message_at',
    'last_message_at',
    'duration_seconds',
    'active_seconds',
    'message_count',
    'user_message_count',
  ];

  const rows = [headers.join(',')];
  for (const s of sessions) {
    const row = [
      escapeCsvField(s.source),
      escapeCsvField(s.project || ''),
      escapeCsvField(s.firstMessageAt || ''),
      escapeCsvField(s.lastMessageAt || ''),
      s.durationSeconds || 0,
      s.activeSeconds || 0,
      s.messageCount || 0,
      s.userMessageCount || 0,
    ];
    rows.push(row.join(','));
  }
  return rows.join('\n');
}

export async function runExport(options = {}) {
  const config = loadConfig();
  const snapshot = await collectLocalSnapshot({ config });
  const dashboardData = createDashboardData(snapshot, { config });

  const format = String(options.format || 'csv').toLowerCase().trim();
  const type = String(options.type || 'buckets').toLowerCase().trim();
  const outputPath = options.output ? resolve(options.output) : null;
  const isZh = getLocale() === 'zh';

  // Apply period/source/model filters if specified
  const period = options.period || (options.days ? `${options.days}d` : 'all');
  const sourceFilter = options.source ? String(options.source).toLowerCase() : null;

  let buckets = dashboardData.buckets;
  let sessions = dashboardData.sessions;

  if (period !== 'all' || sourceFilter || options.model || options.project) {
    const stats = computeStats(dashboardData, { ...options, period });
    // Filter buckets according to stats period
    const startMs = stats.period.startMs;
    const endMs = stats.period.endMs;
    buckets = dashboardData.buckets.filter((b) => {
      const t = Date.parse(b.bucketStart);
      if (t < startMs || t > endMs) return false;
      if (sourceFilter && b.source.toLowerCase() !== sourceFilter) return false;
      if (options.model && !b.model.toLowerCase().includes(options.model.toLowerCase())) return false;
      if (options.project && (b.project || '').toLowerCase() !== options.project.toLowerCase()) return false;
      return true;
    });
    sessions = dashboardData.sessions.filter((s) => {
      const t = Date.parse(s.lastMessageAt || s.firstMessageAt);
      if (t < startMs || t > endMs) return false;
      if (sourceFilter && s.source.toLowerCase() !== sourceFilter) return false;
      if (options.project && (s.project || '').toLowerCase() !== options.project.toLowerCase()) return false;
      return true;
    });
  }

  let outputContent = '';
  if (format === 'json') {
    const payload = type === 'sessions'
      ? { sessions }
      : type === 'summary'
        ? computeStats(dashboardData, options)
        : type === 'all'
          ? { buckets, sessions, generatedAt: new Date().toISOString() }
          : { buckets };
    outputContent = JSON.stringify(payload, null, 2);
  } else if (format === 'jsonl') {
    const items = type === 'sessions' ? sessions : buckets;
    outputContent = items.map((item) => JSON.stringify(item)).join('\n');
  } else {
    // Default CSV
    outputContent = type === 'sessions'
      ? formatSessionsCsv(sessions)
      : formatBucketsCsv(buckets);
  }

  if (outputPath) {
    writeFileSync(outputPath, outputContent, 'utf8');
    const bytes = Buffer.byteLength(outputContent, 'utf8');
    const rowCount = type === 'sessions' ? sessions.length : buckets.length;
    console.log(`\n${c.green('✓')} ${isZh ? '导出成功' : 'Export completed'}: ${c.bold(outputPath)}`);
    console.log(`  • ${isZh ? '格式' : 'Format'}: ${format.toUpperCase()} (${type})`);
    console.log(`  • ${isZh ? '记录数' : 'Rows'}: ${formatNumber(rowCount)}`);
    console.log(`  • ${isZh ? '文件大小' : 'Size'}: ${formatBytes(bytes)}\n`);
    return { path: outputPath, bytes, rowCount };
  }

  console.log(outputContent);
  return outputContent;
}
