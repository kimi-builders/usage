const count = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

export function publicSyncResult(result = {}) {
  const statuses = new Set(['ok', 'skipped', 'partial', 'failed']);
  return {
    buckets: count(result.buckets), sessions: count(result.sessions),
    protectedBuckets: count(result.protectedBuckets), rejected: count(result.rejected),
    compressedBytes: count(result.compressedBytes), batchCount: count(result.batchCount),
    sources: (Array.isArray(result.sources) ? result.sources : []).map((source) => ({
      source: /^[a-z0-9-]{1,64}$/.test(source.source) ? source.source : 'unknown',
      status: statuses.has(source.status) ? source.status : 'failed',
      buckets: count(source.buckets), sessions: count(source.sessions),
      warningCount: Array.isArray(source.warnings) ? source.warnings.length : count(source.warningCount),
    })),
  };
}

export function estimateSyncRemainingMs(elapsedMs, completed, total) {
  if (!(elapsedMs > 0) || !(completed > 0) || total <= completed) return null;
  return Math.ceil(elapsedMs * (total - completed) / completed);
}

export function publicSyncProgress(progress = {}) {
  return {
    phase: ['preparing', 'scanning', 'uploading', 'retrying', 'complete'].includes(progress.phase) ? progress.phase : 'preparing',
    completedBatches: count(progress.completedBatches), totalBatches: count(progress.totalBatches),
    pendingBuckets: count(progress.pendingBuckets), pendingSessions: count(progress.pendingSessions),
    compressedBytes: count(progress.compressedBytes),
    remainingMs: progress.remainingMs == null ? null : count(progress.remainingMs),
    retryDelayMs: count(progress.retryDelayMs),
  };
}
