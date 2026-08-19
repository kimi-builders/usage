import { randomBytes } from 'node:crypto';
import {
  chmod, mkdir, open, readFile, rename, rmdir, stat, unlink, utimes,
} from 'node:fs/promises';
import { arch, hostname, release, type } from 'node:os';
import { dirname, join } from 'node:path';
import { COLLECTOR_VERSION } from '../../client-meta.js';
import { loadKimiCredentials } from '../credentials.js';
import { LimitHTTPError, requestJson } from '../http.js';

const OAUTH_TOKEN_URL = 'https://auth.kimi.com/api/oauth/token';
const OAUTH_CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098';
const REFRESH_THRESHOLD_SECONDS = 300;
const LOCK_STALE_MS = 5_000;
const LOCK_WAIT_MS = 60_000;
const REFRESH_ATTEMPTS = 3;
const activeRefreshes = new Map();

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function ascii(value, fallback = 'unknown') {
  const cleaned = String(value || '').replaceAll(/[^\u0020-\u007E]/g, '').trim();
  return cleaned || fallback;
}

export function kimiIdentityHeaders(credential) {
  const headers = {
    'User-Agent': `kbu-usage/${COLLECTOR_VERSION}`,
    'X-Msh-Platform': 'kimi_code_cli',
    'X-Msh-Version': COLLECTOR_VERSION,
    'X-Msh-Device-Name': ascii(hostname()),
    'X-Msh-Device-Model': ascii(`${type()} ${release()} ${arch()}`),
    'X-Msh-Os-Version': ascii(release()),
  };
  if (credential?.deviceId) headers['X-Msh-Device-Id'] = ascii(credential.deviceId);
  return headers;
}

function needsRefresh(credential, currentTime, force) {
  if (force) return true;
  if (!credential.found || !Number.isFinite(credential.expiresAt)) return true;
  const threshold = credential.expiresIn
    ? Math.max(REFRESH_THRESHOLD_SECONDS, credential.expiresIn * 0.5)
    : REFRESH_THRESHOLD_SECONDS;
  return credential.expiresAt <= currentTime / 1_000 + threshold;
}

async function acquireRefreshLock(root, { currentTime = Date.now, sleep = wait } = {}) {
  if (process.platform === 'win32' || process.env.KIMI_DISABLE_OAUTH_LOCK === '1') {
    return async () => {};
  }
  const oauthDirectory = join(root, 'oauth');
  const target = join(oauthDirectory, 'kimi-code');
  const lockDirectory = `${target}.lock`;
  await mkdir(oauthDirectory, { recursive: true, mode: 0o700 });
  await chmod(oauthDirectory, 0o700).catch(() => {});
  const sentinel = await open(target, 'a', 0o600);
  await sentinel.close();
  const deadline = currentTime() + LOCK_WAIT_MS;
  while (true) {
    try {
      await mkdir(lockDirectory, { mode: 0o700 });
      const owned = await stat(lockDirectory);
      const timer = setInterval(() => {
        const now = new Date();
        utimes(lockDirectory, now, now).catch(() => {});
      }, 1_000);
      timer.unref?.();
      return async () => {
        clearInterval(timer);
        try {
          const latest = await stat(lockDirectory);
          if (latest.ino === owned.ino) await rmdir(lockDirectory);
        } catch { /* another process already recovered or released it */ }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw new LimitHTTPError('无法准备 Kimi 登录续期锁。', { code: 'provider_error' });
      }
      try {
        const existing = await stat(lockDirectory);
        if (currentTime() - existing.mtimeMs > LOCK_STALE_MS) await rmdir(lockDirectory);
      } catch { /* lock changed while it was inspected */ }
      if (currentTime() >= deadline) {
        throw new LimitHTTPError('Kimi 登录正在被其他进程续期，请稍后重试。', { code: 'timeout' });
      }
      await sleep(100);
    }
  }
}

