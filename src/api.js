import { gzipSync } from 'node:zlib';
import { normalizeCommunityUrl } from './community-url.js';

const RETRIES = 3;

async function jsonRequest(apiUrl, path, { method = 'GET', apiKey, body, gzip = false } = {}) {
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
    signal: AbortSignal.timeout(60_000),
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
    throw error;
  }
  return data;
}

async function retry(operation) {
  let lastError;
  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (error.statusCode >= 400 && error.statusCode < 500) throw error;
      if (attempt < RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
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

export function ingest(apiUrl, apiKey, payload) {
  return retry(() => jsonRequest(apiUrl, '/api/usage/ingest', {
    method: 'POST',
    apiKey,
    body: payload,
    gzip: true,
  }));
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
