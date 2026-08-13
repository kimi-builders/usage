import {
  CalendarClock, Gauge, Gift, Layers3, Settings2, ShieldCheck, TrendingUp,
} from 'lucide-react';
import { compact, displayDollars } from './format.js';
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

function entitlementCopy(type, zh) {
  const copies = {
    paid: zh ? '付费订阅' : 'Paid subscription',
    free: zh ? '免费额度' : 'Free allowance',
    promotion: zh ? '试用 / 活动权益' : 'Trial / promotion',
    organization: zh ? '单位 / 团队提供' : 'Organization-provided',
    unknown: zh ? '未分类' : 'Unclassified',
  };
  return copies[type] || copies.unknown;
}

function CycleCapacityCard({ provider, zh, currency }) {
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
    </> : <div className="subscription-review-empty"><Gauge size={25}/><div><b>{provider.quotaObservation?.state === 'unavailable' ? (zh ? '官方额度暂不可观测' : 'Official quota is not observable') : (zh ? '等待第一个可比较的完整周期' : 'Waiting for a comparable completed cycle')}</b><p>{provider.quotaObservation?.state === 'unavailable' ? (zh ? `这不代表没有额度或没有使用。本机仍已识别 ${compact(provider.lifetimeTotals.totalTokens)} Token；只有供应商返回可验证比例后，才会推算周期容量。` : `This does not mean unlimited or unused. ${compact(provider.lifetimeTotals.totalTokens)} local Tokens remain analyzable; cycle capacity requires a provider-reported ratio.`) : (zh ? `已观察 ${observed} 个周期、其中 ${completed} 个已结束。需在重置前刷新且本机日志覆盖完整，才会进入容量区间。` : `${observed} cycles observed, ${completed} completed. A near-reset refresh and complete local coverage are required.`)}</p></div></div>}
  </article>;
}

