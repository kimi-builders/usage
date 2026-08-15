import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { loadConfig } from '../config.js';
import {
  getDaemonStatus, installDaemon, restartDaemon, uninstallDaemon,
} from '../daemon.js';
import { runManagedSync } from '../sync-runtime.js';
import { prepareStateForSync } from '../state.js';
import { loadLocalDashboardData } from './dashboard-data.js';
import {
  getPublicLimitSettings, loadSubscriptionLimits, saveLimitSettings,
} from '../limits/service.js';
import { createDashboardControl } from './dashboard-control.js';

const DEFAULT_BUILD_ROOT = fileURLToPath(new URL('../../dashboard/dist/client/', import.meta.url));
const COOKIE_NAME = 'kbu_local_session';
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function securityHeaders(contentType = 'text/plain; charset=utf-8') {
  return {
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'none'",
      "connect-src 'self'",
      "font-src 'self'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
    ].join('; '),
  };
}

function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

function isLocalPeer(request) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress);
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, { ...securityHeaders(), ...headers });
  response.end(body);
}

function sendJson(request, response, data, status = 200) {
  const raw = Buffer.from(JSON.stringify(data));
  if (String(request.headers['accept-encoding'] || '').includes('gzip')) {
    const compressed = gzipSync(raw);
    send(response, status, compressed, {
      ...securityHeaders('application/json; charset=utf-8'),
      'Content-Encoding': 'gzip',
      'Content-Length': compressed.length,
      Vary: 'Accept-Encoding',
    });
    return;
  }
  send(response, status, raw, {
    ...securityHeaders('application/json; charset=utf-8'),
    'Content-Length': raw.length,
  });
}

function readJson(request, maxBytes = 32 * 1024) {
  return new Promise((resolveBody, reject) => {
    let bytes = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(Object.assign(new Error('Request body is too large.'), { statusCode: 413, code: 'request_too_large' }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400, code: 'invalid_json' }));
      }
    });
    request.on('error', reject);
  });
}

function browserError(error) {
  const declared = {
    invalid_json: [400, 'Request body must be valid JSON.'],
    request_too_large: [413, 'Request body is too large.'],
    not_connected: [409, 'This device is not connected to community sync.'],
    remote_revoke_failed: [502, 'The community device key could not be revoked. Your local connection was kept.'],
    sync_busy: [409, 'A synchronization is already running.'],
    sync_reconciliation_required: [409, 'Confirm a complete replay before rebuilding this device’s community usage.'],
    invalid_action: [400, 'Unsupported sync action.'],
    invalid_control_action: [400, 'Unsupported dashboard control action.'],
    invalid_control_input: [400, 'Dashboard control input is invalid.'],
  }[error?.code];
  if (declared) return { status: declared[0], code: error.code, message: declared[1] };
  return {
    status: 500,
    code: 'internal_error',
    message: 'The local dashboard could not complete this request.',
  };
}

function openBrowser(url) {
  const command = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore' });
  child.unref();
}

function staticFile(buildRoot, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const path = resolve(buildRoot, relative);
  const root = resolve(buildRoot);
  if (path !== root && !path.startsWith(`${root}${sep}`)) return null;
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  return path;
}

export function getLocalSyncStatus() {
  const config = loadConfig();
  return {
    connected: Boolean(config?.apiKey && config?.sessionSalt),
    apiUrl: config?.apiUrl || 'https://kimi.builders',
    daemon: getDaemonStatus(),
  };
}

export function publicSyncResult(result = {}) {
  const statuses = new Set(['ok', 'skipped', 'partial', 'failed']);
  return {
    buckets: Number(result?.buckets || 0),
    sessions: Number(result?.sessions || 0),
    protectedBuckets: Number(result?.protectedBuckets || 0),
    rejected: Number(result?.rejected || 0),
    sources: (result?.sources || []).map((source) => ({
      source: String(source?.source || '').slice(0, 64),
      status: statuses.has(source?.status) ? source.status : 'failed',
      buckets: Number(source?.buckets || 0),
      sessions: Number(source?.sessions || 0),
      warningCount: Array.isArray(source?.warnings) ? source.warnings.length : 0,
    })),
  };
}

