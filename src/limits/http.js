const ALLOWED_HOSTS = new Set([
  'chatgpt.com',
  'chat.openai.com',
  'api.kimi.com',
  'www.kimi.com',
  'app.warp.dev',
  'cloudcode-pa.googleapis.com',
  'oauth2.googleapis.com',
  'api.anthropic.com',
  'cursor.com',
  'api.github.com',
  'opencode.ai',
  'qoder.com',
  'qoder.com.cn',
]);

export class LimitHTTPError extends Error {
  constructor(message, { status = 0, code = 'network_error' } = {}) {
    super(message);
    this.name = 'LimitHTTPError';
    this.status = status;
    this.code = code;
  }
}

export async function requestJson(url, {
  method = 'GET', headers = {}, body, timeoutMs = 12_000, fetcher = fetch,
} = {}) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || !ALLOWED_HOSTS.has(endpoint.hostname)) {
    throw new LimitHTTPError('额度接口地址不在允许列表中。', { code: 'blocked_endpoint' });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(endpoint, {
      method,
      headers: { Accept: 'application/json', ...headers },
      body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { /* handled below */ }
    if (!response.ok) {
      const unauthorized = response.status === 401 || response.status === 403;
      const message = unauthorized
        ? '登录状态已过期或没有额度读取权限。'
        : `供应商额度接口返回 HTTP ${response.status}。`;
      throw new LimitHTTPError(message, {
        status: response.status,
        code: unauthorized ? 'unauthorized' : 'provider_error',
      });
    }
    if (payload == null || typeof payload !== 'object') {
      throw new LimitHTTPError('供应商返回了无法识别的数据。', { code: 'invalid_response' });
    }
    return payload;
  } catch (error) {
    if (error instanceof LimitHTTPError) throw error;
    if (error?.name === 'AbortError') {
      throw new LimitHTTPError('额度查询超时，请稍后重试。', { code: 'timeout' });
    }
    throw new LimitHTTPError('无法连接额度服务，请检查网络后重试。', { code: 'network_error' });
  } finally {
    clearTimeout(timer);
  }
}

export async function requestText(url, {
  method = 'GET', headers = {}, body, timeoutMs = 12_000, fetcher = fetch,
} = {}) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || !ALLOWED_HOSTS.has(endpoint.hostname)) {
    throw new LimitHTTPError('额度接口地址不在允许列表中。', { code: 'blocked_endpoint' });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(endpoint, {
      method,
      headers,
      body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      cache: 'no-store', redirect: 'error', signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      const unauthorized = response.status === 401 || response.status === 403;
      throw new LimitHTTPError(unauthorized
        ? '登录状态已过期或没有额度读取权限。'
        : `供应商额度接口返回 HTTP ${response.status}。`, {
        status: response.status, code: unauthorized ? 'unauthorized' : 'provider_error',
      });
    }
    return raw;
  } catch (error) {
    if (error instanceof LimitHTTPError) throw error;
    if (error?.name === 'AbortError') throw new LimitHTTPError('额度查询超时，请稍后重试。', { code: 'timeout' });
    throw new LimitHTTPError('无法连接额度服务，请检查网络后重试。', { code: 'network_error' });
  } finally {
    clearTimeout(timer);
  }
}

export function asPercent(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
}

export function asDate(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1_000)
    : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}
