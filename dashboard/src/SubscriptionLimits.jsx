import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, BarChart3, Check, ChevronDown, ChevronRight, CircleAlert, Code2,
  ExternalLink, Gauge, GripVertical, Info, KeyRound, RefreshCw, Search, Settings2,
  ShieldCheck, Sparkles, Terminal, TrendingUp, X,
} from 'lucide-react';
import { compact, pluralUnit } from './format.js';
import { buildSubscriptionInsights } from './subscription-insights.js';
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

const SELECTED_BENEFIT_KEY = 'kbu.benefit.selected.v1';
const OVERVIEW_PROVIDER_PANEL_ID = 'subscription-limit-panel';
const SETTINGS_PROVIDER_PANEL_ID = 'limit-provider-settings-panel';

function idSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '-');
}

function overviewProviderTabId(providerId) {
  return `subscription-provider-tab-${idSegment(providerId)}`;
}

function settingsProviderTabId(view) {
  return `limit-provider-settings-tab-${idSegment(view)}`;
}

const PROVIDER_TONES = {
  codex: 'blue', 'kimi-code': 'amber', warp: 'violet', 'gemini-cli': 'violet',
  antigravity: 'green', 'jetbrains-ai': 'pink', 'claude-code': 'amber', cursor: 'blue',
  copilot: 'violet', opencode: 'amber', qoder: 'green', trae: 'blue', windsurf: 'blue',
};

