import { randomUUID } from 'node:crypto';
import { normalizeCookieSecret } from '../credentials.js';
import { requestJson, requestText } from '../http.js';
import { withPlanAccount, planError, planSecret, planSnapshot, quotaDate, quotaNumber, quotaWindow } from './coding-plan-common.js';

export const ALIBABA_NOTICE = '百炼 Coding Plan 官方请求额度，不是新版 Token Plan。仅展示可验证窗口，不把请求数转换为 Token；套餐可见但额度缺失不代表未使用或无限。';
const API = 'zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2';

function unpack(value) {
  for (let depth = 0; depth < 8; depth++) {
    if (typeof value === 'string') {
      if (value.length > 2_000_000) throw planError();
      try { value = JSON.parse(value); } catch { throw planError(); }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw planError();
    const code = value.code ?? value.Code ?? value.statusCode ?? value.status_code;
    if (/login|unauthori/i.test(String(code)) || [401, 403].includes(Number(code))) throw planError('unauthorized');
    if (value.success === false || value.Success === false || code != null && !['0', '200', 'Success', 'SUCCESS'].includes(String(code))) throw planError('provider_error');
    if (value.data != null || value.Data != null || value.successResponse != null || value.body != null) value = value.data ?? value.Data ?? value.successResponse ?? value.body;
    else return value;
  }
  throw planError();
}

function inactive(instance, now) {
  if (/^(EXPIRED|CANCELLED|CANCELED|INACTIVE|DISABLED)$/i.test(instance.status || instance.instanceStatus || '')) return true;
  const expires = quotaDate(instance.expireTime || instance.endTime);
  return Boolean(expires && Date.parse(expires) <= now.getTime());
}

function active(instance, now) {
  if (inactive(instance, now)) return false;
  const expires = quotaDate(instance.expireTime || instance.endTime);
  return /^(RUNNING|VALID|ACTIVE|NORMAL|EFFECTIVE)$/i.test(instance.status || instance.instanceStatus || '')
    || Boolean(expires && Date.parse(expires) > now.getTime());
}

export function parseAlibabaCodingQuota(payload, { now = new Date() } = {}) {
  const data = unpack(payload);
  const instances = data.codingPlanInstanceInfos ?? data.coding_plan_instance_infos;
  let instance = data;
  if (instances != null) {
    if (!Array.isArray(instances) || instances.length > 32 || instances.some(x => !x || typeof x !== 'object' || Array.isArray(x))) throw planError();
    if (!instances.length) return planSnapshot('alibaba-coding', 'Alibaba Coding Plan', [], null, now, ALIBABA_NOTICE);
    if (instances.length > 1) {
      const candidates = instances.filter(item => active(item, now));
      if (candidates.length !== 1) throw planError();
      instance = candidates[0];
    } else instance = instances[0];
  }
  const quota = instance.codingPlanQuotaInfo ?? instance.coding_plan_quota_info
    ?? (instances?.length > 1 ? null : data.codingPlanQuotaInfo ?? data.coding_plan_quota_info)
    ?? instance;
  const plan = instance.planName || instance.instanceName || instance.packageName || data.planName;
  // Even a lone expired instance can retain numeric counters. Those are not
  // available current benefits and must not become a fresh quota observation.
  if (inactive(instance, now)) return planSnapshot('alibaba-coding', 'Alibaba Coding Plan', [], plan, now, ALIBABA_NOTICE);
  const windows = [
    ['rolling', '5 小时', 'per5Hour', 'perFiveHour', 18000],
    ['weekly', '每周', 'perWeek', 'perWeek', 604800],
    ['monthly', '每月', 'perBillMonth', 'perMonth', null],
  ].flatMap(([id, label, key, alternate, seconds]) => {
    const used = quotaNumber(quota[`${key}UsedQuota`] ?? quota[`${alternate}UsedQuota`]);
    const total = quotaNumber(quota[`${key}TotalQuota`] ?? quota[`${alternate}TotalQuota`]);
    const reset = quota[`${key}QuotaNextRefreshTime`] ?? quota[`${alternate}QuotaNextRefreshTime`];
    return [quotaWindow({ id, label, used, total, unit: 'requests', seconds, reset, now })].filter(Boolean);
  });
  if (!windows.length && !active(instance, now)) throw planError();
  return planSnapshot('alibaba-coding', 'Alibaba Coding Plan', windows, plan, now, ALIBABA_NOTICE);
}

function cookieValue(cookie, name) {
  const part = cookie.split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`));
  return part ? part.slice(name.length + 1) : null;
}

export function normalizeAlibabaCookie(secret) {
  const raw = String(secret || '').trim();
  // Read only the literal Cookie argument; never execute a pasted cURL command.
  const argument = raw.match(/(?:^|\s)(?:-b|--cookie)\s+(['"])([^\r\n]*?)\1/)?.[2];
  if (/^curl\s/i.test(raw) && !argument && !/Cookie\s*:/i.test(raw)) return null;
  const cookie = normalizeCookieSecret(argument || raw);
  if (!cookie || cookie.length > 32_768 || !cookie.split(';').every(pair => /^[!#$%&'*+.^_`|~\w-]+=[^\s;\r\n]*$/.test(pair.trim()))) return null;
  return cookie;
}

