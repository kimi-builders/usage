import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { loadLocalDashboardData } from './dashboard-data.js';
import {
  getPublicLimitSettings, loadSubscriptionLimits, saveLimitSettings,
} from '../limits/service.js';

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
        reject(Object.assign(new Error('Request body is too large.'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }));
      }
    });
    request.on('error', reject);
  });
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
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('本地看板端口必须是 0–65535 的整数。');
  }
  if (serveStatic && !existsSync(resolve(buildRoot, 'index.html'))) {
    throw new Error('本地看板尚未构建，请先运行 `npm run dashboard:build`。');
  }

  const token = randomBytes(32).toString('base64url');
  let activeData = await dataLoader();
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

      if (url.pathname === '/api/limits') {
        if (!['GET', 'HEAD'].includes(request.method || '')) {
          send(response, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
          return;
        }
        sendJson(request, response, await limitsLoader({ force: url.searchParams.get('refresh') === '1' }));
        return;
      }

      if (!['GET', 'HEAD'].includes(request.method || '')) {
        send(response, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
        return;
      }

      if (url.pathname === '/api/snapshot') {
        if (url.searchParams.get('refresh') === '1') {
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
      send(response, error?.statusCode || 500, `Local dashboard error: ${error?.message || error}`);
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
  console.log('正在读取本机 Agent 用量；订阅额度仅在你启用供应商后查询…');
  const local = await startLocalDashboardServer(options);
  console.log(`本地看板: ${local.url}`);
  console.log('仅监听 127.0.0.1；关闭此终端或按 Ctrl+C 即停止。');
  return local;
}
