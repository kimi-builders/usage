import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, BarChart3, ChevronLeft, ChevronRight, CircleAlert, Clock3, FileText, LayoutDashboard, ShieldCheck } from 'lucide-react';
import { CHART_COLORS, CONSUMPTION_PALETTE } from './chart-colors.js';
import { compactNumber, displayDollars, percent, pluralUnit } from './format.js';
import { ProviderSelect } from './provider-select.jsx';
import { HeatModeTabs, WeekPager, storedHeatMode, storeHeatMode } from './heat-controls.jsx';
import { addLocalWeeks, firstDataWeekStart, localWeekEnd, localWeekStart, weekLabel } from './week.js';
import {
  BENEFIT_VIEW_RANGES, buildSubscriptionViewUsage, filterBenefitUsageRecords,
  localEvidenceDayKey, nearestBenefitObservation,
} from './subscription-insights.js';

const CHART_LEFT = 42;
const CHART_RIGHT = 880;
const CHART_BOTTOM = 176;
const CHART_TOKEN_HEIGHT = 128;
const DAY_MS = 86_400_000;
const TREND_RANGE_MS = 30 * DAY_MS;
const TOKEN_BREAKDOWN = [
  ['inputTokens', '输入', 'Input', CHART_COLORS.input],
  ['cacheWriteInputTokens', '缓存写', 'Cache write', CHART_COLORS.cacheWrite],
  ['cacheReadInputTokens', '缓存读', 'Cache read', CHART_COLORS.cache],
  ['outputTokens', '输出', 'Output', CHART_COLORS.output],
  ['reasoningOutputTokens', '推理', 'Reasoning', CHART_COLORS.reasoning],
];
const TOKEN_MIX_COLORS = {
  input: CHART_COLORS.input,
  cache: CHART_COLORS.cache,
  output: CHART_COLORS.output,
  reasoning: CHART_COLORS.reasoning,
};

const BENEFIT_RANGE_LABELS = {
  '30d': ['近 30 天', 'Last 30 days'],
  '90d': ['近 90 天', 'Last 90 days'],
  all: ['全部', 'All history'],
};

function localizedCompact(value, zh) {
  return compactNumber(value, zh ? 'zh' : 'en');
}

function storedBenefitRange(view) {
  const value = localStorage.getItem(`kbu.benefit.${view}-range.v1`);
  return BENEFIT_VIEW_RANGES.includes(value) ? value : 'all';
}

function benefitRangeLabel(range, zh) {
  return BENEFIT_RANGE_LABELS[range]?.[zh ? 0 : 1] || BENEFIT_RANGE_LABELS.all[zh ? 0 : 1];
}

function BenefitRangeControl({ value, onChange, zh, label }) {
  const change = (range) => {
    onChange(range);
  };
  return <div className="benefit-range-control" role="radiogroup" aria-label={label}>
    {BENEFIT_VIEW_RANGES.map((range) => <button type="button" role="radio" aria-checked={value === range} className={value === range ? 'active' : ''} onClick={() => change(range)} key={range}>{benefitRangeLabel(range, zh)}</button>)}
  </div>;
}

function money(value, currency) {
  return displayDollars(value, currency);
}

function requestUnit(value, zh) {
  return zh ? '次请求' : pluralUnit(value, 'request');
}

function dateLabel(value, zh, includeTime = false) {
  const options = includeTime
    ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
    : { month: 'numeric', day: 'numeric' };
  return new Date(value).toLocaleString(zh ? 'zh-CN' : 'en-US', options);
}

