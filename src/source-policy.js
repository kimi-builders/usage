import { sourceRegistry } from './parsers/index.js';

export const SOURCE_POLICY_VERSION = 1;
export const SOURCE_MODES = Object.freeze(['off', 'local', 'private']);

export function isSourceMode(value) {
  return SOURCE_MODES.includes(value);
}

function legacyEnabled(config, source) {
  if (source.tier !== 'explicit-opt-in') return true;
  return new Set(config?.enabledSources || []).has(source.id);
}

function defaultMode(config, source, explicit) {
  if (explicit) return source.tier === 'explicit-opt-in' ? 'off' : 'local';
  if (!legacyEnabled(config, source)) return 'off';
  return config?.apiKey && config?.sessionSalt ? 'private' : 'local';
}

export function effectiveSourcePolicies(config = null, registry = sourceRegistry) {
  const stored = config?.sourcePolicies;
  const explicit = Boolean(stored && typeof stored === 'object' && !Array.isArray(stored));
  return Object.fromEntries(registry.map((source) => {
    const saved = explicit ? stored[source.id] : undefined;
    return [source.id, isSourceMode(saved) ? saved : defaultMode(config, source, explicit)];
  }));
}

export function newInstallSourcePolicies({ sync = false } = {}, registry = sourceRegistry) {
  const localDefaults = effectiveSourcePolicies(null, registry);
  return Object.fromEntries(registry.map((source) => [
    source.id,
    sync && localDefaults[source.id] !== 'off' ? 'private' : localDefaults[source.id],
  ]));
}

export function sourceIdsFor(config, purpose, registry = sourceRegistry) {
  if (!['scan', 'sync'].includes(purpose)) throw new Error(`Unknown source policy purpose: ${purpose}`);
  const policies = effectiveSourcePolicies(config, registry);
  return registry
    .filter((source) => purpose === 'scan'
      ? policies[source.id] !== 'off'
      : policies[source.id] === 'private')
    .map((source) => source.id);
}

export function applySourcePolicies(config = {}, nextPolicies = {}, registry = sourceRegistry) {
  if (!nextPolicies || typeof nextPolicies !== 'object' || Array.isArray(nextPolicies)) {
    throw new Error('sourcePolicies must be an object');
  }
  const known = new Set(registry.map((source) => source.id));
  for (const [sourceId, mode] of Object.entries(nextPolicies)) {
    if (!known.has(sourceId)) throw new Error(`Unknown usage source: ${sourceId}`);
    if (!isSourceMode(mode)) throw new Error(`Invalid source mode for ${sourceId}: ${mode}`);
  }
  const current = effectiveSourcePolicies(config, registry);
  const sourcePolicies = Object.fromEntries(registry.map((source) => [
    source.id,
    nextPolicies[source.id] ?? current[source.id],
  ]));
  const enabledSources = registry
    .filter((source) => source.tier === 'explicit-opt-in' && sourcePolicies[source.id] !== 'off')
    .map((source) => source.id)
    .sort();
  return {
    ...config,
    sourcePolicyVersion: SOURCE_POLICY_VERSION,
    sourcePolicies,
    enabledSources,
  };
}

export function sourcePolicyIsExplicit(config) {
  return Boolean(config?.sourcePolicies && typeof config.sourcePolicies === 'object');
}
