const KIMI_MODEL_ALIASES = new Map([
  ['k3', 'kimi-k3'],
  ['kimi-k3', 'kimi-k3'],
  ['k3-256', 'kimi-k3-256k'],
  ['k3-256k', 'kimi-k3-256k'],
  ['kimi-k3-256k', 'kimi-k3-256k'],
  ['kimi-for-coding', 'kimi-k2.7-code'],
  ['kimi-for-coding-highspeed', 'kimi-k2.7-code-highspeed'],
  ['kimi-k2.7-code', 'kimi-k2.7-code'],
  ['kimi-k2.7-code-highspeed', 'kimi-k2.7-code-highspeed'],
  ['kimi-k2.6', 'kimi-k2.6'],
  ['kimi-k2.5', 'kimi-k2.5'],
]);

function modelSlug(model) {
  const value = String(model || '').trim().toLowerCase();
  return value.startsWith('kimi-code/') ? value.slice('kimi-code/'.length) : value;
}

/* Preserve the exact log model as `model`; this is a separate, conservative
 * semantic ID used for cross-tool comparison and pricing. */
export function canonicalModelId({ source, model, modelProvider } = {}) {
  const slug = modelSlug(model);
  const kimiContext = source === 'kimi-code'
    || /kimi|moonshot/i.test(String(modelProvider || ''))
    || slug.startsWith('kimi-')
    || ['k3', 'k3-256', 'k3-256k'].includes(slug);
  return kimiContext ? KIMI_MODEL_ALIASES.get(slug) || '' : '';
}

export function withCanonicalModel(entry) {
  const modelCanonical = canonicalModelId(entry);
  return modelCanonical ? { ...entry, modelCanonical } : entry;
}