function parsedTime(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function officialUsedPercent(point) {
  const used = finiteNumber(point?.usedPercent);
  if (used != null) return Math.max(0, Math.min(100, used));
  const remaining = finiteNumber(point?.remainingPercent);
  return remaining == null ? null : Math.max(0, Math.min(100, 100 - remaining));
}

function cacheHit(row) {
  const input = (row?.inputTokens || 0) + (row?.cacheWriteInputTokens || 0) + (row?.cacheReadInputTokens || 0);
  return input > 0 ? percent((row.cacheReadInputTokens || 0) / input) : '—';
}

function tokenBreakdownRows(row, zh, combineInput = false) {
  if (combineInput) return [
    [zh ? '输入（含缓存写）' : 'Input + cache write', (row?.inputTokens || 0) + (row?.cacheWriteInputTokens || 0), CHART_COLORS.input],
    [zh ? '缓存读' : 'Cache read', row?.cacheReadInputTokens || 0, CHART_COLORS.cache],
    [zh ? '输出' : 'Output', row?.outputTokens || 0, CHART_COLORS.output],
    [zh ? '推理' : 'Reasoning', row?.reasoningOutputTokens || 0, CHART_COLORS.reasoning],
  ];
  return TOKEN_BREAKDOWN.map(([field, cn, en, color]) => [zh ? cn : en, row?.[field] || 0, color]);
}

function TokenBreakdown({ row, zh, combineInput = false }) {
  return <div className="trend-tooltip-breakdown">{tokenBreakdownRows(row, zh, combineInput).map(([label, value, color]) => <span key={label}><i style={{ background: color }}/><em>{label}</em><b>{localizedCompact(value, zh)}</b></span>)}</div>;
}

// Dock the tooltip to the side opposite the pointer so it never covers the
// bars the reader is sweeping toward next.
function tooltipLeft(event, viewport, tipWidth) {
  if (!viewport) return 8;
  const container = viewport.getBoundingClientRect();
  const target = event.currentTarget.getBoundingClientRect();
  const center = target.left + target.width / 2 - container.left;
  return center < container.width / 2 ? Math.max(8, container.width - tipWidth - 8) : 8;
}

function localTrendFacts(item, zh, currency) {
  const facts = [
    `${localizedCompact(Number(item?.requestCount || 0), zh)} ${requestUnit(item?.requestCount || 0, zh)}`,
    `${zh ? '标准 API 等价估算' : 'Standard API-equivalent estimate'} ${money((item?.costMicros || 0) / 1e6, currency)}`,
    zh ? '本机归因事实' : 'Local attributed facts',
  ];
  if (item?.officialObservation) facts.push(zh
    ? `官方观测 ${dateLabel(item.officialObservation.observedAt, true, true)}`
    : `Official observation ${dateLabel(item.officialObservation.observedAt, false, true)}`);
  return facts.join(' · ');
}

function nextLocalMidnight(time) {
  const date = new Date(time);
  date.setDate(date.getDate() + 1);
  return date.getTime();
}

function providerTabId(providerId) {
  return `benefit-provider-tab-${String(providerId).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

const PROVIDER_PANEL_ID = 'benefit-provider-analysis-panel';

function providerPanelProps(provider) {
  return {
    id: PROVIDER_PANEL_ID,
    role: 'tabpanel',
    'aria-labelledby': providerTabId(provider.id),
    tabIndex: 0,
  };
}

function EmptyEvidence({ title, body, zh }) {
  return <div className="benefit-empty-evidence"><CircleAlert size={22}/><div><b>{title}</b><p>{body}</p><small>{zh ? '缺失不会按 0 处理，也不会参与趋势判断。' : 'Missing evidence is never treated as zero or used for trend decisions.'}</small></div></div>;
}

export function BenefitProviderPicker({ providers, active, onChange, zh }) {
  return <section className="benefit-provider-picker">
    <div><span>{zh ? '分析账户' : 'ANALYSIS ACCOUNT'}</span><b>{zh ? '以下页面只分析当前订阅' : 'The pages below analyze one benefit at a time'}</b></div>
    <div>
      <ProviderSelect providers={providers} activeId={active?.id} onChange={onChange} zh={zh}
        ariaLabel={zh ? '选择权益账户' : 'Choose benefit account'} tabIdFor={providerTabId} controlsId={PROVIDER_PANEL_ID}
        statusFor={(provider) => (provider.quotaObservation?.state !== 'current' ? { label: zh ? '仅本机' : 'Local only', tone: 'amber' } : null)}/>
    </div>
  </section>;
}

function buildTrendPlot(timeline, points) {
  const local = timeline.flatMap((item) => {
    const start = parsedTime(item.key);
    if (start == null) return [];
    const end = nextLocalMidnight(start);
    return [{ ...item, start, end, time: start + (end - start) / 2 }];
  });
  const quota = points.flatMap((point) => {
    const time = parsedTime(point.observedAt);
    const usedPercent = officialUsedPercent(point);
    return time == null || usedPercent == null ? [] : [{ ...point, time, usedPercent }];
  });
  const bounds = [
    ...local.flatMap((item) => [item.start, item.end]),
    ...quota.map((point) => point.time),
  ];
  if (!bounds.length) return { domain: null, local: [], quota: [] };
  const evidenceStart = Math.min(...bounds);
  const evidenceEnd = Math.max(...bounds);
  const domainStart = evidenceStart === evidenceEnd ? evidenceStart - DAY_MS / 2 : evidenceStart;
  const domainEnd = evidenceStart === evidenceEnd ? evidenceEnd + DAY_MS / 2 : evidenceEnd;
  const span = Math.max(1, domainEnd - domainStart);
  const x = (time) => CHART_LEFT + (time - domainStart) / span * (CHART_RIGHT - CHART_LEFT);
  const positionedQuota = quota.map((point) => ({
    ...point,
    x: x(point.time),
    y: CHART_BOTTOM - point.usedPercent * 1.32,
  }));
  const positionedLocal = local.map((item) => ({
    ...item,
    x: x(item.time),
    officialObservation: positionedQuota.filter((point) => point.time >= item.start && point.time < item.end).at(-1) || null,
  }));
  return {
    domain: { start: evidenceStart, end: evidenceEnd, span },
    local: positionedLocal,
    quota: positionedQuota,
  };
}

function localTrendLabel(item, zh, currency) {
  const parts = zh
    ? [dateLabel(item.key, true), `本机 Token：${localizedCompact(item.totalTokens, zh)}`, `请求：${localizedCompact(Number(item.requestCount || 0), zh)}`, `API 等价价值：${money(item.costMicros / 1e6, currency)}`]
    : [dateLabel(item.key, false), `Local Tokens: ${localizedCompact(item.totalTokens, zh)}`, `Requests: ${localizedCompact(Number(item.requestCount || 0), zh)}`, `API-equivalent value: ${money(item.costMicros / 1e6, currency)}`];
  if (item.officialObservation) {
    parts.push(zh
      ? `官方已用：${item.officialObservation.usedPercent.toFixed(1)}%（${dateLabel(item.officialObservation.observedAt, true, true)}观测）`
      : `Official used: ${item.officialObservation.usedPercent.toFixed(1)}% (observed ${dateLabel(item.officialObservation.observedAt, false, true)})`);
  }
  return parts.join(' · ');
}

function quotaTrendLabel(point, zh, currency) {
  const localObserved = point.localObserved
    ?? finiteNumber(point.localObservedCoverage ?? point.localCoverage) > 0;
  const localTotals = point.localTotals;
  const parts = zh
    ? [dateLabel(point.observedAt, true, true), `官方已用：${point.usedPercent.toFixed(1)}%`]
    : [dateLabel(point.observedAt, false, true), `Official used: ${point.usedPercent.toFixed(1)}%`];
  if (localObserved && localTotals) {
    parts.push(...(zh
      ? [`本机 Token：${localizedCompact(localTotals.totalTokens, zh)}`, `请求：${localizedCompact(Number(localTotals.requestCount || 0), zh)}`, `API 等价价值：${money(localTotals.costMicros / 1e6, currency)}`]
      : [`Local Tokens: ${localizedCompact(localTotals.totalTokens, zh)}`, `Requests: ${localizedCompact(Number(localTotals.requestCount || 0), zh)}`, `API-equivalent value: ${money(localTotals.costMicros / 1e6, currency)}`]));
    if (point.localEvidenceState === 'local-stale') {
      parts.push(zh ? '本机快照早于额度观测，不参与跨源推算' : 'Local snapshot predates this quota observation; excluded from cross-source estimates');
    }
  } else {
    parts.push(zh ? '本机 Token、请求与 API 等价价值：未观测' : 'Local Tokens, requests, and API-equivalent value: not observed');
  }
  return parts.join(' · ');
}

function QuotaLine({ points, zh, currency, onActivate, onDeactivate, onDrilldown }) {
  if (!points.length) return null;
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  // Dense 15-minute observations overlap into an ambiguous strip on a 30-day chart;
  // the line keeps every point, the interactive dots are thinned to ~48 and always
  // include the latest observation (the most likely drilldown target).
  const dotStep = Math.max(1, Math.ceil(points.length / 48));
  const dots = points.filter((_, index) => index % dotStep === 0 || index === points.length - 1);
  return <g data-evidence="official">
    {points.length > 1 ? <path className="benefit-quota-line" d={path}/> : null}
    {dots.map((point, index) => {
      const label = quotaTrendLabel(point, zh, currency);
      return <circle
        className="benefit-quota-point"
        cx={point.x}
        cy={point.y}
        r={points.length === 1 ? 5 : 4}
        role="button"
        tabIndex={0}
        aria-label={label}
        onMouseEnter={(event) => onActivate?.(event, { kind: 'quota', datum: point })}
        onFocus={(event) => onActivate?.(event, { kind: 'quota', datum: point })}
        onBlur={onDeactivate}
        onClick={() => onDrilldown?.({ kind: 'quota', observedAt: point.observedAt })}
        onKeyDown={(event) => {
          if (!['Enter', ' '].includes(event.key)) return;
          event.preventDefault();
          onDrilldown?.({ kind: 'quota', observedAt: point.observedAt });
        }}
        key={`${point.observedAt}-${index}`}
      />;
    })}
  </g>;
}

function BenefitTrendTooltip({ active, zh, currency }) {
  if (!active) return null;
  if (active.kind === 'local') {
    const item = active.datum;
    return <aside className="trend-tooltip benefit-trend-tooltip" role="tooltip" style={{ left: active.left }}>
      <strong>{dateLabel(item.key, zh)}</strong>
      <div className="trend-tooltip-total"><span>{localizedCompact(item.totalTokens, zh)} tokens</span><small>{zh ? '命中率' : 'hit'} {cacheHit(item)}</small></div>
      <TokenBreakdown row={item} zh={zh}/>
      <footer>{localTrendFacts(item, zh, currency)}</footer>
      <span className="benefit-tooltip-affordance">{zh ? '点击查看证据 →' : 'Click to view evidence →'}</span>
    </aside>;
  }
  const point = active.datum;
  const localObserved = point.localObserved ?? finiteNumber(point.localObservedCoverage ?? point.localCoverage) > 0;
  const localTotals = localObserved ? point.localTotals : null;
  return <aside className="trend-tooltip benefit-trend-tooltip" role="tooltip" style={{ left: active.left }}>
    <strong>{dateLabel(point.observedAt, zh, true)}</strong>
    <div className="trend-tooltip-total"><span>{zh ? '官方已用' : 'Official used'} {point.usedPercent.toFixed(1)}%</span><small>{zh ? '额度事实' : 'quota fact'}</small></div>
    {localTotals ? <TokenBreakdown row={localTotals} zh={zh}/> : <p className="trend-tooltip-note">{zh ? '该观测时刻没有可连接的本机 Token 事实。' : 'No joinable local Token facts at this observation.'}</p>}
    <footer>{localTotals ? `${localizedCompact(Number(localTotals.requestCount || 0), zh)} ${requestUnit(localTotals.requestCount || 0, zh)} · ${zh ? '标准 API 等价估算' : 'Standard API-equivalent estimate'} ${money((localTotals.costMicros || 0) / 1e6, currency)} · ` : ''}{zh ? '官方观测' : 'Official observation'} {dateLabel(point.observedAt, zh, true)}{point.localEvidenceState === 'local-stale' ? ` · ${zh ? '本机快照较旧，不参与跨源推算' : 'local snapshot is stale and excluded from cross-source estimates'}` : ''}</footer>
    <span className="benefit-tooltip-affordance">{zh ? '点击查看证据 →' : 'Click to view evidence →'}</span>
  </aside>;
}

export function BenefitTrendView({ provider, zh, currency, onDrilldown }) {
  const windows = provider.windows.filter((window) => window.historyPoints?.length);
  const windowsKey = windows.map((window) => window.id).join('\u0000');
  const [windowId, setWindowId] = useState(windows[0]?.id || '');
  const tooltipHost = useRef(null);
  const [activeTooltip, setActiveTooltip] = useState(null);
  useEffect(() => {
    if (!windows.some((window) => window.id === windowId)) setWindowId(windows[0]?.id || '');
  }, [windowId, windowsKey]);
  const selected = windows.find((window) => window.id === windowId) || windows[0];
  const allTimeline = (provider.timeline || []).filter((item) => parsedTime(item.key) != null);
  const allPoints = (selected?.historyPoints || []).filter((point) => parsedTime(point.observedAt) != null);
  const latestEvidenceAt = Math.max(
    Number.NEGATIVE_INFINITY,
    ...allTimeline.map((item) => nextLocalMidnight(parsedTime(item.key))),
    ...allPoints.map((point) => parsedTime(point.observedAt)),
  );
  const rangeStart = Number.isFinite(latestEvidenceAt) ? latestEvidenceAt - TREND_RANGE_MS : null;
  const timeline = rangeStart == null
    ? []
    : allTimeline.filter((item) => nextLocalMidnight(parsedTime(item.key)) > rangeStart);
  const points = rangeStart == null
    ? []
    : allPoints.filter((point) => parsedTime(point.observedAt) >= rangeStart && parsedTime(point.observedAt) <= latestEvidenceAt);
  const plot = buildTrendPlot(timeline, points);
  const maxTokens = Math.max(1, ...plot.local.map((item) => item.totalTokens));
  const dayWidth = plot.domain ? Math.max(4, Math.min(28, DAY_MS / plot.domain.span * (CHART_RIGHT - CHART_LEFT) * 0.72)) : 4;
  const panelProps = providerPanelProps(provider);
  const activateTooltip = (event, value) => setActiveTooltip({
    ...value,
    left: tooltipLeft(event, tooltipHost.current, 258),
  });

  return <section className="benefit-view-stack" {...panelProps}>
    <section className="panel benefit-hero-panel">
      <header className="panel-header">
        <div><h2><BarChart3 size={15}/>{zh ? '额度趋势' : 'Quota trends'}</h2><p>{zh ? '供应商额度事实与本机 Token 分轨展示；虚线代表官方消耗比例' : 'Provider quota facts and local Tokens stay on separate scales; the dashed line is official utilization'}</p></div>
        {windows.length > 1 ? <select aria-label={zh ? '选择额度窗口' : 'Choose quota window'} value={selected?.id || ''} onChange={(event) => setWindowId(event.target.value)}>{windows.map((window) => <option value={window.id} key={window.id}>{window.label}</option>)}</select> : null}
      </header>
      {plot.domain ? <div className="benefit-combo-frame" ref={tooltipHost} onMouseLeave={() => setActiveTooltip(null)}><div className="benefit-combo-chart">
        <svg viewBox="0 0 920 218" role="group" aria-label={zh ? `${provider.label}额度和本机 Token 趋势` : `${provider.label} quota and local Token trend`}>
          {[0, 25, 50, 75, 100].map((value) => <g key={value}><line x1={CHART_LEFT} x2={CHART_RIGHT} y1={CHART_BOTTOM - value * 1.32} y2={CHART_BOTTOM - value * 1.32}/><text x="4" y={180 - value * 1.32}>{value}%</text></g>)}
          <g data-evidence="local">
            {plot.local.map((item) => {
              const height = item.totalTokens / maxTokens * CHART_TOKEN_HEIGHT;
              const label = localTrendLabel(item, zh, currency);
              return <rect
                className="benefit-token-bar"
                x={item.x - dayWidth / 2}
                y={CHART_BOTTOM - height}
                width={dayWidth}
                height={height}
                rx="2"
                role="button"
                tabIndex={0}
                aria-label={label}
                onMouseEnter={(event) => activateTooltip(event, { kind: 'local', datum: item })}
                onFocus={(event) => activateTooltip(event, { kind: 'local', datum: item })}
                onBlur={() => setActiveTooltip(null)}
                onClick={() => onDrilldown?.({ kind: 'usage', date: localEvidenceDayKey(item.key) })}
                onKeyDown={(event) => {
                  if (!['Enter', ' '].includes(event.key)) return;
                  event.preventDefault();
                  onDrilldown?.({ kind: 'usage', date: localEvidenceDayKey(item.key) });
                }}
                key={item.key}
              />;
            })}
          </g>
          <QuotaLine points={plot.quota} zh={zh} currency={currency} onActivate={activateTooltip} onDeactivate={() => setActiveTooltip(null)} onDrilldown={onDrilldown}/>
        </svg>
        <div className="benefit-chart-axis"><span>{dateLabel(plot.domain.start, zh)}</span><span>{zh ? '蓝柱：本机 Token　绿线：官方已用额度' : 'Blue: local Tokens　Green: official quota used'}</span><span>{dateLabel(plot.domain.end, zh)}</span></div>
      </div><BenefitTrendTooltip active={activeTooltip} zh={zh} currency={currency}/></div> : (
        <EmptyEvidence zh={zh} title={zh ? '还没有该订阅的趋势证据' : 'No trend evidence yet'} body={zh ? '继续使用、重新扫描或刷新额度后，这里只绘制真实观测点。' : 'Continue using, rescan, or refresh quotas; only real observations are plotted.'}/>
      )}
      {!plot.local.length && plot.quota.length ? <div className="benefit-inline-warning"><CircleAlert size={14}/><span>{zh ? '还没有该订阅的本机日趋势；图中仅显示真实的官方额度观测。' : 'No local daily trend exists yet; the chart shows only real official quota observations.'}</span></div> : null}
      {provider.evidenceClock?.state === 'local-stale' ? <div className="benefit-inline-warning" data-evidence="clock-mismatch"><CircleAlert size={14}/><span>{zh ? `本机用量快照（${dateLabel(provider.evidenceClock.usageObservedAt, true, true)}）早于额度观测（${dateLabel(provider.evidenceClock.quotaObservedAt, true, true)}）；两类事实仍分别展示，但容量与剩余额度推算已暂停。` : `The local usage snapshot (${dateLabel(provider.evidenceClock.usageObservedAt, false, true)}) predates the quota observation (${dateLabel(provider.evidenceClock.quotaObservedAt, false, true)}). Both facts remain visible, but capacity and remaining-Token estimates are paused.`}</span></div> : null}
      {!plot.quota.length ? <div className="benefit-inline-warning"><CircleAlert size={14}/><span>{provider.quotaObservation?.state === 'unavailable' ? (zh ? '该账户当前没有可验证的官方额度窗口，只展示本机趋势。' : 'This account has no verifiable official quota window; only local trends are shown.') : (zh ? '额度历史从成功刷新后开始积累，至少两个样本才计算速度。' : 'Quota history begins after successful refresh and needs two samples for pace.')}</span></div> : null}
    </section>
    <section className="benefit-kpi-row"><article><span>{zh ? '近 30 天 TOKEN' : '30D TOKENS'}</span><strong>{localizedCompact(provider.recentTotals.totalTokens, zh)}</strong><small>{localizedCompact(provider.recentTotals.requestCount, zh)} {requestUnit(provider.recentTotals.requestCount, zh)}</small></article><article><span>{zh ? 'API 等价价值' : 'API EQUIVALENT'}</span><strong>{money(provider.economics.apiEquivalentUsd, currency)}</strong><small>{zh ? '标准价格，不是账单' : 'standard pricing, not a bill'}</small></article><article><span>{zh ? '完整周期样本' : 'COMPLETE CYCLES'}</span><strong>{Math.max(0, ...provider.windows.map((window) => window.cycleStats?.sampledCycles || 0))}</strong><small>{zh ? '覆盖率 ≥90% 且接近重置' : '≥90% coverage near reset'}</small></article><article><span>{zh ? '官方额度状态' : 'QUOTA STATUS'}</span><strong>{provider.quotaObservation?.state === 'current' ? (zh ? '当前可读' : 'Current') : provider.quotaObservation?.state === 'historical' ? (zh ? '仅历史' : 'History') : (zh ? '不可观测' : 'Hidden')}</strong><small>{zh ? '不以缺失推断无限' : 'missing never means unlimited'}</small></article></section>
  </section>;
}

export function BenefitActivityView({ provider, usageData, zh, currency }) {
  const [range, setRange] = useState(() => storedBenefitRange('activity'));
  const [mode, setMode] = useState(() => storedHeatMode('kbu.benefit.heat-mode.v1'));
  const [weekOffset, setWeekOffset] = useState(0);
  const snapshotTime = useMemo(() => {
    const value = new Date(usageData?.generatedAt || Date.now());
    return Number.isFinite(value.getTime()) ? value : new Date();
  }, [usageData]);
  const weekStartMs = addLocalWeeks(localWeekStart(snapshotTime), weekOffset).getTime();
  const weekEndMs = localWeekEnd(weekStartMs).getTime();
  const firstWeekMs = useMemo(() => {
    const sources = new Set(provider.sources);
    return firstDataWeekStart((usageData?.buckets || []).filter((bucket) => sources.has(bucket.source)).map((bucket) => bucket.bucketStart))?.getTime() || null;
  }, [usageData, provider.sources]);
  const viewUsage = useMemo(() => (mode === 'week'
    ? buildSubscriptionViewUsage(usageData, provider.sources, 'all', { windowStart: weekStartMs, windowEnd: weekEndMs })
    : buildSubscriptionViewUsage(usageData, provider.sources, range)), [mode, usageData, provider.sources, range, weekStartMs, weekEndMs]);
  const cells = viewUsage.activity || [];
  const heatCellRefs = useRef(new Map());
  const [hovered, setHovered] = useState(null);
  const [focusCell, setFocusCell] = useState(null);
  const observedCells = cells.flat().filter((cell) => cell.observed);
  const max = Math.max(1, ...observedCells.map((cell) => cell.totalTokens));
  const weekdays = zh ? ['一','二','三','四','五','六','日'] : ['MO','TU','WE','TH','FR','SA','SU'];
  const activeDays = cells.filter((row) => row.some((cell) => cell.observed && cell.totalTokens > 0)).length;
  const peak = cells.flatMap((row, day) => row.map((cell, hour) => ({ ...cell, day, hour }))).filter((cell) => cell.observed).sort((a, b) => b.totalTokens - a.totalTokens)[0];
  const panelProps = providerPanelProps(provider);
  let firstObserved = null;
  for (let day = 0; day < cells.length && !firstObserved; day += 1) {
    const hour = cells[day]?.findIndex((cell) => cell.observed) ?? -1;
    if (hour >= 0) firstObserved = { day, hour };
  }
  const rovingCell = focusCell && cells[focusCell.day]?.[focusCell.hour]?.observed ? focusCell : firstObserved;
  const selectedCell = hovered ? cells[hovered.day]?.[hovered.hour] : null;
  const changeRange = (value) => {
    setRange(value);
    localStorage.setItem('kbu.benefit.activity-range.v1', value);
    setHovered(null);
    setFocusCell(null);
  };
  const changeMode = (value) => { setMode(value); storeHeatMode('kbu.benefit.heat-mode.v1', value); setHovered(null); setFocusCell(null); };
  const changeWeek = (offset) => { setWeekOffset(offset); setHovered(null); setFocusCell(null); };
  const onHeatmapKeyDown = (event, day, hour) => {
    let next = null;
    const rowLength = cells[day]?.length || 0;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      for (let step = 1; step < rowLength; step += 1) {
        const candidate = (hour + direction * step + rowLength) % rowLength;
        if (cells[day]?.[candidate]?.observed) { next = { day, hour: candidate }; break; }
      }
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      for (let step = 1; step < cells.length; step += 1) {
        const candidate = (day + direction * step + cells.length) % cells.length;
        if (cells[candidate]?.[hour]?.observed) { next = { day: candidate, hour }; break; }
      }
    }
    if (event.key === 'Home') {
      const candidate = cells[day]?.findIndex((cell) => cell.observed) ?? -1;
      if (candidate >= 0) next = { day, hour: candidate };
    }
    if (event.key === 'End') {
      const candidate = cells[day]?.findLastIndex((cell) => cell.observed) ?? -1;
      if (candidate >= 0) next = { day, hour: candidate };
    }
    if (!next) return;
    event.preventDefault();
    setFocusCell(next);
    heatCellRefs.current.get(`${next.day}-${next.hour}`)?.focus();
  };

  return <section className="benefit-view-stack" {...panelProps}>
    <section className="panel benefit-activity-panel" onMouseLeave={() => setHovered(null)}>
      <header className="panel-header benefit-view-header"><div><h2><Activity size={15}/>{zh ? '使用节奏' : 'Usage rhythm'}</h2><p>{mode === 'week' ? (zh ? `${weekLabel(weekStartMs, zh)} · 单周实际用量 · 只使用已归因到该订阅的本机 Token` : `${weekLabel(weekStartMs, zh)} · single-week actuals · only local Tokens attributed to this benefit`) : (zh ? `聚合 · ${benefitRangeLabel(range, true)} · 只使用已归因到该订阅的本机 Token · 星期 × 本地小时` : `Aggregate · ${benefitRangeLabel(range, false)} · only local Tokens attributed to this benefit · weekday × local hour`)}</p></div><div className="benefit-view-actions"><span className="evidence-badge"><ShieldCheck size={11}/>{zh ? '本机证据' : 'Local evidence'}</span><HeatModeTabs mode={mode} onChange={changeMode} zh={zh} label={zh ? '节奏图模式' : 'Rhythm mode'}/></div></header>
      <div className="heatmap-controls benefit-heat-controls">{mode === 'week' ? <WeekPager label={weekLabel(weekStartMs, zh)} canPrev={firstWeekMs != null && weekStartMs > firstWeekMs} canNext={weekOffset < 0} onPrev={() => changeWeek(weekOffset - 1)} onNext={() => changeWeek(weekOffset + 1)} onCurrent={() => changeWeek(0)} showCurrent={weekOffset < 0} zh={zh} ariaLabel={zh ? '选择周' : 'Choose week'}/> : <BenefitRangeControl value={range} onChange={changeRange} zh={zh} label={zh ? '使用节奏证据范围' : 'Usage rhythm evidence range'}/>}</div>
      <div className="benefit-heatmap"><div className="benefit-heat-grid">{cells.map((row, day) => <div className="benefit-heat-row" key={day}><span>{weekdays[day]}</span><div>{row.map((cell, hour) => {
        const slot = `${weekdays[day]} ${String(hour).padStart(2,'0')}:00`;
        if (!cell.observed) {
          const unavailable = zh ? `${slot} · 未观测` : `${slot} · Not observed`;
          return <button type="button" className="benefit-heat-cell is-unobserved" data-observed="false" aria-label={unavailable} title={unavailable} disabled key={hour}/>;
        }
        const level = cell.totalTokens > 0 ? Math.max(1, Math.ceil(cell.totalTokens / max * 6)) : 0;
        const title = `${slot} · ${zh ? '已观测' : 'Observed'} · ${localizedCompact(cell.totalTokens, zh)} Token · ${localizedCompact(cell.requestCount, zh)} ${requestUnit(cell.requestCount, zh)} · ${money(cell.costMicros / 1e6, currency)}`;
        return <button
          ref={(node) => { const key = `${day}-${hour}`; if (node) heatCellRefs.current.set(key, node); else heatCellRefs.current.delete(key); }}
          type="button"
          className={`benefit-heat-cell${cell.totalTokens === 0 ? ' is-observed-zero' : ''}`}
          tabIndex={rovingCell?.day === day && rovingCell?.hour === hour ? 0 : -1}
          data-observed="true"
          data-level={level}
          aria-label={title}
          onKeyDown={(event) => onHeatmapKeyDown(event, day, hour)}
          onMouseEnter={() => setHovered({ day, hour })}
          onFocus={() => { setFocusCell({ day, hour }); setHovered({ day, hour }); }}
          onBlur={() => setHovered(null)}
          key={hour}
        />;
      })}</div></div>)}<div className="benefit-heat-hours">{Array.from({ length: 24 }, (_, hour) => <span key={hour}>{hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}</span>)}</div></div></div>
      {hovered && selectedCell ? <aside className="heatmap-tooltip benefit-heat-tooltip" data-dock={hovered.hour < 12 ? 'r' : 'l'} role="tooltip">
        <header><strong>{weekdays[hovered.day]} {String(hovered.hour).padStart(2, '0')}:00</strong><span>{localizedCompact(selectedCell.totalTokens, zh)} tokens</span><small>{zh ? '命中率' : 'hit'} {cacheHit(selectedCell)}</small></header>
        {tokenBreakdownRows(selectedCell, zh, true).map(([label, value, color]) => <div key={label}><span><i style={{ background: color }}/>{label}</span><b>{localizedCompact(value, zh)}</b></div>)}
        <footer>{zh ? '标准 API 等价估算' : 'Standard API-equivalent estimate'} {money(selectedCell.costMicros / 1e6, currency)} · {localizedCompact(Number(selectedCell.requestCount || 0), zh)} {requestUnit(selectedCell.requestCount || 0, zh)} · {zh ? '本机归因事实' : 'local attributed facts'}</footer>
      </aside> : null}
      <footer className="benefit-heat-footer"><span>{zh ? '少' : 'Less'} {[1,2,3,4,5,6].map((level) => <i data-level={level} key={level}/>)} {zh ? '多' : 'More'}</span><span><i className="is-observed-zero" data-level="0"/> {zh ? '已观测 0' : 'Observed 0'}　<i className="is-unobserved"/> {zh ? '未观测' : 'Not observed'}</span><span>{zh ? '悬停或聚焦查看本机证据' : 'Hover or focus for local evidence'}</span></footer>
    </section>
    <section className="benefit-kpi-row"><article><span>{zh ? '活跃星期' : 'ACTIVE WEEKDAYS'}</span><strong>{activeDays} / 7</strong><small>{mode === 'week' ? weekLabel(weekStartMs, zh) : benefitRangeLabel(range, zh)}</small></article><article><span>{zh ? '峰值时段' : 'PEAK SLOT'}</span><strong>{peak?.totalTokens ? `${weekdays[peak.day]} ${String(peak.hour).padStart(2,'0')}:00` : '—'}</strong><small>{peak?.totalTokens ? `${localizedCompact(peak.totalTokens, zh)} Token` : (zh ? '没有非零观测' : 'No nonzero observation')}</small></article><article><span>{zh ? '额度撞线证据' : 'LIMIT EVENTS'}</span><strong>{provider.decisionSignals.some((signal) => signal.code === 'exhausted') ? (zh ? '发现' : 'Found') : (zh ? '未发现' : 'None')}</strong><small>{zh ? '仅供应商返回的额度事实 · 全量' : 'provider-reported facts only · all history'}</small></article><article><span>{zh ? '节奏覆盖范围' : 'RHYTHM COVERAGE'}</span><strong>{localizedCompact(viewUsage.totals.totalTokens, zh)}</strong><small>{zh ? '当前窗口已归因本机 Token' : 'attributed local Tokens in this window'}</small></article></section>
  </section>;
}

function MixCard({ title, rows, zh, semantic = false }) {
  const shown = rows.slice(0, 6);
  const total = rows.reduce((sum, row) => sum + row.totalTokens, 0);
  const count = shown.length === rows.length ? shown.length : `${shown.length} / ${rows.length}`;
  return <section className="panel benefit-mix-card"><header className="panel-header"><h2>{title}</h2><span>{count} {zh ? '项' : pluralUnit(count, 'item')}</span></header><div>{shown.length ? shown.map((row, index) => {
    const suppliedShare = finiteNumber(row.share);
    const share = Math.max(0, Math.min(1, suppliedShare ?? (total ? row.totalTokens / total : 0)));
    const color = semantic ? TOKEN_MIX_COLORS[row.id] : CONSUMPTION_PALETTE[index % CONSUMPTION_PALETTE.length];
    return <article key={row.id} style={{ '--mix-color': color }}><span>{String(index + 1).padStart(2,'0')}</span><div><b title={row.label}>{row.label}</b><i><em style={{ width: share > 0 ? `${Math.max(2, share * 100)}%` : '0%' }}/></i></div><strong>{localizedCompact(row.totalTokens, zh)}<small> · {percent(share)}</small></strong></article>;
  }) : <p>{zh ? '当前没有可归因记录' : 'No attributable records yet'}</p>}</div></section>;
}

export function BenefitDistributionView({ provider, usageData, zh }) {
  const [range, setRange] = useState(() => storedBenefitRange('distribution'));
  const viewUsage = useMemo(() => buildSubscriptionViewUsage(usageData, provider.sources, range), [usageData, provider.sources, range]);
  const changeRange = (value) => {
    setRange(value);
    localStorage.setItem('kbu.benefit.distribution-range.v1', value);
  };
  const tokenTypeRows = [
    { id: 'input', label: zh ? '输入（含缓存写）' : 'Input + cache write', totalTokens: viewUsage.totals.inputTokens + viewUsage.totals.cacheWriteInputTokens },
    { id: 'cache', label: zh ? '缓存读' : 'Cache read', totalTokens: viewUsage.totals.cacheReadInputTokens },
    { id: 'output', label: zh ? '输出' : 'Output', totalTokens: viewUsage.totals.outputTokens },
    { id: 'reasoning', label: zh ? '推理' : 'Reasoning', totalTokens: viewUsage.totals.reasoningOutputTokens },
  ].sort((a,b) => b.totalTokens - a.totalTokens);
  const panelProps = providerPanelProps(provider);
  return <section className="benefit-view-stack" {...panelProps}><section className="benefit-section-heading"><div><span>{zh ? '单一订阅构成' : 'ONE-BENEFIT BREAKDOWN'}</span><h2><LayoutDashboard size={16}/>{zh ? `${provider.label} 的消耗构成` : `${provider.label} consumption mix`}</h2><p>{zh ? `${benefitRangeLabel(range, true)} · 只使用已归因到该订阅的本机 Token；不代表供应商账单内部权重。` : `${benefitRangeLabel(range, false)} · only local Tokens attributed to this benefit; not the provider billing weight.`}</p></div><div className="benefit-section-range"><strong>{localizedCompact(viewUsage.totals.totalTokens, zh)} Token</strong><BenefitRangeControl value={range} onChange={changeRange} zh={zh} label={zh ? '消耗构成证据范围' : 'Consumption mix evidence range'}/></div></section><div className="benefit-distribution-grid"><MixCard title={zh ? '模型' : 'Models'} rows={viewUsage.modelRows} zh={zh}/><MixCard title={zh ? 'Token 类型' : 'Token types'} rows={tokenTypeRows} zh={zh} semantic/><MixCard title={zh ? '推理强度' : 'Reasoning effort'} rows={viewUsage.effortRows} zh={zh}/><MixCard title={zh ? '项目 / 工作负载' : 'Projects / workload'} rows={viewUsage.projectRows} zh={zh}/></div><div className="benefit-attribution-note"><ShieldCheck size={14}/><span>{zh ? `证据窗口：${benefitRangeLabel(range, true)}。归因范围：${provider.sources.join('、')}。无法确认账户归属的数据不会被强行放进这个订阅。` : `Evidence window: ${benefitRangeLabel(range, false)}. Attribution scope: ${provider.sources.join(', ')}. Data without reliable account attribution is not forced into this benefit.`}</span></div></section>;
}

function RecordsTable({ label, columns, rows, rowClassName = '', renderCells, focusKey = null }) {
  const focusRef = useRef(null);
  useEffect(() => {
    if (!focusKey || !focusRef.current) return;
    focusRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    focusRef.current.focus({ preventScroll: true });
  }, [focusKey]);
  return <div className="benefit-records-table" role="table" aria-label={label} aria-colcount={columns.length} aria-rowcount={rows.length + 1}>
    <div className="benefit-records-rowgroup" role="rowgroup">
      <div className={`benefit-records-head${rowClassName ? ` ${rowClassName}-head` : ''}`} role="row" aria-rowindex={1}>
        {columns.map((column, index) => <span role="columnheader" aria-colindex={index + 1} key={column}>{column}</span>)}
      </div>
    </div>
    <div className="benefit-records-rowgroup benefit-records-body" role="rowgroup">
      {rows.map((row, index) => <div ref={row.key === focusKey ? focusRef : null} className={`benefit-records-row benefit-record-card${rowClassName ? ` ${rowClassName}-row` : ''}${row.key === focusKey ? ' is-evidence-target' : ''}`} role="row" aria-rowindex={index + 2} tabIndex={row.key === focusKey ? -1 : undefined} key={row.key}>{renderCells(row, columns)}</div>)}
    </div>
  </div>;
}

function recordCell(content, label, index, { strong = false, className = '', title } = {}) {
  const Element = strong ? 'strong' : 'span';
  return <Element className={`benefit-record-cell${className ? ` ${className}` : ''}`} role="cell" aria-colindex={index + 1} data-label={label} title={title}>{content}</Element>;
}

export function BenefitRecordsView({ provider, drilldown, onClearDrilldown, zh, currency }) {
  const [kind, setKind] = useState(drilldown?.kind || 'quota');
  const [usageRange, setUsageRange] = useState(() => storedBenefitRange('records'));
  useEffect(() => {
    if (drilldown?.kind) setKind(drilldown.kind);
  }, [drilldown]);
  const allQuotaRows = provider.observationLog.map((row, index) => ({ ...row, key: `${row.observedAt}-${row.id}-${index}` }));
  const rangeUsageRows = filterBenefitUsageRecords(provider.usageRecords, usageRange, provider.evidenceClock?.usageObservedAt);
  const dayUsageRows = drilldown?.kind === 'usage' && drilldown.date
    ? rangeUsageRows.filter((row) => localEvidenceDayKey(row.observedAt) === drilldown.date)
    : rangeUsageRows;
  const quotaTarget = drilldown?.kind === 'quota' ? nearestBenefitObservation(allQuotaRows, drilldown.observedAt) : null;
  const baseRows = allQuotaRows.slice(0, 100);
  // A drilled observation older than the first 100 rows would silently lose its
  // highlight; append it (log is time-descending, so order holds).
  const rows = quotaTarget && !baseRows.some((row) => row.key === quotaTarget.key) ? [...baseRows, quotaTarget] : baseRows;
  const usageRows = dayUsageRows.slice(0, 100).map((row) => ({ ...row, key: row.id }));
  const focusKey = kind === 'quota' ? quotaTarget?.key || null : drilldown?.kind === 'usage' ? usageRows[0]?.key || null : null;
  const shown = kind === 'quota' ? rows.length : usageRows.length;
  const total = kind === 'quota' ? provider.observationLog.length : (drilldown?.kind === 'usage' ? dayUsageRows.length : rangeUsageRows.length);
  const [page, setPage] = useState(1);
  const activeRows = kind === 'quota' ? rows : usageRows;
  const pageCount = Math.max(1, Math.ceil(activeRows.length / 25));
  const currentPage = Math.min(page, pageCount);
  useEffect(() => { setPage(1); }, [kind, usageRange, drilldown, provider.id]);
  useEffect(() => {
    if (!focusKey) return;
    const index = activeRows.findIndex((row) => row.key === focusKey);
    if (index >= 0) setPage(Math.floor(index / 25) + 1);
  }, [focusKey]);
  const pageRows = activeRows.slice((currentPage - 1) * 25, currentPage * 25);
  const quotaColumns = zh ? ['时间', '窗口', '官方已用', '本机 TOKEN', '覆盖率', '重置'] : ['Observed', 'Window', 'Official used', 'Local Tokens', 'Coverage', 'Reset'];
  const usageColumns = zh ? ['时间', '模型', 'TOKEN', '请求', '推理强度', 'API 等价价值'] : ['Time', 'Model', 'Tokens', 'Requests', 'Reasoning', 'API equivalent'];
  const panelProps = providerPanelProps(provider);

  return <section className="panel benefit-records-panel" {...panelProps}>
    <header className="panel-header"><div><h2><FileText size={15}/>{zh ? '观测明细' : 'Observation log'}</h2><p>{zh ? '脱敏额度快照与本机用量事实；不包含凭据、Cookie、完整路径或原始响应' : 'Sanitized quota snapshots and local usage facts; no credentials, cookies, full paths, or raw responses'}</p></div><div className="benefit-record-controls"><div className="benefit-record-kind"><button type="button" aria-pressed={kind === 'quota'} className={kind === 'quota' ? 'active' : ''} onClick={() => { setKind('quota'); onClearDrilldown?.(); }}>{zh ? '额度快照' : 'Quota snapshots'}</button><button type="button" aria-pressed={kind === 'usage'} className={kind === 'usage' ? 'active' : ''} onClick={() => { setKind('usage'); onClearDrilldown?.(); }}>{zh ? '本机用量' : 'Local usage'}</button><span>{shown} / {total}</span></div>{kind === 'usage' ? <BenefitRangeControl value={usageRange} onChange={(value) => { setUsageRange(value); localStorage.setItem('kbu.benefit.records-range.v1', value); }} zh={zh} label={zh ? '本机用量明细范围' : 'Local usage record range'}/> : null}</div></header>
    {drilldown ? <div className="benefit-evidence-window"><span><ShieldCheck size={13}/>{zh ? '证据窗口：' : 'Evidence window: '}{drilldown.kind === 'usage' ? drilldown.date : dateLabel(drilldown.observedAt, zh, true)}</span><button type="button" onClick={onClearDrilldown} aria-label={zh ? '清除证据窗口' : 'Clear evidence window'}>×</button></div> : null}
    {kind === 'quota' ? (rows.length ? <RecordsTable
      label={zh ? `${provider.label}额度观测明细` : `${provider.label} quota observation log`}
      columns={quotaColumns}
      rows={pageRows}
      focusKey={focusKey}
      renderCells={(row, columns) => {
        const localObserved = row.localObserved ?? finiteNumber(row.localCoverage) > 0;
        return <>
          {recordCell(dateLabel(row.observedAt, zh, true), columns[0], 0)}
          {recordCell(row.label, columns[1], 1)}
          {recordCell(row.usedPercent == null ? '—' : `${Number(row.usedPercent).toFixed(1)}%`, columns[2], 2, { strong: true, className: 'evidence-official' })}
          {recordCell(localObserved ? localizedCompact(row.localTotals?.totalTokens || 0, zh) : '—', columns[3], 3, { className: 'evidence-local' })}
          {recordCell(row.localCoverage == null ? '—' : percent(row.localCoverage), columns[4], 4, { className: 'evidence-local' })}
          {recordCell(row.resetsAt ? dateLabel(row.resetsAt, zh, true) : '—', columns[5], 5)}
        </>;
      }}
    /> : <EmptyEvidence zh={zh} title={zh ? '还没有额度观测记录' : 'No quota observations yet'} body={provider.quotaObservation?.state === 'unavailable' ? (zh ? '该账户当前不提供稳定的可读额度；可切换到“本机用量”查看已归因 Token。' : 'This account exposes no stable quota; switch to Local usage for attributed Tokens.') : (zh ? '点击“刷新额度”后，从首个成功的脱敏快照开始积累。' : 'Refresh quotas to begin with the first successful sanitized snapshot.')}/>) : (usageRows.length ? <RecordsTable
      label={zh ? `${provider.label}本机用量明细` : `${provider.label} local usage log`}
      columns={usageColumns}
      rows={pageRows}
      rowClassName="benefit-usage"
      focusKey={focusKey}
      renderCells={(row, columns) => <>
        {recordCell(dateLabel(row.observedAt, zh, true), columns[0], 0)}
        {recordCell(row.model, columns[1], 1, { title: row.model })}
        {recordCell(localizedCompact(row.totalTokens, zh), columns[2], 2, { strong: true, className: 'evidence-local' })}
        {recordCell(localizedCompact(row.requestCount, zh), columns[3], 3, { className: 'evidence-local' })}
        {recordCell(row.reasoningEffort || (zh ? '未记录' : 'Not recorded'), columns[4], 4, { className: 'evidence-local' })}
        {recordCell(money(row.costMicros / 1e6, currency), columns[5], 5, { className: 'evidence-derived' })}
      </>}
    /> : <EmptyEvidence zh={zh} title={zh ? '还没有该账户的本机用量' : 'No local usage for this account'} body={zh ? '供应商额度与本机日志相互独立；有额度不等于这台设备已经产生 Token。' : 'Provider quota and local logs are independent; having a quota does not mean this device produced Tokens.'}/>)}
    {activeRows.length > 25 ? <footer className="pagination benefit-records-pagination"><span>{zh ? `显示 ${(currentPage - 1) * 25 + (pageRows.length ? 1 : 0)}–${(currentPage - 1) * 25 + pageRows.length}，共 ${activeRows.length} 组` : `Showing ${(currentPage - 1) * 25 + (pageRows.length ? 1 : 0)}–${(currentPage - 1) * 25 + pageRows.length} of ${activeRows.length}`}</span><div><button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label={zh ? '上一页' : 'Previous page'}><ChevronLeft size={15}/></button><b>{currentPage} / {pageCount}</b><button type="button" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} aria-label={zh ? '下一页' : 'Next page'}><ChevronRight size={15}/></button></div></footer> : null}
    <footer><Clock3 size={13}/><span>{kind === 'quota' ? (zh ? '额度历史由本地服务管理并按时间降采样；重复读取缓存不会追加相同快照。' : 'Quota history is backend-owned and downsampled over time; cached reads do not append duplicates.') : (zh ? '本机用量按原始事实桶展示；完整路径与对话内容从不进入页面。' : 'Local usage uses raw fact buckets; full paths and conversation content never enter the page.')}</span></footer>
  </section>;
}
