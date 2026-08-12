import {
  CalendarClock, Gauge, Layers3, Settings2, ShieldCheck, TrendingUp,
} from 'lucide-react';
import { compact } from './format.js';
import { ToolGlyph } from './tool-glyphs.js';

function percent(value, digits = 0) {
  return value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`;
}

function ratio(value) {
  return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(value >= 10 ? 1 : 2)}×`;
}

function money(value, currency = 'usd') {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${currency === 'cny' ? '¥' : '$'}${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function shortDate(value, zh) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Date(value).toLocaleDateString(zh ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function confidenceCopy(value, zh) {
  if (value === 'high') return zh ? '高置信' : 'High confidence';
  if (value === 'medium') return zh ? '中等置信' : 'Medium confidence';
  if (value === 'low') return zh ? '初步样本' : 'Early sample';
  return zh ? '等待样本' : 'Awaiting samples';
}

function stabilityCopy(value, zh) {
  if (value === 'steady') return zh ? '相对稳定' : 'Relatively stable';
  if (value === 'variable') return zh ? '存在波动' : 'Some variation';
  if (value === 'volatile') return zh ? '波动较大' : 'Highly variable';
  return zh ? '尚不可判断' : 'Not enough data';
}

function CycleCapacityCard({ provider, zh }) {
  const candidates = [...provider.windows]
    .filter((window) => window.cycleStats?.sampledCycles > 0)
    .sort((left, right) => (right.windowSeconds || 0) - (left.windowSeconds || 0));
  const window = candidates[0];
  const stats = window?.cycleStats;
  const observed = provider.windows.reduce((sum, item) => sum + (item.cycleStats?.observedCycles || 0), 0);
  const completed = provider.windows.reduce((sum, item) => sum + (item.cycleStats?.completedCycles || 0), 0);
  const topModel = stats?.modelScenarios.find((model) => model.id === provider.modelRows[0]?.id)
    || stats?.modelScenarios[0];
  return <article className="subscription-review-card cycle-capacity-review">
    <header><span><TrendingUp size={15}/><b>{zh ? '跨周期容量' : 'CROSS-CYCLE CAPACITY'}</b></span><small data-confidence={stats?.confidence || 'none'}>{confidenceCopy(stats?.confidence, zh)}</small></header>
    {stats ? <>
      <div className="cycle-capacity-hero"><div><span>{window.label} · {stats.sampledCycles} {zh ? '个有效完整周期' : 'eligible completed cycles'}</span><strong>{compact(stats.median)}</strong><small>{zh ? '历史中位容量' : 'historical median capacity'}</small></div><div><span>{zh ? '常见区间（P25–P75）' : 'Typical range (P25–P75)'}</span><strong>{compact(stats.low)}–{compact(stats.high)}</strong><small>{stabilityCopy(stats.stability, zh)}</small></div></div>
      <div className="capacity-range" role="img" aria-label={zh ? `历史容量常见区间 ${compact(stats.low)} 到 ${compact(stats.high)}，中位数 ${compact(stats.median)}` : `Typical capacity ${compact(stats.low)} to ${compact(stats.high)}, median ${compact(stats.median)}`}><i/><b style={{ '--median-position': `${stats.high > stats.low ? Math.max(0, Math.min(100, (stats.median - stats.low) / (stats.high - stats.low) * 100)) : 50}%` }}/></div>
      <dl className="cycle-capacity-facts">
        <div><dt>{zh ? '30 天等效中位数' : '30D MEDIAN'}</dt><dd>{compact(stats.monthlyMedian)}</dd></div>
        <div><dt>{zh ? `只用 ${topModel?.id || '主力模型'}` : `ONLY ${topModel?.id || 'TOP MODEL'}`}</dt><dd>{topModel?.median == null ? '—' : `${compact(topModel.low)}–${compact(topModel.high)}`}</dd></div>
        <div><dt>{zh ? '周期稳定性' : 'STABILITY'}</dt><dd>{stabilityCopy(stats.stability, zh)}</dd></div>
      </dl>
      <p>{zh ? '仅纳入已结束、重置前采样充分且本机日志覆盖 ≥90% 的周期；区间不是供应商公布的 Token 上限。' : 'Only completed cycles sampled near reset with ≥90% local coverage. This is not a provider-published Token cap.'}</p>
    </> : <div className="subscription-review-empty"><Gauge size={25}/><div><b>{zh ? '等待第一个可比较的完整周期' : 'Waiting for a comparable completed cycle'}</b><p>{zh ? `已观察 ${observed} 个周期、其中 ${completed} 个已结束。需在重置前刷新且本机日志覆盖完整，才会进入容量区间。` : `${observed} cycles observed, ${completed} completed. A near-reset refresh and complete local coverage are required.`}</p></div></div>}
  </article>;
}

function RenewalReviewCard({ provider, zh, onSettings }) {
  const review = provider.renewalReview;
  return <article className="subscription-review-card renewal-review">
    <header><span><CalendarClock size={15}/><b>{zh ? '本账期回顾' : 'RENEWAL REVIEW'}</b></span>{review.configured ? <small>{review.daysRemaining} {zh ? '天后续费' : 'days to renewal'}</small> : null}</header>
    {review.configured ? <>
      <div className="renewal-heading"><div><span>{zh ? '下次续费' : 'NEXT RENEWAL'}</span><strong>{shortDate(review.periodEnd, zh)}</strong></div><div><span>{zh ? '账期进度' : 'PERIOD ELAPSED'}</span><strong>{percent(review.elapsedFraction)}</strong></div></div>
      <div className="renewal-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round((review.elapsedFraction || 0) * 100)}><i style={{ width: `${Math.max(0, Math.min(100, (review.elapsedFraction || 0) * 100))}%` }}/></div>
      <dl className="renewal-facts">
        <div><dt>{zh ? '本账期已用' : 'TOKENS TO DATE'}</dt><dd>{compact(review.totals.totalTokens)}</dd><small>{review.totals.requestCount.toLocaleString()} {zh ? '次请求' : 'requests'}</small></div>
        <div><dt>{zh ? '周期末预计' : 'PROJECTED TOKENS'}</dt><dd>{compact(review.projectedTokens)}</dd><small>{review.projectedTokens == null ? (zh ? '等待 ≥90% 日志覆盖' : 'awaiting ≥90% coverage') : (zh ? '按当前账期节奏' : 'at current period pace')}</small></div>
        <div><dt>{zh ? '预计 API 等价价值' : 'PROJECTED API VALUE'}</dt><dd>{review.projectedApiEquivalentUsd == null ? '—' : money(review.projectedApiEquivalentUsd)}</dd><small>{zh ? '标准价格，不是账单' : 'standard price, not a bill'}</small></div>
        <div><dt>{zh ? '预计价值比' : 'PROJECTED VALUE RATIO'}</dt><dd>{ratio(review.projectedValueRatio)}</dd><small>{review.projectedValueRatio == null ? (zh ? '需填写美元价格与完整样本' : 'needs USD price + full sample') : (zh ? '等价价值 ÷ 本账期价格' : 'equivalent value ÷ period price')}</small></div>
      </dl>
      <p>{zh ? `本机日志覆盖 ${percent(review.coverage)}；不包含网页端、其他设备或供应商内部权重。` : `${percent(review.coverage)} local-log coverage; web, other devices, and provider weights are excluded.`}</p>
    </> : <div className="subscription-review-empty"><CalendarClock size={25}/><div><b>{zh ? '填写续费日后生成账期回顾' : 'Add a renewal date for period review'}</b><p>{zh ? '系统会按月付或年付账期统计 Token、请求、API 等价价值与周期末预计，不会自动续费或修改套餐。' : 'The review will show period Tokens, requests, API-equivalent value, and forecast without changing the plan.'}</p><button type="button" onClick={onSettings}><Settings2 size={13}/>{zh ? '完善订阅信息' : 'Complete subscription details'}</button></div></div>}
  </article>;
}

export function SubscriptionReviewGrid({ provider, zh, onSettings }) {
  return <section className="subscription-review-grid">
    <CycleCapacityCard provider={provider} zh={zh}/>
    <RenewalReviewCard provider={provider} zh={zh} onSettings={onSettings}/>
  </section>;
}

function ProviderPair({ item, zh }) {
  return <article className="portfolio-pair"><div className="portfolio-pair-tools"><span><ToolGlyph id={item.leftId} size={16}/>{item.leftLabel}</span><i>↔</i><span><ToolGlyph id={item.rightId} size={16}/>{item.rightLabel}</span></div><strong>{Math.round(item.score * 100)}% {zh ? '模型家族分布重叠' : 'model-family overlap'}</strong><p>{zh ? `共同集中于 ${item.families.map((family) => family.label).join('、')}；近 30 天合计 ${compact(item.recentTokens)} Token。` : `Shared focus: ${item.families.map((family) => family.label).join(', ')}; ${compact(item.recentTokens)} combined 30-day Tokens.`}</p><small>{zh ? '这是检查候选，不代表两个订阅可直接互换。' : 'Review candidate only; the subscriptions may not be interchangeable.'}</small></article>;
}

export function SubscriptionPortfolioReview({ review, providers, zh, onSettings }) {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const actionCount = review.upcomingRenewals.length + review.paidWithoutLocalUsage.length + review.overlaps.length;
  return <section className="subscription-portfolio-review">
    <header><div><span>{zh ? '订阅组合' : 'SUBSCRIPTION PORTFOLIO'}</span><h2>{zh ? '续费日程与工作负载重叠' : 'Renewal schedule and workload overlap'}</h2><p>{zh ? '把多个订阅放在同一决策层检查；结论仅使用本机近 30 天数据，并明确遗漏范围。' : 'Review subscriptions together using only the last 30 days of local data, with explicit blind spots.'}</p></div><button type="button" onClick={onSettings}><Settings2 size={14}/>{zh ? '完善价格与续费日' : 'Complete prices & dates'}</button></header>
    <div className="portfolio-readiness">
      <article><span>{zh ? '可生成完整回顾' : 'REVIEW READY'}</span><strong>{review.readyProviders}<small> / {providers.length}</small></strong><p>{zh ? '同时填写价格与续费日' : 'price and renewal date entered'}</p></article>
      <article><span>{zh ? '30 天内续费' : 'RENEWS IN 30D'}</span><strong>{review.upcomingRenewals.length}</strong><p>{review.upcomingRenewals[0] ? `${review.upcomingRenewals[0].label} · ${review.upcomingRenewals[0].renewalReview.daysRemaining}${zh ? ' 天' : 'd'}` : (zh ? '暂无已填写日程' : 'no configured renewal')}</p></article>
      <article><span>{zh ? '工作负载重叠候选' : 'OVERLAP CANDIDATES'}</span><strong>{review.overlaps.length}</strong><p>{zh ? '仅提示检查，不自动建议取消' : 'review only, never auto-cancel'}</p></article>
      <article><span>{zh ? '待核对事项' : 'ITEMS TO REVIEW'}</span><strong>{actionCount}</strong><p>{zh ? '续费、无本机用量或模型重叠' : 'renewal, no local use, or overlap'}</p></article>
    </div>
    <div className="portfolio-review-columns">
      <section><header><CalendarClock size={15}/><div><b>{zh ? '续费雷达' : 'RENEWAL RADAR'}</b><span>{zh ? '未来 30 天与已付未使用项' : 'next 30 days and paid-without-local-use'}</span></div></header><div className="renewal-radar-list">{review.upcomingRenewals.length || review.paidWithoutLocalUsage.length ? <>
        {review.upcomingRenewals.map((provider) => <article key={`renewal:${provider.id}`}><ToolGlyph id={provider.id} size={16}/><div><b>{provider.label}</b><span>{shortDate(provider.renewalReview.periodEnd, zh)} · {provider.renewalReview.daysRemaining} {zh ? '天' : 'days'}</span></div><strong>{provider.renewalReview.projectedValueRatio == null ? compact(provider.renewalReview.projectedTokens) : ratio(provider.renewalReview.projectedValueRatio)}</strong></article>)}
        {review.paidWithoutLocalUsage.map((provider) => <article data-tone="warning" key={`unused:${provider.id}`}><ToolGlyph id={provider.id} size={16}/><div><b>{provider.label}</b><span>{zh ? '近 30 天未识别到本机 Token' : 'No local Tokens in the last 30 days'}</span></div><strong>{money(provider.subscription.monthlyPrice, provider.subscription.currency)}{zh ? '/月' : '/mo'}</strong></article>)}
      </> : <div className="portfolio-empty"><b>{zh ? '尚未形成续费日程' : 'No renewal schedule yet'}</b><p>{zh ? '在订阅设置中填写价格和续费日；未填写不会被当作免费或无限。' : 'Add prices and renewal dates in settings; missing values are never treated as free or unlimited.'}</p></div>}</div></section>
      <section><header><Layers3 size={15}/><div><b>{zh ? '工作负载重叠' : 'WORKLOAD OVERLAP'}</b><span>{zh ? '按近 30 天模型家族分布比较' : 'compared by 30-day model-family mix'}</span></div></header><div className="portfolio-overlap-list">{review.overlaps.length ? review.overlaps.map((item) => <ProviderPair item={item} zh={zh} key={`${item.leftId}:${item.rightId}`}/>) : <div className="portfolio-empty"><b>{zh ? '暂未发现明显重叠' : 'No strong overlap detected'}</b><p>{zh ? '只有两个订阅都有本机用量且模型家族分布重叠 ≥50% 时才会提示。' : 'A candidate appears only when both subscriptions have local usage and ≥50% model-family overlap.'}</p></div>}</div></section>
    </div>
    <footer><ShieldCheck size={13}/><span>{zh ? '不读取对话内容；网页端、其他设备、团队权益和非 Token 功能不在本分析中。任何取消或降级决定都应由你确认。' : 'No conversation content is read. Web, other devices, team benefits, and non-Token features are excluded. You decide any cancellation or downgrade.'}</span>{review.upcomingRenewals[0] ? <small>{byId.get(review.upcomingRenewals[0].id)?.label}</small> : null}</footer>
  </section>;
}
