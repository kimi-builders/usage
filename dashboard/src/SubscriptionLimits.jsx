import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, BarChart3, Check, ChevronDown, ChevronRight, CircleAlert, Code2,
  ExternalLink, Gauge, GripVertical, Info, KeyRound, RefreshCw, Search, Settings2,
  ShieldCheck, Sparkles, Terminal, TrendingUp, X,
} from 'lucide-react';
import { compactNumber, displayDollars, pluralUnit } from './format.js';
import {
  ENTITLEMENT_TYPES, PROVIDER_TONES, entitlementLabel, entitlementNote, idSegment,
  limitWindowDetail, localizedCompact, localizedCount, resetCreditPresentation,
} from './subscription-limits-utils.js';
import { buildSubscriptionInsights, selectSubscriptionAccounts } from './subscription-insights.js';
import {
  SubscriptionPortfolioReview, SubscriptionReviewGrid,
} from './SubscriptionReview.jsx';
import {
  BenefitActivityView, BenefitDistributionView, BenefitProviderPicker,
  BenefitRecordsView, BenefitTrendView,
} from './SubscriptionAnalytics.jsx';
import { ToolGlyph } from './tool-glyphs.js';
import { moveEnabledProvider, reorderEnabledProviders } from './provider-order.js';
import { PageState } from './ui.jsx';
import { ProviderSelect } from './provider-select.jsx';

const SELECTED_BENEFIT_KEY = 'kbu.benefit.selected.v1';
const SELECTED_BENEFIT_ACCOUNTS_KEY = 'kbu.benefit.accounts.v1';
const OVERVIEW_PROVIDER_PANEL_ID = 'subscription-limit-panel';

function overviewProviderTabId(providerId) {
  return `subscription-provider-tab-${idSegment(providerId)}`;
}

export function ProviderIcon({ id, size = 18 }) {
  if (id === 'warp') return <span className="limit-provider-icon limit-provider-icon--warp"><Terminal size={size}/></span>;
  if (id === 'jetbrains-ai') return <span className="limit-provider-icon limit-provider-icon--jetbrains"><Code2 size={size}/></span>;
  return <ToolGlyph id={id} size={size}/>;
}