export async function fetchAlibabaCodingLimits({ settings, environment = process.env, fetcher = fetch } = {}) {
  const secret = planSecret('alibaba-coding', settings, environment);
  const cookie = normalizeAlibabaCookie(secret);
  if (!cookie) throw planError('not_configured');
  return withPlanAccount('alibaba-coding', settings, cookie, async () => {
    const cn = settings.site === 'china';
    const host = cn ? 'https://bailian.console.aliyun.com' : 'https://modelstudio.console.alibabacloud.com';
    const rpc = cn ? 'https://bailian-cs.console.aliyun.com' : 'https://bailian-singapore-cs.alibabacloud.com';
    const region = cn ? 'cn-beijing' : 'ap-southeast-1';
    const referer = `${host}/${region}/?tab=${cn ? 'model' : 'coding-plan'}`;
    const dashboard = `${referer}#/efm/coding_plan`;
    const headers = { Cookie: cookie, 'User-Agent': 'Mozilla/5.0 kbu-usage', Referer: referer };
    let secToken = null;
    try {
      const html = await requestText(referer, { fetcher, headers, timeoutMs: 5000 });
      secToken = html.match(/(?:["']?sec_token["']?|["']?secToken["']?)\s*:\s*["']([^"']{1,4096})["']/)?.[1] || null;
    } catch { /* A valid cookie token may still permit the quota request. */ }
    if (!secToken) {
      try {
        const user = unpack(await requestJson(`${host}/tool/user/info.json`, { fetcher, headers, timeoutMs: 5000 }));
        secToken = user.secToken || user.sec_token;
      } catch { /* Optional session metadata must not mask a valid cookie token. */ }
    }
    secToken ||= cookieValue(cookie, 'sec_token');
    if (typeof secToken !== 'string' || !secToken || secToken.length > 4096) throw planError('unauthorized');
    const url = new URL('/data/api.json', rpc);
    url.search = new URLSearchParams({ action: cn ? 'BroadScopeAspnGateway' : 'IntlBroadScopeAspnGateway', product: 'sfm_bailian', api: API, _v: 'undefined' });
    const body = new URLSearchParams({ region, sec_token: secToken, params: JSON.stringify({ Api: API, V: '1.0', Data: {
      queryCodingPlanInstanceInfoRequest: { commodityCode: `sfm_codingplan_public_${cn ? 'cn' : 'intl'}`, onlyLatestOne: true },
      cornerstoneParam: { feTraceId: randomUUID(), feURL: dashboard, protocol: 'V2', console: 'ONE_CONSOLE', productCode: 'p_efm',
        domain: new URL(host).hostname, consoleSite: cn ? 'BAILIAN_ALIYUN' : 'MODELSTUDIO_ALIBABACLOUD',
        userNickName: '', userPrincipalName: '', xsp_lang: 'en-US',
        ...(cookieValue(cookie, 'cna') ? { 'X-Anonymous-Id': cookieValue(cookie, 'cna') } : {}) },
    } }) });
    const csrf = cookieValue(cookie, 'login_aliyunid_csrf') || cookieValue(cookie, 'csrf');
    const payload = await requestJson(url, { fetcher, method: 'POST', body: body.toString(), headers: {
      ...headers, Origin: host, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest',
      ...(csrf ? { 'x-xsrf-token': csrf, 'x-csrf-token': csrf } : {}),
    } });
    return { ...parseAlibabaCodingQuota(payload), source: new URL(host).hostname };
  });
}