function RenewalReviewCard({ provider, zh, currency, onSettings }) {
  const review = provider.renewalReview;
  if (!review.applicable && provider.subscription.entitlementType === 'unknown') return <article className="subscription-review-card renewal-review">
    <header><span><CalendarClock size={15}/><b>{zh ? '权益类型待确认' : 'ENTITLEMENT TYPE NEEDED'}</b></span><small data-confidence="none">{zh ? '不做付费假设' : 'No spend assumption'}</small></header>
    <div className="subscription-review-empty"><Settings2 size={25}/><div><b>{zh ? '这是付费订阅、免费额度，还是活动权益？' : 'Is this paid, free, promotional, or provided by work?'}</b><p>{zh ? '先标注权益来源，系统才会把它放进正确的支出、续费和组合分析；未分类不会被当成免费或无限。' : 'Classify the account before it enters spend, renewal, and portfolio analysis. Unknown never means free or unlimited.'}</p><button type="button" onClick={onSettings}><Settings2 size={13}/>{zh ? '标注权益类型' : 'Classify entitlement'}</button></div></div>
  </article>;
  if (!review.applicable) return <article className="subscription-review-card renewal-review benefit-value-review">
    <header><span><Gift size={15}/><b>{zh ? '非付费权益价值' : 'NON-PAID BENEFIT VALUE'}</b></span><small data-confidence="high">{entitlementCopy(provider.subscription.entitlementType, zh)}</small></header>
    <div className="cycle-capacity-hero"><div><span>{zh ? '近 30 天本机 Token' : '30D LOCAL TOKENS'}</span><strong>{compact(provider.recentTotals.totalTokens)}</strong><small>{provider.recentTotals.requestCount.toLocaleString()} {zh ? '次请求' : 'requests'}</small></div><div><span>{zh ? '标准 API 等价价值' : 'API-EQUIVALENT VALUE'}</span><strong>{displayDollars(provider.economics.apiEquivalentUsd, currency)}</strong><small>{zh ? '用于衡量权益承载量，不是节省金额' : 'benefit throughput, not realized savings'}</small></div></div>
    <dl className="cycle-capacity-facts">
      <div><dt>{zh ? '本机累计 Token' : 'LIFETIME TOKENS'}</dt><dd>{compact(provider.lifetimeTotals.totalTokens)}</dd></div>
      <div><dt>{zh ? '主要模型' : 'TOP MODEL'}</dt><dd>{provider.modelRows[0]?.label || '—'}</dd></div>
      <div><dt>{zh ? '续费与支出' : 'RENEWAL & SPEND'}</dt><dd>{zh ? '不计入' : 'Excluded'}</dd></div>
    </dl>
    <p>{zh ? '免费、活动或单位提供的权益仍参与 Token 与工作负载分析，但不会进入个人月支出、付费闲置或续费提醒。' : 'Free, promotional, and organization-provided benefits still contribute to usage analysis, but not personal spend, paid-idle, or renewal alerts.'}</p>
  </article>;
  return <article className="subscription-review-card renewal-review">
    <header><span><CalendarClock size={15}/><b>{zh ? '本账期回顾' : 'RENEWAL REVIEW'}</b></span>{review.configured ? <small>{review.daysRemaining} {zh ? '天后续费' : 'days to renewal'}</small> : null}</header>
    {review.configured ? <>
      <div className="renewal-heading"><div><span>{zh ? '下次续费' : 'NEXT RENEWAL'}</span><strong>{shortDate(review.periodEnd, zh)}</strong></div><div><span>{zh ? '账期进度' : 'PERIOD ELAPSED'}</span><strong>{percent(review.elapsedFraction)}</strong></div></div>
      <div className="renewal-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round((review.elapsedFraction || 0) * 100)}><i style={{ width: `${Math.max(0, Math.min(100, (review.elapsedFraction || 0) * 100))}%` }}/></div>
      <dl className="renewal-facts">
        <div><dt>{zh ? '本账期已用' : 'TOKENS TO DATE'}</dt><dd>{compact(review.totals.totalTokens)}</dd><small>{review.totals.requestCount.toLocaleString()} {zh ? '次请求' : 'requests'}</small></div>
        <div><dt>{zh ? '周期末预计' : 'PROJECTED TOKENS'}</dt><dd>{compact(review.projectedTokens)}</dd><small>{review.projectedTokens == null ? (zh ? '等待 ≥90% 日志覆盖' : 'awaiting ≥90% coverage') : (zh ? '按当前账期节奏' : 'at current period pace')}</small></div>
        <div><dt>{zh ? '预计 API 等价价值' : 'PROJECTED API VALUE'}</dt><dd>{review.projectedApiEquivalentUsd == null ? '—' : displayDollars(review.projectedApiEquivalentUsd, currency)}</dd><small>{zh ? '标准价格，不是账单' : 'standard price, not a bill'}</small></div>
        <div><dt>{zh ? '预计价值比' : 'PROJECTED VALUE RATIO'}</dt><dd>{ratio(review.projectedValueRatio)}</dd><small>{review.projectedValueRatio == null ? (zh ? '需填写美元价格与完整样本' : 'needs USD price + full sample') : (zh ? '等价价值 ÷ 本账期价格' : 'equivalent value ÷ period price')}</small></div>
      </dl>
      <p>{zh ? `本机日志覆盖 ${percent(review.coverage)}；不包含网页端、其他设备或供应商内部权重。` : `${percent(review.coverage)} local-log coverage; web, other devices, and provider weights are excluded.`}</p>
    </> : <div className="subscription-review-empty"><CalendarClock size={25}/><div><b>{zh ? '填写续费日后生成账期回顾' : 'Add a renewal date for period review'}</b><p>{zh ? '系统会按月付或年付账期统计 Token、请求、API 等价价值与周期末预计，不会自动续费或修改套餐。' : 'The review will show period Tokens, requests, API-equivalent value, and forecast without changing the plan.'}</p><button type="button" onClick={onSettings}><Settings2 size={13}/>{zh ? '完善订阅信息' : 'Complete subscription details'}</button></div></div>}
  </article>;
}

export function SubscriptionReviewGrid({ provider, zh, currency, onSettings }) {
  return <section className="subscription-review-grid">
    <CycleCapacityCard provider={provider} zh={zh} currency={currency}/>
    <RenewalReviewCard provider={provider} zh={zh} currency={currency} onSettings={onSettings}/>
  </section>;
}