function storedAccountSelections() {
  try {
    const value = JSON.parse(localStorage.getItem(SELECTED_BENEFIT_ACCOUNTS_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function AccountPicker({ provider, onChange, zh }) {
  if (!provider?.accounts?.length || provider.accounts.length < 2) return null;
  return <label className="benefit-account-picker">
    <span>{zh ? '查看账户' : 'Account'}</span>
    <select value={provider.activeAccountId || ''} onChange={(event) => onChange(event.target.value)}>
      {provider.accounts.map((account) => <option value={account.accountId} key={account.accountId}>
        {account.accountLabel || account.account || account.accountId}
      </option>)}
    </select>
    <small>{zh ? `${provider.accounts.length} 个账户，数据彼此隔离` : `${provider.accounts.length} accounts · isolated data`}</small>
  </label>;
}

function useNow(interval = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

function resetText(value, now, zh) {
  if (!value) return zh ? '未提供重置时间' : 'Reset time unavailable';
  const delta = Date.parse(value) - now;
  if (!Number.isFinite(delta) || delta <= 0) return zh ? '即将刷新' : 'Resetting soon';
  const minutes = Math.max(1, Math.ceil(delta / 60_000));
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const mins = minutes % 60;
  const parts = [];
  if (days) parts.push(`${days}${zh ? '天' : 'd'}`);
  if (hours) parts.push(`${hours}${zh ? '小时' : 'h'}`);
  if (!days && mins) parts.push(`${mins}${zh ? '分' : 'm'}`);
  return `${zh ? '重置于' : 'Resets in'} ${parts.join(' ')}`;
}

function relativeUpdated(value, now, zh) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000));
  if (!Number.isFinite(minutes) || minutes < 1) return zh ? '刚刚更新' : 'Updated now';
  if (minutes < 60) return zh ? `${minutes} 分钟前更新` : `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return zh ? `${hours} 小时前更新` : `Updated ${hours}h ago`;
}

function confidenceLabel(value, zh) {
  if (value === 'high') return zh ? '样本较完整' : 'Strong sample';
  if (value === 'medium') return zh ? '样本一般' : 'Moderate sample';
  return zh ? '样本较少' : 'Limited sample';
}

function estimateText(value, zh) {
  return value == null ? '—' : `${zh ? '约 ' : '~'}${localizedCompact(value, zh)}`;
}

function subscriptionMoney(value, currency, suffix = '') {
  if (value == null) return '—';
  return `${currency === 'cny' ? '¥' : '$'}${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}${suffix}`;
}

function portfolioSpend(summary, zh) {
  const parts = [];
  if (summary.spendByCurrency.usd > 0) parts.push(subscriptionMoney(summary.spendByCurrency.usd, 'usd'));
  if (summary.spendByCurrency.cny > 0) parts.push(subscriptionMoney(summary.spendByCurrency.cny, 'cny'));
  return parts.length ? parts.join(' + ') : (zh ? '未填写' : 'Not set');
}

function usageSegments(percentUsed, tone, zh) {
  const used = Math.max(0, Math.min(100, percentUsed));
  return <div className="limit-progress">
    <div className="limit-progress-meta"><span>{zh ? '已消耗' : 'Used'} {used.toFixed(used % 1 ? 1 : 0)}%</span><small>{zh ? '每格 20%' : '20% per segment'}</small></div>
    <div className={`limit-segments tone-${tone}`} role="progressbar" aria-label={zh ? '额度消耗进度' : 'Quota usage'} aria-valuemin="0" aria-valuemax="100" aria-valuenow={used}>
      {Array.from({ length: 5 }, (_, index) => {
        const fill = Math.max(0, Math.min(100, (used - index * 20) * 5));
        return <i key={index}><span style={{ width: `${fill}%` }}/></i>;
      })}
    </div>
  </div>;
}

function WindowRow({ window, tone, now, zh }) {
  const remaining = window.remainingPercent == null ? null : Number(window.remainingPercent);
  const reportedUsed = window.usedPercent == null ? null : Number(window.usedPercent);
  const left = Number.isFinite(remaining)
    ? Math.max(0, Math.min(100, remaining))
    : Number.isFinite(reportedUsed) ? 100 - Math.max(0, Math.min(100, reportedUsed)) : null;
  const used = left == null ? null : 100 - left;
  const detail = limitWindowDetail(window);
  return <article className="limit-window">
    <header><div><b>{window.label}</b>{detail ? <span>{detail}</span> : null}</div><div><strong>{left == null ? '—' : `${left.toFixed(left % 1 ? 1 : 0)}%`}</strong><small>{zh ? '剩余' : 'left'}</small></div></header>
    {used == null ? <p className="limit-progress-unavailable"><CircleAlert size={13}/>{zh ? '供应商未返回可验证的额度比例' : 'No verifiable quota ratio was reported'}</p> : usageSegments(used, tone, zh)}
    <footer><span>{resetText(window.resetsAt, now, zh)}</span>{window.windowSeconds ? <small>{Math.round(window.windowSeconds / 3_600)}h window</small> : null}</footer>
    <div className="limit-token-facts">
      <div><span>{zh ? '本窗口本机 TOKEN' : 'LOCAL TOKENS IN WINDOW'}</span><strong>{window.observedFrom ? localizedCompact(window.localTotals.totalTokens, zh) : '—'}</strong></div>
      <div><span>{zh ? '推算窗口总容量' : 'EST. WINDOW CAPACITY'}</span><strong>{estimateText(window.estimatedCapacityTokens, zh)}</strong></div>
      <div><span>{zh ? '推算剩余 TOKEN' : 'EST. TOKENS LEFT'}</span><strong>{estimateText(window.estimatedRemainingTokens, zh)}</strong></div>
      <div><span>{zh ? '30 天等效容量' : '30-DAY EQUIVALENT'}</span><strong>{estimateText(window.monthlyEquivalentTokens, zh)}</strong></div>
    </div>
    <p className="limit-estimate-note"><Info size={11}/>{window.estimatedCapacityTokens != null
      ? (zh ? `${confidenceLabel(window.estimationConfidence, zh)} · 用官方消耗比例与本机同窗 Token 反推，不是官方 Token 上限。` : `${confidenceLabel(window.estimationConfidence, zh)} · inferred from official utilization and local tokens, not an official token cap.`)
      : (zh ? '当前比例、时间窗或本机样本不足，暂不推算 Token 容量。' : 'Quota ratio, time window, or local sample is insufficient for a token estimate.')}</p>
  </article>;
}

function ModelScenario({ provider, zh }) {
  const [modelId, setModelId] = useState(provider.modelRows[0]?.id || '');
  useEffect(() => {
    if (!provider.modelRows.some((model) => model.id === modelId)) setModelId(provider.modelRows[0]?.id || '');
  }, [modelId, provider.modelRows]);
  if (!provider.modelRows.length) return <section className="model-scenario model-scenario--empty"><div><b>{zh ? '单模型容量情景' : 'Single-model capacity scenario'}</b><p>{zh ? '还没有与该订阅对应的本机 Token 记录。同步或继续使用后即可分析。' : 'No matching local token history yet. Use or sync this agent to unlock estimates.'}</p></div></section>;
  const selectedModel = provider.modelRows.find((model) => model.id === modelId) || provider.modelRows[0];
  const scenarios = provider.windows.map((window) => ({
    window,
    value: window.modelScenarios.find((scenario) => scenario.id === selectedModel.id),
  })).filter((item) => item.value?.capacityTokens != null);
  const primary = provider.primaryWindow?.modelScenarios.find((scenario) => scenario.id === selectedModel.id);
  return <section className="model-scenario">
    <header><div><span>{zh ? '单模型容量情景' : 'SINGLE-MODEL CAPACITY'}</span><b>{zh ? `如果只使用 ${selectedModel.label}` : `If you only used ${selectedModel.label}`}</b></div><label><span className="visually-hidden">{zh ? '选择模型' : 'Choose model'}</span><select value={selectedModel.id} onChange={(event) => setModelId(event.target.value)}>{provider.modelRows.map((model) => <option value={model.id} key={model.id}>{model.label}</option>)}</select></label></header>
    <div className="model-scenario-grid">
      {scenarios.map(({ window, value }) => <article key={window.id}><span>{window.label}</span><strong>{estimateText(value.capacityTokens, zh)}</strong><small>{zh ? `剩余约 ${localizedCompact(value.remainingTokens, zh)}` : `~${localizedCompact(value.remainingTokens, zh)} left`}</small></article>)}
      <article><span>{zh ? '30 天等效' : '30-day equivalent'}</span><strong>{estimateText(primary?.monthlyEquivalentTokens, zh)}</strong><small>{zh ? '按最长可估算额度窗折算' : 'from longest estimable window'}</small></article>
    </div>
    <footer><span>{zh ? `本机累计 ${localizedCompact(selectedModel.totalTokens, zh)} · 当前占该订阅 Token 的 ${(selectedModel.share * 100).toFixed(1)}%` : `${localizedCompact(selectedModel.totalTokens, zh)} local lifetime · ${(selectedModel.share * 100).toFixed(1)}% of this subscription's tokens`}</span><small>{zh ? '按标准 API 等价成本换算；订阅方可能采用不同权重，仅用于计划与对比。' : 'Converted with standard API-equivalent cost; provider weights may differ. Use for planning and comparison only.'}</small></footer>
  </section>;
}

function percentNumber(value) {
  return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(value % 1 ? 1 : 0)}%`;
}

function ratioText(value) {
  return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(value >= 10 ? 1 : 2)}×`;
}

function shortObservationTime(value, zh) {
  return new Date(value).toLocaleString(zh ? 'zh-CN' : 'en-US', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function QuotaHistory({ provider, zh }) {
  const available = useMemo(
    () => provider.windows.filter((window) => window.historyPoints.length),
    [provider.windows],
  );
  const availableKey = available.map((window) => window.id).join('\u0000');
  const [windowId, setWindowId] = useState(available[0]?.id || '');
  useEffect(() => {
    if (!available.some((window) => window.id === windowId)) setWindowId(available[0]?.id || '');
  }, [available, availableKey, windowId]);
  const selected = available.find((window) => window.id === windowId) || available[0];
  const points = selected?.historyPoints || [];
  const stride = Math.max(1, Math.ceil(points.length / 180));
  const plotted = points.filter((_, index) => index % stride === 0 || index === points.length - 1);
  const firstTime = Date.parse(plotted[0]?.observedAt);
  const lastTime = Date.parse(plotted.at(-1)?.observedAt);
  const span = Math.max(1, lastTime - firstTime);
  const coords = plotted.map((point) => ({
    ...point,
    x: 34 + (Date.parse(point.observedAt) - firstTime) / span * 572,
    y: 148 - Math.max(0, Math.min(100, Number(point.usedPercent) || 0)) * 1.14,
  }));
  const path = coords.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  return <section className="quota-history-card">
    <header><div><span>{zh ? '额度历史' : 'QUOTA HISTORY'}</span><b>{provider.label} · {selected?.label || (zh ? '等待首个样本' : 'Waiting for first sample')}</b></div>{available.length > 1 ? <label><span className="visually-hidden">{zh ? '选择额度窗口' : 'Choose quota window'}</span><select value={selected?.id || ''} onChange={(event) => setWindowId(event.target.value)}>{available.map((window) => <option value={window.id} key={window.id}>{window.label}</option>)}</select></label> : null}</header>
    {points.length ? <>
      <div className="quota-history-chart">
        <svg viewBox="0 0 640 176" role="img" aria-label={zh ? `${selected.label}额度消耗历史` : `${selected.label} quota usage history`}>
          {[0, 25, 50, 75, 100].map((value) => <g key={value}><line x1="34" x2="606" y1={148 - value * 1.14} y2={148 - value * 1.14}/><text x="4" y={152 - value * 1.14}>{value}%</text></g>)}
          {coords.length > 1 ? <path d={path}/> : null}
          {coords.map((point) => <circle cx={point.x} cy={point.y} r={coords.length === 1 ? 5 : 3.5} key={point.observedAt}><title>{shortObservationTime(point.observedAt, zh)} · {percentNumber(point.usedPercent)} {zh ? '已用' : 'used'} · {localizedCompact(point.localTotals.totalTokens, zh)} local tokens</title></circle>)}
        </svg>
      </div>
      <footer><span>{shortObservationTime(points[0].observedAt, zh)}</span><strong>{localizedCount(points.length, zh, '个本机快照', 'local snapshot', 'local snapshots')}</strong><span>{shortObservationTime(points.at(-1).observedAt, zh)}</span></footer>
    </> : <div className="quota-history-empty"><TrendingUp size={22}/><div><b>{provider.quotaObservation?.state === 'unavailable' ? (zh ? '官方额度暂不可观测' : 'Official quota is not observable') : (zh ? '历史从这次刷新开始积累' : 'History starts with this refresh')}</b><p>{provider.quotaObservation?.state === 'unavailable' ? (zh ? '这不代表额度无限或没有使用。系统仍分析本机 Token；如果供应商以后返回可验证窗口，历史会从首次成功刷新开始积累。' : 'This does not mean unlimited or unused. Local Token analytics continue, and history starts once the provider exposes a verifiable window.') : (zh ? '以后每次额度刷新都会在本机留下脱敏快照；有两个以上样本后即可显示消耗速度。' : 'Each quota refresh stores a sanitized local point. Burn rate appears after at least two samples.')}</p></div></div>}
  </section>;
}

function signalCopy(signal, zh) {
  if (signal.code === 'quota-unobservable') return {
    title: zh ? '官方额度不可观测，本机分析继续' : 'Official quota hidden; local analysis continues',
    body: zh
      ? `当前没有可验证的额度窗口，不能判断剩余比例；已识别的 ${localizedCompact(signal.localTokens, zh)} 本机 Token 仍参与模型、价值与工作负载分析。`
      : `No verifiable quota window is available, so no remaining balance is inferred. ${localizedCompact(signal.localTokens, zh)} local Tokens still contribute to model, value, and workload analysis.`,
  };
  if (signal.code === 'quota-historical') return {
    title: zh ? '当前额度读取失败，历史样本已保留' : 'Current quota failed; history is retained',
    body: zh ? '历史额度只用于回看，不会冒充当前余额，也不会产生当前周期预测。' : 'Historical quota remains for review but never acts as a current balance or pace forecast.',
  };
  if (signal.code === 'exhausted') return {
    title: zh ? '本周期额度已经用尽' : 'Quota is exhausted this cycle',
    body: zh
      ? `${signal.windowLabel}已消耗 ${percentNumber(signal.usedPercent)}，需等待重置或使用其他可用订阅；这是供应商返回的当前额度事实。`
      : `${signal.windowLabel} is ${percentNumber(signal.usedPercent)} used. Wait for reset or use another available subscription; this is the provider-reported quota fact.`,
  };
  if (signal.code === 'pace-high') return {
    title: zh ? '按当前节奏可能提前触顶' : 'May hit the limit early',
    body: zh
      ? `${signal.windowLabel}已用 ${percentNumber(signal.usedPercent)}，时间已走过 ${percentNumber(signal.elapsedFraction * 100)}，照此节奏重置前约为 ${percentNumber(signal.projectedFinalPercent)}。`
      : `${signal.windowLabel} is ${percentNumber(signal.usedPercent)} used after ${percentNumber(signal.elapsedFraction * 100)} of its window; current pace reaches ~${percentNumber(signal.projectedFinalPercent)}.`,
  };
  if (signal.code === 'pace-low') return {
    title: zh ? '本周期额度较为充裕' : 'Quota is underused this cycle',
    body: zh
      ? `${signal.windowLabel}时间已走过 ${percentNumber(signal.elapsedFraction * 100)}，按当前节奏最终约用 ${percentNumber(signal.projectedFinalPercent)}。可继续观察到续费日前再决定。`
      : `${percentNumber(signal.elapsedFraction * 100)} of ${signal.windowLabel} has elapsed; current pace ends near ${percentNumber(signal.projectedFinalPercent)}. Recheck near renewal.`,
  };
  if (signal.code === 'value-high') return {
    title: zh ? '本机 API 等价价值高于月费' : 'Local API-equivalent value exceeds price',
    body: zh ? `近 30 天标准 API 等价价值约 $${signal.apiEquivalentUsd.toFixed(2)}，是所填月均订阅支出的 ${ratioText(signal.valueRatio)}。这不是实际节省金额。` : `30-day standard API-equivalent value is $${signal.apiEquivalentUsd.toFixed(2)}, ${ratioText(signal.valueRatio)} the entered monthly price. This is not realized savings.`,
  };
  if (signal.code === 'value-low') return {
    title: zh ? '当前本机使用价值偏低' : 'Current local value is below price',
    body: zh ? `近 30 天本机 API 等价价值约为月费的 ${ratioText(signal.valueRatio)}；网页端和其他设备用量不在本结论中。` : `Local 30-day API-equivalent value is ${ratioText(signal.valueRatio)} the monthly price; web and other-device usage is excluded.`,
  };
  return {
    title: zh ? `Token 高度集中在 ${signal.model}` : `Tokens concentrate on ${signal.model}`,
    body: zh ? `${signal.model} 占该订阅本机累计 Token 的 ${(signal.share * 100).toFixed(1)}%。可用上方单模型情景判断套餐是否与主力模型匹配。` : `${signal.model} represents ${(signal.share * 100).toFixed(1)}% of this subscription's local tokens. Use the model-only scenario to assess fit.`,
  };
}

function SubscriptionDecisionPanel({ provider, zh, currency, onSettings }) {
  const exhausted = [...provider.windows].filter((window) => !window.stale && window.usedPercent != null && Number(window.usedPercent) >= 99)
    .sort((left, right) => (right.windowSeconds || 0) - (left.windowSeconds || 0))[0];
  const pace = [...provider.windows].filter((window) => window.pace?.projectedFinalPercent != null)
    .sort((left, right) => (right.windowSeconds || 0) - (left.windowSeconds || 0))[0];
  const isPaid = provider.subscription.isPaid;
  return <section className="subscription-decision-panel">
    <header><div><span>{zh ? '账户权益决策' : 'ACCOUNT BENEFIT DECISIONS'}</span><h2>{zh ? `${provider.label} 的用量与价值观察` : `${provider.label} usage and value`}</h2><p>{zh ? '本机 Token、官方额度和个人实际支出分别保真；读取不到官方额度时不会伪造剩余量。' : 'Local Tokens, official quota, and personal spend stay separate. Missing official quota is never replaced with a guessed balance.'}</p></div><small><ShieldCheck size={12}/>{zh ? '只读建议' : 'Read-only advice'}</small></header>
    <div className="subscription-economics-strip">
      <article><span>{zh ? '近 30 天 TOKEN' : '30D TOKENS'}</span><strong>{localizedCompact(provider.recentTotals.totalTokens, zh)}</strong><small>{localizedCount(localizedCompact(provider.recentTotals.requestCount, zh), zh, '次请求', 'request', 'requests')}</small></article>
      <article><span>{isPaid ? (zh ? '实际成本 / 百万 TOKEN' : 'ACTUAL COST / 1M') : (zh ? '权益来源' : 'BENEFIT SOURCE')}</span><strong>{isPaid ? (provider.economics.costPerMillionTokens == null ? '—' : subscriptionMoney(provider.economics.costPerMillionTokens, provider.subscription.currency)) : entitlementLabel(provider.subscription.entitlementType, zh)}</strong><small>{isPaid ? (zh ? '按所填月均订阅支出' : 'from entered monthly spend') : entitlementNote(provider.subscription.entitlementType, zh)}</small></article>
      <article><span>{isPaid ? (zh ? 'API 等价价值比' : 'API-EQUIVALENT RATIO') : (zh ? 'API 等价承载价值' : 'API-EQUIVALENT THROUGHPUT')}</span><strong>{isPaid ? ratioText(provider.economics.valueRatio) : displayDollars(provider.economics.apiEquivalentUsd, currency)}</strong><small>{isPaid ? (provider.subscription.currency === 'cny' ? (zh ? '人民币未自动换汇' : 'no automatic FX') : (zh ? '等价价值 ÷ 月均支出' : 'equivalent value ÷ spend')) : (zh ? '标准价格口径，不代表实际节省' : 'standard-price basis, not realized savings')}</small></article>
      <article><span>{zh ? '官方额度状态' : 'OFFICIAL QUOTA STATUS'}</span><strong>{exhausted ? (zh ? '已触顶' : 'EXHAUSTED') : pace ? percentNumber(pace.pace.projectedFinalPercent) : provider.quotaObservation?.state === 'historical' ? (zh ? '仅历史' : 'HISTORY') : (zh ? '不可观测' : 'UNOBSERVABLE')}</strong><small>{exhausted ? `${exhausted.label} · ${zh ? '供应商额度事实' : 'provider quota fact'}` : pace ? `${pace.label} · ${zh ? '重置时预计' : 'at reset'}` : (zh ? '本机 Token 分析仍然可用' : 'local Token analytics remain available')}</small></article>
    </div>
    <SubscriptionReviewGrid provider={provider} zh={zh} currency={currency} onSettings={onSettings}/>
    <div className="subscription-decision-grid">
      <QuotaHistory provider={provider} zh={zh}/>
      <section className="subscription-signals"><header><Gauge size={15}/><div><b>{zh ? '本机观察' : 'LOCAL OBSERVATIONS'}</b><span>{zh ? '提示不是账单结论，也不会自动改套餐' : 'Evidence, not billing conclusions or automatic changes'}</span></div></header><div>{provider.decisionSignals.length ? provider.decisionSignals.map((signal) => { const copy = signalCopy(signal, zh); return <article data-tone={signal.tone} key={signal.code}><i/><div><b>{copy.title}</b><p>{copy.body}</p></div></article>; }) : <article data-tone="positive"><i/><div><b>{zh ? '暂未发现明显异常' : 'No obvious issue yet'}</b><p>{zh ? '当前样本中没有明显的触顶、闲置、价值偏低或模型过度集中信号；继续积累历史后判断会更稳定。' : 'No clear limit, underuse, low-value, or concentration signal yet. More history will improve confidence.'}</p></div></article>}</div></section>
    </div>
  </section>;
}

// Credential sources that are local paths (~/…) truncate badly and expose config layout; show a generic label.
function sourceDisplay(value, zh) {
  if (!value) return '—';
  return /[~\/\\]/.test(value) ? (zh ? '本机凭据' : 'Local credential') : value;
}

function ProviderCard({ provider, zh, currency, onSettings }) {
  const now = useNow();
  const tone = PROVIDER_TONES[provider.id] || 'blue';
  const currentWindows = provider.windows?.filter((window) => !window.stale) || [];
  const quotaUnavailable = provider.quotaObservation?.state !== 'current';
  const showResetCredits = provider.id === 'codex' || provider.resetCredits != null;
  const resetCredit = resetCreditPresentation(provider.resetCredits, zh);
  return <article className={`limit-card tone-${tone}`}>
    <dl className="limit-provider-summary">
      <div><dt>{zh ? '账户' : 'Account'}</dt><dd>{provider.account || (zh ? '本机账户' : 'Local account')}</dd></div>
      {provider.plan ? <div><dt>{zh ? '方案' : 'Plan'}</dt><dd>{String(provider.plan).replaceAll('_', ' ')}</dd></div> : null}
      <div><dt>{zh ? '权益类型' : 'BENEFIT TYPE'}</dt><dd>{entitlementLabel(provider.subscription.entitlementType, zh)}</dd></div>
      <div><dt>{zh ? '本机累计 TOKEN' : 'LOCAL LIFETIME TOKENS'}</dt><dd>{localizedCompact(provider.lifetimeTotals.totalTokens, zh)}</dd></div>
      <div><dt>{zh ? '主要模型' : 'TOP MODEL'}</dt><dd>{provider.modelRows[0]?.label || '—'}</dd></div>
      <div><dt>{zh ? '个人月均支出' : 'PERSONAL MONTHLY SPEND'}</dt><dd>{provider.subscription.isPaid ? (provider.subscription.monthlyPrice == null ? (zh ? '待填写' : 'Not set') : subscriptionMoney(provider.subscription.monthlyPrice, provider.subscription.currency, zh ? '/月' : '/mo')) : (zh ? '不计入' : 'Excluded')}</dd></div>
      <div><dt>{zh ? '近 30 天 API 等价价值' : '30D API EQUIVALENT'}</dt><dd>{displayDollars(provider.recentTotals.costMicros / 1_000_000, currency)}</dd></div>
      <div><dt>{zh ? '更新' : 'Updated'}</dt><dd>{relativeUpdated(provider.updatedAt, now, zh)}</dd></div>
      <div><dt>{zh ? '来源' : 'Source'}</dt><dd>{sourceDisplay(provider.source, zh)}</dd></div>
    </dl>
    {quotaUnavailable ? <section className="quota-unavailable-state"><div><Gauge size={22}/><span><b>{provider.quotaObservation?.state === 'historical' ? (zh ? '当前额度不可读，仅保留历史' : 'Current quota unavailable; history retained') : (zh ? '官方额度暂不可观测' : 'Official quota is not observable')}</b><small>{provider.quotaObservation.bestEffort ? (zh ? '该平台或当前账户不一定提供稳定额度数据' : 'This platform or account may not expose stable quota data') : (zh ? '当前没有取得可验证的额度窗口' : 'No verifiable quota window is available')}</small></span></div><p>{provider.status === 'error' ? (provider.error?.message || (zh ? '额度查询失败。' : 'Quota request failed.')) : (zh ? '供应商没有返回可验证的额度比例。' : 'The provider did not return a verifiable quota ratio.')} {zh ? `这不代表免费、无限或未使用；本机 ${localizedCompact(provider.lifetimeTotals.totalTokens, zh)} Token 仍参与价值与工作负载分析。` : `This does not mean free, unlimited, or unused; ${localizedCompact(provider.lifetimeTotals.totalTokens, zh)} local Tokens still contribute to value and workload analysis.`}</p>{provider.status === 'error' ? <button type="button" className="ghost-btn" onClick={onSettings}>{zh ? '检查连接（可选）' : 'Check connection (optional)'}</button> : null}</section> : <div className="limit-window-list">{currentWindows.map((window) => <WindowRow window={window} tone={tone} now={now} zh={zh} key={window.id}/>)}</div>}
    <ModelScenario provider={provider} zh={zh}/>
    {showResetCredits ? <div className="reset-credit" data-state={resetCredit.state}><div><span><b>{zh ? '额度重置券' : 'Limit reset credits'}</b><small>{resetCredit.detail || (provider.resetCredits?.nextExpiry ? resetText(provider.resetCredits.nextExpiry, now, zh) : (zh ? '未返回到期时间' : 'No expiry time reported'))}</small></span></div><strong>{resetCredit.value}</strong></div> : null}
    {provider.notice ? <p className="limit-notice">{provider.notice}</p> : null}
  </article>;
}

export function SubscriptionPulse({ data, usageData, settings, loading, error, onOpen, onSettings, onRetry, zh }) {
  const insights = useMemo(() => buildSubscriptionInsights(usageData, data, { settings }), [usageData, data, settings]);
  if (error && !data) return <section className="subscription-pulse subscription-pulse--error" role="alert">
    <div><CircleAlert size={17}/><span><b>{zh ? '权益状态暂时不可读' : 'Benefits are temporarily unavailable'}</b><small>{error}</small></span></div><button type="button" onClick={() => onRetry?.()}>{zh ? '重试' : 'Retry'}<RefreshCw size={13}/></button>
  </section>;
  if (!data?.enabled) return <section className="subscription-pulse subscription-pulse--empty">
    <div><BarChart3 size={17}/><span><b>{zh ? '订阅与权益中心尚未启用' : 'Subscriptions & Benefits is off'}</b><small>{zh ? '连接付费、免费或活动账户，把官方额度与本机 Token 放在一起分析。' : 'Connect paid, free, or promotional accounts to compare official quota with local Tokens.'}</small></span></div><button type="button" onClick={onSettings}>{zh ? '连接账户权益' : 'Connect benefits'}<ArrowRight size={13}/></button>
  </section>;
  return <section className="subscription-pulse">
    <div><BarChart3 size={17}/><span><b>{zh ? '订阅与权益中心' : 'Subscriptions & Benefits'}</b><small>{loading ? (zh ? '正在刷新额度…' : 'Refreshing quotas…') : (zh ? `${insights.summary.entitlementCounts.paid} 项付费 · ${insights.summary.benefitProviders} 项非付费 · ${localizedCompact(insights.summary.trackedTokens, zh)} 本机 Token` : `${insights.summary.entitlementCounts.paid} paid · ${insights.summary.benefitProviders} non-paid · ${localizedCompact(insights.summary.trackedTokens, zh)} local Tokens`)}</small></span></div><button type="button" onClick={onOpen}>{zh ? '查看权益与容量' : 'View benefits & capacity'}<ArrowRight size={13}/></button>
  </section>;
}

export function SubscriptionCenter({ data, usageData, settings, loading, error, onRefresh, onSettings, onViewChange, onRefreshIntervalChange, view = 'overview', zh, currency }) {
  const [accountSelections, setAccountSelections] = useState(storedAccountSelections);
  const effectiveData = useMemo(
    () => selectSubscriptionAccounts(data, accountSelections),
    [data, accountSelections],
  );
  const insights = useMemo(
    () => buildSubscriptionInsights(usageData, effectiveData, { settings }),
    [usageData, effectiveData, settings],
  );
  const providers = insights.providers;
  const [selected, setSelected] = useState(() => localStorage.getItem(SELECTED_BENEFIT_KEY) || '');
  const [drilldown, setDrilldown] = useState(null);
  useEffect(() => {
    if (!providers.some((provider) => provider.id === selected)) setSelected(providers[0]?.id || '');
  }, [providers, selected]);
  useEffect(() => {
    if (selected) localStorage.setItem(SELECTED_BENEFIT_KEY, selected);
  }, [selected]);
  useEffect(() => {
    localStorage.setItem(SELECTED_BENEFIT_ACCOUNTS_KEY, JSON.stringify(accountSelections));
  }, [accountSelections]);
  const active = providers.find((provider) => provider.id === selected) || providers[0];
  const selectAccount = (accountId) => setAccountSelections((current) => ({
    ...current, [active.id]: accountId,
  }));
  const openEvidence = (evidence) => {
    setDrilldown({ ...evidence, providerId: active?.id || null });
    onViewChange?.('records');
  };
  if (loading && !data) return <section className="panel limits-panel limits-panel--loading" id="subscriptions"><div><h2>{zh ? '正在读取订阅中心' : 'Loading Subscription Center'}</h2><p>{zh ? '未启用供应商时不会发起外部网络请求。' : 'No external requests are made until a provider is enabled.'}</p></div></section>;
  if (error && !data) return <PageState className="panel limits-panel" kind="error" title={zh ? '权益数据读取失败' : 'Could not load benefit data'} body={error} action={<button className="primary-btn" type="button" onClick={() => onRefresh(true)}><RefreshCw size={14}/>{zh ? '重新读取' : 'Try again'}</button>}/>;
  if (!data?.enabled) return <section className="panel limits-panel limits-panel--empty" id="subscriptions">
    <div><h2>{zh ? '把付费核心、免费权益、官方额度与本机 Token 放在一起看' : 'Compare paid core, free benefits, official quotas, and local Tokens'}</h2><p>{zh ? '默认关闭且零联网。连接后先标注权益来源；额度不可读的平台仍可做本机 Token、模型和价值分析。' : 'Off and network-free by default. Classify each benefit after connecting; platforms with hidden quota still support local Token, model, and value analysis.'}</p></div><button className="primary-btn" type="button" onClick={onSettings}><Settings2 size={15}/>{zh ? '连接账户权益' : 'Connect account benefits'}<ChevronRight size={14}/></button>
  </section>;
  if (view !== 'overview') return <section className="subscription-center subscription-center--detail" id={`subscription-${view}`}>
    {error ? <div className="limits-banner">{error}</div> : null}
    <BenefitProviderPicker providers={providers} active={active} onChange={(value) => { setSelected(value); setDrilldown(null); }} zh={zh}/>
    <AccountPicker provider={active} onChange={selectAccount} zh={zh}/>
    {active && view === 'trend' ? <BenefitTrendView provider={active} onDrilldown={openEvidence} zh={zh} currency={currency}/> : null}
    {active && view === 'activity' ? <BenefitActivityView provider={active} usageData={usageData} zh={zh} currency={currency}/> : null}
    {active && view === 'distribution' ? <BenefitDistributionView provider={active} usageData={usageData} zh={zh} currency={currency}/> : null}
    {active && view === 'records' ? <BenefitRecordsView provider={active} drilldown={drilldown?.providerId === active.id ? drilldown : null} onClearDrilldown={() => setDrilldown(null)} zh={zh} currency={currency}/> : null}
    <section className="subscription-method-note"><Info size={16}/><div><b>{zh ? '这里展示的三类数据不会混算' : 'Three evidence classes remain separate'}</b><p>{zh ? '官方额度是供应商事实，本机 Token 是 Agent 日志，容量和价值是带前提的推算。读取不到的数据明确留空，不会当成 0、免费或无限。' : 'Official quota is a provider fact, local Tokens come from Agent logs, and capacity/value are conditional estimates. Missing data stays empty—never zero, free, or unlimited.'}</p></div></section>
  </section>;
  return <section className="subscription-center" id="subscriptions">
    <section className="subscription-overview-grid">
      <article><span>{zh ? '已连接账户权益' : 'CONNECTED BENEFITS'}</span><strong>{insights.summary.subscriptionAccounts}</strong><p>{zh ? `${insights.summary.classifiedProviders} 项已标注权益类型` : `${insights.summary.classifiedProviders} classified`}</p></article>
      <article><span>{zh ? '个人付费核心' : 'PERSONALLY PAID'}</span><strong>{insights.summary.entitlementCounts.paid}</strong><p>{zh ? `月均实际支出 ${portfolioSpend(insights.summary, zh)}` : `${portfolioSpend(insights.summary, zh)} actual monthly spend`}</p></article>
      <article><span>{zh ? '零新增支出权益' : 'NON-PAID BENEFITS'}</span><strong>{insights.summary.benefitProviders}</strong><p>{zh ? '免费、活动或单位提供' : 'free, promotional, or organization-provided'}</p></article>
      <article><span>{zh ? '已关联本机 TOKEN' : 'LINKED LOCAL TOKENS'}</span><strong>{localizedCompact(insights.summary.trackedTokens, zh)}</strong><p>{zh ? `${insights.summary.trackedProviders} 个账户有本机用量` : `${localizedCount(insights.summary.trackedProviders, false, '', 'account', 'accounts')} ${insights.summary.trackedProviders === 1 ? 'has' : 'have'} local usage`}</p></article>
      <article><span>{zh ? '官方额度可观测' : 'QUOTA OBSERVABLE'}</span><strong>{insights.summary.quotaObservableProviders}<small> / {providers.length}</small></strong><p>{insights.summary.quotaUnavailableProviders ? (zh ? `${insights.summary.quotaUnavailableProviders} 项仅做本机分析` : `${insights.summary.quotaUnavailableProviders} local-analysis only`) : (zh ? '当前额度窗口均可读取' : 'all current windows observable')}</p></article>
    </section>
    <section className="panel limits-panel">
    <header className="panel-header limits-header"><div><h2>{zh ? '账户权益、官方额度与 Token 容量' : 'Benefits, official quotas & token capacity'}</h2><p>{zh ? '额度可观测时显示供应商事实；不可观测时只分析本机 Token，不猜测剩余额度' : 'Provider facts appear when observable; otherwise local Tokens remain without a guessed balance'}</p></div><div className="limits-actions"><span>{insights.summary.quotaObservableProviders}/{providers.length} {zh ? '额度可观测' : 'quota observable'}</span><button className="icon-btn" type="button" onClick={onSettings} aria-label={zh ? '账户权益设置' : 'Account benefit settings'}><Settings2 size={16}/></button><button className="icon-btn" type="button" onClick={() => onRefresh(true)} disabled={loading} aria-label={zh ? '刷新订阅额度' : 'Refresh subscription quotas'}><RefreshCw className={loading ? 'spin' : ''} size={16}/></button></div></header>
    {error ? <div className="limits-banner">{error}</div> : null}
    <div className="provider-tabs"><ProviderSelect providers={providers} activeId={active?.id} onChange={setSelected} zh={zh} ariaLabel={zh ? '账户权益平台' : 'Account benefit providers'} tabIdFor={overviewProviderTabId} controlsId={OVERVIEW_PROVIDER_PANEL_ID} renderIcon={(id, size) => <ProviderIcon id={id} size={size}/>} statusFor={(provider) => (provider.status === 'error' && !provider.quotaObservation?.bestEffort) ? { label: zh ? '需处理' : 'Issue', tone: 'red' } : provider.quotaObservation?.state === 'unavailable' ? { label: zh ? '仅本机' : 'Local only', tone: 'amber' } : null}/><AccountPicker provider={active} onChange={selectAccount} zh={zh}/></div>
    <div className="limit-card-stage" id={OVERVIEW_PROVIDER_PANEL_ID} role="tabpanel" aria-labelledby={active ? overviewProviderTabId(active.id) : undefined} tabIndex={0}>{active ? <ProviderCard provider={active} zh={zh} currency={currency} onSettings={onSettings}/> : <div className="limit-card-empty">{zh ? '没有已启用的供应商' : 'No providers enabled'}</div>}</div>
    <footer className="limits-privacy"><ShieldCheck size={13}/><span>{zh ? '凭据只在本地服务进程使用；Token 估算只读取本机统计，不进入导出文件或社区同步。' : 'Credentials stay in the local server process; token estimates use local statistics only and never enter exports or community sync.'}</span>{settings?.refreshMinutes && onRefreshIntervalChange ? <span className="refresh-inline" role="radiogroup" aria-label={zh ? '额度缓存间隔' : 'Quota cache interval'}><small>{zh ? '缓存' : 'Cache'}</small>{[5, 10, 15, 30].map((minutes) => <button key={minutes} type="button" role="radio" aria-checked={settings.refreshMinutes === minutes} className={settings.refreshMinutes === minutes ? 'active' : ''} onClick={() => onRefreshIntervalChange(minutes)}>{minutes}m</button>)}</span> : null}</footer>
    </section>
    {active ? <details className="subscription-deep-dive"><summary><span><b>{zh ? `${active.label} 深度证据与推算` : `${active.label} evidence & estimates`}</b><small>{zh ? '额度历史、容量情景和只读建议' : 'Quota history, capacity scenarios, and read-only advice'}</small></span><ChevronRight size={16}/></summary><div><SubscriptionDecisionPanel provider={active} zh={zh} currency={currency} onSettings={onSettings}/></div></details> : null}
    <details className="subscription-deep-dive"><summary><span><b>{zh ? '账户组合与续费判断' : 'Portfolio & renewal review'}</b><small>{zh ? '按需查看跨账户重叠、闲置和组合证据' : 'Expand for cross-account overlap, underuse, and portfolio evidence'}</small></span><ChevronRight size={16}/></summary><div><SubscriptionPortfolioReview review={insights.portfolio} providers={providers} zh={zh} currency={currency} onSettings={onSettings}/></div></details>
    <section className="subscription-method-note"><Info size={16}/><div><b>{zh ? '为什么有些账户只有 Token，没有“剩余额度”？' : 'Why do some accounts show Tokens without remaining quota?'}</b><p>{zh ? 'ChatGPT Pro、Claude Max 等可能只返回消耗比例，Warp、JetBrains AI 等在部分账户上甚至没有稳定可读的额度窗口。本工具只有拿到可验证比例时才反推容量；否则保留本机 Token、模型与标准 API 等价价值，但明确把官方余额标成不可观测。账号在网页端、其他设备上的用量和供应商内部权重仍不在本机证据中。' : 'Some products expose only utilization, while platforms such as Warp or JetBrains AI may expose no stable quota window for a given account. Capacity is inferred only from a verifiable ratio; otherwise local Tokens, models, and standard API-equivalent value remain while official balance is marked unobservable. Web, other-device usage, and provider weighting remain outside local evidence.'}</p></div></section>
  </section>;
}
