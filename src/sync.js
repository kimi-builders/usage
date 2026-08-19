import { loadConfig, saveConfig } from './config.js';
import { fetchSettings, ingest } from './api.js';
import { createSyncClient, forBatch } from './client-meta.js';
import { collectAll } from './local/snapshot.js';
import { validateUploadBucket, validateUploadSession } from './protocol.js';
import {
  applySourcePolicies, effectiveSourcePolicies, sourceIdsFor, sourcePolicyIsExplicit,
} from './source-policy.js';
import {
  c, formatCurrency, formatDuration, formatNumber, formatTokens, getLocale, t,
} from './cli-ui.js';
import { estimateLocalBucketCost } from './local/pricing.js';
import {
  bucketKey,
  contentHash,
  prepareStateForSync,
  pruneState,
  saveState,
  sessionKey,
} from './state.js';

const BUCKET_BATCH = 500;
const SESSION_BATCH = 200;
const ADDITIVE_BUCKET_FIELDS = [
  'inputTokens',
  'cacheWriteInputTokens',
  'cacheWrite5mInputTokens',
  'cacheWrite1hInputTokens',
  'cacheReadInputTokens',
  'outputTokens',
  'reasoningOutputTokens',
  'requestCount',
];

export { collectAll } from './local/snapshot.js';

function bucketBaseKey(bucket) {
  return [bucket.source, bucket.model, bucket.project || '', bucket.bucketStart].join('|');
}

function hasRequestMetadata(bucket) {
  return Boolean(
    bucket.modelProvider
    || bucket.reasoningEffort
    || bucket.agentVersion
    || bucket.contextTier
    || bucket.processingTier
    || bucket.cacheWrite5mInputTokens
    || bucket.cacheWrite1hInputTokens,
  );
}

/* Keep all metadata variants of one former base bucket in the same request.
 * The server can then compare their combined total with the old unsplit row
 * before replacing it. Rich variants sort first so even an exceptional group
 * larger than the batch cap cannot send the ambiguous empty variant first. */
export function chunkBucketChanges(changes, maxSize = BUCKET_BATCH) {
  const groups = new Map();
  for (const change of changes) {
    const key = bucketBaseKey(change.item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(change);
  }
  const chunks = [];
  let current = [];
  const flush = () => {
    if (current.length > 0) chunks.push(current);
    current = [];
  };
  for (const group of groups.values()) {
    group.sort((left, right) => Number(hasRequestMetadata(right.item)) - Number(hasRequestMetadata(left.item)));
    if (group.length > maxSize) {
      flush();
      for (let index = 0; index < group.length; index += maxSize) {
        chunks.push(group.slice(index, index + maxSize));
      }
      continue;
    }
    if (current.length + group.length > maxSize) flush();
    current.push(...group);
  }
  flush();
  return chunks;
}

function wireBucketKey(bucket) {
  return [
    bucket.source,
    bucket.model,
    bucket.modelProvider || '',
    bucket.reasoningEffort || '',
    bucket.agentVersion || '',
    bucket.contextTier || '',
    bucket.processingTier || '',
    bucket.project || '',
    bucket.bucketStart,
  ].join('|');
}

function addBucketValue(total, value, field) {
  const left = Number(total ?? 0);
  const right = Number(value ?? 0);
  const next = left + right;
  if (!Number.isSafeInteger(next) || next < 0) {
    throw new Error(`${field} aggregate exceeds JavaScript's safe integer range`);
  }
  return next;
}

function mergeMeasurement(left, right) {
  if (left === right) return left;
  if (left === 'credit' && right === 'credit') return 'credit';
  return 'estimated';
}

/* Project labels are part of the local bucket grain but disappear from the
 * privacy-preserving wire contract. Merge only after applying privacy, using
 * the server's final natural key, so two private projects cannot overwrite one
 * another or make the checkpoint alternate forever. */
export function mergeWireBuckets(buckets) {
  const merged = new Map();
  for (const bucket of buckets) {
    const key = wireBucketKey(bucket);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...bucket });
      continue;
    }
    for (const field of ADDITIVE_BUCKET_FIELDS) {
      const hasValue = current[field] !== undefined || bucket[field] !== undefined;
      if (hasValue) current[field] = addBucketValue(current[field], bucket[field], field);
    }
    if (current.creditUnits !== undefined || bucket.creditUnits !== undefined) {
      const creditUnits = Number(current.creditUnits || 0) + Number(bucket.creditUnits || 0);
      if (!Number.isFinite(creditUnits) || creditUnits < 0) {
        throw new Error('creditUnits aggregate must be a finite non-negative number');
      }
      current.creditUnits = creditUnits;
    }
    current.measurement = mergeMeasurement(current.measurement, bucket.measurement);
    if (current.modelCanonical !== bucket.modelCanonical) delete current.modelCanonical;
  }
  return [...merged.values()];
}