function ProviderPair({ item, zh }) {
  return <article className="portfolio-pair"><div className="portfolio-pair-tools"><span><ToolGlyph id={item.leftId} size={16}/>{item.leftLabel}</span><i>↔</i><span><ToolGlyph id={item.rightId} size={16}/>{item.rightLabel}</span></div><strong>{Math.round(item.score * 100)}% {zh ? '模型家族分布重叠' : 'model-family overlap'}</strong><p>{zh ? `共同集中于 ${item.families.map((family) => family.label).join('、')}；近 30 天合计 ${compact(item.recentTokens)} Token。` : `Shared focus: ${item.families.map((family) => family.label).join(', ')}; ${compact(item.recentTokens)} combined 30-day Tokens.`}</p><small>{item.bothPaid ? (zh ? '两个都是付费核心，可在续费前核对是否各自承担了不同工作。' : 'Both are paid; verify that each carries a distinct workload before renewal.') : (zh ? '至少一项不是个人付费订阅，更可能是互补入口，不作为“重复付费”告警。' : 'At least one is not personally paid, so treat it as a complement—not duplicate-spend evidence.')}</small></article>;
}

export function SubscriptionPortfolioReview({ review, providers, zh, currency, onSettings }) {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const actionCount = review.upcomingRenewals.length + review.paidWithoutLocalUsage.length + review.unknownProviders.length;
  return <section className="subscription-portfolio-review">
    <header><div><span>{zh ? '账户权益组合' : 'ACCOUNT BENEFIT PORTFOLIO'}</span><h2>{zh ? '付费核心、免费补充与额度证据覆盖' : 'Paid core, free complements, and quota evidence'}</h2><p>{zh ? '常见组合是少数付费订阅，加上多个免费、活动或单位权益。这里分别分析，不把“已连接”误当成“已付费”。' : 'A typical portfolio mixes a few paid subscriptions with free, promotional, or organization-provided benefits. Connected never automatically means paid.'}</p></div><button type="button" onClick={onSettings}><Settings2 size={14}/>{zh ? '标注权益与实际支出' : 'Classify benefits & spend'}</button></header>
    <div className="portfolio-readiness">
      <article><span>{zh ? '个人付费核心' : 'PAID CORE'}</span><strong>{review.paidProviders.length}</strong><p>{zh ? `${review.readyProviders} 项已有价格与续费日` : `${review.readyProviders} have price + renewal date`}</p></article>
      <article><span>{zh ? '免费 / 活动 / 单位权益' : 'NON-PAID BENEFITS'}</span><strong>{review.benefitProviders.length}</strong><p>{zh ? `近 30 天 API 等价 ${displayDollars(review.benefitApiEquivalentUsd, currency)}` : `${displayDollars(review.benefitApiEquivalentUsd, currency)} 30D API equivalent`}</p></article>
      <article><span>{zh ? '官方额度可观测' : 'QUOTA OBSERVABLE'}</span><strong>{review.quotaObservableProviders}<small> / {providers.length}</small></strong><p>{zh ? '不可观测仍保留本机 Token 分析' : 'local Tokens remain when quota is hidden'}</p></article>
      <article><span>{zh ? '待核对事项' : 'ITEMS TO REVIEW'}</span><strong>{actionCount}</strong><p>{zh ? `${review.unknownProviders.length} 项权益类型未分类` : `${review.unknownProviders.length} benefits unclassified`}</p></article>
    </div>
    <div className="portfolio-review-columns">
      <section><header><CalendarClock size={15}/><div><b>{zh ? '付费核心检查' : 'PAID CORE REVIEW'}</b><span>{zh ? '只检查个人实际付费项的续费与本机闲置' : 'renewal and local-idle checks for personally paid items only'}</span></div></header><div className="renewal-radar-list">{review.upcomingRenewals.length || review.paidWithoutLocalUsage.length ? <>
        {review.upcomingRenewals.map((provider) => <article key={`renewal:${provider.id}`}><ToolGlyph id={provider.id} size={16}/><div><b>{provider.label}</b><span>{shortDate(provider.renewalReview.periodEnd, zh)} · {provider.renewalReview.daysRemaining} {zh ? '天' : 'days'}</span></div><strong>{provider.renewalReview.projectedValueRatio == null ? compact(provider.renewalReview.projectedTokens) : ratio(provider.renewalReview.projectedValueRatio)}</strong></article>)}
        {review.paidWithoutLocalUsage.map((provider) => <article data-tone="warning" key={`unused:${provider.id}`}><ToolGlyph id={provider.id} size={16}/><div><b>{provider.label}</b><span>{zh ? '近 30 天未识别到本机 Token' : 'No local Tokens in the last 30 days'}</span></div><strong>{money(provider.subscription.monthlyPrice, provider.subscription.currency)}{zh ? '/月' : '/mo'}</strong></article>)}
      </> : <div className="portfolio-empty"><b>{review.paidProviders.length ? (zh ? '付费项暂时没有紧迫事项' : 'No urgent paid-item review') : (zh ? '尚未标注个人付费订阅' : 'No personally paid subscription classified')}</b><p>{zh ? '只有明确标注为“付费订阅”的账户才会进入月支出、续费和付费闲置分析。' : 'Only accounts explicitly marked paid enter monthly spend, renewal, and paid-idle analysis.'}</p></div>}</div></section>
      <section><header><Gift size={15}/><div><b>{zh ? '零新增支出权益' : 'ZERO-INCREMENTAL-SPEND BENEFITS'}</b><span>{zh ? '免费、活动与单位权益仍展示承载价值' : 'free, promotional, and organization benefits still show throughput value'}</span></div></header><div className="renewal-radar-list">{review.benefitProviders.length ? review.benefitProviders.map((provider) => <article key={`benefit:${provider.id}`}><ToolGlyph id={provider.id} size={16}/><div><b>{provider.label}</b><span>{entitlementCopy(provider.subscription.entitlementType, zh)} · {compact(provider.recentTotals.totalTokens)} {zh ? '近 30 天 Token' : '30D Tokens'}</span></div><strong>{displayDollars(provider.economics.apiEquivalentUsd, currency)}</strong></article>) : <div className="portfolio-empty"><b>{zh ? '尚未标注免费或活动权益' : 'No non-paid benefits classified'}</b><p>{zh ? '把免费版、试用、促销赠送或单位提供的账户标出来，它们不会进入个人支出。' : 'Classify free tiers, trials, promotions, or organization-provided accounts so they stay out of personal spend.'}</p></div>}</div></section>
    </div>
    <section className="portfolio-overlap-section"><header><Layers3 size={15}/><div><b>{zh ? '工作负载重叠与互补' : 'WORKLOAD OVERLAP & COMPLEMENTS'}</b><span>{zh ? '只有两个付费项重叠才进入重复支出核对；含免费权益的组合只作为工作流互补线索' : 'only paid-paid overlap enters duplicate-spend review; non-paid overlap is workflow context'}</span></div></header><div className="portfolio-overlap-list">{review.overlaps.length ? review.overlaps.map((item) => <ProviderPair item={item} zh={zh} key={`${item.leftId}:${item.rightId}`}/>) : <div className="portfolio-empty"><b>{zh ? '暂未发现明显重叠' : 'No strong overlap detected'}</b><p>{zh ? '只有两个账户都有本机用量且模型家族分布重叠 ≥50% 时才会提示。' : 'A candidate appears only when both accounts have local usage and ≥50% model-family overlap.'}</p></div>}</div></section>
    <footer><ShieldCheck size={13}/><span>{zh ? '不读取对话内容；网页端、其他设备、团队权益和非 Token 功能不在本分析中。任何取消或降级决定都应由你确认。' : 'No conversation content is read. Web, other devices, team benefits, and non-Token features are excluded. You decide any cancellation or downgrade.'}</span>{review.upcomingRenewals[0] ? <small>{byId.get(review.upcomingRenewals[0].id)?.label}</small> : null}</footer>
  </section>;
}
