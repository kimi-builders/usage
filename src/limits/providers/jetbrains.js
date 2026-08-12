import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { asDate, asPercent } from '../http.js';

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

function configRoots(platform = process.platform) {
  if (platform === 'darwin') return [
    join(homedir(), 'Library', 'Application Support', 'JetBrains'),
    join(homedir(), 'Library', 'Application Support', 'Google'),
  ];
  return [
    join(homedir(), '.config', 'JetBrains'), join(homedir(), '.local', 'share', 'JetBrains'),
    join(homedir(), '.config', 'Google'),
  ];
}

function candidateFromDirectory(root, directory) {
  const match = IDE_PATTERNS.find(([prefix]) => directory.toLowerCase().startsWith(prefix.toLowerCase()));
  if (!match) return null;
  const [prefix, label] = match;
  const basePath = join(root, directory);
  const path = join(basePath, 'options', 'AIAssistantQuotaManager2.xml');
  if (!existsSync(path)) return null;
  return { label, version: directory.slice(prefix.length) || 'Unknown', basePath, path, mtime: statSync(path).mtimeMs };
}

export function detectJetBrainsQuotaFile(customPath = '') {
  if (customPath.trim()) {
    const basePath = resolve(customPath.replace(/^~(?=$|\/)/, homedir()));
    const path = join(basePath, 'options', 'AIAssistantQuotaManager2.xml');
    return existsSync(path) ? { label: 'JetBrains IDE', version: null, basePath, path, mtime: statSync(path).mtimeMs } : null;
  }
  const candidates = [];
  for (const root of configRoots()) {
    if (!existsSync(root)) continue;
    for (const directory of readdirSync(root)) {
      try {
        const candidate = candidateFromDirectory(root, directory);
        if (candidate) candidates.push(candidate);
      } catch { /* a concurrently removed IDE directory is harmless */ }
    }
  }
  return candidates.sort((a, b) => b.mtime - a.mtime)[0] || null;
}

export function parseJetBrainsQuota(xml, ide = null, { now = new Date() } = {}) {
  const rawQuota = optionValue(xml, 'quotaInfo');
  if (!rawQuota) throw new Error('JetBrains 配置中没有 AI quotaInfo。');
  let quota;
  try { quota = JSON.parse(htmlDecode(rawQuota)); } catch { throw new Error('JetBrains AI quotaInfo 无法解析。'); }
  const rawRefill = optionValue(xml, 'nextRefill');
  let refill = null;
  try { refill = rawRefill ? JSON.parse(htmlDecode(rawRefill)) : null; } catch { /* optional */ }
  const used = Number(quota.current) || 0;
  const limit = Number(quota.maximum) || 0;
  const available = Number(quota.tariffQuota?.available);
  const remaining = Number.isFinite(available) && limit > 0 ? available : Math.max(0, limit - used);
  const usedPercent = limit > 0 ? asPercent(used / limit * 100) : 0;
  const resetsAt = asDate(refill?.next || quota.until);
  return {
    id: 'jetbrains-ai', label: 'JetBrains AI', status: 'ok', account: null,
    plan: quota.type || null,
    source: ide ? `${ide.label}${ide.version ? ` ${ide.version}` : ''}` : 'JetBrains IDE',
    updatedAt: now.toISOString(),
    windows: [{
      id: 'credits', label: '当前 Credits', usedPercent,
      remainingPercent: limit > 0 ? asPercent(remaining / limit * 100) : 100,
      resetsAt, value: used, limit, unit: 'credits',
    }],
    notice: '纯本地读取 JetBrains AI Assistant 配置，不会连接 JetBrains 网络服务。',
  };
}

export async function fetchJetBrainsLimits({ settings } = {}) {
  const ide = detectJetBrainsQuotaFile(settings?.customPath || '');
  if (!ide) {
    const error = new Error('未找到 JetBrains AI Assistant 额度文件；请先在 IDE 中启用 AI Assistant。');
    error.code = 'not_configured';
    throw error;
  }
  return parseJetBrainsQuota(readFileSync(ide.path, 'utf8'), ide);
}
