import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { getConfigDir } from '../config.js';
import { normalizeCommunityUrl } from '../community-url.js';

const RATE_FIELDS = [
  'input', 'cacheWrite', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead', 'output', 'reasoning',
];
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_CATALOG_ENTRIES = 2_000;
const CATALOG_PATH = join(getConfigDir(), 'pricing-catalog-v1.json');
const STATE_PATH = join(getConfigDir(), 'pricing-state-v1.json');
const EMBEDDED_PATH = new URL('./catalog-v1.json', import.meta.url);
const ACTIVE_CACHE_TTL_MS = 1_000;

let activeCatalogCache = null;
let numericEntriesCache = null;

function invalidateCatalogCache() {
  activeCatalogCache = null;
  numericEntriesCache = null;
}

function digestCatalog(catalog) {
  const { integrity, ...unsigned } = catalog;
  return createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
}

function catalogError(message, code = 'invalid_price_catalog') {
  return Object.assign(new Error(message), { code });
}

function validateDate(value, field, pattern) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw catalogError(`${pattern} 的 ${field} 不是有效时间。`);
  }
}

function validateRate(value, field, pattern, required = false) {
  if (value === null && !required) return;
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value) || Number(value) < 0) {
    throw catalogError(`${pattern} 的 ${field} 费率无效。`);
  }
}

export function validatePriceCatalog(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw catalogError('价格目录必须是 JSON 对象。');
  }
  if (value.schemaVersion !== 1 || value.matcherVersion !== 1) {
    throw catalogError('当前 Collector 不支持这个价格目录协议。', 'unsupported_price_catalog');
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw catalogError('价格目录 revision 无效。');
  }
  if (typeof value.catalogVersion !== 'string' || !value.catalogVersion || value.currency !== 'USD' || value.basis !== 'standard-api') {
    throw catalogError('价格目录版本、币种或口径无效。');
  }
  validateDate(value.publishedAt, 'publishedAt', 'catalog');
  if (!Array.isArray(value.entries) || value.entries.length < 1 || value.entries.length > MAX_CATALOG_ENTRIES) {
    throw catalogError('价格目录条目数量无效。');
  }
  for (const entry of value.entries) {
    if (!entry || typeof entry !== 'object' || !entry.pattern || !['exact', 'prefix'].includes(entry.match)) {
      throw catalogError('价格目录包含无效匹配条目。');
    }
    if (entry.source !== null && typeof entry.source !== 'string') throw catalogError(`${entry.pattern} 的 source 无效。`);
    if (typeof entry.contextTier !== 'string' || typeof entry.processingTier !== 'string') {
      throw catalogError(`${entry.pattern} 的 tier 无效。`);
    }
    validateDate(entry.effectiveFrom, 'effectiveFrom', entry.pattern);
    if (entry.effectiveTo !== null) validateDate(entry.effectiveTo, 'effectiveTo', entry.pattern);
    if (entry.effectiveTo !== null && Date.parse(entry.effectiveTo) <= Date.parse(entry.effectiveFrom)) {
      throw catalogError(`${entry.pattern} 的价格生效窗口无效。`);
    }
    validateRate(entry.input, 'input', entry.pattern, true);
    validateRate(entry.output, 'output', entry.pattern, true);
    for (const field of RATE_FIELDS.filter((name) => !['input', 'output'].includes(name))) {
      validateRate(entry[field], field, entry.pattern);
    }
    if (entry.basis !== 'standard-api' || typeof entry.version !== 'string') {
      throw catalogError(`${entry.pattern} 的计价口径或版本无效。`);
    }
    if (entry.sourceUrl) {
      const sourceUrl = new URL(entry.sourceUrl);
      if (sourceUrl.protocol !== 'https:') throw catalogError(`${entry.pattern} 的价格来源必须使用 HTTPS。`);
    }
  }
  if (value.integrity?.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(value.integrity.digest || '')) {
    throw catalogError('价格目录缺少可验证的 SHA-256 完整性信息。');
  }
  if (digestCatalog(value) !== value.integrity.digest) {
    throw catalogError('价格目录完整性校验失败。', 'price_catalog_integrity_failed');
  }
  return value;
}

function parseCatalogText(text) {
  if (Buffer.byteLength(text) > MAX_CATALOG_BYTES) throw catalogError('价格目录超过大小限制。');
  try {
    return validatePriceCatalog(JSON.parse(text));
  } catch (error) {
    if (error?.code) throw error;
    throw catalogError('价格目录不是有效 JSON。');
  }
}

async function readResponseText(response) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_CATALOG_BYTES) throw catalogError('价格目录超过大小限制。');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CATALOG_BYTES) {
        await reader.cancel();
        throw catalogError('价格目录超过大小限制。');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size).toString('utf8');
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function readDownloadedCatalog() {
  if (!existsSync(CATALOG_PATH)) return null;
  try { return parseCatalogText(readFileSync(CATALOG_PATH, 'utf8')); } catch { return null; }
}