export function applyPrivacy(result, uploadProject) {
  const hide = (item) => {
    const copy = { ...item };
    if (!uploadProject) delete copy.project;
    return copy;
  };
  const buckets = result.buckets.map(hide);
  return {
    buckets: uploadProject ? buckets : mergeWireBuckets(buckets),
    sessions: result.sessions.map(hide),
  };
}

export async function runSync({ quiet = false, surface = 'cli', full = false } = {}) {
  let config = loadConfig();
  if (!config?.apiKey || !config?.sessionSalt) {
    throw new Error('尚未连接设备，请先运行 `npx @kimi.builders/usage init`。');
  }
  if (!sourcePolicyIsExplicit(config)) {
    config = applySourcePolicies(config, effectiveSourcePolicies(config));
    saveConfig(config);
  }
  const prepared = prepareStateForSync(config, { full });
  if (prepared.reconciliationRequired) {
    const error = new Error(
      '当前 checkpoint 无法证明属于这个社区设备。为避免意外全量上传，本次已取消；确认同步范围后运行 `npx @kimi.builders/usage sync --full`，或在本地看板中确认“完整重建社区数据”。',
    );
    error.code = 'SYNC_RECONCILIATION_REQUIRED';
    throw error;
  }
  const settings = await fetchSettings(config.apiUrl, config.apiKey);
  if (typeof settings.uploadProject !== 'boolean') {
    throw new Error('服务端没有返回有效的隐私设置，本次同步已安全取消。');
  }

  const collected = await collectAll({
    sessionSalt: config.sessionSalt,
    enabledSourceIds: config.enabledSources,
    sourceIds: sourceIdsFor(config, 'sync'),
    sourceOptions: config.sourceOptions,
  });
  const sources = collected.results.map((result) => ({
    source: result.source,
    tier: result.tier,
    status: result.status,
    buckets: result.buckets.length,
    sessions: result.sessions.length,
    ...(result.error ? { error: result.error } : {}),
    ...(result.warnings ? { warnings: result.warnings } : {}),
  }));
  if (!quiet) {
    printSyncScanResults(collected.results);
  }
  const anyFailed = collected.results.some((result) => ['failed', 'partial'].includes(result.status));

  const snapshot = applyPrivacy(
    { buckets: collected.buckets, sessions: collected.sessions },
    settings.uploadProject,
  );
  const state = prepared.state;
  const client = createSyncClient(surface);
  const liveBucketKeys = new Set();
  const liveSessionKeys = new Set();
  const changedBuckets = [];
  const changedSessions = [];
  const rejected = [];

  for (const bucket of snapshot.buckets) {
    const key = bucketKey(bucket);
    const hash = contentHash(bucket);
    liveBucketKeys.add(key);
    const error = validateUploadBucket(bucket);
    if (error) rejected.push({ kind: 'bucket', source: bucket.source, key, error });
    else if (state.buckets[key] !== hash) changedBuckets.push({ item: bucket, key, hash });
  }
  for (const session of snapshot.sessions) {
    const key = sessionKey(session);
    const hash = contentHash(session);
    liveSessionKeys.add(key);
    const error = validateUploadSession(session);
    if (error) rejected.push({ kind: 'session', source: session.source, key, error });
    else if (state.sessions[key] !== hash) changedSessions.push({ item: session, key, hash });
  }
  // Only ok sources may prune: skipped/partial/failed sources keep their old state,
  // so a transient failure or temporary uninstall never triggers a full
  // re-upload when the source comes back.
  const okSources = new Set(
    collected.results.filter((result) => result.status === 'ok').map((result) => result.source),
  );
  pruneState(state, liveBucketKeys, liveSessionKeys, okSources);

  if (changedBuckets.length === 0 && changedSessions.length === 0) {
    const response = await ingest(config.apiUrl, config.apiKey, {
      protocolVersion: 2,
      client: forBatch(client, 0, 1),
      buckets: [],
      sessions: [],
    });
    if (!response.ok) throw new Error('服务端拒绝了设备元数据更新。');
    saveState(state);
    if (!quiet) {
      const isZh = getLocale() === 'zh';
      console.log(isZh ? '暂无新增或变化的用量。' : 'No new or modified usage.');
      if (anyFailed) {
        console.log(isZh
          ? '⚠ 部分来源解析失败，其余来源不受影响；失败来源的旧数据已保留。'
          : '⚠ Some sources failed to parse; remaining sources are unaffected and previous data is preserved.');
      }
      printRejected(rejected);
    }
    return { buckets: 0, sessions: 0, sources, rejected: rejected.length };
  }

  const bucketBatches = chunkBucketChanges(changedBuckets);
  const sessionBatches = Math.ceil(changedSessions.length / SESSION_BATCH);
  const batchCount = Math.max(bucketBatches.length, sessionBatches, 1);
  let bucketTotal = 0;
  let sessionTotal = 0;
  let protectedBucketTotal = 0;

  for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
    const bucketBatch = bucketBatches[batchIndex] || [];
    const sessionBatch = changedSessions.slice(
      batchIndex * SESSION_BATCH,
      (batchIndex + 1) * SESSION_BATCH,
    );
    const response = await ingest(config.apiUrl, config.apiKey, {
      protocolVersion: 2,
      client: forBatch(client, batchIndex, batchCount),
      buckets: bucketBatch.map(({ item }) => item),
      sessions: sessionBatch.map(({ item }) => item),
    });
    if (!response.ok) throw new Error('服务端拒绝了同步批次。');
    for (const { key, hash } of bucketBatch) state.buckets[key] = hash;
    for (const { key, hash } of sessionBatch) state.sessions[key] = hash;
    saveState(state);
    bucketTotal += Number(response.ingested?.buckets ?? bucketBatch.length);
    sessionTotal += Number(response.ingested?.sessions ?? sessionBatch.length);
    protectedBucketTotal += Number(response.protected?.buckets ?? 0);
  }
  if (!quiet) {
    const isZh = getLocale() === 'zh';
    const syncedMsg = isZh
      ? `已同步 ${bucketTotal} buckets · ${sessionTotal} sessions`
      : `Synced ${bucketTotal} buckets · ${sessionTotal} sessions`;
    console.log(syncedMsg);
    if (protectedBucketTotal > 0) {
      console.log(isZh
        ? `服务端保留了 ${protectedBucketTotal} 个更大的已有 bucket（本次较小快照未覆盖）`
        : `Server preserved ${protectedBucketTotal} larger existing buckets (not overwritten by this smaller snapshot)`);
    }
    if (anyFailed) {
      console.log(isZh
        ? '⚠ 部分来源解析失败，其余来源不受影响；失败来源的旧数据已保留。'
        : '⚠ Some sources failed to parse; remaining sources are unaffected and previous data is preserved.');
    }
    printRejected(rejected);
  }
  return {
    buckets: bucketTotal,
    sessions: sessionTotal,
    protectedBuckets: protectedBucketTotal,
    sources,
    rejected: rejected.length,
  };
}

