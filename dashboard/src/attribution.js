import { tokenTotal } from './analytics.js';

export function knownDimension(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^(?:unknown|private\s*\/\s*unknown|n\/a)$/i.test(text) ? '' : text;
}

export function measurementCoverage(buckets) {
  const total = buckets.reduce((sum, bucket) => sum + tokenTotal(bucket), 0);
  return total > 0 ? buckets.filter((bucket) => bucket.measurement === 'exact')
    .reduce((sum, bucket) => sum + tokenTotal(bucket), 0) / total : 0;
}