export async function runLocalSyncAction(payload = {}) {
  const action = String(payload.action || '');
  const config = loadConfig();
  if (!config?.apiKey || !config?.sessionSalt) {
    throw Object.assign(new Error('尚未连接社区，请先运行 `npx @kimi.builders/usage init`。'), {
      statusCode: 409, code: 'not_connected',
    });
  }
  let result = null;
  if (['sync', 'sync-full'].includes(action)) {
    if (action === 'sync' && prepareStateForSync(config).reconciliationRequired) {
      return { ...getLocalSyncStatus(), action, result: null, reconciliationRequired: true };
    }
    try {
      const synced = await runManagedSync({
        trigger: 'dashboard', quiet: true, surface: 'local-dashboard', full: action === 'sync-full',
      });
      result = publicSyncResult(synced);
    } catch (error) {
      if (error?.code === 'SYNC_BUSY') {
        error.statusCode = 409;
        error.code = 'sync_busy';
      } else if (error?.code === 'SYNC_RECONCILIATION_REQUIRED') {
        error.statusCode = 409;
        error.code = 'sync_reconciliation_required';
      }
      throw error;
    }
  } else if (action === 'install') {
    result = installDaemon({ intervalMinutes: payload.intervalMinutes });
  } else if (action === 'restart') {
    result = restartDaemon({ intervalMinutes: payload.intervalMinutes });
  } else if (action === 'uninstall') {
    result = uninstallDaemon();
  } else {
    throw Object.assign(new Error('不支持的同步操作。'), { statusCode: 400, code: 'invalid_action' });
  }
  return { ...getLocalSyncStatus(), action, result };
}

