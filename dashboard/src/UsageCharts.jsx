import { useId, useMemo, useRef, useState } from 'react';
import { CalendarDays, Cpu, Folder, Monitor, Terminal } from 'lucide-react';
import { buildHeatmap, heatmapView } from './analytics.js';
import { HeatModeTabs, WeekPager, storedHeatMode, storeHeatMode } from './heat-controls.jsx';
import { addLocalWeeks, firstDataWeekStart, localWeekEnd, localWeekStart, weekLabel } from './week.js';
import { CHART_COLORS as COLORS } from './chart-colors.js';
import { compactMoney, compactNumber, displayMoney, distributionShare, duration, percent, sourceLabel } from './format.js';
import { ToolGlyph } from './tool-glyphs.js';

const METRICS = [
  { id: 'tokens', zh: 'Token', en: 'Token' },
  { id: 'cost', zh: '费用', en: 'Cost' },
  { id: 'duration', zh: '时长', en: 'Time' },
];

function MetricTabs({ active, onChange, zh, prompts = false, controlsId, items, className = 'mini-tabs' }) {
  const metrics = items || (prompts ? [...METRICS, { id: 'prompts', zh: '用户消息', en: 'User messages' }] : METRICS);
  const onKeyDown = (event) => {
    const current = metrics.findIndex((item) => item.id === active);
    let next = null;
    if (event.key === 'ArrowRight') next = (current + 1) % metrics.length;
    if (event.key === 'ArrowLeft') next = (current - 1 + metrics.length) % metrics.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = metrics.length - 1;
    if (next == null) return;
    event.preventDefault();
    onChange(metrics[next].id);
    event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[next]?.focus();
  };
  return <div className={className} role="tablist" aria-orientation="horizontal" aria-label={zh ? '图表指标' : 'Chart metric'}>{metrics.map((item) => <button type="button" role="tab" id={`${controlsId}-${item.id}-tab`} key={item.id} aria-controls={controlsId} aria-selected={active === item.id} tabIndex={active === item.id ? 0 : -1} className={active === item.id ? 'active' : ''} onKeyDown={onKeyDown} onClick={() => onChange(item.id)}>{zh ? item.zh : item.en}</button>)}</div>;
}

function costText(micros, currency) { return displayMoney(micros, currency); }
function compact(value, zh) { return compactNumber(value, zh ? 'zh' : 'en'); }

function timezoneLabel() {
  const offset = -new Date().getTimezoneOffset() / 60;
  return `GMT${offset >= 0 ? '+' : ''}${Number.isInteger(offset) ? offset : offset.toFixed(1)}`;
}

function metricValue(row, metric) {
  if (metric === 'cost') return row.costMicros || 0;
  if (metric === 'duration') return row.activeSeconds || 0;
  return row.totalTokens || 0;
}

function metricText(row, metric, zh, currency) {
  if (metric === 'cost') return costText(row.costMicros || 0, currency);
  if (metric === 'duration') return duration(row.activeSeconds || 0, zh);
  return `${compact(row.totalTokens || 0, zh)} tokens`;
}

function axisText(value, metric, currency, zh) {
  if (value === 0) return '0';
  if (metric === 'cost') return compactMoney(value, currency);
  if (metric === 'duration') {
    const hours = value / 3600;
    return hours >= 1 ? `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)}h` : `${Math.round(value / 60)}m`;
  }
  return compact(value, zh);
}

function cacheHit(row) {
  const input = (row.inputTokens || 0) + (row.cacheWriteInputTokens || 0) + (row.cacheReadInputTokens || 0);
  return input > 0 ? percent((row.cacheReadInputTokens || 0) / input) : '—';
}

function labelIndexes(length, target = 9) {
  if (length <= 0) return new Set();
  const step = Math.max(1, Math.ceil((length - 1) / Math.max(1, target - 1)));
  const result = new Set([0, length - 1]);
  for (let index = step; index < length - 1; index += step) {
    if (length - 1 - index >= Math.max(2, step)) result.add(index);
  }
  return result;
}

// Dock the tooltip to the side opposite the pointer so it never covers the
// bars the reader is sweeping toward next.
function tooltipLeft(event, viewport, tipWidth = 244) {
  if (!viewport) return 8;
  const container = viewport.getBoundingClientRect();
  const target = event.currentTarget.getBoundingClientRect();
  const center = target.left + target.width / 2 - container.left;
  return center < container.width / 2 ? Math.max(8, container.width - tipWidth - 8) : 8;
}

