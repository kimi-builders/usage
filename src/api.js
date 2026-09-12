import { gzipSync } from 'node:zlib';
import { normalizeCommunityUrl } from './community-url.js';

const RETRIES = 3;
const MAX_RETRY_AFTER_MS = 60_000;

export function parseRetryAfterMs(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.ceil(seconds * 1000));
  }
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, at - now));
}

async function jsonRequest(apiUrl, path, { method = 'GET', apiKey, body, gzip = false, timeoutMs = 60_000 } = {}) {
  const raw = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const payload = raw && gzip ? gzipSync(raw) : raw;
  const response = await fetch(new URL(path, normalizeCommunityUrl(apiUrl)), {
    method,
    headers: {
      Accept: 'application/json',
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
      ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: payload,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`服务端返回了无效 JSON (${response.status})`);
  }
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.error || `HTTP ${response.status}`);
    error.statusCode = response.status;
    error.code = data?.error?.code;
    error.retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
    throw error;
  }
  return data;
}

async function retry(operation, onProgress) {
  const report = (value) => { try { onProgress?.(value); } catch { /* UI feedback cannot cancel an upload. */ } };
  let lastError;
  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    try {
      report({ phase: 'uploading', attempt: attempt + 1 });
      return await operation();
    } catch (error) {
      lastError = error;
      const retryableRateLimit = error.statusCode === 429;
      if (error.statusCode >= 400 && error.statusCode < 500 && !retryableRateLimit) {
        throw error;
      }
      if (attempt < RETRIES - 1) {
        const fallbackMs = 500 * (2 ** attempt);
        const delayMs = retryableRateLimit && Number.isFinite(error.retryAfterMs)
          ? error.retryAfterMs
          : fallbackMs;
        report({ phase: 'retrying', retryDelayMs: delayMs, attempt: attempt + 1 });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

export function requestDeviceCode(apiUrl, payload) {
  return jsonRequest(apiUrl, '/api/usage/device/code', { method: 'POST', body: payload });
}

export function pollDeviceToken(apiUrl, deviceCode) {
  return jsonRequest(apiUrl, '/api/usage/device/token', {
    method: 'POST',
    body: { deviceCode },
  });
}

export function fetchSettings(apiUrl, apiKey) {
  return retry(() => jsonRequest(apiUrl, '/api/usage/settings', { apiKey }));
}

export async function fetchAccount(apiUrl, apiKey) {
  try {
    const data = await jsonRequest(apiUrl, '/api/usage/device/current', { apiKey, timeoutMs: 5_000 });
    const account = data?.account;
    const clean = (value) => String(value).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 80);
    if (typeof account?.handle !== 'string' || !account.handle.trim()) return { status: 'unavailable', account: null };
    return { status: 'verified', account: { handle: clean(account.handle), name: typeof account.name === 'string' ? clean(account.name) : null } };
  } catch (error) {
    return { status: [401, 403].includes(error.statusCode) ? 'unauthorized' : 'unavailable', account: null };
  }
}

export function ingest(apiUrl, apiKey, payload, { onProgress } = {}) {
  return retry(() => jsonRequest(apiUrl, '/api/usage/ingest', {
    method: 'POST',
    apiKey,
    body: payload,
    gzip: true,
  }), onProgress);
}

export function fetchSummary(apiUrl, apiKey, days) {
  return retry(() => jsonRequest(apiUrl, `/api/usage?days=${days}`, { apiKey }));
}

export function deleteCurrentDeviceData(apiUrl, apiKey) {
  return jsonRequest(apiUrl, '/api/usage/ingest', { method: 'DELETE', apiKey });
}

export function revokeCurrentDevice(apiUrl, apiKey) {
  return jsonRequest(apiUrl, '/api/usage/device/current', { method: 'DELETE', apiKey });
}

export function encodeIngestBody(payload) {
  return gzipSync(Buffer.from(JSON.stringify(payload)));
}
