import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { queryDbJson } from '../parsers/sqlite.js';

const KEYCHAIN_SERVICE = 'builders.kimi.usage.subscription-limits';

export function providerAccountCredentialKey(providerId, accountId) {
  const provider = String(providerId || '').trim();
  const account = String(accountId || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(provider) || !/^[A-Za-z0-9_-]+$/.test(account)) {
    throw new Error('账户凭据标识无效。');
  }
  return `${provider}:${account}`;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function databaseText(value) {
  if (Buffer.isBuffer(value)) return text(value.toString('utf8'));
  return text(value);
}

function jsonFile(path) {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function configuredHome(environment, key, fallback) {
  const value = text(environment[key]);
  return value ? resolve(value.replace(/^~(?=$|\/)/, homedir())) : fallback;
}

export function decodeJwtPayload(token) {
  const encoded = text(token)?.split('.')[1];
  if (!encoded) return {};
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

export function loadCodexCredentials(environment = process.env) {
  const root = configuredHome(environment, 'CODEX_HOME', join(homedir(), '.codex'));
  const path = join(root, 'auth.json');
  const payload = jsonFile(path);
  const tokens = payload?.tokens && typeof payload.tokens === 'object' ? payload.tokens : {};
  const accessToken = text(tokens.access_token || tokens.accessToken);
  if (!accessToken) return { found: false, path };
  const idToken = text(tokens.id_token || tokens.idToken);
  const claims = decodeJwtPayload(idToken);
  return {
    found: true,
    path,
    accessToken,
    accountId: text(tokens.account_id || tokens.accountId || claims.chatgpt_account_id),
    email: text(claims.email),
    plan: text(claims.chatgpt_plan_type || claims.plan_type),
  };
}

export function loadKimiCredentials(environment = process.env) {
  const root = configuredHome(environment, 'KIMI_CODE_HOME', join(homedir(), '.kimi-code'));
  const path = join(root, 'credentials', 'kimi-code.json');
  const payload = jsonFile(path);
  const accessToken = text(payload?.access_token || payload?.accessToken);
  const expiresAt = Number(payload?.expires_at ?? payload?.expiresAt);
  const fresh = accessToken && Number.isFinite(expiresAt) && expiresAt > Date.now() / 1_000 + 60;
  return { found: Boolean(accessToken), fresh: Boolean(fresh), path, accessToken, claims: decodeJwtPayload(accessToken) };
}

export function loadClaudeCredentials(environment = process.env) {
  const configRoot = configuredHome(environment, 'CLAUDE_CONFIG_DIR', join(homedir(), '.claude'));
  const secureRoot = text(environment.CLAUDE_SECURESTORAGE_CONFIG_DIR)
    ? configuredHome(environment, 'CLAUDE_SECURESTORAGE_CONFIG_DIR', configRoot)
    : configRoot;
  const path = join(secureRoot, '.credentials.json');
  const payload = jsonFile(path);
  const oauth = payload?.claudeAiOauth && typeof payload.claudeAiOauth === 'object'
    ? payload.claudeAiOauth : {};
  const accessToken = text(oauth.accessToken || oauth.access_token);
  const rawExpiry = Number(oauth.expiresAt ?? oauth.expires_at);
  const expiry = Number.isFinite(rawExpiry) && rawExpiry < 100_000_000_000 ? rawExpiry * 1_000 : rawExpiry;
  return {
    found: Boolean(accessToken), fresh: Boolean(accessToken && (!Number.isFinite(expiry) || expiry > Date.now() + 60_000)),
    path, accessToken, expiry, plan: text(oauth.subscriptionType || oauth.rateLimitTier),
  };
}

function cursorDatabasePath(environment = process.env) {
  if (text(environment.CURSOR_STATE_DB)) return resolve(environment.CURSOR_STATE_DB.replace(/^~(?=$|\/)/, homedir()));
  const base = process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support')
    : configuredHome(environment, 'XDG_CONFIG_HOME', join(homedir(), '.config'));
  return join(base, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

export function loadCursorCredentials(environment = process.env, { query = queryDbJson } = {}) {
  const path = cursorDatabasePath(environment);
  if (!existsSync(path)) return { found: false, fresh: false, path };
  let accessToken = null;
  try {
    const escapedKey = 'cursorAuth/accessToken'.replaceAll("'", "''");
    accessToken = databaseText(query(path, `SELECT value FROM ItemTable WHERE key='${escapedKey}' LIMIT 1`)[0]?.value);
  } catch {
    return { found: false, fresh: false, path };
  }
  const claims = decodeJwtPayload(accessToken);
  const rawSubject = text(claims.sub);
  const userId = rawSubject?.split('|').filter(Boolean).at(-1) || null;
  const validUserId = userId && /^[A-Za-z0-9._-]+$/.test(userId) ? userId : null;
  const expiry = Number(claims.exp);
  const fresh = Boolean(accessToken && validUserId && Number.isFinite(expiry) && expiry > Date.now() / 1_000 + 60);
  return {
    found: Boolean(accessToken), fresh, path, accessToken, userId: validUserId,
    cookie: fresh ? `WorkosCursorSessionToken=${validUserId}%3A%3A${accessToken}` : null,
  };
}

export function loadCopilotCredentials(environment = process.env, { run = spawnSync } = {}) {
  const configured = environmentSecret('COPILOT_API_TOKEN', environment)
    || environmentSecret('GH_TOKEN', environment)
    || environmentSecret('GITHUB_TOKEN', environment);
  if (configured) return { found: true, token: configured, source: '环境变量' };
  const result = run('gh', ['auth', 'token'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2_500, env: environment,
  });
  const token = result.status === 0 ? text(result.stdout) : null;
  return { found: Boolean(token), token, source: token ? 'GitHub CLI 登录' : null };
}

export function loadGeminiCredentials(environment = process.env) {
  const root = configuredHome(environment, 'GEMINI_CLI_HOME', join(homedir(), '.gemini'));
  const path = join(root, 'oauth_creds.json');
  const payload = jsonFile(path);
  const accessToken = text(payload?.access_token || payload?.accessToken);
  const expiry = Number(payload?.expiry_date ?? payload?.expiryDate);
  const fresh = accessToken && (!Number.isFinite(expiry) || expiry > Date.now() + 60_000);
  return {
    found: Boolean(accessToken),
    fresh: Boolean(fresh),
    path,
    accessToken,
    claims: decodeJwtPayload(payload?.id_token || payload?.idToken),
  };
}

function normalizeOAuthCredentials(payload, path = null) {
  const accessToken = text(payload?.access_token || payload?.accessToken);
  const rawExpiry = Number(payload?.expiry_date ?? payload?.expiryDate ?? payload?.expiresAt);
  const expiry = Number.isFinite(rawExpiry) && rawExpiry < 100_000_000_000
    ? rawExpiry * 1_000
    : rawExpiry;
  const idToken = text(payload?.id_token || payload?.idToken);
  return {
    found: Boolean(accessToken),
    fresh: Boolean(accessToken && (!Number.isFinite(expiry) || expiry > Date.now() + 60_000)),
    path,
    accessToken,
    refreshToken: text(payload?.refresh_token || payload?.refreshToken),
    expiry,
    idToken,
    claims: decodeJwtPayload(idToken),
    projectId: text(payload?.project_id || payload?.projectId),
    clientId: text(payload?.client_id || payload?.clientId),
    clientSecret: text(payload?.client_secret || payload?.clientSecret),
  };
}

export function parseOAuthCredentials(value) {
  if (value && typeof value === 'object') return normalizeOAuthCredentials(value);
  const raw = text(value);
  if (!raw) return normalizeOAuthCredentials(null);
  try {
    return normalizeOAuthCredentials(JSON.parse(raw));
  } catch {
    return normalizeOAuthCredentials({ access_token: raw });
  }
}

export function loadAntigravityCredentials(environment = process.env) {
  const configured = environmentSecret('ANTIGRAVITY_OAUTH_CREDENTIALS_JSON', environment);
  if (configured) return parseOAuthCredentials(configured);
  const root = configuredHome(environment, 'CODEXBAR_HOME', join(homedir(), '.codexbar'));
  const path = join(root, 'antigravity', 'oauth_creds.json');
  return normalizeOAuthCredentials(jsonFile(path), path);
}

export function environmentSecret(name, environment = process.env) {
  const variable = text(name);
  if (!variable || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) return null;
  return text(environment[variable]);
}

export function normalizeCookieSecret(value, allowedNames = []) {
  const raw = text(value);
  if (!raw) return null;
  const header = raw.match(/(?:^|\s)(?:-H\s+)?['"]?Cookie\s*:\s*([^'"\r\n]+)/i)?.[1] || raw;
  const safe = header.replace(/[\r\n]/g, '').trim();
  const pairs = safe.split(';').map((part) => part.trim()).filter((part) => part.includes('='));
  const allowed = new Set(allowedNames.map((name) => name.toLowerCase()));
  const filtered = allowed.size
    ? pairs.filter((pair) => allowed.has(pair.slice(0, pair.indexOf('=')).trim().toLowerCase()))
    : pairs;
  return filtered.length ? filtered.join('; ') : null;
}

export function keychainAvailable(platform = process.platform) {
  return platform === 'darwin';
}

export function readKeychainSecret(providerId, { run = spawnSync, platform = process.platform } = {}) {
  if (!keychainAvailable(platform)) return null;
  const result = run('/usr/bin/security', [
    'find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', providerId, '-w',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return result.status === 0 ? text(result.stdout) : null;
}

export function writeKeychainSecret(providerId, secret, { run = spawnSync, platform = process.platform } = {}) {
  if (!keychainAvailable(platform)) throw new Error('当前系统不支持 macOS 钥匙串；请改用环境变量。');
  const value = text(secret);
  if (!value) throw new Error('凭据不能为空。');
  const result = run('/usr/bin/security', [
    'add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', providerId, '-w', value,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error('无法保存到 macOS 钥匙串。');
}

export function deleteKeychainSecret(providerId, { run = spawnSync, platform = process.platform } = {}) {
  if (!keychainAvailable(platform)) return;
  run('/usr/bin/security', [
    'delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', providerId,
  ], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'] });
}

export function resolveProviderSecret(providerId, providerSettings, environment = process.env) {
  if (providerSettings.authMode === 'environment') {
    return environmentSecret(providerSettings.environmentVariable, environment);
  }
  if (providerSettings.authMode === 'keychain') {
    return readKeychainSecret(providerSettings.credentialKey || providerId);
  }
  return null;
}

export function parentDirectory(path) {
  return dirname(path);
}
