import { canonicalModelId, modelLeaf } from '../model-meta.js';
import {
  EMBEDDED_PRICE_CATALOG,
  getActivePriceCatalog,
  numericCatalogEntries,
  priceCatalogStatus,
} from '../pricing/catalog.js';

export const LOCAL_PRICE_CATALOG_VERSION = EMBEDDED_PRICE_CATALOG.catalogVersion;
export const LOCAL_PRICE_CATALOG = numericCatalogEntries(EMBEDDED_PRICE_CATALOG);

function contextRank(price, contextTier) {
  if (contextTier) {
    if (price.contextTier === contextTier) return 2;
    return price.contextTier === '' ? 0 : -1;
  }
  if (price.contextTier === 'short') return 1;
  return price.contextTier === '' ? 0 : -1;
}

function matchCandidate(catalog, name, bucket, at) {
  const candidates = catalog
    .filter((price) => {
      const patternMatches = price.match === 'exact'
        ? name === price.pattern
        : name.startsWith(price.pattern)
          && !(['kimi-k3', 'minimax-m3', 'claude-fable-5'].includes(price.pattern) && name.startsWith(price.pattern + '.'))
          && !(price.pattern === 'claude-fable-5' && /^claude-fable-5-\d{1,2}(?:-|$)/.test(name));
      return patternMatches
        && Date.parse(price.effectiveFrom) <= at
        && (!price.effectiveTo || at < Date.parse(price.effectiveTo))
        && price.processingTier === (bucket.processingTier || 'standard')
        && contextRank(price, bucket.contextTier) >= 0;
    })
    .sort((left, right) => {
      if (left.match !== right.match) return left.match === 'exact' ? -1 : 1;
      return right.pattern.length - left.pattern.length
        || contextRank(right, bucket.contextTier) - contextRank(left, bucket.contextTier)
        || Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom);
    });
  const mostSpecific = candidates[0];
  if (!mostSpecific) return null;
  return candidates
    .filter((price) => price.match === mostSpecific.match && price.pattern === mostSpecific.pattern)
    .filter((price) => price.source === null || price.source === bucket.source)
    .sort((left, right) => (
      contextRank(right, bucket.contextTier) - contextRank(left, bucket.contextTier)
      || Number(right.source === bucket.source) - Number(left.source === bucket.source)
      || Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom)
    ))[0] || null;
}

export function matchLocalPrice(bucket) {
  const model = modelLeaf(canonicalModelId(bucket) || bucket.model);
  const at = Date.parse(bucket.bucketStart);
  if (!model || !Number.isFinite(at)) return null;
  const normalized = model.toLowerCase().replace(/[\s_]+/g, '-');
  // Resolve decimal Claude versions before trying a less specific family prefix.
  const claudeAlias = normalized.startsWith('claude-')
    ? normalized.replace(/-(\d+)\.(\d+)(?=-|$)/g, '-$1-$2') : normalized;
  const candidates = new Set([claudeAlias, normalized]);
  const catalog = numericCatalogEntries(getActivePriceCatalog().catalog);
  for (const candidate of candidates) {
    const match = matchCandidate(catalog, candidate, bucket, at);
    if (match) return match;
  }
  return null;
}

export function estimateLocalBucketCost(bucket) {
  const price = matchLocalPrice(bucket);
  const totalTokens = bucket.inputTokens
    + bucket.cacheWriteInputTokens
    + bucket.cacheReadInputTokens
    + bucket.outputTokens
    + bucket.reasoningOutputTokens;
  if (!price) {
    return {
      costMicros: 0,
      status: 'unpriced',
      pricedTokens: 0,
      unpricedTokens: totalTokens,
      assumedTokens: 0,
      priceVersion: null,
    };
  }

  const cacheWrite5m = Math.max(0, bucket.cacheWrite5mInputTokens || 0);
  const cacheWrite1h = Math.max(0, bucket.cacheWrite1hInputTokens || 0);
  const unclassifiedCacheWrite = Math.max(
    0,
    bucket.cacheWriteInputTokens - cacheWrite5m - cacheWrite1h,
  );
  const legs = [
    [bucket.inputTokens, price.input],
    [unclassifiedCacheWrite, price.cacheWrite ?? price.input],
    [cacheWrite5m, price.cacheWrite5m ?? price.cacheWrite ?? price.input],
    [cacheWrite1h, price.cacheWrite1h ?? (price.cacheWrite5m !== null ? null : price.cacheWrite ?? price.input)],
    [bucket.cacheReadInputTokens, price.cacheRead],
    [bucket.outputTokens, price.output],
    [bucket.reasoningOutputTokens, price.reasoning ?? price.output],
  ];
  let costMicros = 0;
  let pricedTokens = 0;
  let unpricedTokens = 0;
  for (const [tokens, rate] of legs) {
    if (tokens <= 0) continue;
    if (rate === null) unpricedTokens += tokens;
    else {
      costMicros += tokens * rate;
      pricedTokens += tokens;
    }
  }
  // Keep the community estimator's assumptions explicit; estimates are not bills.
  const priceAssumptions = [];
  let assumedTokens = 0;
  if (!bucket.contextTier && price.contextTier === 'short') {
    priceAssumptions.push('short-context');
    assumedTokens += totalTokens;
  }
  if (price.provisional) {
    priceAssumptions.push('provisional-price');
    assumedTokens += totalTokens;
  }
  if (unclassifiedCacheWrite > 0 && price.cacheWrite5m !== null
    && price.cacheWrite5m !== price.cacheWrite1h) {
    priceAssumptions.push('cache-write-ttl');
    assumedTokens += unclassifiedCacheWrite;
  }
  return {
    costMicros,
    status: unpricedTokens > 0 ? 'partial' : 'priced',
    pricedTokens,
    unpricedTokens,
    assumedTokens: Math.min(totalTokens, assumedTokens),
    priceAssumptions,
    priceVersion: price.version,
    pricePattern: price.pattern,
    priceSourceUrl: price.sourceUrl,
    priceInput: price.input,
    priceCacheWrite: price.cacheWrite,
    priceCacheWrite5m: price.cacheWrite5m,
    priceCacheWrite1h: price.cacheWrite1h,
    priceCacheRead: price.cacheRead,
    priceOutput: price.output,
    priceContextTier: price.contextTier || null,
    priceProcessingTier: price.processingTier || null,
    priceProvisional: price.provisional === true,
    priceNote: price.note || null,
  };
}

export function localPricingStatus() {
  return priceCatalogStatus();
}
