export const LOCAL_PRICE_CATALOG_VERSION = '2026-08-19';

const SOURCES = {
  openai: 'https://developers.openai.com/api/docs/pricing',
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  kimi: 'https://platform.kimi.ai/docs/pricing/chat',
  google: 'https://ai.google.dev/gemini-api/docs/pricing',
  zai: 'https://docs.z.ai/guides/overview/pricing',
  minimax: 'https://platform.minimax.io/docs/guides/pricing-paygo',
};

function entry(pattern, input, cacheRead, output, options = {}) {
  return {
    pattern,
    match: options.match || 'prefix',
    source: options.source || null,
    contextTier: options.contextTier || '',
    processingTier: options.processingTier || 'standard',
    effectiveFrom: options.effectiveFrom || '2025-01-01T00:00:00.000Z',
    effectiveTo: options.effectiveTo || null,
    input,
    cacheWrite: options.cacheWrite ?? null,
    cacheWrite5m: options.cacheWrite5m ?? null,
    cacheWrite1h: options.cacheWrite1h ?? null,
    cacheRead,
    output,
    reasoning: options.reasoning ?? null,
    sourceUrl: options.sourceUrl || '',
    verifiedAt: options.verifiedAt || '2026-08-19',
    version: options.version || LOCAL_PRICE_CATALOG_VERSION,
    basis: 'standard-api',
  };
}

const claude = (pattern, input, cacheRead, output, options = {}) => entry(
  pattern,
  input,
  cacheRead,
  output,
  {
    ...options,
    cacheWrite: input * 1.25,
    cacheWrite5m: input * 1.25,
    cacheWrite1h: input * 2,
    sourceUrl: SOURCES.anthropic,
  },
);

const rate = (value) => Number(value.toFixed(12));

const gpt56 = (pattern, input, cacheWrite, cacheRead, output, options = {}) => [
  entry(pattern, input, cacheRead, output, {
    ...options,
    contextTier: 'short',
    cacheWrite,
    cacheWrite5m: cacheWrite,
    sourceUrl: SOURCES.openai,
  }),
  entry(pattern, rate(input * 2), rate(cacheRead * 2), rate(output * 1.5), {
    ...options,
    contextTier: 'long',
    cacheWrite: rate(cacheWrite * 2),
    cacheWrite5m: rate(cacheWrite * 2),
    sourceUrl: SOURCES.openai,
  }),
];

const contextPrices = (pattern, short, long, options = {}) => [
  entry(pattern, short.input, short.cacheRead, short.output, {
    ...options,
    contextTier: 'short',
    cacheWrite: short.cacheWrite ?? null,
  }),
  entry(pattern, long.input, long.cacheRead, long.output, {
    ...options,
    contextTier: 'long',
    cacheWrite: long.cacheWrite ?? null,
  }),
];

const CURRENT_PRICE_START = '2026-08-14T00:00:00.000Z';
const PRICE_MATRIX_START = '2026-08-19T00:00:00.000Z';

