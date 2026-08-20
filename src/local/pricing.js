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
  return catalog
    .filter((price) => {
      const patternMatches = price.match === 'exact'
        ? name === price.pattern
        : name.startsWith(price.pattern);
      return patternMatches
        && Date.parse(price.effectiveFrom) <= at
        && (!price.effectiveTo || at < Date.parse(price.effectiveTo))
        && (price.source === null || price.source === bucket.source)
        && price.processingTier === (bucket.processingTier || 'standard')
        && contextRank(price, bucket.contextTier) >= 0;
    })
    .sort((left, right) => {
      if (left.match !== right.match) return left.match === 'exact' ? -1 : 1;
      return right.pattern.length - left.pattern.length
        || contextRank(right, bucket.contextTier) - contextRank(left, bucket.contextTier)
        || Number(right.source === bucket.source) - Number(left.source === bucket.source)
        || Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom);
    })[0] || null;
}

export function matchLocalPrice(bucket) {
  const model = String(bucket.modelCanonical || bucket.model || '').trim();
  const at = Date.parse(bucket.bucketStart);
  if (!model || !Number.isFinite(at)) return null;
  const slash = model.lastIndexOf('/');
  const names = slash > 0 && slash < model.length - 1
    ? [model, model.slice(slash + 1)]
    : [model];
  const candidates = [...new Set(names.flatMap((name) => {
    const normalized = name.toLowerCase().replace(/[\s_]+/g, '-');
    const claudeVersionAlias = normalized.startsWith('claude-')
      ? normalized.replace(/-(\d+)\.(\d+)(?=-|$)/g, '-$1-$2')
      : normalized;
    return [name, normalized, claudeVersionAlias];
  }))];
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
    [cacheWrite1h, price.cacheWrite1h ?? price.cacheWrite ?? price.input],
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
  const assumedTokens = !bucket.contextTier && price.contextTier === 'short'
    ? totalTokens
    : 0;
  return {
    costMicros,
    status: unpricedTokens > 0 ? 'partial' : 'priced',
    pricedTokens,
    unpricedTokens,
    assumedTokens,
    priceVersion: price.version,
    pricePattern: price.pattern,
    priceSourceUrl: price.sourceUrl,
    priceInput: price.input,
    priceCacheWrite: price.cacheWrite,
    priceCacheRead: price.cacheRead,
    priceOutput: price.output,
    priceContextTier: price.contextTier || null,
    priceProcessingTier: price.processingTier || null,
  };
}

export function localPricingStatus() {
  return priceCatalogStatus();
}
