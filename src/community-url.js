const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isLocalHost(hostname) {
  const normalized = hostname.toLowerCase();
  return LOCAL_HOSTS.has(normalized)
    || normalized.endsWith('.localhost')
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

export function normalizeCommunityUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new Error('社区 API URL 无效。');
  }
  if (url.username || url.password) {
    throw new Error('社区 API URL 不能包含用户名或密码。');
  }
  const localHttp = url.protocol === 'http:' && isLocalHost(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error('社区 API URL 必须使用 HTTPS；本机 localhost 开发地址可使用 HTTP。');
  }
  return url.origin;
}