export const LOCAL_PRICE_CATALOG = [
  entry('grok-4.5', 2, 0.3, 6, { effectiveFrom: CURRENT_PRICE_START }),
  ...contextPrices('grok-4.6',
    { input: 2, cacheRead: 0.5, output: 6 },
    { input: 4, cacheRead: 1, output: 12 },
    { effectiveFrom: PRICE_MATRIX_START }),
  entry('grok-build-0.1', 1, 0.2, 2, { effectiveFrom: PRICE_MATRIX_START }),
  entry('muse-spark-1.2-contributor', 0.1, 0.002, 0.2, { effectiveFrom: PRICE_MATRIX_START }),
  entry('muse-spark-1.2', 1.25, 0.15, 4.25, { effectiveFrom: PRICE_MATRIX_START }),
  entry('kimi-k3', 3, 0.3, 15, { effectiveFrom: '2026-07-16T00:00:00.000Z', sourceUrl: SOURCES.kimi }),
  entry('kimi-k2.7-code', 0.95, 0.19, 4, { effectiveFrom: '2026-06-01T00:00:00.000Z', sourceUrl: SOURCES.kimi }),
  entry('kimi-k2.6', 0.95, null, 4, {
    effectiveFrom: '2026-06-01T00:00:00.000Z', effectiveTo: CURRENT_PRICE_START, sourceUrl: SOURCES.kimi,
  }),
  entry('kimi-k2.6', 0.95, 0.16, 4, { effectiveFrom: CURRENT_PRICE_START, sourceUrl: SOURCES.kimi }),
  entry('kimi-k2.5', 0.6, null, 3, {
    effectiveFrom: '2026-06-01T00:00:00.000Z', effectiveTo: PRICE_MATRIX_START, sourceUrl: SOURCES.kimi,
  }),
  entry('kimi-k2.5', 0.6, 0.1, 3, { effectiveFrom: PRICE_MATRIX_START, sourceUrl: SOURCES.kimi }),
  entry('kimi-k2-thinking', 1.15, null, 8, {
    effectiveFrom: '2025-11-06T00:00:00.000Z', effectiveTo: PRICE_MATRIX_START, sourceUrl: SOURCES.kimi,
  }),
  entry('kimi-k2-turbo', 1.15, null, 8, {
    effectiveFrom: '2025-08-01T00:00:00.000Z', effectiveTo: PRICE_MATRIX_START, sourceUrl: SOURCES.kimi,
  }),
  claude('claude-fable-5', 10, 1, 50, { effectiveFrom: '2026-06-01T00:00:00.000Z' }),
  claude('claude-opus-5', 5, 0.5, 25, { effectiveFrom: '2026-06-01T00:00:00.000Z' }),
  claude('claude-opus-4-8', 5, 0.5, 25, { effectiveFrom: PRICE_MATRIX_START }),
  claude('claude-opus-4-7', 5, 0.5, 25, { effectiveFrom: PRICE_MATRIX_START }),
  claude('claude-opus-4-6', 5, 0.5, 25, { effectiveFrom: PRICE_MATRIX_START }),
  claude('claude-opus-4-5', 5, 0.5, 25, { effectiveFrom: PRICE_MATRIX_START }),
  claude('claude-sonnet-5', 2, 0.2, 10, { effectiveFrom: '2026-06-01T00:00:00.000Z' }),
  claude('claude-sonnet-4-6', 3, 0.3, 15, { effectiveFrom: PRICE_MATRIX_START }),
  claude('claude-sonnet-4-5', 3, 0.3, 15, { effectiveFrom: PRICE_MATRIX_START, contextTier: 'short' }),
  claude('claude-sonnet-4-5', 6, 0.6, 22.5, { effectiveFrom: PRICE_MATRIX_START, contextTier: 'long' }),
  claude('claude-haiku-4-5', 1, 0.1, 5, { effectiveFrom: '2025-10-01T00:00:00.000Z' }),
  claude('claude-opus-4-1', 15, 1.5, 75, {
    effectiveFrom: '2025-08-05T00:00:00.000Z', effectiveTo: PRICE_MATRIX_START,
  }),
  claude('claude-opus-4', 5, 0.5, 25, {
    effectiveFrom: '2025-05-01T00:00:00.000Z', effectiveTo: PRICE_MATRIX_START,
  }),
  claude('claude-sonnet-4', 3, 0.3, 15, {
    effectiveFrom: '2025-05-01T00:00:00.000Z', effectiveTo: PRICE_MATRIX_START,
  }),
  ...gpt56('gpt-5.6', 5, 6.25, 0.5, 30, {
    effectiveFrom: '2026-07-09T00:00:00.000Z', effectiveTo: PRICE_MATRIX_START,
  }),
  ...gpt56('gpt-5.6-sol', 5, 6.25, 0.5, 30, { effectiveFrom: PRICE_MATRIX_START }),
  ...gpt56('gpt-5.6-terra', 2.5, 3.125, 0.25, 15, {
    effectiveFrom: '2026-07-09T00:00:00.000Z',
    effectiveTo: '2026-07-30T00:00:00.000Z',
  }),
  ...gpt56('gpt-5.6-terra', 2, 2.5, 0.2, 12, { effectiveFrom: '2026-07-30T00:00:00.000Z' }),
  ...gpt56('gpt-5.6-luna', 1, 1.25, 0.1, 6, {
    effectiveFrom: '2026-07-09T00:00:00.000Z',
    effectiveTo: '2026-07-30T00:00:00.000Z',
  }),
  ...gpt56('gpt-5.6-luna', 0.2, 0.25, 0.02, 1.2, { effectiveFrom: '2026-07-30T00:00:00.000Z' }),
  entry('codex-auto-review', 2.5, 0.25, 15, {
    match: 'exact', source: 'codex', effectiveFrom: '2026-04-01T00:00:00.000Z', effectiveTo: PRICE_MATRIX_START, sourceUrl: SOURCES.openai,
  }),
  entry('gpt-5.5-pro', 30, null, 180, {
    effectiveFrom: '2026-06-01T00:00:00.000Z', effectiveTo: PRICE_MATRIX_START, sourceUrl: SOURCES.openai,
  }),
  entry('gpt-5.5-pro', 30, 30, 180, { effectiveFrom: PRICE_MATRIX_START, sourceUrl: SOURCES.openai }),
  entry('gpt-5.5', 5, 0.5, 30, {
    effectiveFrom: '2026-06-01T00:00:00.000Z', effectiveTo: PRICE_MATRIX_START, sourceUrl: SOURCES.openai,
  }),
  ...contextPrices('gpt-5.5',
    { input: 5, cacheRead: 0.5, output: 30 },
    { input: 10, cacheRead: 1, output: 45 },
    { effectiveFrom: PRICE_MATRIX_START, sourceUrl: SOURCES.openai }),
  entry('gpt-5.4-mini', 0.75, 0.075, 4.5, { effectiveFrom: '2026-04-01T00:00:00.000Z', sourceUrl: SOURCES.openai }),
  entry('gpt-5.4-nano', 0.2, 0.02, 1.25, { effectiveFrom: PRICE_MATRIX_START, sourceUrl: SOURCES.openai }),
  entry('gpt-5.4-pro', 30, 30, 180, { effectiveFrom: PRICE_MATRIX_START, sourceUrl: SOURCES.openai }),
  entry('gpt-5.4', 2.5, 0.25, 15, {
    effectiveFrom: '2026-04-01T00:00:00.000Z', effectiveTo: PRICE_MATRIX_START, sourceUrl: SOURCES.openai,
  }),
  ...contextPrices('gpt-5.4',
    { input: 2.5, cacheRead: 0.25, output: 15 },
    { input: 5, cacheRead: 0.5, output: 22.5 },
    { effectiveFrom: PRICE_MATRIX_START, sourceUrl: SOURCES.openai }),
  entry('gpt-5.3-codex', 1.75, null, 14, {
    effectiveFrom: '2026-03-01T00:00:00.000Z', effectiveTo: PRICE_MATRIX_START, sourceUrl: SOURCES.openai,
  }),
  entry('gpt-5.3-codex', 1.75, 0.175, 14, { effectiveFrom: PRICE_MATRIX_START, sourceUrl: SOURCES.openai }),
  entry('gpt-5.2-codex', 1.75, 0.175, 14, { effectiveFrom: '2026-02-01T00:00:00.000Z', sourceUrl: SOURCES.openai }),
  entry('gpt-5.2', 1.75, 0.175, 14, { effectiveFrom: '2026-02-01T00:00:00.000Z', sourceUrl: SOURCES.openai }),
  entry('gpt-5.1-codex-mini', 0.25, null, 2, {
    effectiveFrom: '2026-02-01T00:00:00.000Z', effectiveTo: PRICE_MATRIX_START, sourceUrl: SOURCES.openai,
  }),
  entry('gpt-5.1-codex-mini', 0.25, 0.025, 2, { effectiveFrom: PRICE_MATRIX_START, sourceUrl: SOURCES.openai }),
  entry('gpt-5.1-codex-max', 1.25, 0.125, 10, { effectiveFrom: PRICE_MATRIX_START, sourceUrl: SOURCES.openai }),
  entry('gpt-5.1-codex', 1.25, 0.125, 10, {
    effectiveFrom: '2026-02-01T00:00:00.000Z', effectiveTo: PRICE_MATRIX_START, sourceUrl: SOURCES.openai,
  }),
  entry('gpt-5.1-codex', 1.07, 0.107, 8.5, { effectiveFrom: PRICE_MATRIX_START, sourceUrl: SOURCES.openai }),
  entry('gpt-5.1', 1.25, 0.125, 10, {
    effectiveFrom: '2026-02-01T00:00:00.000Z', effectiveTo: PRICE_MATRIX_START, sourceUrl: SOURCES.openai,
  }),
  entry('gpt-5.1', 1.07, 0.107, 8.5, { effectiveFrom: PRICE_MATRIX_START, sourceUrl: SOURCES.openai }),
  entry('gpt-5-codex', 1.25, 0.125, 10, {
    effectiveFrom: '2025-09-15T00:00:00.000Z', effectiveTo: PRICE_MATRIX_START, sourceUrl: SOURCES.openai,
  }),
  entry('gpt-5-codex', 1.07, 0.107, 8.5, { effectiveFrom: PRICE_MATRIX_START, sourceUrl: SOURCES.openai }),
  entry('gpt-5-nano', 0.05, 0.005, 0.4, { effectiveFrom: PRICE_MATRIX_START, sourceUrl: SOURCES.openai }),
  entry('gpt-5', 1.25, 0.125, 10, {
    effectiveFrom: '2025-08-07T00:00:00.000Z', effectiveTo: PRICE_MATRIX_START, sourceUrl: SOURCES.openai,
  }),
  entry('gpt-5', 1.07, 0.107, 8.5, { effectiveFrom: PRICE_MATRIX_START, sourceUrl: SOURCES.openai }),
  entry('glm-5.3', 1.4, 0.26, 4.4, { effectiveFrom: CURRENT_PRICE_START, sourceUrl: SOURCES.zai }),
  entry('glm-5.2', 1.4, 0.26, 4.4, { effectiveFrom: '2026-06-13T00:00:00.000Z', sourceUrl: SOURCES.zai }),
  entry('glm-5.1', 1.4, 0.26, 4.4, { effectiveFrom: '2026-01-01T00:00:00.000Z', sourceUrl: SOURCES.zai }),
  entry('glm-5', 1, 0.2, 3.2, {
    match: 'exact', effectiveFrom: PRICE_MATRIX_START, sourceUrl: SOURCES.zai,
  }),
  entry('mimo-v2.5-pro', 0.435, 0.003625, 0.87, { effectiveFrom: CURRENT_PRICE_START }),
  entry('mimo-v2.5', 0.14, 0.0028, 0.28, { effectiveFrom: CURRENT_PRICE_START }),
  entry('minimax-m3', 0.6, null, 2.4, {
    effectiveFrom: '2026-05-01T00:00:00.000Z', effectiveTo: CURRENT_PRICE_START, sourceUrl: SOURCES.minimax,
  }),
  entry('minimax-m3', 0.3, 0.06, 1.2, { effectiveFrom: CURRENT_PRICE_START, sourceUrl: SOURCES.minimax }),
  entry('minimax-m2.7', 0.3, 0.06, 1.2, {
    effectiveFrom: CURRENT_PRICE_START, cacheWrite: 0.375, sourceUrl: SOURCES.minimax,
  }),
  entry('minimax-m2.5', 0.3, 0.06, 1.2, {
    effectiveFrom: CURRENT_PRICE_START, cacheWrite: 0.375, sourceUrl: SOURCES.minimax,
  }),
  entry('qwen3.8-max', 2, 0.25, 6, { effectiveFrom: CURRENT_PRICE_START, cacheWrite: 2.5 }),
  entry('qwen3.7-max', 2.5, 0.5, 7.5, { effectiveFrom: CURRENT_PRICE_START, cacheWrite: 3.125 }),
  ...contextPrices('qwen3.7-plus',
    { input: 0.4, cacheRead: 0.04, cacheWrite: 0.5, output: 1.6 },
    { input: 1.2, cacheRead: 0.12, cacheWrite: 1.5, output: 4.8 },
    { effectiveFrom: CURRENT_PRICE_START }),
  ...contextPrices('qwen3.6-plus',
    { input: 0.5, cacheRead: 0.05, cacheWrite: 0.625, output: 3 },
    { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 6 },
    { effectiveFrom: CURRENT_PRICE_START }),
  entry('qwen3.5-plus', 0.2, 0.02, 1.2, { effectiveFrom: PRICE_MATRIX_START, cacheWrite: 0.25 }),
  entry('deepseek-v4-pro', 0.435, 0.003625, 0.87, { effectiveFrom: CURRENT_PRICE_START, effectiveTo: PRICE_MATRIX_START }),
  entry('deepseek-v4-pro', 1.32, 0.044, 3.96, { effectiveFrom: PRICE_MATRIX_START }),
  entry('deepseek-v4-pro', 1.32, 0.044, 3.96, { effectiveFrom: PRICE_MATRIX_START, processingTier: 'peak' }),
  entry('deepseek-v4-pro', 0.66, 0.022, 1.98, { effectiveFrom: PRICE_MATRIX_START, processingTier: 'off-peak' }),
  entry('deepseek-v4-flash', 0.14, 0.0028, 0.28, { effectiveFrom: CURRENT_PRICE_START, effectiveTo: PRICE_MATRIX_START }),
  entry('deepseek-v4-flash', 0.44, 0.014, 1.32, { effectiveFrom: PRICE_MATRIX_START }),
  entry('deepseek-v4-flash', 0.44, 0.014, 1.32, { effectiveFrom: PRICE_MATRIX_START, processingTier: 'peak' }),
  entry('deepseek-v4-flash', 0.22, 0.007, 0.66, { effectiveFrom: PRICE_MATRIX_START, processingTier: 'off-peak' }),
  entry('hy3', 0.14, 0.035, 0.58, { effectiveFrom: CURRENT_PRICE_START }),
  entry('gemini-3.7-flash', 1.5, 0.15, 7.5, { effectiveFrom: PRICE_MATRIX_START }),
  entry('gemini-3.6-flash', 1.5, 0.15, 7.5, { effectiveFrom: PRICE_MATRIX_START }),
  ...contextPrices('gemini-3.1-pro',
    { input: 2, cacheRead: 0.2, output: 12 },
    { input: 4, cacheRead: 0.4, output: 18 },
    { effectiveFrom: '2026-05-01T00:00:00.000Z', sourceUrl: SOURCES.google, verifiedAt: '2026-08-19' }),
  entry('gemini-3.5-flash', 1.5, 0.15, 9, {
    effectiveFrom: '2026-05-01T00:00:00.000Z', sourceUrl: SOURCES.google, verifiedAt: '2026-08-19',
  }),
  entry('gemini-3.5-flash-lite', 0.3, 0.03, 2.5, { effectiveFrom: PRICE_MATRIX_START }),
  entry('gemini-3-flash-preview', 0.5, 0.05, 3, {
    effectiveFrom: '2026-05-01T00:00:00.000Z', sourceUrl: SOURCES.google, verifiedAt: '2026-08-19',
  }),
  entry('gemini-3-flash', 0.5, 0.05, 3, {
    effectiveFrom: '2026-05-01T00:00:00.000Z', sourceUrl: SOURCES.google, verifiedAt: '2026-08-19',
  }),
];

function contextRank(price, contextTier) {
  if (contextTier) {
    if (price.contextTier === contextTier) return 2;
    return price.contextTier === '' ? 0 : -1;
  }
  if (price.contextTier === 'short') return 1;
  return price.contextTier === '' ? 0 : -1;
}

function matchCandidate(name, bucket, at) {
  return LOCAL_PRICE_CATALOG
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
  for (const candidate of candidates) {
    const match = matchCandidate(candidate, bucket, at);
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