function ProviderIcon({ id, size = 18 }) {
  if (id === 'warp') return <span className="limit-provider-icon limit-provider-icon--warp"><Terminal size={size}/></span>;
  if (id === 'jetbrains-ai') return <span className="limit-provider-icon limit-provider-icon--jetbrains"><Code2 size={size}/></span>;
  return <ToolGlyph id={id} size={size}/>;
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
  return value == null ? '—' : `${zh ? '约 ' : '~'}${compact(value)}`;
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function limitWindowDetail(window) {
  const value = finiteNumber(window?.value);
  const limit = finiteNumber(window?.limit);
  if (value == null || limit == null) return window?.detail || null;
  return `${value.toLocaleString()} / ${limit.toLocaleString()} ${window?.unit || ''}`;
}

export function resetCreditPresentation(resetCredits, zh = false) {
  const supplied = resetCredits?.availableCount;
  const count = typeof supplied === 'number' && Number.isFinite(supplied) ? supplied : null;
  if (count == null || count < 0) return {
    state: 'unknown', value: '—', detail: zh ? '可用数量不可观测' : 'Available count is not observable',
  };
  if (count === 0) return {
    state: 'zero', value: '0', detail: zh ? '已观测到可用数量为 0' : 'Observed available count: 0',
  };
  return {
    state: 'available', value: Math.floor(count).toLocaleString(), detail: null,
  };
}

function localizedCount(value, zh, cnUnit, singular, plural) {
  return zh ? `${value} ${cnUnit}` : `${value} ${pluralUnit(value, singular, plural)}`;
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

const ENTITLEMENT_TYPES = ['unknown', 'paid', 'free', 'promotion', 'organization'];

function entitlementLabel(type, zh) {
  const labels = {
    unknown: zh ? '未分类' : 'Unclassified',
    paid: zh ? '付费订阅' : 'Paid subscription',
    free: zh ? '免费额度' : 'Free allowance',
    promotion: zh ? '试用 / 活动权益' : 'Trial / promotion',
    organization: zh ? '单位 / 团队提供' : 'Organization-provided',
  };
  return labels[type] || labels.unknown;
}

function entitlementNote(type, zh) {
  if (type === 'paid') return zh ? '计入个人支出、续费与付费闲置分析。' : 'Included in personal spend, renewal, and paid-idle analysis.';
  if (type === 'free') return zh ? '保留 Token 价值分析，不计入个人支出。' : 'Usage value remains visible without entering personal spend.';
  if (type === 'promotion') return zh ? '适合记录试用、赠送和限时活动额度。' : 'For trials, grants, and time-limited promotional allowances.';
  if (type === 'organization') return zh ? '由单位或团队承担，不计入个人支出。' : 'Paid by an organization or team, not personal spend.';
  return zh ? '未分类不会被当成免费、付费或无限。' : 'Unclassified is never assumed free, paid, or unlimited.';
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
      <div><span>{zh ? '本窗口本机 TOKEN' : 'LOCAL TOKENS IN WINDOW'}</span><strong>{window.observedFrom ? compact(window.localTotals.totalTokens) : '—'}</strong></div>
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
      {scenarios.map(({ window, value }) => <article key={window.id}><span>{window.label}</span><strong>{estimateText(value.capacityTokens, zh)}</strong><small>{zh ? `剩余约 ${compact(value.remainingTokens)}` : `~${compact(value.remainingTokens)} left`}</small></article>)}
      <article><span>{zh ? '30 天等效' : '30-day equivalent'}</span><strong>{estimateText(primary?.monthlyEquivalentTokens, zh)}</strong><small>{zh ? '按最长可估算额度窗折算' : 'from longest estimable window'}</small></article>
    </div>
    <footer><span>{zh ? `本机累计 ${compact(selectedModel.totalTokens)} · 当前占该订阅 Token 的 ${(selectedModel.share * 100).toFixed(1)}%` : `${compact(selectedModel.totalTokens)} local lifetime · ${(selectedModel.share * 100).toFixed(1)}% of this subscription's tokens`}</span><small>{zh ? '按标准 API 等价成本换算；订阅方可能采用不同权重，仅用于计划与对比。' : 'Converted with standard API-equivalent cost; provider weights may differ. Use for planning and comparison only.'}</small></footer>
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
          {coords.map((point) => <circle cx={point.x} cy={point.y} r={coords.length === 1 ? 5 : 3.5} key={point.observedAt}><title>{shortObservationTime(point.observedAt, zh)} · {percentNumber(point.usedPercent)} {zh ? '已用' : 'used'} · {compact(point.localTotals.totalTokens)} local tokens</title></circle>)}
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
      ? `当前没有可验证的额度窗口，不能判断剩余比例；已识别的 ${compact(signal.localTokens)} 本机 Token 仍参与模型、价值与工作负载分析。`
      : `No verifiable quota window is available, so no remaining balance is inferred. ${compact(signal.localTokens)} local Tokens still contribute to model, value, and workload analysis.`,
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

function SubscriptionDecisionPanel({ provider, zh, onSettings }) {
  const exhausted = [...provider.windows].filter((window) => !window.stale && window.usedPercent != null && Number(window.usedPercent) >= 99)
    .sort((left, right) => (right.windowSeconds || 0) - (left.windowSeconds || 0))[0];
  const pace = [...provider.windows].filter((window) => window.pace?.projectedFinalPercent != null)
    .sort((left, right) => (right.windowSeconds || 0) - (left.windowSeconds || 0))[0];
  const isPaid = provider.subscription.isPaid;
  return <section className="subscription-decision-panel">
    <header><div><span>{zh ? '账户权益决策' : 'ACCOUNT BENEFIT DECISIONS'}</span><h2>{zh ? `${provider.label} 的用量与价值观察` : `${provider.label} usage and value`}</h2><p>{zh ? '本机 Token、官方额度和个人实际支出分别保真；读取不到官方额度时不会伪造剩余量。' : 'Local Tokens, official quota, and personal spend stay separate. Missing official quota is never replaced with a guessed balance.'}</p></div><small><ShieldCheck size={12}/>{zh ? '只读建议' : 'Read-only advice'}</small></header>
    <div className="subscription-economics-strip">
      <article><span>{zh ? '近 30 天 TOKEN' : '30D TOKENS'}</span><strong>{compact(provider.recentTotals.totalTokens)}</strong><small>{localizedCount(provider.recentTotals.requestCount.toLocaleString(), zh, '次请求', 'request', 'requests')}</small></article>
      <article><span>{isPaid ? (zh ? '实际成本 / 百万 TOKEN' : 'ACTUAL COST / 1M') : (zh ? '权益来源' : 'BENEFIT SOURCE')}</span><strong>{isPaid ? (provider.economics.costPerMillionTokens == null ? '—' : subscriptionMoney(provider.economics.costPerMillionTokens, provider.subscription.currency)) : entitlementLabel(provider.subscription.entitlementType, zh)}</strong><small>{isPaid ? (zh ? '按所填月均订阅支出' : 'from entered monthly spend') : entitlementNote(provider.subscription.entitlementType, zh)}</small></article>
      <article><span>{isPaid ? (zh ? 'API 等价价值比' : 'API-EQUIVALENT RATIO') : (zh ? 'API 等价承载价值' : 'API-EQUIVALENT THROUGHPUT')}</span><strong>{isPaid ? ratioText(provider.economics.valueRatio) : subscriptionMoney(provider.economics.apiEquivalentUsd, 'usd')}</strong><small>{isPaid ? (provider.subscription.currency === 'cny' ? (zh ? '人民币未自动换汇' : 'no automatic FX') : (zh ? '等价价值 ÷ 月均支出' : 'equivalent value ÷ spend')) : (zh ? '标准价格口径，不代表实际节省' : 'standard-price basis, not realized savings')}</small></article>
      <article><span>{zh ? '官方额度状态' : 'OFFICIAL QUOTA STATUS'}</span><strong>{exhausted ? (zh ? '已触顶' : 'EXHAUSTED') : pace ? percentNumber(pace.pace.projectedFinalPercent) : provider.quotaObservation?.state === 'historical' ? (zh ? '仅历史' : 'HISTORY') : (zh ? '不可观测' : 'UNOBSERVABLE')}</strong><small>{exhausted ? `${exhausted.label} · ${zh ? '供应商额度事实' : 'provider quota fact'}` : pace ? `${pace.label} · ${zh ? '重置时预计' : 'at reset'}` : (zh ? '本机 Token 分析仍然可用' : 'local Token analytics remain available')}</small></article>
    </div>
    <SubscriptionReviewGrid provider={provider} zh={zh} onSettings={onSettings}/>
    <div className="subscription-decision-grid">
      <QuotaHistory provider={provider} zh={zh}/>
      <section className="subscription-signals"><header><Gauge size={15}/><div><b>{zh ? '本机观察' : 'LOCAL OBSERVATIONS'}</b><span>{zh ? '提示不是账单结论，也不会自动改套餐' : 'Evidence, not billing conclusions or automatic changes'}</span></div></header><div>{provider.decisionSignals.length ? provider.decisionSignals.map((signal) => { const copy = signalCopy(signal, zh); return <article data-tone={signal.tone} key={signal.code}><i/><div><b>{copy.title}</b><p>{copy.body}</p></div></article>; }) : <article data-tone="positive"><i/><div><b>{zh ? '暂未发现明显异常' : 'No obvious issue yet'}</b><p>{zh ? '当前样本中没有明显的触顶、闲置、价值偏低或模型过度集中信号；继续积累历史后判断会更稳定。' : 'No clear limit, underuse, low-value, or concentration signal yet. More history will improve confidence.'}</p></div></article>}</div></section>
    </div>
  </section>;
}

function ProviderCard({ provider, zh, onSettings }) {
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
      <div><dt>{zh ? '本机累计 TOKEN' : 'LOCAL LIFETIME TOKENS'}</dt><dd>{compact(provider.lifetimeTotals.totalTokens)}</dd></div>
      <div><dt>{zh ? '主要模型' : 'TOP MODEL'}</dt><dd>{provider.modelRows[0]?.label || '—'}</dd></div>
      <div><dt>{zh ? '个人月均支出' : 'PERSONAL MONTHLY SPEND'}</dt><dd>{provider.subscription.isPaid ? (provider.subscription.monthlyPrice == null ? (zh ? '待填写' : 'Not set') : subscriptionMoney(provider.subscription.monthlyPrice, provider.subscription.currency, zh ? '/月' : '/mo')) : (zh ? '不计入' : 'Excluded')}</dd></div>
      <div><dt>{zh ? '近 30 天 API 等价价值' : '30D API EQUIVALENT'}</dt><dd>{subscriptionMoney(provider.recentTotals.costMicros / 1_000_000, 'usd')}</dd></div>
      <div><dt>{zh ? '更新' : 'Updated'}</dt><dd>{relativeUpdated(provider.updatedAt, now, zh)}</dd></div>
      <div><dt>{zh ? '来源' : 'Source'}</dt><dd>{provider.source || '—'}</dd></div>
    </dl>
    {quotaUnavailable ? <section className="quota-unavailable-state"><div><Gauge size={22}/><span><b>{provider.quotaObservation?.state === 'historical' ? (zh ? '当前额度不可读，仅保留历史' : 'Current quota unavailable; history retained') : (zh ? '官方额度暂不可观测' : 'Official quota is not observable')}</b><small>{provider.quotaObservation.bestEffort ? (zh ? '该平台或当前账户不一定提供稳定额度数据' : 'This platform or account may not expose stable quota data') : (zh ? '当前没有取得可验证的额度窗口' : 'No verifiable quota window is available')}</small></span></div><p>{provider.status === 'error' ? (provider.error?.message || (zh ? '额度查询失败。' : 'Quota request failed.')) : (zh ? '供应商没有返回可验证的额度比例。' : 'The provider did not return a verifiable quota ratio.')} {zh ? `这不代表免费、无限或未使用；本机 ${compact(provider.lifetimeTotals.totalTokens)} Token 仍参与价值与工作负载分析。` : `This does not mean free, unlimited, or unused; ${compact(provider.lifetimeTotals.totalTokens)} local Tokens still contribute to value and workload analysis.`}</p>{provider.status === 'error' ? <button type="button" className="ghost-btn" onClick={onSettings}>{zh ? '检查连接（可选）' : 'Check connection (optional)'}</button> : null}</section> : <div className="limit-window-list">{currentWindows.map((window) => <WindowRow window={window} tone={tone} now={now} zh={zh} key={window.id}/>)}</div>}
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
    <div><BarChart3 size={17}/><span><b>{zh ? '订阅与权益中心' : 'Subscriptions & Benefits'}</b><small>{loading ? (zh ? '正在刷新额度…' : 'Refreshing quotas…') : (zh ? `${insights.summary.entitlementCounts.paid} 项付费 · ${insights.summary.benefitProviders} 项非付费 · ${compact(insights.summary.trackedTokens)} 本机 Token` : `${insights.summary.entitlementCounts.paid} paid · ${insights.summary.benefitProviders} non-paid · ${compact(insights.summary.trackedTokens)} local Tokens`)}</small></span></div><button type="button" onClick={onOpen}>{zh ? '查看权益与容量' : 'View benefits & capacity'}<ArrowRight size={13}/></button>
  </section>;
}

export function SubscriptionCenter({ data, usageData, settings, loading, error, onRefresh, onSettings, view = 'overview', zh }) {
  const insights = useMemo(() => buildSubscriptionInsights(usageData, data, { settings }), [usageData, data, settings]);
  const providers = insights.providers;
  const [selected, setSelected] = useState(() => localStorage.getItem(SELECTED_BENEFIT_KEY) || '');
  const overviewTabs = useRef(new Map());
  const overviewTablist = useRef(null);
  useEffect(() => {
    if (!providers.some((provider) => provider.id === selected)) setSelected(providers[0]?.id || '');
  }, [providers, selected]);
  useEffect(() => {
    if (selected) localStorage.setItem(SELECTED_BENEFIT_KEY, selected);
  }, [selected]);
  useEffect(() => {
    const node = overviewTabs.current.get(selected);
    const scroller = overviewTablist.current;
    if (!node || !scroller) return;
    const left = node.offsetLeft;
    const right = left + node.offsetWidth;
    if (left < scroller.scrollLeft) scroller.scrollLeft = left;
    else if (right > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = right - scroller.clientWidth;
  }, [selected, providers.length]);
  const active = providers.find((provider) => provider.id === selected) || providers[0];
  if (loading && !data) return <section className="panel limits-panel limits-panel--loading" id="subscriptions"><div><h2>{zh ? '正在读取订阅中心' : 'Loading Subscription Center'}</h2><p>{zh ? '未启用供应商时不会发起外部网络请求。' : 'No external requests are made until a provider is enabled.'}</p></div></section>;
  if (error && !data) return <PageState className="panel limits-panel" kind="error" title={zh ? '权益数据读取失败' : 'Could not load benefit data'} body={error} action={<button className="primary-btn" type="button" onClick={() => onRefresh(true)}><RefreshCw size={14}/>{zh ? '重新读取' : 'Try again'}</button>}/>;
  if (!data?.enabled) return <section className="panel limits-panel limits-panel--empty" id="subscriptions">
    <div><h2>{zh ? '把付费核心、免费权益、官方额度与本机 Token 放在一起看' : 'Compare paid core, free benefits, official quotas, and local Tokens'}</h2><p>{zh ? '默认关闭且零联网。连接后先标注权益来源；额度不可读的平台仍可做本机 Token、模型和价值分析。' : 'Off and network-free by default. Classify each benefit after connecting; platforms with hidden quota still support local Token, model, and value analysis.'}</p></div><button className="primary-btn" type="button" onClick={onSettings}><Settings2 size={15}/>{zh ? '连接账户权益' : 'Connect account benefits'}<ChevronRight size={14}/></button>
  </section>;
  if (view !== 'overview') return <section className="subscription-center subscription-center--detail" id={`subscription-${view}`}>
    {error ? <div className="limits-banner">{error}</div> : null}
    <BenefitProviderPicker providers={providers} active={active} onChange={setSelected} zh={zh}/>
    {active && view === 'trend' ? <BenefitTrendView provider={active} zh={zh}/> : null}
    {active && view === 'activity' ? <BenefitActivityView provider={active} zh={zh}/> : null}
    {active && view === 'distribution' ? <BenefitDistributionView provider={active} zh={zh}/> : null}
    {active && view === 'records' ? <BenefitRecordsView provider={active} zh={zh}/> : null}
    <section className="subscription-method-note"><Info size={16}/><div><b>{zh ? '这里展示的三类数据不会混算' : 'Three evidence classes remain separate'}</b><p>{zh ? '官方额度是供应商事实，本机 Token 是 Agent 日志，容量和价值是带前提的推算。读取不到的数据明确留空，不会当成 0、免费或无限。' : 'Official quota is a provider fact, local Tokens come from Agent logs, and capacity/value are conditional estimates. Missing data stays empty—never zero, free, or unlimited.'}</p></div></section>
  </section>;
  return <section className="subscription-center" id="subscriptions">
    <section className="subscription-overview-grid">
      <article><span>{zh ? '已连接账户权益' : 'CONNECTED BENEFITS'}</span><strong>{providers.length}</strong><p>{zh ? `${insights.summary.classifiedProviders} 项已标注权益类型` : `${insights.summary.classifiedProviders} classified`}</p></article>
      <article><span>{zh ? '个人付费核心' : 'PERSONALLY PAID'}</span><strong>{insights.summary.entitlementCounts.paid}</strong><p>{zh ? `月均实际支出 ${portfolioSpend(insights.summary, zh)}` : `${portfolioSpend(insights.summary, zh)} actual monthly spend`}</p></article>
      <article><span>{zh ? '零新增支出权益' : 'NON-PAID BENEFITS'}</span><strong>{insights.summary.benefitProviders}</strong><p>{zh ? '免费、活动或单位提供' : 'free, promotional, or organization-provided'}</p></article>
      <article><span>{zh ? '已关联本机 TOKEN' : 'LINKED LOCAL TOKENS'}</span><strong>{compact(insights.summary.trackedTokens)}</strong><p>{zh ? `${insights.summary.trackedProviders} 个账户有本机用量` : `${localizedCount(insights.summary.trackedProviders, false, '', 'account', 'accounts')} ${insights.summary.trackedProviders === 1 ? 'has' : 'have'} local usage`}</p></article>
      <article><span>{zh ? '官方额度可观测' : 'QUOTA OBSERVABLE'}</span><strong>{insights.summary.quotaObservableProviders}<small> / {providers.length}</small></strong><p>{insights.summary.quotaUnavailableProviders ? (zh ? `${insights.summary.quotaUnavailableProviders} 项仅做本机分析` : `${insights.summary.quotaUnavailableProviders} local-analysis only`) : (zh ? '当前额度窗口均可读取' : 'all current windows observable')}</p></article>
    </section>
    <section className="panel limits-panel">
    <header className="panel-header limits-header"><div><h2>{zh ? '账户权益、官方额度与 Token 容量' : 'Benefits, official quotas & token capacity'}</h2><p>{zh ? '额度可观测时显示供应商事实；不可观测时只分析本机 Token，不猜测剩余额度' : 'Provider facts appear when observable; otherwise local Tokens remain without a guessed balance'}</p></div><div className="limits-actions"><span>{insights.summary.quotaObservableProviders}/{providers.length} {zh ? '额度可观测' : 'quota observable'}</span><button className="icon-btn" type="button" onClick={onSettings} aria-label={zh ? '账户权益设置' : 'Account benefit settings'}><Settings2 size={16}/></button><button className="icon-btn" type="button" onClick={() => onRefresh(true)} disabled={loading} aria-label={zh ? '刷新订阅额度' : 'Refresh subscription quotas'}><RefreshCw className={loading ? 'spin' : ''} size={16}/></button></div></header>
    {error ? <div className="limits-banner">{error}</div> : null}
    <nav ref={overviewTablist} className="provider-tabs" role="tablist" aria-orientation="horizontal" aria-label={zh ? '账户权益平台' : 'Account benefit providers'}>{providers.map((provider, index) => { const isActive = provider.id === active?.id; const needsAttention = provider.status === 'error' && !provider.quotaObservation?.bestEffort; return <button ref={(node) => { if (node) overviewTabs.current.set(provider.id, node); else overviewTabs.current.delete(provider.id); }} type="button" role="tab" id={overviewProviderTabId(provider.id)} aria-selected={isActive} aria-controls={OVERVIEW_PROVIDER_PANEL_ID} tabIndex={isActive ? 0 : -1} className={isActive ? 'active' : ''} data-tone={PROVIDER_TONES[provider.id]} onClick={() => setSelected(provider.id)} onKeyDown={(event) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? providers.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + providers.length) % providers.length; setSelected(providers[nextIndex].id); event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[nextIndex]?.focus(); }} key={provider.id}><ProviderIcon id={provider.id} size={16}/><span>{provider.label}</span>{needsAttention ? <small>{zh ? '需处理' : 'Issue'}</small> : provider.quotaObservation?.state === 'unavailable' ? <small>{zh ? '仅本机' : 'Local only'}</small> : null}</button>; })}</nav>
    <div className="limit-card-stage" id={OVERVIEW_PROVIDER_PANEL_ID} role="tabpanel" aria-labelledby={active ? overviewProviderTabId(active.id) : undefined} tabIndex={0}>{active ? <ProviderCard provider={active} zh={zh} onSettings={onSettings}/> : <div className="limit-card-empty">{zh ? '没有已启用的供应商' : 'No providers enabled'}</div>}</div>
    <footer className="limits-privacy"><ShieldCheck size={13}/><span>{zh ? '凭据只在本地服务进程使用；Token 估算只读取本机统计，不进入导出文件或社区同步。' : 'Credentials stay in the local server process; token estimates use local statistics only and never enter exports or community sync.'}</span>{settings?.refreshMinutes ? <small>{zh ? `额度缓存 ${settings.refreshMinutes} 分钟` : `${settings.refreshMinutes}m quota cache`}</small> : null}</footer>
    </section>
    {active ? <details className="subscription-deep-dive"><summary><span><b>{zh ? `${active.label} 深度证据与推算` : `${active.label} evidence & estimates`}</b><small>{zh ? '额度历史、容量情景和只读建议' : 'Quota history, capacity scenarios, and read-only advice'}</small></span><ChevronRight size={16}/></summary><div><SubscriptionDecisionPanel provider={active} zh={zh} onSettings={onSettings}/></div></details> : null}
    <details className="subscription-deep-dive"><summary><span><b>{zh ? '账户组合与续费判断' : 'Portfolio & renewal review'}</b><small>{zh ? '按需查看跨账户重叠、闲置和组合证据' : 'Expand for cross-account overlap, underuse, and portfolio evidence'}</small></span><ChevronRight size={16}/></summary><div><SubscriptionPortfolioReview review={insights.portfolio} providers={providers} zh={zh} onSettings={onSettings}/></div></details>
    <section className="subscription-method-note"><Info size={16}/><div><b>{zh ? '为什么有些账户只有 Token，没有“剩余额度”？' : 'Why do some accounts show Tokens without remaining quota?'}</b><p>{zh ? 'ChatGPT Pro、Claude Max 等可能只返回消耗比例，Warp、JetBrains AI 等在部分账户上甚至没有稳定可读的额度窗口。本工具只有拿到可验证比例时才反推容量；否则保留本机 Token、模型与标准 API 等价价值，但明确把官方余额标成不可观测。账号在网页端、其他设备上的用量和供应商内部权重仍不在本机证据中。' : 'Some products expose only utilization, while platforms such as Warp or JetBrains AI may expose no stable quota window for a given account. Capacity is inferred only from a verifiable ratio; otherwise local Tokens, models, and standard API-equivalent value remain while official balance is marked unobservable. Web, other-device usage, and provider weighting remain outside local evidence.'}</p></div></section>
  </section>;
}

function Toggle({ checked, onChange, label, disabled = false }) {
  return <label className={`switch-control${disabled ? ' disabled' : ''}`}><input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)}/><span/><em>{label}</em></label>;
}