function writeOwnerFile(path, value) {
  mkdirSync(getConfigDir(), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, path);
  try { chmodSync(path, 0o600); } catch (error) { if (process.platform !== 'win32') throw error; }
}

export const EMBEDDED_PRICE_CATALOG = parseCatalogText(readFileSync(EMBEDDED_PATH, 'utf8'));

export function getActivePriceCatalog() {
  if (activeCatalogCache && activeCatalogCache.expiresAt > Date.now()) {
    return activeCatalogCache.value;
  }
  const downloaded = readDownloadedCatalog();
  const value = downloaded && downloaded.revision >= EMBEDDED_PRICE_CATALOG.revision
    ? { catalog: downloaded, source: 'downloaded' }
    : { catalog: EMBEDDED_PRICE_CATALOG, source: 'embedded' };
  activeCatalogCache = { value, expiresAt: Date.now() + ACTIVE_CACHE_TTL_MS };
  return value;
}

export function numericCatalogEntries(catalog = getActivePriceCatalog().catalog) {
  if (numericEntriesCache?.digest === catalog.integrity.digest) return numericEntriesCache.entries;
  const entries = catalog.entries.map((entry) => Object.fromEntries(Object.entries(entry).map(([key, value]) => (
    RATE_FIELDS.includes(key) && value !== null ? [key, Number(value)] : [key, value]
  ))));
  numericEntriesCache = { digest: catalog.integrity.digest, entries };
  return entries;
}

export function priceCatalogStatus() {
  const active = getActivePriceCatalog();
  const state = readJson(STATE_PATH) || {};
  return {
    schemaVersion: active.catalog.schemaVersion,
    matcherVersion: active.catalog.matcherVersion,
    revision: active.catalog.revision,
    version: active.catalog.catalogVersion,
    publishedAt: active.catalog.publishedAt,
    source: active.source,
    entryCount: active.catalog.entries.length,
    integrity: active.catalog.integrity,
    lastCheckedAt: state.lastCheckedAt || null,
    fetchedAt: active.source === 'downloaded' ? state.fetchedAt || null : null,
    endpoint: state.endpoint || null,
    etag: state.etag || null,
  };
}

export function priceCatalogEndpoint(apiUrl = 'https://kimi.builders') {
  return new URL('/api/public/usage-pricing/v1/catalog', normalizeCommunityUrl(apiUrl)).toString();
}

export async function updatePriceCatalog({
  apiUrl = 'https://kimi.builders', fetchImpl = globalThis.fetch, force = false,
} = {}) {
  if (typeof fetchImpl !== 'function') throw catalogError('当前 Node.js 环境不支持价格目录下载。');
  const endpoint = priceCatalogEndpoint(apiUrl);
  const previousState = readJson(STATE_PATH) || {};
  const previousCatalog = getActivePriceCatalog();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      headers: !force && previousCatalog.source === 'downloaded' && previousState.etag
        ? { 'If-None-Match': previousState.etag }
        : {},
      redirect: 'error',
      signal: controller.signal,
    });
  } catch (error) {
    throw catalogError(error?.name === 'AbortError' ? '价格目录请求超时。' : `价格目录请求失败：${error?.message || error}`, 'price_catalog_fetch_failed');
  } finally {
    clearTimeout(timeout);
  }
  const checkedAt = new Date().toISOString();
  if (response.status === 304) {
    writeOwnerFile(STATE_PATH, { ...previousState, endpoint, lastCheckedAt: checkedAt });
    return { changed: false, notModified: true, ...priceCatalogStatus() };
  }
  if (!response.ok) throw catalogError(`价格目录请求失败（HTTP ${response.status}）。`, 'price_catalog_fetch_failed');
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_CATALOG_BYTES) throw catalogError('价格目录超过大小限制。');
  const next = parseCatalogText(await readResponseText(response));
  const active = getActivePriceCatalog().catalog;
  if (next.revision < active.revision) throw catalogError('拒绝回退到更旧的价格目录。', 'price_catalog_rollback');
  if (next.revision === active.revision && next.integrity.digest !== active.integrity.digest) {
    throw catalogError('同一 revision 的价格目录内容发生变化；请由维护者发布新 revision。', 'price_catalog_revision_conflict');
  }
  writeOwnerFile(CATALOG_PATH, next);
  invalidateCatalogCache();
  writeOwnerFile(STATE_PATH, {
    endpoint,
    etag: response.headers.get('etag') || `"sha256-${next.integrity.digest}"`,
    lastCheckedAt: checkedAt,
    fetchedAt: checkedAt,
  });
  return { changed: next.integrity.digest !== active.integrity.digest, notModified: false, ...priceCatalogStatus() };
}

export function resetPriceCatalog() {
  for (const path of [CATALOG_PATH, STATE_PATH]) rmSync(path, { force: true });
  invalidateCatalogCache();
  return priceCatalogStatus();
}

export const PRICE_CATALOG_PATHS = { catalog: CATALOG_PATH, state: STATE_PATH };
