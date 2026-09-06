import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';

export const EXTRA_ROOT_SOURCE_IDS = Object.freeze([
  'codex',
  'antigravity',
  'pi-coding-agent',
  'grok',
  'trae-cli',
]);

export function supportsExtraRoots(sourceId) {
  return EXTRA_ROOT_SOURCE_IDS.includes(sourceId);
}

export function expandLocalPath(value) {
  const trimmed = String(value || '').trim();
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

export function normalizeExtraRoot(value) {
  const expanded = expandLocalPath(value);
  if (!expanded || !isAbsolute(expanded)) return '';
  return resolve(expanded);
}

export function configuredExtraRoots(sourceOptions = {}, sourceId) {
  const values = sourceOptions?.[sourceId]?.extraRoots;
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(normalizeExtraRoot).filter(Boolean))];
}

export function extraRootId(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

export function publicExtraRoots(sourceOptions = {}, sourceId) {
  return configuredExtraRoots(sourceOptions, sourceId).map((path) => ({
    id: extraRootId(path),
    label: basename(path) || sourceId,
  }));
}

function isDirectory(path) {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function isCodexHome(path) {
  return isDirectory(path)
    && ['sessions', 'archived_sessions'].some((name) => isDirectory(join(path, name)));
}

export function discoverCodexHomes(value, maxDepth = 3) {
  const root = normalizeExtraRoot(value);
  if (!root || !isDirectory(root)) return [];
  if (isCodexHome(root)) return [root];
  const homes = [];
  const queue = [{ path: root, depth: 0 }];
  while (queue.length) {
    const current = queue.shift();
    let children;
    try { children = readdirSync(current.path, { withFileTypes: true }); } catch { continue; }
    for (const child of children) {
      // Dirent#isDirectory excludes symlinks, keeping discovery inside the
      // explicitly chosen bounded hierarchy.
      if (!child.isDirectory()) continue;
      const path = join(current.path, child.name);
      const depth = current.depth + 1;
      if (child.name === 'codex-home' && isCodexHome(path)) homes.push(path);
      else if (depth < maxDepth) queue.push({ path, depth });
    }
  }
  return [...new Set(homes)];
}

export function antigravityConversationDirs(value) {
  const root = normalizeExtraRoot(value);
  if (!root) return [];
  const candidates = basename(root) === 'conversations'
    ? [root]
    : [
      join(root, 'conversations'),
      join(root, '.gemini', 'antigravity', 'conversations'),
      join(root, '.gemini', 'antigravity-cli', 'conversations'),
    ];
  return [...new Set(candidates)].filter((path) => existsSync(path) && isDirectory(path));
}