function secretLabel(provider, zh) {
  return provider.secretKind || (zh ? '登录凭据' : 'Credential');
}

function detectionClass(state) {
  if (state === 'detected' || state === 'configured') return 'ready';
  if (state === 'expired') return 'warning';
  if (state === 'unavailable') return 'muted';
  return 'neutral';
}

function authLabel(mode, zh) {
  if (mode === 'local') return zh ? '自动读取本机登录' : 'Detect local login';
  if (mode === 'environment') return zh ? '环境变量' : 'Environment variable';
  return zh ? '安全保存到钥匙串' : 'Save to Keychain';
}

function SetupSteps({ provider, zh }) {
  if (!['opencode', 'qoder', 'cursor'].includes(provider.id)) return null;
  return <div className="provider-setup-steps"><b>{zh ? '不会配？照着 3 步做' : 'Three-step setup'}</b><ol>
    <li>{zh ? <><a href={provider.dashboardUrl} target="_blank" rel="noreferrer">打开并登录 {provider.label}<ExternalLink size={11}/></a></> : <>Open and sign in to {provider.label}</>}</li>
    <li>{zh ? '打开浏览器开发者工具 → 网络（Network），刷新用量页并点开任意同域请求。' : 'Open DevTools → Network, refresh the usage page, and select a same-domain request.'}</li>
    <li>{zh ? '复制“请求标头”里的 Cookie 整行，或直接复制该请求的 cURL；两种格式都可粘贴。' : 'Copy the Cookie request header or the request as cURL; either format works.'}</li>
  </ol></div>;
}

