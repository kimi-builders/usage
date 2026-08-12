import { detectAgentVersions } from '../agent-info.js';
import { COLLECTOR_VERSION } from '../client-meta.js';
import { loadConfig } from '../config.js';
import { deviceEnvironment } from '../device-info.js';
import { collectLocalSnapshot, publicDoctorReport } from './snapshot.js';
import {
  estimateLocalBucketCost,
  LOCAL_PRICE_CATALOG,
  LOCAL_PRICE_CATALOG_VERSION,
} from './pricing.js';

function totalTokens(bucket) {
  return bucket.inputTokens
    + bucket.cacheWriteInputTokens
    + bucket.cacheReadInputTokens
    + bucket.outputTokens
    + bucket.reasoningOutputTokens;
}

function communityUrl(apiUrl) {
  try {
    return new URL('/usage', apiUrl || 'https://kimi.builders').toString();
  } catch {
    return 'https://kimi.builders/usage';
  }
}

function aggregateActivityHours(sessions) {
  const hours = new Map();
  for (const session of sessions) {
    for (const item of session.activityHours || []) {
      const key = `${session.source}|${item.hourStart}`;
      if (!hours.has(key)) {
        hours.set(key, {
          source: session.source,
          hourStart: item.hourStart,
          activeSeconds: 0,
          engagedSeconds: 0,
          messageCount: 0,
          userMessageCount: 0,
        });
      }
      const hour = hours.get(key);
      hour.activeSeconds += item.activeSeconds;
      hour.engagedSeconds += item.engagedSeconds || 0;
      hour.messageCount += item.messageCount || 0;
      hour.userMessageCount += item.userMessageCount;
    }
  }
  return [...hours.values()].sort((left, right) => left.hourStart.localeCompare(right.hourStart));
}

export function createDashboardData(snapshot, {
  config = loadConfig(),
  device = deviceEnvironment(),
  agentVersions = detectAgentVersions(),
} = {}) {
  const diagnostic = publicDoctorReport(snapshot);
  const buckets = snapshot.data.buckets.map((bucket, index) => {
    const price = estimateLocalBucketCost(bucket);
    return {
      id: index,
      source: bucket.source,
      model: bucket.model,
      modelCanonical: bucket.modelCanonical || null,
      modelProvider: bucket.modelProvider || null,
      reasoningEffort: bucket.reasoningEffort || null,
      agentVersion: bucket.agentVersion || null,
      contextTier: bucket.contextTier || null,
      processingTier: bucket.processingTier || null,
      project: bucket.project || null,
      bucketStart: bucket.bucketStart,
      inputTokens: bucket.inputTokens,
      cacheWriteInputTokens: bucket.cacheWriteInputTokens,
      cacheReadInputTokens: bucket.cacheReadInputTokens,
      outputTokens: bucket.outputTokens,
      reasoningOutputTokens: bucket.reasoningOutputTokens,
      requestCount: bucket.requestCount,
      measurement: bucket.measurement,
      totalTokens: totalTokens(bucket),
      ...price,
    };
  });
  const sessions = snapshot.data.sessions.map((session) => ({
    source: session.source,
    project: session.project || null,
    agentVersion: session.agentVersion || null,
    firstMessageAt: session.firstMessageAt,
    lastMessageAt: session.lastMessageAt,
    durationSeconds: session.durationSeconds,
    activeSeconds: session.activeSeconds,
    messageCount: session.messageCount,
    userMessageCount: session.userMessageCount,
  }));
  return {
    schemaVersion: 1,
    generatedAt: snapshot.generatedAt,
    locality: snapshot.locality,
    device: { ...device, collector: { name: '@kimi-builders/usage', version: COLLECTOR_VERSION } },
    agentVersions,
    community: {
      connected: Boolean(config?.apiKey && config?.sessionSalt),
      url: communityUrl(config?.apiUrl),
      origin: config?.apiUrl || 'https://kimi.builders',
    },
    pricing: {
      version: LOCAL_PRICE_CATALOG_VERSION,
      basis: 'standard-api',
      entryCount: LOCAL_PRICE_CATALOG.length,
      entries: LOCAL_PRICE_CATALOG.map((price) => ({
        pattern: price.pattern,
        source: price.source,
        contextTier: price.contextTier,
        processingTier: price.processingTier,
        effectiveFrom: price.effectiveFrom,
        effectiveTo: price.effectiveTo,
        input: price.input,
        cacheWrite: price.cacheWrite,
        cacheRead: price.cacheRead,
        output: price.output,
        reasoning: price.reasoning,
        sourceUrl: price.sourceUrl,
        verifiedAt: price.verifiedAt,
      })),
    },
    sources: diagnostic.sources,
    diagnostics: diagnostic.diagnostics,
    buckets,
    sessions,
    activityHours: aggregateActivityHours(snapshot.data.sessions),
  };
}

export async function loadLocalDashboardData() {
  const snapshot = await collectLocalSnapshot();
  return createDashboardData(snapshot);
}