function TokenBreakdown({ row, zh }) {
  const values = [
    [zh ? '输入' : 'Input', row.inputTokens || 0, COLORS.input],
    [zh ? '缓存写' : 'Cache write', row.cacheWriteInputTokens || 0, COLORS.cacheWrite],
    [zh ? '缓存读' : 'Cache read', row.cacheReadInputTokens || 0, COLORS.cache],
    [zh ? '输出' : 'Output', row.outputTokens || 0, COLORS.output],
    [zh ? '推理' : 'Reasoning', row.reasoningOutputTokens || 0, COLORS.reasoning],
  ];
  return <div className="trend-tooltip-breakdown">{values.map(([label, value, color]) => <span key={label}><i style={{ background: color }}/><em>{label}</em><b>{compact(value, zh)}</b></span>)}</div>;
}

function trendFacts(row, zh, currency) {
  const facts = [
    `${compact(row.requestCount || 0, zh)} ${zh ? '次请求' : 'requests'}`,
    `${zh ? '标准 API 等价估算' : 'Standard API-equivalent estimate'} ${costText(row.costMicros || 0, currency)}`,
    `${zh ? '活跃' : 'active'} ${duration(row.activeSeconds || 0, zh)}`,
  ];
  if (row.userMessageCount != null) facts.push(`${compact(row.userMessageCount, zh)} ${zh ? '条用户消息' : 'user messages'}`);
  return facts.join(' · ');
}

function trendPointLabel(row, metric, zh, currency) {
  const tokens = [
    `${zh ? '输入' : 'input'} ${compact(row.inputTokens || 0, zh)}`,
    `${zh ? '缓存写' : 'cache write'} ${compact(row.cacheWriteInputTokens || 0, zh)}`,
    `${zh ? '缓存读' : 'cache read'} ${compact(row.cacheReadInputTokens || 0, zh)}`,
    `${zh ? '输出' : 'output'} ${compact(row.outputTokens || 0, zh)}`,
    `${zh ? '推理' : 'reasoning'} ${compact(row.reasoningOutputTokens || 0, zh)}`,
  ];
  return `${row.label}: ${metricText(row, metric, zh, currency)}; ${tokens.join('; ')}; ${trendFacts(row, zh, currency)}`;
}