export function LimitSettingsDialog({ open, settings, onClose, onSave, saving, zh }) {
  const dialogRef = useRef(null);
  const [draft, setDraft] = useState(settings);
  const [secrets, setSecrets] = useState({});
  const [clearSecrets, setClearSecrets] = useState([]);
  const [message, setMessage] = useState('');
  const [validationErrors, setValidationErrors] = useState([]);
  const [view, setView] = useState('detected');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState('');
  const [draggingId, setDraggingId] = useState('');
  const [dragOverId, setDragOverId] = useState('');
  useEffect(() => { if (open) { setDraft(settings); setSecrets({}); setClearSecrets([]); setMessage(''); setValidationErrors([]); setView('detected'); setQuery(''); setExpanded(''); setDraggingId(''); setDragOverId(''); } }, [open, settings]);
  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const focusable = () => [...(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') || [])];
    const key = (event) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key); document.body.classList.add('dialog-open');
    return () => {
      document.removeEventListener('keydown', key);
      document.body.classList.remove('dialog-open'); previousFocus?.focus?.();
    };
  }, [open, onClose]);
  if (!open || !draft) return null;
  const updateProvider = (id, patch) => setDraft((current) => ({
    ...current, providers: { ...current.providers, [id]: { ...current.providers[id], ...patch } },
  }));
  const submit = async () => {
    setMessage('');
    setValidationErrors([]);
    try {
      const result = await onSave({ settings: draft, secrets, clearSecrets });
      const failures = result?.providers?.filter((provider) => (
        provider.status === 'error' && provider.quotaCoverage !== 'best-effort'
      )) || [];
      setValidationErrors(failures);
      if (failures.length) {
        setMessage(zh
          ? `设置已保存，但 ${failures.map((provider) => provider.label).join('、')} 仍需处理。请按下方提示修正后重试。`
          : `Saved, but ${failures.map((provider) => provider.label).join(', ')} still need attention.`);
        setExpanded(failures[0].id);
      } else onClose();
    }
    catch (reason) { setMessage(reason?.message || String(reason)); }
  };
  const ready = draft.catalog.filter((provider) => ['detected', 'configured'].includes(provider.detection?.state));
  const enabledCount = Object.values(draft.providers).filter((provider) => provider.enabled).length;
  const settingsTabs = [
    ['detected', zh ? '已检测' : 'Detected'],
    ['all', zh ? '全部平台' : 'All platforms'],
  ];
  const visible = draft.catalog.filter((provider) => {
    const matches = !query || `${provider.label} ${provider.description}`.toLowerCase().includes(query.toLowerCase());
    if (!matches) return false;
    if (view === 'detected') return ['detected', 'configured'].includes(provider.detection?.state) || draft.providers[provider.id]?.enabled;
    return true;
  });
  const catalogById = new Map(draft.catalog.map((provider) => [provider.id, provider]));
  const orderedEnabled = draft.providerOrder
    .map((id) => catalogById.get(id))
    .filter((provider) => provider && draft.providers[provider.id]?.enabled);
  const reorderProvider = (activeId, overId) => setDraft((current) => reorderEnabledProviders(current, activeId, overId));
  const finishDrag = () => { setDraggingId(''); setDragOverId(''); };
  const enableDetected = () => setDraft((current) => ({
    ...current, enabled: true,
    providers: Object.fromEntries(Object.entries(current.providers).map(([id, item]) => [id, {
      ...item, enabled: item.enabled || ready.some((provider) => provider.id === id),
    }])),
  }));
  return <div className="dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section ref={dialogRef} className="dialog dialog--limit-settings" role="dialog" aria-modal="true" aria-label={zh ? '账户权益与额度设置' : 'Account benefit and quota settings'}><header><div><h2>{zh ? '连接并标注账户权益' : 'Connect and classify account benefits'}</h2><p>{zh ? '先自动检测账户，再标注付费、免费、活动或单位权益。额度读取失败不影响本机 Token 分析。' : 'Detect accounts first, then classify them as paid, free, promotional, or organization-provided. Quota failures never block local Token analytics.'}</p></div><button autoFocus className="icon-btn" type="button" onClick={onClose} aria-label={zh ? '关闭账户权益设置' : 'Close account benefit settings'}><X size={18}/></button></header>
    <div className="limit-settings-body"><section className="limit-setup-summary"><div className="limit-setup-score"><Sparkles size={18}/><div><b>{zh ? `自动检测到 ${ready.length} 个账户` : `${localizedCount(ready.length, false, '', 'account', 'accounts')} detected`}</b><span>{zh ? '无需复制 Token，推荐直接启用已检测账户。' : 'No token copying needed for detected accounts.'}</span></div></div><button type="button" onClick={enableDetected} disabled={!ready.length}><Check size={14}/>{zh ? '一键启用已检测' : 'Enable detected'}</button><div className="limit-master-inline"><span>{zh ? `${enabledCount} 个已选择` : `${enabledCount} selected`}</span><Toggle checked={draft.enabled} onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))} label={draft.enabled ? (zh ? '总开关已开启' : 'Master on') : (zh ? '总开关已关闭' : 'Master off')}/></div></section>
      <section className="limit-provider-toolbar"><div role="tablist" aria-orientation="horizontal" aria-label={zh ? '筛选账户平台' : 'Filter account providers'}>{settingsTabs.map(([id, label], index) => <button type="button" role="tab" id={settingsProviderTabId(id)} aria-controls={SETTINGS_PROVIDER_PANEL_ID} aria-selected={view === id} tabIndex={view === id ? 0 : -1} className={view === id ? 'active' : ''} onClick={() => setView(id)} onKeyDown={(event) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? settingsTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + settingsTabs.length) % settingsTabs.length; setView(settingsTabs[nextIndex][0]); event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[nextIndex]?.focus(); }} key={id}>{label}</button>)}</div><label><Search size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '搜索平台' : 'Search providers'}/></label></section>
      <div className="limit-provider-settings" id={SETTINGS_PROVIDER_PANEL_ID} role="tabpanel" aria-labelledby={settingsProviderTabId(view)} tabIndex={0}>{visible.map((provider) => { const item = draft.providers[provider.id]; const unavailable = provider.quotaSupport === 'unavailable'; const isExpanded = expanded === provider.id; const setEnabled = (enabled) => { const patch = { enabled }; if (enabled && provider.quotaSupport === 'manual' && provider.supportsKeychain) patch.authMode = 'keychain'; updateProvider(provider.id, patch); if (enabled) { setDraft((current) => ({ ...current, enabled: true })); setExpanded(provider.id); } }; return <article className={`${item.enabled ? 'enabled' : ''} ${isExpanded ? 'expanded' : ''} ${unavailable ? 'unavailable' : ''}`} key={provider.id}><div className="provider-setting-head"><ProviderIcon id={provider.id}/><button type="button" className="provider-setting-copy" onClick={() => !unavailable && setExpanded(isExpanded ? '' : provider.id)}><span><b>{provider.label}{provider.popular ? <em>{zh ? '热门' : 'Popular'}</em> : null}</b><small>{provider.description}</small></span><ChevronDown className={isExpanded ? 'expanded' : ''} size={15}/></button><Toggle checked={item.enabled} onChange={setEnabled} label={zh ? `启用 ${provider.label}` : `Enable ${provider.label}`} disabled={unavailable}/></div><div className={`provider-detection ${detectionClass(provider.detection?.state)}`}>{['detected', 'configured'].includes(provider.detection?.state) ? <Check size={12}/> : <CircleAlert size={12}/>}<span>{provider.detection?.label}</span>{provider.detection?.detail ? <small>{provider.detection.detail}</small> : null}</div>{unavailable ? <div className="provider-unavailable-copy"><p>{provider.localHint}</p>{provider.dashboardUrl ? <a href={provider.dashboardUrl} target="_blank" rel="noreferrer">{zh ? '打开官方页面' : 'Open official site'}<ExternalLink size={11}/></a> : null}</div> : null}{isExpanded && !unavailable ? <div className="provider-config-panel"><p>{provider.localHint}</p>{provider.authModes.length > 1 ? <div className="provider-auth-modes" role="radiogroup" aria-label={zh ? '凭据来源' : 'Credential source'}>{provider.authModes.map((mode) => <button type="button" role="radio" aria-checked={item.authMode === mode} className={item.authMode === mode ? 'active' : ''} onClick={() => updateProvider(provider.id, { authMode: mode })} disabled={mode === 'keychain' && !provider.supportsKeychain} key={mode}>{item.authMode === mode ? <Check size={11}/> : null}{authLabel(mode, zh)}</button>)}</div> : null}<SetupSteps provider={provider} zh={zh}/><div className="provider-auth-fields">{item.authMode === 'environment' ? <label><span>{zh ? '环境变量名（凭据内容不要填在这里）' : 'Environment variable name—not the secret itself'}</span><input value={item.environmentVariable} onChange={(event) => updateProvider(provider.id, { environmentVariable: event.target.value })} placeholder={provider.defaultEnvironmentVariable || 'TOKEN'}/><small>{zh ? `在启动看板前设置 ${item.environmentVariable || provider.defaultEnvironmentVariable}，保存后会自动验证。` : 'Set this variable before starting the dashboard; saving will verify it.'}</small></label> : null}{item.authMode === 'keychain' ? <label><span>{secretLabel(provider, zh)}</span><input type="password" autoComplete="off" spellCheck="false" value={secrets[provider.id] || ''} onChange={(event) => setSecrets((current) => ({ ...current, [provider.id]: event.target.value }))} placeholder={provider.hasSecret ? (zh ? '已安全保存 · 留空保持不变' : 'Saved securely · leave blank to keep') : (zh ? '粘贴 Cookie、Token 或 cURL 片段' : 'Paste cookie, token, or cURL snippet')} disabled={!provider.supportsKeychain}/><small>{zh ? '只会提交给 127.0.0.1 本地服务，并保存到系统钥匙串。' : 'Sent only to the local 127.0.0.1 service and stored in Keychain.'}</small>{provider.hasSecret ? <button type="button" onClick={() => setClearSecrets((current) => current.includes(provider.id) ? current.filter((id) => id !== provider.id) : [...current, provider.id])}>{clearSecrets.includes(provider.id) ? (zh ? '撤销清除' : 'Keep secret') : (zh ? '清除已保存凭据' : 'Clear saved secret')}</button> : null}</label> : null}{provider.extraFields?.includes('workspaceId') ? <label><span>{zh ? 'Workspace ID 或账单页链接（可选）' : 'Workspace ID or billing URL (optional)'}</span><input value={item.workspaceId} onChange={(event) => updateProvider(provider.id, { workspaceId: event.target.value })} placeholder="https://opencode.ai/workspace/wrk_…/billing"/></label> : null}{provider.extraFields?.includes('site') ? <label><span>{zh ? 'Qoder 站点' : 'Qoder site'}</span><select value={item.site} onChange={(event) => updateProvider(provider.id, { site: event.target.value })}><option value="international">qoder.com · 国际站</option><option value="china">qoder.com.cn · 中国站</option></select></label> : null}{provider.extraFields?.includes('customPath') ? <label><span>{zh ? 'IDE 配置目录（通常留空）' : 'IDE config directory (usually blank)'}</span><input value={item.customPath} onChange={(event) => updateProvider(provider.id, { customPath: event.target.value })} placeholder="~/Library/Application Support/JetBrains/WebStorm2026.2"/></label> : null}</div>{provider.dashboardUrl ? <a className="provider-dashboard-link" href={provider.dashboardUrl} target="_blank" rel="noreferrer">{zh ? `打开 ${provider.label} 用量页` : `Open ${provider.label} usage`}<ExternalLink size={11}/></a> : null}</div> : null}</article>; })}</div>
      {orderedEnabled.length ? <section className="subscription-cost-settings">
        <header><div><b>{zh ? '账户权益来源与实际支出' : 'Benefit source and actual spend'}</b><span>{zh ? '大多数人会同时使用少数付费订阅和多项免费/活动权益。只有明确标注为“付费订阅”的账户才计入个人支出、续费和付费闲置分析。' : 'Most people mix a few paid subscriptions with several free or promotional benefits. Only explicitly paid accounts enter personal spend, renewal, and paid-idle analysis.'}</span></div></header>
        <div>{orderedEnabled.map((provider) => { const item = draft.providers[provider.id]; const isPaid = item.entitlementType === 'paid'; const setEntitlementType = (entitlementType) => updateProvider(provider.id, entitlementType === 'paid' ? { entitlementType } : { entitlementType, subscriptionPrice: null, renewsAt: '' }); return <article className={`entitlement-${item.entitlementType || 'unknown'}`} key={provider.id}><div className="subscription-entitlement-head"><span className="subscription-cost-provider"><ProviderIcon id={provider.id} size={15}/><span><b>{provider.label}</b><small>{entitlementNote(item.entitlementType, zh)}</small></span></span><label className="entitlement-kind-field"><span>{zh ? '权益类型' : 'Benefit type'}</span><select value={item.entitlementType || 'unknown'} onChange={(event) => setEntitlementType(event.target.value)}>{ENTITLEMENT_TYPES.map((type) => <option value={type} key={type}>{entitlementLabel(type, zh)}</option>)}</select></label></div>{isPaid ? <div className="subscription-paid-fields"><label><span>{zh ? '实际价格' : 'Actual price'}</span><input type="number" inputMode="decimal" min="0" max="1000000" step="0.01" value={item.subscriptionPrice ?? ''} onChange={(event) => updateProvider(provider.id, { subscriptionPrice: event.target.value === '' ? null : Number(event.target.value) })} placeholder="—"/></label><label><span>{zh ? '货币' : 'Currency'}</span><select value={item.subscriptionCurrency} onChange={(event) => updateProvider(provider.id, { subscriptionCurrency: event.target.value })}><option value="usd">USD · $</option><option value="cny">CNY · ¥</option></select></label><label><span>{zh ? '账期' : 'Cycle'}</span><select value={item.billingCycle} onChange={(event) => updateProvider(provider.id, { billingCycle: event.target.value })}><option value="monthly">{zh ? '每月' : 'Monthly'}</option><option value="yearly">{zh ? '每年' : 'Yearly'}</option></select></label><label><span>{zh ? '下次续费' : 'Renewal'}</span><input type="date" value={item.renewsAt || ''} onChange={(event) => updateProvider(provider.id, { renewsAt: event.target.value })}/></label></div> : <p className="subscription-entitlement-note">{entitlementNote(item.entitlementType, zh)}</p>}</article>; })}</div>
      </section> : null}
      <section className="limit-provider-order">
        <header><div><b>{zh ? '额度显示顺序' : 'Quota display order'}</b><span>{zh ? '拖动右侧手柄即可排序；触屏也可拖动，结果保存在本机。' : 'Drag the handle to reorder. Touch is supported and the result stays on this device.'}</span></div><small>{zh ? `${orderedEnabled.length} 个已启用平台` : `${orderedEnabled.length} enabled`}</small></header>
        {orderedEnabled.length ? <ol onMouseMove={(event) => { if (!draggingId) return; const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-provider-order-id]')?.dataset.providerOrderId; if (!target || target === draggingId) return; setDragOverId(target); reorderProvider(draggingId, target); }} onMouseUp={finishDrag}>{orderedEnabled.map((provider, index) => <li key={provider.id} data-provider-order-id={provider.id} className={`${draggingId === provider.id ? 'dragging' : ''} ${dragOverId === provider.id && draggingId !== provider.id ? 'drag-over' : ''}`}>
          <span className="provider-order-index">{String(index + 1).padStart(2, '0')}</span>
          <span className="provider-order-label"><ProviderIcon id={provider.id} size={15}/><b>{provider.label}</b></span>
          <button type="button" className="provider-order-handle" onMouseDown={() => { setDraggingId(provider.id); setDragOverId(provider.id); }} onPointerDown={(event) => { if (event.button !== 0 && event.button !== -1) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDraggingId(provider.id); setDragOverId(provider.id); }} onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-provider-order-id]')?.dataset.providerOrderId; if (!target || target === provider.id) return; setDragOverId(target); reorderProvider(provider.id, target); }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); finishDrag(); }} onPointerCancel={finishDrag} onKeyDown={(event) => { const direction = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : 0; if (!direction) return; event.preventDefault(); setDraft((current) => moveEnabledProvider(current, provider.id, direction)); }} aria-label={zh ? `拖动调整 ${provider.label}；也可按方向键移动` : `Drag to reorder ${provider.label}; arrow keys also work`} title={zh ? '拖动排序' : 'Drag to reorder'}><GripVertical size={16}/></button>
        </li>)}</ol> : <p>{zh ? '启用至少一个平台后即可调整顺序。' : 'Enable a provider to arrange its position.'}</p>}
      </section>
      <section className="refresh-setting"><span>{zh ? '自动刷新间隔' : 'Refresh interval'}</span><div>{[5, 10, 15, 30].map((minutes) => <button type="button" className={draft.refreshMinutes === minutes ? 'active' : ''} onClick={() => setDraft((current) => ({ ...current, refreshMinutes: minutes }))} key={minutes}>{minutes}m</button>)}</div><small>{zh ? '手动刷新始终绕过缓存；只有已启用平台才联网。' : 'Manual refresh bypasses cache; only enabled providers access the network.'}</small></section>
      <div className="limit-security-note"><ShieldCheck size={17}/><div><b>{zh ? '敏感信息边界' : 'Sensitive-data boundary'}</b><p>{zh ? '浏览器只提交你主动输入的凭据一次；服务端把手动凭据交给 macOS 钥匙串，普通 config.json 只保存开关、来源和变量名。接口响应永远不包含 Token 或 Cookie，只显示不暴露主目录的来源提示。' : 'The browser submits manually entered secrets once. The local server stores them in macOS Keychain; config.json keeps only toggles, source modes, and variable names. Responses never contain tokens or cookies and show only home-redacted source hints.'}</p></div></div>{validationErrors.length ? <div className="provider-validation-errors" role="alert">{validationErrors.map((provider) => <div key={provider.id}><CircleAlert size={14}/><span><b>{provider.label}</b><small>{provider.error?.message || (zh ? '连接验证失败' : 'Connection validation failed')}</small></span><button type="button" onClick={() => { setView('all'); setExpanded(provider.id); }}>{zh ? '去修复' : 'Fix'}</button></div>)}</div> : null}{message ? <p className="dialog-error" role="alert">{message}</p> : null}</div>
    <footer className="dialog-actions"><button type="button" className="ghost-btn" onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button type="button" className="primary-btn" onClick={submit} disabled={saving}>{saving ? <RefreshCw className="spin" size={14}/> : <KeyRound size={14}/>} {zh ? '保存并刷新' : 'Save & refresh'}</button></footer>
  </section></div>;
}
