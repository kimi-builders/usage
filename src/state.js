import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const stateDir = process.env.KBU_USAGE_STATE_DIR?.trim()
  || join(homedir(), '.kimi-builders', 'usage');
const stateFile = join(stateDir, 'state.json');

export function loadState() {
  if (!existsSync(stateFile)) return { buckets: {}, sessions: {} };
  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8'));
    return {
      buckets: parsed.buckets || {},
      sessions: parsed.sessions || {},
      ...(typeof parsed.syncTarget === 'string' && parsed.syncTarget
        ? { syncTarget: parsed.syncTarget }
        : {}),
    };
  } catch {
    return { buckets: {}, sessions: {} };
  }
}

export function syncTargetKey(config = {}) {
  const rawApiUrl = String(config.apiUrl || '').trim();
  let apiUrl = rawApiUrl;
  try { apiUrl = new URL(rawApiUrl).origin; } catch {}
  const apiKey = String(config.apiKey || '').trim();
  const deviceId = String(config.deviceId || '').trim();
  if (!apiUrl || !apiKey) throw new Error('Cannot bind sync state without a community target.');
  // Checkpoints belong to one exact remote credential. Store only an
  // irreversible fingerprint; the API key itself never enters state.json.
  return createHash('sha256')
    .update(`${apiUrl}\0${deviceId}\0${apiKey}`)
    .digest('hex')
    .slice(0, 32);
}

export function prepareStateForSync(config, { full = false, state = loadState() } = {}) {
  const syncTarget = syncTargetKey(config);
  const hasCheckpoint = Object.keys(state.buckets).length > 0 || Object.keys(state.sessions).length > 0;
  const targetMatches = state.syncTarget === syncTarget;
  if (full || (!hasCheckpoint && !targetMatches)) {
    return { state: { buckets: {}, sessions: {}, syncTarget }, reconciliationRequired: false };
  }
  if (!targetMatches) {
    return { state, reconciliationRequired: true };
  }
  return { state: { ...state, syncTarget }, reconciliationRequired: false };
}

export function saveState(state) {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(stateFile, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(stateFile, 0o600);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  }
}

export function clearState() {
  try {
    unlinkSync(stateFile);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export function bucketKey(bucket) {
  const base = [bucket.source, bucket.model, bucket.project || '', bucket.bucketStart];
  const dimensions = [
    bucket.modelCanonical,
    bucket.modelProvider,
    bucket.reasoningEffort,
    bucket.agentVersion,
    bucket.contextTier,
    bucket.processingTier,
  ].map((value) => value || '');
  return dimensions.some(Boolean) ? [...base, ...dimensions].join('|') : base.join('|');
}

export function sessionKey(session) {
  return `${session.source}|${session.sessionHash}`;
}

export function contentHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

// When okSources is given, only state keys belonging to those sources (key
// prefix up to the first '|') may be pruned — skipped/failed sources keep
// their old state so a transient failure never forces a full re-upload.
// Omitted = prune everything (back-compat).
export function pruneState(state, liveBucketKeys, liveSessionKeys, okSources) {
  const prunable = (key) => !okSources || okSources.has(key.slice(0, key.indexOf('|')));
  for (const key of Object.keys(state.buckets)) {
    if (prunable(key) && !liveBucketKeys.has(key)) delete state.buckets[key];
  }
  for (const key of Object.keys(state.sessions)) {
    if (prunable(key) && !liveSessionKeys.has(key)) delete state.sessions[key];
  }
}
