export function modelPriceRows(report) {
  const rows = new Map();
  for (const bucket of report.buckets || []) {
    const model = bucket.modelCanonical || bucket.model || 'unknown';
    // A model may span historical rates, sources, contexts and processing tiers.
    const key = JSON.stringify([model, bucket.pricePattern, bucket.priceVersion,
      bucket.priceContextTier, bucket.priceProcessingTier, bucket.priceInput,
      bucket.priceCacheWrite, bucket.priceCacheWrite5m, bucket.priceCacheWrite1h,
      bucket.priceCacheRead, bucket.priceOutput, bucket.priceProvisional,
      bucket.priceSourceUrl, bucket.priceNote, bucket.priceAssumptions]);
    if (!rows.has(key)) rows.set(key, { key, model, bucket });
  }
  return [...rows.values()].sort((a, b) => a.model.localeCompare(b.model));
}

export function cacheWritePriceLabel(bucket, zh) {
  const fallback = bucket.priceCacheWrite ?? bucket.priceInput;
  if (!bucket.pricePattern || fallback == null) return '—';
  const rate = `$${fallback}/M`;
  if (bucket.priceCacheWrite5m != null || bucket.priceCacheWrite1h != null) {
    return `5m $${bucket.priceCacheWrite5m ?? fallback}/M · 1h $${bucket.priceCacheWrite1h ?? fallback}/M · ${zh ? '未知 TTL' : 'unknown TTL'} ${rate}`;
  }
  return bucket.priceCacheWrite == null ? `${rate} · ${zh ? '同输入' : 'same as input'}` : rate;
}

export function pricingAssumptionLabels(bucket, zh) {
  const labels = {
    'short-context': zh ? '未记录上下文档位，按短上下文估算' : 'Context tier missing; estimated at short-context rates',
    'cache-write-ttl': zh ? '未记录缓存 TTL，按默认缓存写价估算' : 'Cache TTL missing; estimated at the default cache-write rate',
  };
  return (bucket.priceAssumptions || []).map((key) => labels[key]).filter(Boolean);
}