export async function startLocalDashboardServer({
  port = 0,
  launchBrowser = true,
  buildRoot = DEFAULT_BUILD_ROOT,
  serveStatic = true,
  authRedirectOrigin = null,
  dataLoader = loadLocalDashboardData,
  limitsLoader = loadSubscriptionLimits,
  limitSettingsLoader = getPublicLimitSettings,
  limitSettingsSaver = saveLimitSettings,
  syncStatusLoader = getLocalSyncStatus,
  syncAction = runLocalSyncAction,
  control = null,
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('本地看板端口必须是 0–65535 的整数。');
  }
  if (serveStatic && !existsSync(resolve(buildRoot, 'index.html'))) {
    throw new Error('本地看板尚未构建，请先运行 `npm run dashboard:build`。');
  }

  const token = randomBytes(32).toString('base64url');
  const dashboardControl = control || (dataLoader === loadLocalDashboardData
    ? createDashboardControl()
    : { state: async () => ({ onboardingRequired: false }), act: async () => ({}) });
  const initialControl = await dashboardControl.state();
  let activeData = initialControl.onboardingRequired ? null : await dataLoader();
  let refreshPromise = null;
  let actualPort = 0;
  let expectedHost = '';
  let expectedOrigin = '';

  const server = createServer(async (request, response) => {
    try {
      if (!isLocalPeer(request)) {
        send(response, 403, 'Local connections only.');
        return;
      }
      if (request.headers.host !== expectedHost) {
        send(response, 421, 'Unexpected Host header.');
        return;
      }
      const origin = request.headers.origin;
      if (origin && origin !== expectedOrigin) {
        send(response, 403, 'Unexpected Origin header.');
        return;
      }
      const url = new URL(request.url || '/', expectedOrigin);
      const queryToken = url.searchParams.get('token');
      if (url.pathname === '/' && queryToken === token) {
        const configuredRedirect = typeof authRedirectOrigin === 'function'
          ? authRedirectOrigin()
          : authRedirectOrigin;
        let redirect = '/';
        if (configuredRedirect) {
          const target = new URL('/', configuredRedirect);
          if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password) {
            throw new Error('开发看板跳转地址必须是无凭据的 127.0.0.1 HTTP 地址。');
          }
          redirect = target.toString();
        }
        response.writeHead(303, {
          ...securityHeaders(),
          Location: redirect,
          'Set-Cookie': `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/`,
        });
        response.end();
        return;
      }
      if (cookieValue(request.headers.cookie, COOKIE_NAME) !== token) {
        send(response, 401, 'This local dashboard session is not authorized.');
        return;
      }

      if (url.pathname === '/api/limits/settings') {
        if (request.method === 'GET' || request.method === 'HEAD') {
          sendJson(request, response, limitSettingsLoader());
          return;
        }
        if (request.method === 'POST') {
          if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
            send(response, 415, 'Content-Type must be application/json.');
            return;
          }
          const payload = await readJson(request);
          limitSettingsSaver(payload);
          sendJson(request, response, limitSettingsLoader());
          return;
        }
        send(response, 405, 'Method not allowed.', { Allow: 'GET, HEAD, POST' });
        return;
      }

      if (url.pathname === '/api/control') {
        if (request.method === 'GET' || request.method === 'HEAD') {
          sendJson(request, response, await dashboardControl.state());
          return;
        }
        if (request.method === 'POST') {
          if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
            send(response, 415, 'Content-Type must be application/json.');
            return;
          }
          const payload = await readJson(request);
          const result = await dashboardControl.act(payload);
          if (['save-sources', 'prepare-onboarding', 'complete-onboarding'].includes(payload.action)) activeData = null;
          sendJson(request, response, result);
          return;
        }
        send(response, 405, 'Method not allowed.', { Allow: 'GET, HEAD, POST' });
        return;
      }

      if (url.pathname === '/api/limits') {
        if (!['GET', 'HEAD'].includes(request.method || '')) {
          send(response, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
          return;
        }
        sendJson(request, response, await limitsLoader({ force: url.searchParams.get('refresh') === '1' }));
        return;
      }

      if (url.pathname === '/api/sync') {
        if (request.method === 'GET' || request.method === 'HEAD') {
          sendJson(request, response, await syncStatusLoader());
          return;
        }
        if (request.method === 'POST') {
          if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
            send(response, 415, 'Content-Type must be application/json.');
            return;
          }
          const payload = await readJson(request);
          sendJson(request, response, await syncAction(payload));
          return;
        }
        send(response, 405, 'Method not allowed.', { Allow: 'GET, HEAD, POST' });
        return;
      }

      if (!['GET', 'HEAD'].includes(request.method || '')) {
        send(response, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
        return;
      }

      if (url.pathname === '/api/snapshot') {
        if (!activeData || url.searchParams.get('refresh') === '1') {
          if (!refreshPromise) {
            refreshPromise = dataLoader()
              .then((next) => {
                activeData = next;
                return next;
              })
              .finally(() => { refreshPromise = null; });
          }
          await refreshPromise;
        }
        sendJson(request, response, activeData);
        return;
      }

      if (!serveStatic) {
        send(response, 404, 'Not found.');
        return;
      }

      const path = staticFile(buildRoot, url.pathname);
      if (!path) {
        send(response, 404, 'Not found.');
        return;
      }
      const body = readFileSync(path);
      send(response, 200, request.method === 'HEAD' ? undefined : body, {
        ...securityHeaders(MIME_TYPES[extname(path)] || 'application/octet-stream'),
        'Content-Length': body.length,
      });
    } catch (error) {
      const safe = browserError(error);
      sendJson(request, response, { error: { code: safe.code, message: safe.message } }, safe.status);
    }
  });

  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  actualPort = server.address().port;
  expectedHost = `127.0.0.1:${actualPort}`;
  expectedOrigin = `http://${expectedHost}`;
  const url = `${expectedOrigin}/?token=${encodeURIComponent(token)}`;
  if (launchBrowser) openBrowser(url);
  return {
    server,
    port: actualPort,
    origin: expectedOrigin,
    url,
    close: () => new Promise((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
    }),
  };
}

export async function runDashboard(options = {}) {
  console.log('正在启动本机用量中心；首次使用可在浏览器选择要扫描和同步的 Agent…');
  const local = await startLocalDashboardServer(options);
  console.log(`本地看板: ${local.url}`);
  console.log('仅监听 127.0.0.1；关闭此终端或按 Ctrl+C 即停止。');
  return local;
}