async function requestRefreshToken(credential, { fetcher, sleep }) {
  let lastError;
  for (let attempt = 0; attempt < REFRESH_ATTEMPTS; attempt += 1) {
    try {
      return await requestJson(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...kimiIdentityHeaders(credential),
        },
        body: new URLSearchParams({
          client_id: OAUTH_CLIENT_ID,
          grant_type: 'refresh_token',
          refresh_token: credential.refreshToken,
        }).toString(),
        timeoutMs: 30_000,
        fetcher,
      });
    } catch (error) {
      lastError = error;
      const retryable = error?.code === 'network_error' || error?.code === 'timeout'
        || (error?.code === 'provider_error' && [429, 500, 502, 503, 504].includes(error?.status));
      if (!retryable || attempt === REFRESH_ATTEMPTS - 1) throw error;
      await sleep(2 ** attempt * 1_000);
    }
  }
  throw lastError;
}

function refreshedToken(payload, currentTime) {
  const accessToken = typeof payload?.access_token === 'string' ? payload.access_token.trim() : '';
  const refreshToken = typeof payload?.refresh_token === 'string' ? payload.refresh_token.trim() : '';
  const expiresIn = Number(payload?.expires_in);
  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new LimitHTTPError('Kimi 登录续期返回了无法验证的数据。', { code: 'invalid_response' });
  }
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Math.floor(currentTime() / 1_000) + expiresIn,
    expires_in: expiresIn,
    scope: typeof payload.scope === 'string' ? payload.scope : '',
    token_type: typeof payload.token_type === 'string' && payload.token_type ? payload.token_type : 'Bearer',
  };
}

async function saveCredentials(credential, token) {
  let current = {};
  try {
    const parsed = JSON.parse(await readFile(credential.path, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed;
  } catch { /* replace a malformed credential only after a valid refresh response */ }
  const directory = dirname(credential.path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700).catch(() => {});
  const temporary = `${credential.path}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify({ ...current, ...token }, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await chmod(temporary, 0o600);
    await rename(temporary, credential.path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function refreshUnderLock(initial, {
  environment, fetcher, currentTime, sleep, force,
}) {
  const release = await acquireRefreshLock(initial.root, { currentTime, sleep });
  try {
    const current = loadKimiCredentials(environment);
    const changed = current.accessToken !== initial.accessToken
      || current.refreshToken !== initial.refreshToken
      || current.expiresAt !== initial.expiresAt;
    if (!needsRefresh(current, currentTime(), force) || (force && changed && current.fresh)) return current;
    if (!current.refreshToken) return current;
    let payload;
    try {
      payload = await requestRefreshToken(current, { fetcher, sleep });
    } catch (error) {
      if (error?.status === 400 || error?.code === 'unauthorized') {
        await sleep(100);
        const recovery = loadKimiCredentials(environment);
        if (recovery.refreshToken && recovery.refreshToken !== current.refreshToken && recovery.fresh) {
          return recovery;
        }
        throw new LimitHTTPError('Kimi Code 登录已失效，请重新登录。', {
          status: error?.status || 401, code: 'unauthorized',
        });
      }
      throw error;
    }
    await saveCredentials(current, refreshedToken(payload, currentTime));
    return loadKimiCredentials(environment);
  } finally {
    await release();
  }
}

export async function ensureFreshKimiCredentials({
  environment = process.env, fetcher = fetch, currentTime = Date.now, sleep = wait, force = false,
} = {}) {
  const initial = loadKimiCredentials(environment);
  if (!initial.found || !needsRefresh(initial, currentTime(), force) || !initial.refreshToken) return initial;
  const active = activeRefreshes.get(initial.path);
  if (active) {
    if (!force || active.force) return active.promise;
    await active.promise.catch(() => {});
    return ensureFreshKimiCredentials({ environment, fetcher, currentTime, sleep, force });
  }
  const promise = refreshUnderLock(initial, {
    environment, fetcher, currentTime, sleep, force,
  }).finally(() => {
    if (activeRefreshes.get(initial.path)?.promise === promise) activeRefreshes.delete(initial.path);
  });
  activeRefreshes.set(initial.path, { promise, force });
  return promise;
}
