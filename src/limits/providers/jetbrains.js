import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { asDate, asPercent } from '../http.js';
import { jetBrainsConfigRoots, jetBrainsLogPath, readJetBrainsLog } from './jetbrains-log.js';

const IDE_PATTERNS = [
  ['IntelliJIdea', 'IntelliJ IDEA'], ['PyCharm', 'PyCharm'], ['WebStorm', 'WebStorm'],
  ['GoLand', 'GoLand'], ['CLion', 'CLion'], ['DataGrip', 'DataGrip'], ['RubyMine', 'RubyMine'],
  ['Rider', 'Rider'], ['PhpStorm', 'PhpStorm'], ['Fleet', 'Fleet'],
  ['AndroidStudio', 'Android Studio'], ['RustRover', 'RustRover'], ['Aqua', 'Aqua'], ['DataSpell', 'DataSpell'],
];

function htmlDecode(value) {
  return String(value || '')
    .replaceAll('&#10;', '\n').replaceAll('&quot;', '"').replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function optionValue(xml, name) {
  const component = xml.match(/<component[^>]*name\s*=\s*["']AIAssistantQuotaManager2["'][^>]*>[\s\S]*?<\/component>/i)?.[0];
  if (!component) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return component.match(new RegExp(`<option[^>]*name\\s*=\\s*["']${escaped}["'][^>]*value\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1]
    || component.match(new RegExp(`<option[^>]*value\\s*=\\s*["']([^"']*)["'][^>]*name\\s*=\\s*["']${escaped}["']`, 'i'))?.[1]
    || null;
}

function candidateFromDirectory(root, directory, includeMissing = false) {
  const match = IDE_PATTERNS.find(([prefix]) => directory.toLowerCase().startsWith(prefix.toLowerCase()));
  if (!match) return null;
  const [prefix, label] = match;
  const basePath = join(root, directory);
  const path = join(basePath, 'options', 'AIAssistantQuotaManager2.xml');
  const exists = existsSync(path);
  if (!exists && !includeMissing) return null;
  return { label, version: directory.slice(prefix.length) || 'Unknown', basePath, path, mtime: exists ? statSync(path).mtimeMs : null };
}

function quotaCandidates(customPath, options) {
  if (customPath.trim()) {
    const basePath = resolve(customPath.replace(/^~(?=$|\/)/, options.home || homedir()));
    const path = join(basePath, 'options', 'AIAssistantQuotaManager2.xml');
    return [{ label: 'JetBrains IDE', version: null, basePath, path, mtime: existsSync(path) ? statSync(path).mtimeMs : null }];
  }
  const candidates = [];
  for (const root of jetBrainsConfigRoots(options)) {
    if (!existsSync(root)) continue;
    for (const directory of readdirSync(root)) {
      try {
        const candidate = candidateFromDirectory(root, directory, true);
        if (candidate) candidates.push(candidate);
      } catch { /* a concurrently removed IDE directory is harmless */ }
    }
  }
  return candidates.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
}

export function detectJetBrainsQuotaFile(customPath = '', options = {}) {
  return quotaCandidates(customPath, options).find((candidate) => candidate.mtime != null) || null;
}

export function parseJetBrainsQuota(xml, ide = null, { now = new Date() } = {}) {
  const rawQuota = optionValue(xml, 'quotaInfo');
  if (!rawQuota) {
    const error = new Error('JetBrains 配置中没有 AI quotaInfo。');
    error.code = 'invalid_response';
    throw error;
  }
  let quota;
  try { quota = JSON.parse(htmlDecode(rawQuota)); } catch {
    const error = new Error('JetBrains AI quotaInfo 无法解析。');
    error.code = 'invalid_response';
    throw error;
  }
  const rawRefill = optionValue(xml, 'nextRefill');
  let refill = null;
  try { refill = rawRefill ? JSON.parse(htmlDecode(rawRefill)) : null; } catch { /* optional */ }
  return quotaSnapshot(quota, refill, ide, now);
}

function balance(value) {
  const number = (raw) => (typeof raw === 'number' || typeof raw === 'string' && raw.trim())
    && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : null;
  const used = number(value?.current);
  const limit = number(value?.maximum);
  return used != null && limit > 0 ? { used, limit } : null;
}

function quotaSnapshot(quota, refill, ide, now) {
  // Never divide monthly consumption by monthly + purchased credits, nor
  // combine a total limit with the monthly `available` field.
  const monthly = balance(quota.tariffQuota);
  const values = monthly || balance(quota);
  if (!values) throw Object.assign(new Error('JetBrains AI 没有有效的额度计数。 / No valid JetBrains AI quota counters.'), { code: 'invalid_response' });
  const { used, limit } = values;
  const usedPercent = asPercent(used / limit * 100);
  const resetsAt = asDate(refill?.next || quota.until);
  return {
    id: 'jetbrains-ai', label: 'JetBrains AI', status: 'ok', account: null,
    plan: quota.type || null,
    source: ide ? `${ide.label}${ide.version ? ` ${ide.version}` : ''}` : 'JetBrains IDE',
    updatedAt: now.toISOString(),
    windows: [{
      id: 'credits', label: monthly ? '月度 Credits' : '当前 Credits', usedPercent,
      remainingPercent: 100 - usedPercent,
      resetsAt, value: used, limit, unit: 'credits',
    }],
    notice: '纯本地读取 JetBrains AI Assistant 配置，不会连接 JetBrains 网络服务。',
  };
}

export async function fetchJetBrainsLimits({ settings, ...options } = {}) {
  const candidates = quotaCandidates(settings?.customPath || '', options);
  const ide = candidates.find((candidate) => candidate.mtime != null);
  if (!ide) {
    const newest = candidates.map((candidate) => ({
      ide: candidate, entry: readJetBrainsLog(jetBrainsLogPath(candidate.basePath, options)),
    })).filter(({ entry }) => entry).sort((a, b) => b.entry.timestamp - a.entry.timestamp)[0];
    if (newest) return quotaSnapshot(newest.entry.quota, newest.entry.refill, newest.ide, newest.entry.timestamp);
    const error = new Error('未找到 JetBrains AI Assistant 额度文件；请先在 IDE 中启用 AI Assistant。');
    error.code = 'not_configured';
    throw error;
  }
  const entry = readJetBrainsLog(jetBrainsLogPath(ide.basePath, options));
  let snapshot;
  try {
    snapshot = parseJetBrainsQuota(readFileSync(ide.path, 'utf8'), ide, { now: new Date(ide.mtime) });
  } catch (error) {
    if (!entry) throw error;
  }
  return entry && (!snapshot || entry.timestamp.getTime() > ide.mtime)
    ? quotaSnapshot(entry.quota, entry.refill, ide, entry.timestamp)
    : snapshot;
}