function calculateSourceMetrics(result) {
  let tokens = 0;
  let costMicros = 0;
  for (const bucket of result.buckets || []) {
    tokens += Number(bucket.inputTokens || 0)
      + Number(bucket.cacheWriteInputTokens || 0)
      + Number(bucket.cacheReadInputTokens || 0)
      + Number(bucket.outputTokens || 0)
      + Number(bucket.reasoningOutputTokens || 0);
    const price = estimateLocalBucketCost(bucket);
    costMicros += Number(price.costMicros || 0);
  }
  let activeSeconds = 0;
  for (const session of result.sessions || []) {
    activeSeconds += Number(session.activeSeconds || 0);
  }
  return {
    tokens,
    cost: costMicros / 1e6,
    activeSeconds,
  };
}

function printSyncScanResults(results) {
  const isZh = getLocale() === 'zh';
  console.log(isZh ? '来源扫描：' : 'Source scan:');
  const width = Math.max(...results.map((result) => result.source.length), 0) + 4;
  let totalTokens = 0;
  let totalCost = 0;
  let totalActive = 0;
  let totalBuckets = 0;
  let totalSessions = 0;
  let hasActiveData = false;

  for (const result of results) {
    const label = result.source.padEnd(width);
    const metrics = calculateSourceMetrics(result);
    totalTokens += metrics.tokens;
    totalCost += metrics.cost;
    totalActive += metrics.activeSeconds;
    totalBuckets += result.buckets.length;
    totalSessions += result.sessions.length;

    if (result.status === 'ok') {
      hasActiveData = true;
      const metricsInfo = ` (${c.cyan(formatTokens(metrics.tokens))} · ${c.green(formatCurrency(metrics.cost))})`;
      console.log(`  ✓ ${label}${result.buckets.length} buckets · ${result.sessions.length} sessions${metricsInfo}`);
    } else if (result.status === 'skipped') {
      console.log(`  - ${label}${isZh ? '未检测到本地数据，已跳过' : 'no local data found, skipped'}`);
    } else if (result.status === 'partial') {
      hasActiveData = true;
      const extra = isZh
        ? `（部分读取，本来源旧数据已保留）`
        : ` (partially read, previous data retained)`;
      console.log(`  ~ ${label}${result.buckets.length} buckets · ${result.sessions.length} sessions${extra}`);
      for (const warning of (result.warnings || []).slice(0, 2)) console.log(`      ${warning}`);
    } else {
      const errorMsg = isZh
        ? `解析失败：${result.error}（已保留该来源的旧数据）`
        : `parsing failed: ${result.error} (previous data retained)`;
      console.log(`  ✗ ${label}${errorMsg}`);
    }
  }

  if (hasActiveData && results.length > 1) {
    const totalLabel = (isZh ? '合计' : 'Total').padEnd(width);
    console.log(c.dim('  ' + '─'.repeat(Math.min(72, (process.stdout.columns || 80) - 4))));
    console.log(`  ${c.bold(totalLabel)}${totalBuckets} buckets · ${totalSessions} sessions (${c.bold(c.cyan(formatTokens(totalTokens)))} · ${c.bold(c.green(formatCurrency(totalCost)))} · ${c.dim(formatDuration(totalActive, { short: true }))})\n`);
  }
}

function printRejected(rejected) {
  if (rejected.length === 0) return;
  const isZh = getLocale() === 'zh';
  console.log(isZh
    ? `⚠ 本地校验隔离了 ${rejected.length} 条异常记录，其余数据已继续同步：`
    : `⚠ Local validation quarantined ${rejected.length} abnormal records; remaining data synced:`);
  for (const item of rejected.slice(0, 5)) {
    console.log(`  - ${item.source} ${item.kind}: ${item.error}`);
  }
  if (rejected.length > 5) {
    console.log(isZh ? `  - 其余 ${rejected.length - 5} 条已省略` : `  - Remaining ${rejected.length - 5} omitted`);
  }
}