function TrendCore({ rows, metric, zh, currency, average = true, plotHeight = 192, tooltipTitle, tooltipNote }) {
  const viewport = useRef(null);
  const pointRefs = useRef([]);
  const [hovered, setHovered] = useState(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const max = Math.max(0, ...rows.map((row) => metricValue(row, metric)));
  if (max <= 0) return <div className="chart-empty">{zh ? '该范围内暂无数据' : 'No data in this range'}</div>;

  const count = rows.length;
  const rovingIndex = Math.min(focusIndex, count - 1);
  const onPointKeyDown = (event, index) => {
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % count;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + count) % count;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = count - 1;
    if (next == null) return;
    event.preventDefault();
    setFocusIndex(next);
    pointRefs.current[next]?.focus();
  };
  const padL = metric === 'cost' ? 68 : 46; const padR = 10; const padT = 12; const padB = 22;
  const slot = Math.max(22, Math.min(64, Math.floor((980 - padL - padR) / Math.max(1, count))));
  const plotWidth = count * slot;
  const width = padL + plotWidth + padR;
  const height = padT + plotHeight + padB;
  const barWidth = slot * .62;
  const y = (value) => padT + plotHeight - value / max * plotHeight;
  const ticks = [0, 1, 2, 3, 4].map((step) => max * step / 4);
  const labels = labelIndexes(count);
  const active = hovered ? rows[hovered.index] : null;
  const points = average ? rows.map((_, index) => {
    const sample = rows.slice(Math.max(0, index - 6), index + 1);
    const mean = sample.reduce((sum, row) => sum + metricValue(row, metric), 0) / sample.length;
    return [padL + index * slot + slot / 2, y(mean)];
  }) : [];
  let averagePath = points.length ? `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}` : null;
  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = points[index - 1]; const [x2, y2] = points[index]; const mid = (x1 + x2) / 2;
    averagePath += ` C${mid.toFixed(1)},${y1.toFixed(1)} ${mid.toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
  }

  return <div className="trend-core" ref={viewport} onMouseLeave={() => setHovered(null)}>
    <div className="trend-svg-scroll"><div style={{ minWidth: Math.min(560, width) }}><div className="trend-svg-stage" style={{ maxWidth: width }}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={zh ? '趋势图' : 'Trend chart'}>
        {ticks.map((tick, index) => <g key={index}><line x1={padL} y1={y(tick)} x2={width - padR} y2={y(tick)} className="trend-grid-line"/><text x={padL - 8} y={y(tick) + 3.5} textAnchor="end" className="trend-axis-text">{axisText(tick, metric, currency, zh)}</text></g>)}
        {hovered ? <rect x={padL + hovered.index * slot} y={padT} width={slot} height={plotHeight} className="trend-hover-column"/> : null}
        {rows.map((row, index) => {
          const x = padL + index * slot + (slot - barWidth) / 2;
          if (metric !== 'tokens') {
            const value = metricValue(row, metric); const barHeight = value <= 0 ? 1 : Math.max(2, value / max * plotHeight);
            return <rect key={row.key} x={x} y={y(0) - barHeight} width={barWidth} height={barHeight} rx="1" className={value <= 0 ? 'trend-empty-bar' : 'trend-metric-bar'}/>;
          }
          const segments = [
            [(row.inputTokens || 0) + (row.cacheWriteInputTokens || 0), COLORS.input],
            [row.cacheReadInputTokens || 0, COLORS.cache],
            [row.outputTokens || 0, COLORS.output],
            [row.reasoningOutputTokens || 0, COLORS.reasoning],
          ];
          let cursor = y(0);
          return <g key={row.key}>{row.totalTokens <= 0 ? <rect x={x} y={cursor - 1} width={barWidth} height="1" className="trend-empty-bar"/> : null}{segments.map(([value, fill], segment) => {
            if (value <= 0) return null;
            const barHeight = value / max * plotHeight; cursor -= barHeight;
            return <rect key={segment} x={x} y={cursor} width={barWidth} height={Math.max(barHeight, 1.5)} rx="1" style={{ fill }}/>;
          })}</g>;
        })}
        {averagePath ? <path d={averagePath} className="trend-average-line"/> : null}
        {rows.map((row, index) => labels.has(index) ? <text key={row.key} x={index === 0 ? padL - 4 : index === count - 1 ? width - padR + 4 : padL + index * slot + slot / 2} y={height - 6} textAnchor={index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle'} className="trend-axis-text">{row.label}</text> : null)}
      </svg>
      <div className="trend-hit-zones" style={{ left: `${padL / width * 100}%`, top: `${padT / height * 100}%`, width: `${plotWidth / width * 100}%`, height: `${plotHeight / height * 100}%` }}>{rows.map((row, index) => <button ref={(node) => { pointRefs.current[index] = node; }} key={row.key} type="button" tabIndex={index === rovingIndex ? 0 : -1} aria-label={trendPointLabel(row, metric, zh, currency)} onKeyDown={(event) => onPointKeyDown(event, index)} onMouseEnter={(event) => setHovered({ index, left: tooltipLeft(event, viewport.current) })} onFocus={(event) => { setFocusIndex(index); setHovered({ index, left: tooltipLeft(event, viewport.current) }); }} onBlur={() => setHovered(null)}/>)}</div>
    </div></div></div>
    {active && hovered ? <aside className="trend-tooltip" role="tooltip" style={{ left: hovered.left }}><strong>{tooltipTitle ? tooltipTitle(active) : active.label}</strong><div className="trend-tooltip-total"><span>{metricText(active, metric, zh, currency)}</span>{metric === 'tokens' ? <small>{zh ? '命中率' : 'hit'} {cacheHit(active)}</small> : null}</div>{tooltipNote?.(active, hovered.index)}<TokenBreakdown row={active} zh={zh}/><footer>{trendFacts(active, zh, currency)}</footer></aside> : null}
  </div>;
}

function percentDelta(current, previous) {
  if (previous <= 0) return '—';
  const value = (current - previous) / previous * 100;
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function dateStamp(value) {
  const date = new Date(value); const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, '0'); const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekEnd(value) {
  const date = new Date(value); date.setDate(date.getDate() + 7); return dateStamp(date);
}

export function DailyTrend({ report, zh, currency, metric, onMetric }) {
  const metricPanelId = useId();
  const title = report.seriesUnit === 'hour' ? (zh ? '每小时趋势' : 'Hourly trend') : report.seriesUnit === 'week' ? (zh ? '每周趋势' : 'Weekly trend') : (zh ? '每日趋势' : 'Daily trend');
  return <section className="panel trend-panel" id="trend"><header className="panel-header"><div><h2>{title}</h2><p>{timezoneLabel()} · {zh ? '30 分钟事实桶聚合' : '30-minute fact buckets'}</p></div><div className="chart-controls">{metric === 'tokens' ? <div className="chart-legend"><span><i style={{ background: COLORS.input }}/>{zh ? '输入（含缓存写）' : 'Input + cache write'}</span><span><i style={{ background: COLORS.cache }}/>{zh ? '缓存读' : 'Cache read'}</span><span><i style={{ background: COLORS.output }}/>{zh ? '输出' : 'Output'}</span><span><i style={{ background: COLORS.reasoning }}/>{zh ? '推理' : 'Reasoning'}</span><span><i className="dash"/>{zh ? '7 日均值' : '7-slot avg'}</span></div> : null}<MetricTabs active={metric} onChange={onMetric} zh={zh} controlsId={metricPanelId}/></div></header><div className="trend-chart" id={metricPanelId} role="tabpanel" aria-labelledby={`${metricPanelId}-${metric}-tab`} tabIndex={0}><TrendCore rows={report.series} metric={metric} zh={zh} currency={currency}/></div></section>;
}

export function WeeklyTrend({ report, zh, currency }) {
  const current = report.weeklySeries.at(-1)?.totalTokens || 0;
  const previous = report.weeklySeries.at(-2)?.totalTokens || 0;
  const change = current >= previous ? 'up' : 'down';
  return <section className="panel weekly-panel"><header className="panel-header"><div><h2>{zh ? '自然周趋势' : 'Natural-week trend'}</h2><p>{zh ? `截至所选范围末尾的 12 周 · 周一 00:00 → 下周一 00:00 · ${timezoneLabel()}` : `12 weeks ending at the selection · Monday 00:00 → next Monday 00:00 · ${timezoneLabel()}`}</p></div></header><div className="weekly-summary"><span>{zh ? '本周' : 'This week'} <b>{compact(current, zh)}</b></span><span>{zh ? '上周' : 'Last week'} <b>{compact(previous, zh)}</b></span><em className={change}>{percentDelta(current, previous)}</em></div><div className="weekly-chart"><TrendCore rows={report.weeklySeries} metric="tokens" zh={zh} currency={currency} average={false} plotHeight={140} tooltipTitle={(row) => `${dateStamp(row.key)} → ${weekEnd(row.key)}`} tooltipNote={(row, index) => <p className="trend-tooltip-note">{zh ? '环比' : 'WoW'} {percentDelta(row.totalTokens, report.weeklySeries[index - 1]?.totalTokens || 0)}</p>}/></div></section>;
}

function heatValueText(value, metric, zh, currency) {
  if (metric === 'cost') return costText(value, currency);
  if (metric === 'duration') return duration(value, zh);
  if (metric === 'prompts') return `${compact(value, zh)} ${zh ? '条' : 'msgs'}`;
  return `${compact(value, zh)} tokens`;
}

export function ActivityHeatmap({ report, data, zh, currency, metric, onMetric }) {
  const metricPanelId = useId();
  const heatCellRefs = useRef(new Map());
  const [mode, setMode] = useState(() => storedHeatMode('kbu.usage.heat-mode.v1'));
  const [weekOffset, setWeekOffset] = useState(0);
  const weekdays = zh ? ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const weekdayShort = zh ? ['一', '二', '三', '四', '五', '六', '日'] : ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  const [hovered, setHovered] = useState(null);
  const [focusCell, setFocusCell] = useState(null);
  const snapshotTime = useMemo(() => {
    const value = new Date(data?.generatedAt || Date.now());
    return Number.isFinite(value.getTime()) ? value : new Date();
  }, [data]);
  const weekStartMs = addLocalWeeks(localWeekStart(snapshotTime), weekOffset).getTime();
  const weekEndMs = localWeekEnd(weekStartMs).getTime();
  const firstWeekMs = useMemo(() => firstDataWeekStart((data?.buckets || []).map((bucket) => bucket.bucketStart))?.getTime() || null, [data]);
  const weekHeatmap = useMemo(() => {
    if (mode !== 'week' || !data) return null;
    const inWeek = (value) => {
      const time = new Date(value).getTime();
      return Number.isFinite(time) && time >= weekStartMs && time < weekEndMs;
    };
    return buildHeatmap(
      (data.buckets || []).filter((bucket) => inWeek(bucket.bucketStart)),
      (data.activityHours || []).filter((hour) => inWeek(hour.hourStart)),
    );
  }, [mode, data, weekStartMs, weekEndMs]);
  const activeHeatmap = mode === 'week' && weekHeatmap ? weekHeatmap : report.heatmap;
  const view = useMemo(() => heatmapView(activeHeatmap, metric), [activeHeatmap, metric]);
  const cells = activeHeatmap.cells;
  const changeMode = (value) => { setMode(value); storeHeatMode('kbu.usage.heat-mode.v1', value); setHovered(null); setFocusCell(null); };
  const changeWeek = (offset) => { setWeekOffset(offset); setHovered(null); setFocusCell(null); };
  let firstObserved = null;
  for (let day = 0; day < cells.length && !firstObserved; day += 1) {
    const hour = cells[day].findIndex((cell) => cell.observed);
    if (hour >= 0) firstObserved = { day, hour };
  }
  const rovingCell = focusCell && cells[focusCell.day]?.[focusCell.hour]?.observed ? focusCell : firstObserved;
  const onHeatmapKeyDown = (event, day, hour) => {
    let next = null;
    const rowLength = cells[day].length;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      for (let step = 1; step < rowLength; step += 1) {
        const candidate = (hour + direction * step + rowLength) % rowLength;
        if (cells[day][candidate]?.observed) { next = { day, hour: candidate }; break; }
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
      const candidate = cells[day].findIndex((cell) => cell.observed);
      if (candidate >= 0) next = { day, hour: candidate };
    }
    if (event.key === 'End') {
      const candidate = cells[day].findLastIndex((cell) => cell.observed);
      if (candidate >= 0) next = { day, hour: candidate };
    }
    if (!next) return;
    event.preventDefault();
    setFocusCell(next);
    heatCellRefs.current.get(`${next.day}-${next.hour}`)?.focus();
  };
  const selectedCell = hovered ? report.heatmap.cells[hovered.day][hovered.hour] : null;
  const selectedHit = selectedCell && (selectedCell.inputTokens + selectedCell.cacheWriteInputTokens + selectedCell.cacheReadInputTokens) > 0
    ? selectedCell.cacheReadInputTokens / (selectedCell.inputTokens + selectedCell.cacheWriteInputTokens + selectedCell.cacheReadInputTokens)
    : null;
  const offsetMinutes = -new Date().getTimezoneOffset();
  const offset = offsetMinutes / 60;
  const timezone = `GMT${offset >= 0 ? '+' : ''}${Number.isInteger(offset) ? offset : offset.toFixed(1)}`;
  return <div className="activity-layout" id="activity">
    <section className="panel heatmap-panel" onMouseLeave={() => setHovered(null)}>
      <header className="panel-header"><div><h2>{zh ? '用量热力图' : 'Activity heatmap'}</h2><p>{mode === 'week' ? (zh ? `${weekLabel(weekStartMs, zh)} · 单周实际用量` : `${weekLabel(weekStartMs, zh)} · single-week actuals`) : (zh ? '聚合 · 星期 × 本地小时 · 窗口跟随顶部筛选器' : 'Aggregate · weekday × local hour · window follows the filter bar')}</p></div><MetricTabs zh={zh} active={metric} onChange={onMetric} prompts controlsId={metricPanelId}/></header>
      <div className="heatmap-controls"><HeatModeTabs mode={mode} onChange={changeMode} zh={zh} label={zh ? '热图模式' : 'Heatmap mode'}/>{mode === 'week' ? <WeekPager label={weekLabel(weekStartMs, zh)} canPrev={firstWeekMs != null && weekStartMs > firstWeekMs} canNext={weekOffset < 0} onPrev={() => changeWeek(weekOffset - 1)} onNext={() => changeWeek(weekOffset + 1)} onCurrent={() => changeWeek(0)} showCurrent={weekOffset < 0} zh={zh} ariaLabel={zh ? '选择周' : 'Choose week'}/> : <span className="heat-mode-note">{zh ? '聚合所选范围内的星期 × 小时' : 'Aggregates weekday × hour across the selected range'}</span>}</div>
      <div className="heatmap-scroll" id={metricPanelId} role="tabpanel" aria-labelledby={`${metricPanelId}-${metric}-tab`} tabIndex={0}><div className="heatmap-grid">{report.heatmap.cells.map((row, day) => <div className="heatmap-row" key={weekdays[day]}><span>{weekdayShort[day]}</span><div>{row.map((cell, hour) => {
        const value = metric === 'cost' ? cell.costMicros : metric === 'duration' ? cell.activeSeconds : metric === 'prompts' ? cell.userMessageCount : cell.totalTokens;
        const level = value > 0 && view.max ? Math.max(1, Math.ceil((value / view.max) * 6)) : 0;
        const title = `${weekdays[day]} ${String(hour).padStart(2, '0')}:00 · ${compact(cell.totalTokens, zh)} tokens · ${costText(cell.costMicros, currency)} · ${duration(cell.activeSeconds, zh)} · ${compact(cell.userMessageCount, zh)} ${zh ? '条用户消息' : 'user messages'} · ${zh ? '输入' : 'input'} ${compact(cell.inputTokens + cell.cacheWriteInputTokens, zh)} · ${zh ? '缓存读' : 'cache'} ${compact(cell.cacheReadInputTokens, zh)} · ${zh ? '输出' : 'output'} ${compact(cell.outputTokens, zh)} · ${zh ? '推理' : 'reasoning'} ${compact(cell.reasoningOutputTokens, zh)}`;
        const peak = view.peak?.day === day && view.peak?.hour === hour && value > 0;
        if (!cell.observed) return <i key={hour} className="heatmap-missing" aria-hidden="true"/>;
        return <button ref={(node) => { const key = `${day}-${hour}`; if (node) heatCellRefs.current.set(key, node); else heatCellRefs.current.delete(key); }} type="button" key={hour} tabIndex={rovingCell?.day === day && rovingCell?.hour === hour ? 0 : -1} data-level={level} data-peak={peak ? 'true' : undefined} aria-label={title} onKeyDown={(event) => onHeatmapKeyDown(event, day, hour)} onMouseEnter={() => setHovered({ day, hour })} onFocus={() => { setFocusCell({ day, hour }); setHovered({ day, hour }); }} onBlur={() => setHovered(null)}/>;
      })}</div></div>)}<div/><div className="heatmap-hours">{Array.from({ length: 24 }, (_, hour) => <span key={hour}>{hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}</span>)}</div></div></div>
      {hovered && selectedCell ? <aside className="heatmap-tooltip" data-dock={hovered.hour < 12 ? 'r' : 'l'} role="tooltip">
        <header><strong>{weekdays[hovered.day]} {String(hovered.hour).padStart(2, '0')}:00</strong><span>{compact(selectedCell.totalTokens, zh)} tokens</span><small>{zh ? '命中率' : 'hit'} {selectedHit == null ? '—' : percent(selectedHit)}</small></header>
        <div><span><i style={{ background: COLORS.input }}/>{zh ? '输入（含缓存写）' : 'Input + cache write'}</span><b>{compact(selectedCell.inputTokens + selectedCell.cacheWriteInputTokens, zh)}</b></div>
        <div><span><i style={{ background: COLORS.cache }}/>{zh ? '缓存读' : 'Cache read'}</span><b>{compact(selectedCell.cacheReadInputTokens, zh)}</b></div>
        <div><span><i style={{ background: COLORS.output }}/>{zh ? '输出' : 'Output'}</span><b>{compact(selectedCell.outputTokens, zh)}</b></div>
        <div><span><i style={{ background: COLORS.reasoning }}/>{zh ? '推理' : 'Reasoning'}</span><b>{compact(selectedCell.reasoningOutputTokens, zh)}</b></div>
        <footer>{zh ? '标准 API 等价估算' : 'Standard API-equivalent estimate'} {costText(selectedCell.costMicros, currency)} · {zh ? '活跃' : 'Active'} {duration(selectedCell.activeSeconds, zh)} · {compact(selectedCell.userMessageCount, zh)} {zh ? '条用户消息' : 'user messages'}</footer>
      </aside> : null}
      <footer className="heatmap-footer"><div><span className="heatmap-ramp"><em>{zh ? '少' : 'Less'}</em>{[1,2,3,4,5,6].map((level) => <i key={level} data-level={level}/>)}<em>{zh ? '多' : 'More'}</em></span><span><i className="legend-missing"/>{zh ? '描边 = 未观测' : 'Dashed = not observed'}</span><span>{zh ? '白圈 = 峰值 · 悬停查看数值' : 'White ring = peak · hover for values'}</span></div><span>{zh ? `时区：${timezone}（浏览器本地）` : `Timezone: ${timezone} (browser local)`}</span></footer>
    </section>
    <section className="panel busiest-panel"><header className="panel-header"><div><h2>{zh ? '最活跃时段' : 'Busiest slots'}</h2><p>{zh ? 'TOP 5 · 随热图指标联动' : 'Top 5 · follows heatmap metric'}</p></div></header><ol>{view.slots.length ? view.slots.map((slot, index) => <li key={`${slot.day}-${slot.hour}`}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{weekdays[slot.day]} {String(slot.hour).padStart(2, '0')}:00</b><i><em style={{ width: `${Math.max(2, slot.value / view.slots[0].value * 100)}%` }}/></i></div><strong>{heatValueText(slot.value, metric, zh, currency)}</strong></li>) : <li className="empty">{zh ? '当前范围暂无数据' : 'No data in this range'}</li>}</ol></section>
  </div>;
}

const DIST_ICONS = { source: Terminal, model: Cpu, project: Folder, device: Monitor };
const DIST_METRICS = [
  { id: 'tokens', zh: 'Token', en: 'Token' },
  { id: 'cost', zh: '费用', en: 'Cost' },
];

export function DistributionCard({ type, rows, zh, currency }) {
  const metricPanelId = useId();
  const [metric, setMetric] = useState('tokens');
  const labels = { source: zh ? 'Agent' : 'Agents', model: zh ? '模型' : 'Models', project: zh ? '项目' : 'Projects', device: zh ? '设备' : 'Devices' };
  const Icon = DIST_ICONS[type] || CalendarDays;
  const shown = [...rows].sort((a, b) => metric === 'cost' ? b.costMicros - a.costMicros : b.totalTokens - a.totalTokens).slice(0, 6);
  return <section className="panel distribution-card"><header className="panel-header"><h2><Icon size={14}/>{labels[type]}</h2><MetricTabs active={metric} onChange={setMetric} zh={zh} items={DIST_METRICS} className="tiny-tabs" controlsId={metricPanelId}/></header><div className="distribution-list" id={metricPanelId} role="tabpanel" aria-labelledby={`${metricPanelId}-${metric}-tab`} tabIndex={0}>{shown.length ? shown.map((row, index) => {
    const share = distributionShare(rows, row, metric);
    return <div className="distribution-row" key={row.id}><span className="rank">{String(index + 1).padStart(2, '0')}</span><span className="distribution-name">{type === 'source' ? <ToolGlyph id={row.id} size={14}/> : null}<b title={row.label || row.id}>{type === 'source' ? sourceLabel(row.id) : row.label || row.id || (zh ? '未上传' : 'Not uploaded')}</b></span><span className="distribution-value"><b>{metric === 'cost' ? costText(row.costMicros, currency) : compact(row.totalTokens, zh)}<small> · {percent(share)}</small></b><em>{metric === 'cost' ? `${compact(row.totalTokens, zh)} tokens` : costText(row.costMicros, currency)}</em></span><span className="distribution-track"><i style={{ width: `${Math.max(2, share * 100)}%` }}/></span></div>;
  }) : <p className="empty">{type === 'project' ? (zh ? '项目名未采集；本地日志仍保持私有' : 'Project names were not collected; local logs remain private') : (zh ? '当前范围暂无数据' : 'No data in this range')}</p>}</div></section>;
}
