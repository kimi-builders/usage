import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { requestJson } from '../http.js';
import { planError, planSnapshot, quotaDate, quotaWindow, withPlanAccount } from './coding-plan-common.js';

export function loadStepPlanCredentials(environment = process.env, { home = homedir(), now = Date.now() } = {}) {
  const expand = path => path === '~' ? home : /^~[/\\]/.test(path) ? join(home, path.slice(2)) : path;
  const agentDir = environment.STEP_CODING_AGENT_DIR?.trim();
  // StepCode keeps the current auth file beside the agent directory, not
  // inside it. An explicit auth path is exclusive, even when it is missing.
  const agent = agentDir ? resolve(expand(agentDir)) : null;
  const config = agent ? dirname(agent) : join(home, environment.STEPCODE_CONFIG_DIR?.trim() || '.stepcode');
  const explicitAuth = environment.STEPCODE_AUTH_PATH?.trim();
  const paths = explicitAuth ? [resolve(expand(explicitAuth))]
    : [join(config, 'auth.json'), join(agent || join(config, 'agent'), 'auth.json')];
  for (const path of paths) {
    try {
      const value = JSON.parse(readFileSync(path, 'utf8')).step;
      // An existing current file without Step credentials represents logout.
      // Only ENOENT may try the legacy store; never resurrect another account.
      if (!value) return { found: false };
      const profile = value.profile || 'step_plan';
      if (value.type !== 'oauth' || !['step_plan', 'step_plan_oversea'].includes(profile)
        || typeof value.access !== 'string' || !value.access.trim()
        || value.access.length > 32768 || /[\s\x00-\x1f\x7f]/.test(value.access.trim())) return { found: false };
      return { found: true, fresh: value.expires == null || Number.isSafeInteger(value.expires) && value.expires > now,
        access: value.access.trim(), profile };
    } catch (error) {
      if (error.code !== 'ENOENT') return { found: false };
    }
  }
  return { found: false };
}

export function parseStepPlanQuota(payload, { now = new Date() } = {}) {
  const { plan, quota } = payload || {};
  if (payload?.schema_version !== 1 || payload.scope !== 'personal_account'
    || !plan || !['coding', 'token', 'none'].includes(plan.family)
    || !quota || !['known', 'partial'].includes(quota.state) || !Array.isArray(quota.windows)
    || quota.windows.length > 2) throw planError();
  const windows = [];
  const add = (id, label, percent, seconds, reset) => {
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) throw planError();
    windows.push(quotaWindow({ id, label, percent, seconds, reset: quotaDate(reset), now }));
  };
  if (plan.family === 'coding') {
    if (quota.windows.length !== 2 || new Set(quota.windows.map(w => w?.id)).size !== 2) throw planError();
    for (const w of quota.windows) {
      if (!['five_hour', 'weekly'].includes(w?.id) || typeof w.limited !== 'boolean') throw planError();
      if (!w.limited) { if (w.used_percent !== null) throw planError(); continue; }
      add(w.id, w.id === 'five_hour' ? '5 小时' : '每周', w.used_percent,
        w.id === 'five_hour' ? 18000 : 604800, w.resets_at_ms);
    }
  } else if (quota.windows.length) throw planError();
  if (plan.family === 'token' && quota.state === 'known') {
    if (!Array.isArray(quota.credit_buckets) || quota.credit_buckets.length > 64) throw planError();
    const counts = Object.fromEntries(['subscription', 'topup'].map(type => [type,
      quota.credit_buckets.filter(bucket => bucket?.type === type).length]));
    for (const [index, credit] of quota.credit_buckets.entries()) {
      if (!['subscription', 'topup'].includes(credit?.type) || credit.used_percent == null) continue;
      const id = `credit-${credit.type}${counts[credit.type] > 1 ? `-${index}` : ''}`;
      add(id, credit.type === 'subscription' ? '订阅 Credit' : '加购 Credit',
        credit.used_percent, null, credit.resets_at_ms || credit.expires_at_ms);
    }
  }
  const result = planSnapshot('stepfun', 'StepFun', windows, plan.name, now,
    'Step Plan 官方额度；Credit 与 Token 不等价，本机用量不代表账号全部消耗。');
  if (quota.state === 'partial') result.notice += ' 部分额度暂不可用。';
  return result;
}

export async function fetchStepFunLimits({ environment = process.env, fetcher = fetch, settings = {}, home } = {}) {
  const auth = loadStepPlanCredentials(environment, { home });
  if (!auth.found) throw planError('not_configured');
  if (!auth.fresh) throw planError('unauthorized');
  const origin = auth.profile === 'step_plan_oversea' ? 'https://api.stepfun.ai' : 'https://api.stepfun.com';
  return withPlanAccount('stepfun', settings, auth.access, async () => ({
    ...parseStepPlanQuota(await requestJson(new URL('/step_plan/v1/usage', origin), {
      fetcher, headers: { Authorization: `Bearer ${auth.access}` },
    })), source: new URL(origin).hostname,
  }));
}
