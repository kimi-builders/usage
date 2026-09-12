import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync,
  unlinkSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { getLocale } from './cli-ui.js';
import { getConfigDir } from './config.js';
import { runSync } from './sync.js';
import { publicSyncProgress, publicSyncResult } from './sync-progress.js';

const LOCK_STALE_MS = 2 * 60 * 60 * 1000;

export function getSyncRuntimePaths(configDir = getConfigDir()) {
  return {
    root: configDir,
    lock: join(configDir, 'sync.lock'),
    status: join(configDir, 'sync-status.json'),
    log: join(configDir, 'sync.log'),
  };
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function privateMessage(error) {
  return String(error?.message || error || 'Unknown sync error').replace(/[\r\n]+/g, ' ').slice(0, 500);
}

function publicFailure(error) {
  if ([401, 403].includes(Number(error?.statusCode))) {
    return { code: 'authentication_failed', message: 'Synchronization authorization failed. Reconnect this device and try again.' };
  }
  return { code: 'sync_failed', message: 'Synchronization failed. See the private local log for details.' };
}

function publicStatus(value) {
  if (!value || typeof value !== 'object' || !value.lastError) return value;
  const failure = value.lastErrorCode === 'authentication_failed'
    ? publicFailure({ statusCode: 401 })
    : publicFailure();
  return { ...value, lastErrorCode: failure.code, lastError: failure.message };
}

function appendLog(path, message) {
  try {
    const previous = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const retained = previous.length > 256_000 ? previous.slice(-192_000) : previous;
    writeFileSync(path, `${retained}${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
  } catch {
    // Logging must never turn a successful synchronization into a failure.
  }
}

function acquireLock(path) {
  try {
    return openSync(path, 'wx', 0o600);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    try {
      if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) {
        unlinkSync(path);
        return openSync(path, 'wx', 0o600);
      }
    } catch (nextError) {
      if (nextError?.code !== 'ENOENT') throw nextError;
      return openSync(path, 'wx', 0o600);
    }
    const busy = new Error(getLocale() === 'zh'
      ? '另一次同步仍在运行，请稍后重试。'
      : 'Another synchronization is still running. Try again later.');
    busy.code = 'SYNC_BUSY';
    throw busy;
  }
}

export function loadSyncStatus({ configDir = getConfigDir() } = {}) {
  return publicStatus(readJson(getSyncRuntimePaths(configDir).status));
}

export async function runManagedSync({
  trigger = 'manual', quiet = false, surface = 'cli', full = false,
  configDir = getConfigDir(), sync = runSync,
} = {}) {
  const paths = getSyncRuntimePaths(configDir);
  mkdirSync(paths.root, { recursive: true, mode: 0o700 });
  const handle = acquireLock(paths.lock);
  const startedAt = new Date().toISOString();
  const prior = loadSyncStatus({ configDir }) || {};
  const running = { ...prior, state: 'running', trigger, lastAttemptAt: startedAt, lastError: null, progress: publicSyncProgress() };
  writeJson(paths.status, running);
  appendLog(paths.log, `[${trigger}] synchronization started`);
  const started = Date.now();
  try {
    const result = await sync({ quiet, surface, full, onProgress: (progress) => {
      running.progress = publicSyncProgress(progress);
      try { writeJson(paths.status, running); } catch { /* Progress is best effort; final status is not. */ }
    } });
    const completedAt = new Date().toISOString();
    const summary = publicSyncResult(result);
    const issues = summary.sources.filter((source) => ['partial', 'failed'].includes(source.status));
    const partial = issues.length > 0 || summary.rejected > 0;
    const next = {
      state: partial ? 'partial' : 'idle', trigger, lastAttemptAt: startedAt, lastCompletedAt: completedAt,
      lastSuccessAt: partial ? prior.lastSuccessAt || null : completedAt,
      lastDurationMs: Date.now() - started, lastError: null,
      result: summary,
    };
    writeJson(paths.status, next);
    appendLog(paths.log, `[${trigger}] synchronization ${partial ? 'partially completed' : 'completed'} (${next.result.buckets} buckets, ${next.result.sessions} sessions; ${summary.rejected} rejected)`);
    for (const source of result?.sources || []) {
      if (['partial', 'failed'].includes(source.status)) appendLog(paths.log, `[${source.source}] ${source.status}: ${privateMessage(source.error || 'Source could not be fully read')}`);
      for (const warning of (source.warnings || []).slice(0, 10)) appendLog(paths.log, `[${source.source}] ${privateMessage(warning)}`);
    }
    return result;
  } catch (error) {
    const privateDetail = privateMessage(error);
    const failure = publicFailure(error);
    writeJson(paths.status, {
      ...prior, state: 'error', trigger, lastAttemptAt: startedAt,
      lastDurationMs: Date.now() - started,
      lastErrorCode: failure.code, lastError: failure.message,
    });
    appendLog(paths.log, `[${trigger}] synchronization failed: ${privateDetail}`);
    throw error;
  } finally {
    try { closeSync(handle); } catch {}
    try { unlinkSync(paths.lock); } catch {}
  }
}
