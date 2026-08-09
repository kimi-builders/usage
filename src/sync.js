import { loadConfig } from './config.js';
import { fetchSettings, ingest } from './api.js';
import { createSyncClient, forBatch } from './client-meta.js';
import { enabledSources } from './parsers/index.js';
import { validateUploadBucket, validateUploadSession } from './protocol.js';
import {
  bucketKey,
  contentHash,
  loadState,
  pruneState,
  saveState,
  sessionKey,
} from './state.js';

const BUCKET_BATCH = 500;
const SESSION_BATCH = 200;

export function applyPrivacy(result, uploadProject) {
  const hide = (item) => {
    const copy = { ...item };
    if (!uploadProject) delete copy.project;
    return copy;
  };
  return {
    buckets: result.buckets.map(hide),
    sessions: result.sessions.map(hide),
  };
}

// Run every enabled source in its own try/catch: one source's failure never
// blocks the others. No roots → skipped (未检测到); roots but nothing parsed
// → ok with 0 items; throw → failed (its old state is kept, see pruneState).
export async function collectAll({ sessionSalt, enabledSourceIds = [], sourceOptions = {} }) {
  const results = [];
  for (const source of enabledSources(enabledSourceIds)) {
    try {
      const roots = (await source.roots({ sourceOptions })) || [];
      if (roots.length === 0) {
        results.push({ source: source.id, tier: source.tier, status: 'skipped', buckets: [], sessions: [] });
        continue;
      }
      const parsed = await source.parse({ sessionSalt, sourceOptions });
      results.push({
        source: source.id,
        tier: source.tier,
        status: parsed?.skipped ? 'partial' : 'ok',
        buckets: parsed?.buckets ?? [],
        sessions: parsed?.sessions ?? [],
        ...(parsed?.warnings?.length ? { warnings: parsed.warnings } : {}),
      });
    } catch (error) {
      results.push({
        source: source.id,
        tier: source.tier,
        status: 'failed',
        buckets: [],
        sessions: [],
        error: error?.message || String(error),
      });
    }
  }
  return {
    results,
    buckets: results.flatMap((result) => result.buckets),
    sessions: results.flatMap((result) => result.sessions),
  };
}

export async function runSync({ quiet = false, surface = 'cli' } = {}) {
  const config = loadConfig();
  if (!config?.apiKey || !config?.sessionSalt) {
    throw new Error('尚未连接设备，请先运行 `npx @kimi-builders/usage init`。');
  }
  const settings = await fetchSettings(config.apiUrl, config.apiKey);
  if (typeof settings.uploadProject !== 'boolean') {
    throw new Error('服务端没有返回有效的隐私设置，本次同步已安全取消。');
  }

  const collected = await collectAll({
    sessionSalt: config.sessionSalt,
    enabledSourceIds: config.enabledSources,
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
    console.log('来源扫描：');
    const width = Math.max(...collected.results.map((result) => result.source.length)) + 4;
    for (const result of collected.results) {
      const label = result.source.padEnd(width);
      if (result.status === 'ok') {
        console.log(`  ✓ ${label}${result.buckets.length} buckets · ${result.sessions.length} sessions`);
      } else if (result.status === 'skipped') {
        console.log(`  - ${label}未检测到本地数据，已跳过`);
      } else if (result.status === 'partial') {
        console.log(`  ~ ${label}${result.buckets.length} buckets · ${result.sessions.length} sessions（部分读取，本来源旧数据已保留）`);
        for (const warning of (result.warnings || []).slice(0, 2)) console.log(`      ${warning}`);
      } else {
        console.log(`  ✗ ${label}解析失败：${result.error}（已保留该来源的旧数据）`);
      }
    }
  }
  const anyFailed = collected.results.some((result) => ['failed', 'partial'].includes(result.status));

  const snapshot = applyPrivacy(
    { buckets: collected.buckets, sessions: collected.sessions },
    settings.uploadProject,
  );
  const state = loadState();
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
    saveState(state);
    if (!quiet) {
      console.log('暂无新增或变化的用量。');
      if (anyFailed) console.log('⚠ 部分来源解析失败，其余来源不受影响；失败来源的旧数据已保留。');
      printRejected(rejected);
    }
    return { buckets: 0, sessions: 0, sources, rejected: rejected.length };
  }

  const bucketBatches = Math.ceil(changedBuckets.length / BUCKET_BATCH);
  const sessionBatches = Math.ceil(changedSessions.length / SESSION_BATCH);
  const batchCount = Math.max(bucketBatches, sessionBatches, 1);
  const client = createSyncClient(surface);
  let bucketTotal = 0;
  let sessionTotal = 0;
  let protectedBucketTotal = 0;

  for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
    const bucketBatch = changedBuckets.slice(
      batchIndex * BUCKET_BATCH,
      (batchIndex + 1) * BUCKET_BATCH,
    );
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
    console.log(`已同步 ${bucketTotal} buckets · ${sessionTotal} sessions`);
    if (protectedBucketTotal > 0) {
      console.log(`服务端保留了 ${protectedBucketTotal} 个更大的已有 bucket（本次较小快照未覆盖）`);
    }
    if (anyFailed) console.log('⚠ 部分来源解析失败，其余来源不受影响；失败来源的旧数据已保留。');
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

function printRejected(rejected) {
  if (rejected.length === 0) return;
  console.log(`⚠ 本地校验隔离了 ${rejected.length} 条异常记录，其余数据已继续同步：`);
  for (const item of rejected.slice(0, 5)) {
    console.log(`  - ${item.source} ${item.kind}: ${item.error}`);
  }
  if (rejected.length > 5) console.log(`  - 其余 ${rejected.length - 5} 条已省略`);
}
