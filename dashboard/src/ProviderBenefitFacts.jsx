import { localizedCompact } from './subscription-limits-utils.js';

function factDate(value, zh) {
  if (!value) return zh ? '未返回' : 'Not reported';
  // Calendar dates from subscription_details are not UTC instants.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(value).toLocaleString(zh ? 'zh-CN' : 'en-US');
}

export function ProviderBenefitFacts({ provider, now, zh }) {
  if (!['ok', 'empty'].includes(provider.status)) return null;
  const credit = provider.creditBalance;
  const cloud = provider.cloudCredits;
  const dates = provider.subscriptionDates;
  if (!credit && !cloud && !dates) return null;
  const expired = cloud?.expiresAt && Date.parse(cloud.expiresAt) <= +now;
  const stale = !Number.isFinite(Date.parse(provider.updatedAt)) || +now - Date.parse(provider.updatedAt) > 86_400_000;
  return <section className="provider-benefit-facts" aria-label={zh ? '供应商额外权益' : 'Additional provider benefits'}>
    <p>{zh ? '供应商事实 · 不与本机 Token、个人支出或容量推算混算' : 'Provider facts · separate from local Tokens, personal spend, and capacity estimates'}</p>
    {stale ? <p role="status">{zh ? '历史观测 · 请刷新以确认当前权益' : 'Historical observation · refresh to confirm current benefits'}</p> : null}
    {credit ? <dl className="limit-provider-summary">
      <div><dt>{zh ? '剩余 Credits' : 'Remaining credits'}</dt><dd>{localizedCompact(credit.remaining, zh)}</dd></div>
      <div><dt>{zh ? '周期 Credits 总额' : 'Cycle credit allowance'}</dt><dd>{localizedCompact(credit.total, zh)}</dd></div>
      <div><dt>{zh ? '预留 Credits（不重复扣减）' : 'Reserved credits (not deducted again)'}</dt><dd>{credit.reserved == null ? '—' : localizedCompact(credit.reserved, zh)}</dd></div>
      <div><dt>{zh ? '周期重置' : 'Cycle reset'}</dt><dd>{factDate(credit.resetsAt, zh)}</dd></div>
    </dl> : null}
    {cloud ? <dl className="limit-provider-summary">
      <div><dt>{zh ? '赠送云额度（USD）' : 'Promotional cloud credits (USD)'}</dt><dd>${cloud.remaining.toFixed(2)} / ${cloud.limit.toFixed(2)}</dd></div>
      <div><dt>{zh ? '赠送额度状态' : 'Promotion status'}</dt><dd>{expired ? (zh ? '已到期' : 'Expired') : stale ? (zh ? '待刷新' : 'Needs refresh') : cloud.locked ? (zh ? '已锁定' : 'Locked') : (zh ? '可用' : 'Available')}</dd></div>
      <div><dt>{zh ? '赠送额度到期' : 'Promotion expires'}</dt><dd>{factDate(cloud.expiresAt, zh)}</dd></div>
    </dl> : null}
    {dates ? <dl className="limit-provider-summary">
      <div><dt>{zh ? '官方续费日期' : 'Official renewal date'}</dt><dd>{factDate(dates.renewsAt, zh)}</dd></div>
      <div><dt>{zh ? '官方订阅到期日期' : 'Official subscription expiry'}</dt><dd>{factDate(dates.expiresAt, zh)}</dd></div>
    </dl> : null}
  </section>;
}
