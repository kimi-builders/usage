import { useEffect, useRef, useState } from 'react';
import { Activity, BarChart3, CircleAlert, Clock3, FileText, LayoutDashboard, ShieldCheck } from 'lucide-react';
import { CHART_COLORS, CONSUMPTION_PALETTE } from './chart-colors.js';
import { compact, percent } from './format.js';
import { ToolGlyph } from './tool-glyphs.js';

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

function money(value) {
  return `$${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  return <div className="trend-tooltip-breakdown">{tokenBreakdownRows(row, zh, combineInput).map(([label, value, color]) => <span key={label}><i style={{ background: color }}/><em>{label}</em><b>{compact(value)}</b></span>)}</div>;
}

function tooltipLeft(event, viewport) {
  if (!viewport) return 8;
  const container = viewport.getBoundingClientRect();
  const target = event.currentTarget.getBoundingClientRect();
  const center = target.left + target.width / 2 - container.left;
  const maxLeft = Math.max(8, container.width - 252);
  return Math.max(8, Math.min(maxLeft, center - 122));
}

function localTrendFacts(item, zh) {
  const facts = [
    `${Number(item?.requestCount || 0).toLocaleString()} ${zh ? '次请求' : 'requests'}`,
    `${zh ? '标准 API 等价估算' : 'Standard API-equivalent estimate'} ${money((item?.costMicros || 0) / 1e6)}`,
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
  const tabs = useRef([]);
  const activeIndex = providers.findIndex((provider) => provider.id === active?.id);

  function moveFocus(event, index) {
    let nextIndex = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % providers.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + providers.length) % providers.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = providers.length - 1;
    if (nextIndex == null || !providers[nextIndex]) return;
    event.preventDefault();
    onChange(providers[nextIndex].id);
    tabs.current[nextIndex]?.focus();
  }

  return <section className="benefit-provider-picker">
    <div><span>{zh ? '分析账户' : 'ANALYSIS ACCOUNT'}</span><b>{zh ? '以下页面只分析当前订阅' : 'The pages below analyze one benefit at a time'}</b></div>
    <div role="tablist" aria-orientation="horizontal" aria-label={zh ? '选择权益账户' : 'Choose benefit account'}>
      {providers.map((provider, index) => {
        const selected = provider.id === active?.id;
        return <button
          type="button"
          role="tab"
          id={providerTabId(provider.id)}
          aria-controls={PROVIDER_PANEL_ID}
          aria-selected={selected}
          tabIndex={selected || (activeIndex < 0 && index === 0) ? 0 : -1}
          className={selected ? 'active' : ''}
          onClick={() => onChange(provider.id)}
          onKeyDown={(event) => moveFocus(event, index)}
          ref={(node) => { tabs.current[index] = node; }}
          key={provider.id}
        >
          <ToolGlyph id={provider.id} size={15}/>
          <span>{provider.label}</span>
          {provider.quotaObservation?.state !== 'current' ? <small>{zh ? '仅本机' : 'Local only'}</small> : null}
        </button>;
      })}
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

function localTrendLabel(item, zh) {
  const parts = zh
    ? [dateLabel(item.key, true), `本机 Token：${compact(item.totalTokens)}`, `请求：${Number(item.requestCount || 0).toLocaleString()}`, `API 等价价值：${money(item.costMicros / 1e6)}`]
    : [dateLabel(item.key, false), `Local Tokens: ${compact(item.totalTokens)}`, `Requests: ${Number(item.requestCount || 0).toLocaleString()}`, `API-equivalent value: ${money(item.costMicros / 1e6)}`];
  if (item.officialObservation) {
    parts.push(zh
      ? `官方已用：${item.officialObservation.usedPercent.toFixed(1)}%（${dateLabel(item.officialObservation.observedAt, true, true)}观测）`
      : `Official used: ${item.officialObservation.usedPercent.toFixed(1)}% (observed ${dateLabel(item.officialObservation.observedAt, false, true)})`);
  }
  return parts.join(' · ');
}

function quotaTrendLabel(point, zh) {
  const localObserved = point.localObserved
    ?? finiteNumber(point.localObservedCoverage ?? point.localCoverage) > 0;
  const localTotals = point.localTotals;
  const parts = zh
    ? [dateLabel(point.observedAt, true, true), `官方已用：${point.usedPercent.toFixed(1)}%`]
    : [dateLabel(point.observedAt, false, true), `Official used: ${point.usedPercent.toFixed(1)}%`];
  if (localObserved && localTotals) {
    parts.push(...(zh
      ? [`本机 Token：${compact(localTotals.totalTokens)}`, `请求：${Number(localTotals.requestCount || 0).toLocaleString()}`, `API 等价价值：${money(localTotals.costMicros / 1e6)}`]
      : [`Local Tokens: ${compact(localTotals.totalTokens)}`, `Requests: ${Number(localTotals.requestCount || 0).toLocaleString()}`, `API-equivalent value: ${money(localTotals.costMicros / 1e6)}`]));
    if (point.localEvidenceState === 'local-stale') {
      parts.push(zh ? '本机快照早于额度观测，不参与跨源推算' : 'Local snapshot predates this quota observation; excluded from cross-source estimates');
    }
  } else {
    parts.push(zh ? '本机 Token、请求与 API 等价价值：未观测' : 'Local Tokens, requests, and API-equivalent value: not observed');
  }
  return parts.join(' · ');
}

function QuotaLine({ points, zh, onActivate, onDeactivate }) {
  if (!points.length) return null;
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  return <g data-evidence="official">
    {points.length > 1 ? <path className="benefit-quota-line" d={path}/> : null}
    {points.map((point, index) => {
      const label = quotaTrendLabel(point, zh);
      return <circle
        className="benefit-quota-point"
        cx={point.x}
        cy={point.y}
        r={points.length === 1 ? 5 : 4}
        role="img"
        tabIndex={0}
        aria-label={label}
        onMouseEnter={(event) => onActivate?.(event, { kind: 'quota', datum: point })}
        onFocus={(event) => onActivate?.(event, { kind: 'quota', datum: point })}
        onBlur={onDeactivate}
        key={`${point.observedAt}-${index}`}
      />;
    })}
  </g>;
}

function BenefitTrendTooltip({ active, zh }) {
  if (!active) return null;
  if (active.kind === 'local') {
    const item = active.datum;
    return <aside className="trend-tooltip benefit-trend-tooltip" role="tooltip" style={{ left: active.left }}>
      <strong>{dateLabel(item.key, zh)}</strong>
      <div className="trend-tooltip-total"><span>{compact(item.totalTokens)} tokens</span><small>{zh ? '命中率' : 'hit'} {cacheHit(item)}</small></div>
      <TokenBreakdown row={item} zh={zh}/>
      <footer>{localTrendFacts(item, zh)}</footer>
    </aside>;
  }
  const point = active.datum;
  const localObserved = point.localObserved ?? finiteNumber(point.localObservedCoverage ?? point.localCoverage) > 0;
  const localTotals = localObserved ? point.localTotals : null;
  return <aside className="trend-tooltip benefit-trend-tooltip" role="tooltip" style={{ left: active.left }}>
    <strong>{dateLabel(point.observedAt, zh, true)}</strong>
    <div className="trend-tooltip-total"><span>{zh ? '官方已用' : 'Official used'} {point.usedPercent.toFixed(1)}%</span><small>{zh ? '额度事实' : 'quota fact'}</small></div>
    {localTotals ? <TokenBreakdown row={localTotals} zh={zh}/> : <p className="trend-tooltip-note">{zh ? '该观测时刻没有可连接的本机 Token 事实。' : 'No joinable local Token facts at this observation.'}</p>}
    <footer>{localTotals ? `${Number(localTotals.requestCount || 0).toLocaleString()} ${zh ? '次请求' : 'requests'} · ${zh ? '标准 API 等价估算' : 'Standard API-equivalent estimate'} ${money((localTotals.costMicros || 0) / 1e6)} · ` : ''}{zh ? '官方观测' : 'Official observation'} {dateLabel(point.observedAt, zh, true)}{point.localEvidenceState === 'local-stale' ? ` · ${zh ? '本机快照较旧，不参与跨源推算' : 'local snapshot is stale and excluded from cross-source estimates'}` : ''}</footer>
  </aside>;
}

export function BenefitTrendView({ provider, zh }) {
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
    left: tooltipLeft(event, tooltipHost.current),
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
              const label = localTrendLabel(item, zh);
              return <rect
                className="benefit-token-bar"
                x={item.x - dayWidth / 2}
                y={CHART_BOTTOM - height}
                width={dayWidth}
                height={height}
                rx="2"
                role="img"
                tabIndex={0}
                aria-label={label}
                onMouseEnter={(event) => activateTooltip(event, { kind: 'local', datum: item })}
                onFocus={(event) => activateTooltip(event, { kind: 'local', datum: item })}
                onBlur={() => setActiveTooltip(null)}
                key={item.key}
              />;
            })}
          </g>
          <QuotaLine points={plot.quota} zh={zh} onActivate={activateTooltip} onDeactivate={() => setActiveTooltip(null)}/>
        </svg>
        <div className="benefit-chart-axis"><span>{dateLabel(plot.domain.start, zh)}</span><span>{zh ? '蓝柱：本机 Token　绿线：官方已用额度' : 'Blue: local Tokens　Green: official quota used'}</span><span>{dateLabel(plot.domain.end, zh)}</span></div>
      </div><BenefitTrendTooltip active={activeTooltip} zh={zh}/></div> : (
        <EmptyEvidence zh={zh} title={zh ? '还没有该订阅的趋势证据' : 'No trend evidence yet'} body={zh ? '继续使用、重新扫描或刷新额度后，这里只绘制真实观测点。' : 'Continue using, rescan, or refresh quotas; only real observations are plotted.'}/>
      )}
      {!plot.local.length && plot.quota.length ? <div className="benefit-inline-warning"><CircleAlert size={14}/><span>{zh ? '还没有该订阅的本机日趋势；图中仅显示真实的官方额度观测。' : 'No local daily trend exists yet; the chart shows only real official quota observations.'}</span></div> : null}
      {provider.evidenceClock?.state === 'local-stale' ? <div className="benefit-inline-warning" data-evidence="clock-mismatch"><CircleAlert size={14}/><span>{zh ? `本机用量快照（${dateLabel(provider.evidenceClock.usageObservedAt, true, true)}）早于额度观测（${dateLabel(provider.evidenceClock.quotaObservedAt, true, true)}）；两类事实仍分别展示，但容量与剩余额度推算已暂停。` : `The local usage snapshot (${dateLabel(provider.evidenceClock.usageObservedAt, false, true)}) predates the quota observation (${dateLabel(provider.evidenceClock.quotaObservedAt, false, true)}). Both facts remain visible, but capacity and remaining-Token estimates are paused.`}</span></div> : null}
      {!plot.quota.length ? <div className="benefit-inline-warning"><CircleAlert size={14}/><span>{provider.quotaObservation?.state === 'unavailable' ? (zh ? '该账户当前没有可验证的官方额度窗口，只展示本机趋势。' : 'This account has no verifiable official quota window; only local trends are shown.') : (zh ? '额度历史从成功刷新后开始积累，至少两个样本才计算速度。' : 'Quota history begins after successful refresh and needs two samples for pace.')}</span></div> : null}
    </section>
    <section className="benefit-kpi-row"><article><span>{zh ? '近 30 天 TOKEN' : '30D TOKENS'}</span><strong>{compact(provider.recentTotals.totalTokens)}</strong><small>{provider.recentTotals.requestCount.toLocaleString()} {zh ? '次请求' : 'requests'}</small></article><article><span>{zh ? 'API 等价价值' : 'API EQUIVALENT'}</span><strong>{money(provider.economics.apiEquivalentUsd)}</strong><small>{zh ? '标准价格，不是账单' : 'standard pricing, not a bill'}</small></article><article><span>{zh ? '完整周期样本' : 'COMPLETE CYCLES'}</span><strong>{Math.max(0, ...provider.windows.map((window) => window.cycleStats?.sampledCycles || 0))}</strong><small>{zh ? '覆盖率 ≥90% 且接近重置' : '≥90% coverage near reset'}</small></article><article><span>{zh ? '官方额度状态' : 'QUOTA STATUS'}</span><strong>{provider.quotaObservation?.state === 'current' ? (zh ? '当前可读' : 'Current') : provider.quotaObservation?.state === 'historical' ? (zh ? '仅历史' : 'History') : (zh ? '不可观测' : 'Hidden')}</strong><small>{zh ? '不以缺失推断无限' : 'missing never means unlimited'}</small></article></section>
  </section>;
}

export function BenefitActivityView({ provider, zh }) {
  const cells = provider.activity || [];
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
      <header className="panel-header"><div><h2><Activity size={15}/>{zh ? '使用节奏' : 'Usage rhythm'}</h2><p>{zh ? '星期 × 本地小时 · 只使用已归因到该订阅的本机 Token' : 'Weekday × local hour · only local Tokens attributed to this benefit'}</p></div><span className="evidence-badge"><ShieldCheck size={11}/>{zh ? '本机证据' : 'Local evidence'}</span></header>
      <div className="benefit-heatmap"><div className="benefit-heat-hours">{Array.from({ length: 24 }, (_, hour) => <span key={hour}>{hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}</span>)}</div>{cells.map((row, day) => <div className="benefit-heat-row" key={day}><span>{weekdays[day]}</span><div>{row.map((cell, hour) => {
        const slot = `${weekdays[day]} ${String(hour).padStart(2,'0')}:00`;
        if (!cell.observed) {
          const unavailable = zh ? `${slot} · 未观测` : `${slot} · Not observed`;
          return <button type="button" className="benefit-heat-cell is-unobserved" data-observed="false" aria-label={unavailable} title={unavailable} disabled key={hour}/>;
        }
        const level = cell.totalTokens > 0 ? Math.max(1, Math.ceil(cell.totalTokens / max * 6)) : 0;
        const title = `${slot} · ${zh ? '已观测' : 'Observed'} · ${compact(cell.totalTokens)} Token · ${cell.requestCount} ${zh ? '次请求' : 'requests'} · ${money(cell.costMicros / 1e6)}`;
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
      })}</div></div>)}</div>
      {hovered && selectedCell ? <aside className="heatmap-tooltip benefit-heat-tooltip" role="tooltip">
        <header><strong>{weekdays[hovered.day]} {String(hovered.hour).padStart(2, '0')}:00</strong><span>{compact(selectedCell.totalTokens)} tokens</span><small>{zh ? '命中率' : 'hit'} {cacheHit(selectedCell)}</small></header>
        {tokenBreakdownRows(selectedCell, zh, true).map(([label, value, color]) => <div key={label}><span><i style={{ background: color }}/>{label}</span><b>{compact(value)}</b></div>)}
        <footer>{zh ? '标准 API 等价估算' : 'Standard API-equivalent estimate'} {money(selectedCell.costMicros / 1e6)} · {Number(selectedCell.requestCount || 0).toLocaleString()} {zh ? '次请求' : 'requests'} · {zh ? '本机归因事实' : 'local attributed facts'}</footer>
      </aside> : null}
      <footer className="benefit-heat-footer"><span>{zh ? '少' : 'Less'} {[1,2,3,4,5,6].map((level) => <i data-level={level} key={level}/>)} {zh ? '多' : 'More'}</span><span><i className="is-observed-zero" data-level="0"/> {zh ? '已观测 0' : 'Observed 0'}　<i className="is-unobserved"/> {zh ? '未观测' : 'Not observed'}</span><span>{zh ? '悬停或聚焦查看本机证据' : 'Hover or focus for local evidence'}</span></footer>
    </section>
    <section className="benefit-kpi-row"><article><span>{zh ? '活跃星期' : 'ACTIVE WEEKDAYS'}</span><strong>{activeDays} / 7</strong><small>{zh ? '按全部本机历史' : 'all local history'}</small></article><article><span>{zh ? '峰值时段' : 'PEAK SLOT'}</span><strong>{peak?.totalTokens ? `${weekdays[peak.day]} ${String(peak.hour).padStart(2,'0')}:00` : '—'}</strong><small>{peak?.totalTokens ? `${compact(peak.totalTokens)} Token` : (zh ? '没有非零观测' : 'No nonzero observation')}</small></article><article><span>{zh ? '额度撞线证据' : 'LIMIT EVENTS'}</span><strong>{provider.decisionSignals.some((signal) => signal.code === 'exhausted') ? (zh ? '发现' : 'Found') : (zh ? '未发现' : 'None')}</strong><small>{zh ? '仅供应商返回的额度事实' : 'provider-reported facts only'}</small></article><article><span>{zh ? '节奏覆盖范围' : 'RHYTHM COVERAGE'}</span><strong>{compact(provider.lifetimeTotals.totalTokens)}</strong><small>{zh ? '已归因本机 Token' : 'attributed local Tokens'}</small></article></section>
  </section>;
}

function MixCard({ title, rows, zh, semantic = false }) {
  const shown = rows.slice(0, 6);
  const total = rows.reduce((sum, row) => sum + row.totalTokens, 0);
  const count = shown.length === rows.length ? shown.length : `${shown.length} / ${rows.length}`;
  return <section className="panel benefit-mix-card"><header className="panel-header"><h2>{title}</h2><span>{count} {zh ? '项' : 'items'}</span></header><div>{shown.length ? shown.map((row, index) => {
    const suppliedShare = finiteNumber(row.share);
    const share = Math.max(0, Math.min(1, suppliedShare ?? (total ? row.totalTokens / total : 0)));
    const color = semantic ? TOKEN_MIX_COLORS[row.id] : CONSUMPTION_PALETTE[index % CONSUMPTION_PALETTE.length];
    return <article key={row.id} style={{ '--mix-color': color }}><span>{String(index + 1).padStart(2,'0')}</span><div><b title={row.label}>{row.label}</b><i><em style={{ width: share > 0 ? `${Math.max(2, share * 100)}%` : '0%' }}/></i></div><strong>{compact(row.totalTokens)}<small>{percent(share)}</small></strong></article>;
  }) : <p>{zh ? '当前没有可归因记录' : 'No attributable records yet'}</p>}</div></section>;
}

export function BenefitDistributionView({ provider, zh }) {
  const tokenTypeRows = [
    { id: 'input', label: zh ? '输入（含缓存写）' : 'Input + cache write', totalTokens: provider.lifetimeTotals.inputTokens + provider.lifetimeTotals.cacheWriteInputTokens },
    { id: 'cache', label: zh ? '缓存读' : 'Cache read', totalTokens: provider.lifetimeTotals.cacheReadInputTokens },
    { id: 'output', label: zh ? '输出' : 'Output', totalTokens: provider.lifetimeTotals.outputTokens },
    { id: 'reasoning', label: zh ? '推理' : 'Reasoning', totalTokens: provider.lifetimeTotals.reasoningOutputTokens },
  ].sort((a,b) => b.totalTokens - a.totalTokens);
  const panelProps = providerPanelProps(provider);
  return <section className="benefit-view-stack" {...panelProps}><section className="benefit-section-heading"><div><span>{zh ? '单一订阅构成' : 'ONE-BENEFIT BREAKDOWN'}</span><h2><LayoutDashboard size={16}/>{zh ? `${provider.label} 的消耗构成` : `${provider.label} consumption mix`}</h2><p>{zh ? '构成来自本机 Agent 日志，不代表供应商账单内部权重。' : 'The mix comes from local Agent logs and is not the provider billing weight.'}</p></div><strong>{compact(provider.lifetimeTotals.totalTokens)} Token</strong></section><div className="benefit-distribution-grid"><MixCard title={zh ? '模型' : 'Models'} rows={provider.modelRows} zh={zh}/><MixCard title={zh ? 'Token 类型' : 'Token types'} rows={tokenTypeRows} zh={zh} semantic/><MixCard title={zh ? '推理强度' : 'Reasoning effort'} rows={provider.effortRows} zh={zh}/><MixCard title={zh ? '项目 / 工作负载' : 'Projects / workload'} rows={provider.projectRows} zh={zh}/></div><div className="benefit-attribution-note"><ShieldCheck size={14}/><span>{zh ? `归因范围：${provider.sources.join('、')}。无法确认账户归属的数据不会被强行放进这个订阅。` : `Attribution scope: ${provider.sources.join(', ')}. Data without reliable account attribution is not forced into this benefit.`}</span></div></section>;
}

function RecordsTable({ label, columns, rows, rowClassName = '', renderCells }) {
  return <div className="benefit-records-table" role="table" aria-label={label} aria-colcount={columns.length} aria-rowcount={rows.length + 1}>
    <div className="benefit-records-rowgroup" role="rowgroup">
      <div className={`benefit-records-head${rowClassName ? ` ${rowClassName}-head` : ''}`} role="row" aria-rowindex={1}>
        {columns.map((column, index) => <span role="columnheader" aria-colindex={index + 1} key={column}>{column}</span>)}
      </div>
    </div>
    <div className="benefit-records-rowgroup benefit-records-body" role="rowgroup">
      {rows.map((row, index) => <div className={`benefit-records-row benefit-record-card${rowClassName ? ` ${rowClassName}-row` : ''}`} role="row" aria-rowindex={index + 2} key={row.key}>{renderCells(row, columns)}</div>)}
    </div>
  </div>;
}

function recordCell(content, label, index, { strong = false, className = '', title } = {}) {
  const Element = strong ? 'strong' : 'span';
  return <Element className={`benefit-record-cell${className ? ` ${className}` : ''}`} role="cell" aria-colindex={index + 1} data-label={label} title={title}>{content}</Element>;
}

export function BenefitRecordsView({ provider, zh }) {
  const [kind, setKind] = useState('quota');
  const rows = provider.observationLog.slice(0, 100).map((row, index) => ({ ...row, key: `${row.observedAt}-${row.id}-${index}` }));
  const usageRows = provider.usageRecords.slice(0, 100).map((row) => ({ ...row, key: row.id }));
  const shown = kind === 'quota' ? rows.length : usageRows.length;
  const total = kind === 'quota' ? provider.observationLog.length : provider.usageRecords.length;
  const quotaColumns = zh ? ['时间', '窗口', '官方已用', '本机 TOKEN', '覆盖率', '重置'] : ['Observed', 'Window', 'Official used', 'Local Tokens', 'Coverage', 'Reset'];
  const usageColumns = zh ? ['时间', '模型', 'TOKEN', '请求', '推理强度', 'API 等价价值'] : ['Time', 'Model', 'Tokens', 'Requests', 'Reasoning', 'API equivalent'];
  const panelProps = providerPanelProps(provider);

  return <section className="panel benefit-records-panel" {...panelProps}>
    <header className="panel-header"><div><h2><FileText size={15}/>{zh ? '观测明细' : 'Observation log'}</h2><p>{zh ? '脱敏额度快照与本机用量事实；不包含凭据、Cookie、完整路径或原始响应' : 'Sanitized quota snapshots and local usage facts; no credentials, cookies, full paths, or raw responses'}</p></div><div className="benefit-record-kind"><button type="button" aria-pressed={kind === 'quota'} className={kind === 'quota' ? 'active' : ''} onClick={() => setKind('quota')}>{zh ? '额度快照' : 'Quota snapshots'}</button><button type="button" aria-pressed={kind === 'usage'} className={kind === 'usage' ? 'active' : ''} onClick={() => setKind('usage')}>{zh ? '本机用量' : 'Local usage'}</button><span>{shown} / {total}</span></div></header>
    {kind === 'quota' ? (rows.length ? <RecordsTable
      label={zh ? `${provider.label}额度观测明细` : `${provider.label} quota observation log`}
      columns={quotaColumns}
      rows={rows}
      renderCells={(row, columns) => {
        const localObserved = row.localObserved ?? finiteNumber(row.localCoverage) > 0;
        return <>
          {recordCell(dateLabel(row.observedAt, zh, true), columns[0], 0)}
          {recordCell(row.label, columns[1], 1)}
          {recordCell(row.usedPercent == null ? '—' : `${Number(row.usedPercent).toFixed(1)}%`, columns[2], 2, { strong: true, className: 'evidence-official' })}
          {recordCell(localObserved ? compact(row.localTotals?.totalTokens || 0) : '—', columns[3], 3, { className: 'evidence-local' })}
          {recordCell(row.localCoverage == null ? '—' : percent(row.localCoverage), columns[4], 4, { className: 'evidence-local' })}
          {recordCell(row.resetsAt ? dateLabel(row.resetsAt, zh, true) : '—', columns[5], 5)}
        </>;
      }}
    /> : <EmptyEvidence zh={zh} title={zh ? '还没有额度观测记录' : 'No quota observations yet'} body={provider.quotaObservation?.state === 'unavailable' ? (zh ? '该账户当前不提供稳定的可读额度；可切换到“本机用量”查看已归因 Token。' : 'This account exposes no stable quota; switch to Local usage for attributed Tokens.') : (zh ? '点击“刷新额度”后，从首个成功的脱敏快照开始积累。' : 'Refresh quotas to begin with the first successful sanitized snapshot.')}/>) : (usageRows.length ? <RecordsTable
      label={zh ? `${provider.label}本机用量明细` : `${provider.label} local usage log`}
      columns={usageColumns}
      rows={usageRows}
      rowClassName="benefit-usage"
      renderCells={(row, columns) => <>
        {recordCell(dateLabel(row.observedAt, zh, true), columns[0], 0)}
        {recordCell(row.model, columns[1], 1, { title: row.model })}
        {recordCell(compact(row.totalTokens), columns[2], 2, { strong: true, className: 'evidence-local' })}
        {recordCell(row.requestCount.toLocaleString(), columns[3], 3, { className: 'evidence-local' })}
        {recordCell(row.reasoningEffort || (zh ? '未记录' : 'Not recorded'), columns[4], 4, { className: 'evidence-local' })}
        {recordCell(money(row.costMicros / 1e6), columns[5], 5, { className: 'evidence-derived' })}
      </>}
    /> : <EmptyEvidence zh={zh} title={zh ? '还没有该账户的本机用量' : 'No local usage for this account'} body={zh ? '供应商额度与本机日志相互独立；有额度不等于这台设备已经产生 Token。' : 'Provider quota and local logs are independent; having a quota does not mean this device produced Tokens.'}/>)}
    <footer><Clock3 size={13}/><span>{kind === 'quota' ? (zh ? '额度历史由本地服务管理并按时间降采样；重复读取缓存不会追加相同快照。' : 'Quota history is backend-owned and downsampled over time; cached reads do not append duplicates.') : (zh ? '本机用量按原始事实桶展示；完整路径与对话内容从不进入页面。' : 'Local usage uses raw fact buckets; full paths and conversation content never enter the page.')}</span></footer>
  </section>;
}
