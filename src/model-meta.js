const KIMI_MODEL_ALIASES = new Map([
  ['k3', 'kimi-k3'],
  ['kimi-k3', 'kimi-k3'],
  ['k3.1-pro', 'kimi-k3.1-pro'],
  ['kimi-k3.1-pro', 'kimi-k3.1-pro'],
  ['k3.1-pro-highspeed', 'kimi-k3.1-pro-highspeed'],
  ['kimi-k3.1-pro-highspeed', 'kimi-k3.1-pro-highspeed'],
  ['k3-256', 'kimi-k3-256k'],
  ['k3-256k', 'kimi-k3-256k'],
  ['kimi-k3-256k', 'kimi-k3-256k'],
  ['kimi-for-coding', 'kimi-k2.8-preview'],
  ['kimi-for-coding-highspeed', 'kimi-k2.7-code-highspeed'],
  ['kimi-k2.8-preview', 'kimi-k2.8-preview'],
  ['kimi-k2.7-code', 'kimi-k2.7-code'],
  ['kimi-k2.7-code-highspeed', 'kimi-k2.7-code-highspeed'],
  ['kimi-k2.6', 'kimi-k2.6'],
  ['kimi-k2.5', 'kimi-k2.5'],
]);

const KIMI_K2_8_ROLLOUT_AT = Date.parse('2026-09-11T00:00:00.000Z');

// A profile or gateway name can be chosen by the user; only the last
// segment identifies the model. A trailing slash has no model segment.
export function modelLeaf(model) {
  const name = String(model || '').trim();
  return name.slice(name.lastIndexOf('/') + 1).trim();
}

// Classify the full prompt for ONE request, including cache hits/writes.
// Half-hour totals cannot tell which rate individual requests incurred.
export function openAiRequestContextTier(model, promptTokens) {
  const name = modelLeaf(model).toLowerCase();
  if (!(name.startsWith('gpt-5.6') || name.startsWith('gpt-6-astra') || /^gpt-6\.2-(?:astra|sol)$/.test(name))) return '';
  return promptTokens > 272_000 ? 'long' : 'short';
}

function temporalKimiAlias(slug, timestamp) {
  if (slug !== 'kimi-for-coding') return null;
  const at = timestamp instanceof Date ? timestamp.getTime() : Date.parse(timestamp);
  if (!Number.isFinite(at)) return null;
  return at < KIMI_K2_8_ROLLOUT_AT ? 'kimi-k2.7-code' : 'kimi-k2.8-preview';
}

/* Preserve the exact log model as `model`; this is a separate, conservative
 * semantic ID used for cross-tool comparison and pricing. */
export function canonicalModelId({ model, modelCanonical, timestamp, bucketStart } = {}) {
  const stored = String(modelCanonical || '').trim();
  const at = timestamp ?? bucketStart;
  const raw = modelLeaf(model).toLowerCase();
  const slug = stored ? modelLeaf(stored).toLowerCase() : raw;
  return temporalKimiAlias(raw === 'kimi-for-coding' ? raw : slug, at)
    ?? KIMI_MODEL_ALIASES.get(slug) ?? stored;
}

export function withCanonicalModel(entry) {
  const modelCanonical = canonicalModelId(entry);
  return modelCanonical ? { ...entry, modelCanonical } : entry;
}
