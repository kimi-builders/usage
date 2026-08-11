const TOKEN_FIELDS = [
  'inputTokens',
  'cacheWriteInputTokens',
  'cacheReadInputTokens',
  'outputTokens',
  'reasoningOutputTokens',
];

function addSafe(total, value, field) {
  const next = total + Number(value || 0);
  if (!Number.isSafeInteger(next) || next < 0) {
    throw new Error(`${field} aggregate exceeds JavaScript's safe integer range`);
  }
  return next;
}

function activityRange(buckets, sessions) {
  const starts = [
    ...buckets.map((bucket) => Date.parse(bucket.bucketStart)),
    ...sessions.map((session) => Date.parse(session.firstMessageAt)),
  ].filter(Number.isFinite);
  const ends = [
    ...buckets.map((bucket) => Date.parse(bucket.bucketStart) + 30 * 60 * 1000),
    ...sessions.map((session) => Date.parse(session.lastMessageAt)),
  ].filter(Number.isFinite);
  return {
    firstActivityAt: starts.length > 0 ? new Date(Math.min(...starts)).toISOString() : null,
    lastActivityAt: ends.length > 0 ? new Date(Math.max(...ends)).toISOString() : null,
  };
}

export function observedTokenTotal(bucket) {
  return TOKEN_FIELDS.reduce((total, field) => addSafe(total, bucket[field], field), 0);
}

export function summarizeUsage({ buckets = [], sessions = [] } = {}) {
  const totals = {
    bucketCount: buckets.length,
    sessionCount: sessions.length,
    inputTokens: 0,
    cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    requestCount: 0,
    messageCount: 0,
    userMessageCount: 0,
    activeSeconds: 0,
    engagedSeconds: 0,
  };
  const coverage = {
    exactBuckets: 0,
    estimatedBuckets: 0,
    creditBuckets: 0,
    canonicalModelBuckets: 0,
    reasoningEffortBuckets: 0,
    agentVersionBuckets: 0,
  };

  for (const bucket of buckets) {
    for (const field of TOKEN_FIELDS) {
      totals[field] = addSafe(totals[field], bucket[field], field);
    }
    totals.requestCount = addSafe(totals.requestCount, bucket.requestCount, 'requestCount');
    if (bucket.measurement === 'exact') coverage.exactBuckets += 1;
    else if (bucket.measurement === 'estimated') coverage.estimatedBuckets += 1;
    else if (bucket.measurement === 'credit') coverage.creditBuckets += 1;
    if (bucket.modelCanonical) coverage.canonicalModelBuckets += 1;
    if (bucket.reasoningEffort) coverage.reasoningEffortBuckets += 1;
    if (bucket.agentVersion) coverage.agentVersionBuckets += 1;
  }
  totals.totalTokens = TOKEN_FIELDS.reduce(
    (total, field) => addSafe(total, totals[field], 'totalTokens'),
    0,
  );

  for (const session of sessions) {
    totals.messageCount = addSafe(totals.messageCount, session.messageCount, 'messageCount');
    totals.userMessageCount = addSafe(
      totals.userMessageCount,
      session.userMessageCount,
      'userMessageCount',
    );
    totals.activeSeconds = addSafe(totals.activeSeconds, session.activeSeconds, 'activeSeconds');
    totals.engagedSeconds = addSafe(
      totals.engagedSeconds,
      session.durationSeconds,
      'engagedSeconds',
    );
  }

  return {
    ...totals,
    ...activityRange(buckets, sessions),
    coverage,
  };
}

export function summarizeBySource({ buckets = [], sessions = [] } = {}) {
  const sourceIds = new Set([
    ...buckets.map((bucket) => bucket.source),
    ...sessions.map((session) => session.source),
  ]);
  return Object.fromEntries([...sourceIds].sort().map((source) => [
    source,
    summarizeUsage({
      buckets: buckets.filter((bucket) => bucket.source === source),
      sessions: sessions.filter((session) => session.source === source),
    }),
  ]));
}
