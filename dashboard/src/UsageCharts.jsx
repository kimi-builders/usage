import { useMemo, useRef, useState } from 'react';
import { CalendarDays, Cpu, Folder, Monitor, Terminal } from 'lucide-react';
import { heatmapView } from './analytics.js';
import { compact, duration, percent, sourceLabel } from './format.js';
import { ToolGlyph } from './tool-glyphs.js';

const COLORS = {
  input: '#1a88ff', cache: '#20d39a', output: '#c5c8cc', reasoning: '#f6a609', avg: '#8a9099',
};

const METRICS = [
  { id: 'tokens', zh: 'Token', en: 'Token' },
  { id: 'cost', zh: '费用', en: 'Cost' },
  { id: 'duration', zh: '时长', en: 'Time' },
];

function MetricTabs({ active, onChange, zh, prompts = false }) {
  const metrics = prompts ? [...METRICS, { id: 'prompts', zh: '用户消息', en: 'User messages' }] : METRICS;
  return <div className="mini-tabs" aria-label={zh ? '图表指标' : 'Chart metric'}>{metrics.map((item) => <button type="button" key={item.id} className={active === item.id ? 'active' : ''} onClick={() => onChange(item.id)}>{zh ? item.zh : item.en}</button>)}</div>;
}

function costText(micros, currency) {
  const value = (micros / 1e6) * (currency === 'cny' ? 7.2 : 1);
  return `${currency === 'cny' ? '¥' : '$'}${value >= 0.01 ? value.toFixed(2) : value.toFixed(4)}`;
}

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
  return `${compact(row.totalTokens || 0)} tokens`;
}

function axisText(value, metric, currency) {
  if (value === 0) return '0';
  if (metric === 'cost') return costText(value, currency);
  if (metric === 'duration') {
    const hours = value / 3600;
    return hours >= 1 ? `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)}h` : `${Math.round(value / 60)}m`;
  }
  return compact(value);
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

function tooltipLeft(event, viewport) {
  if (!viewport) return 8;
  const container = viewport.getBoundingClientRect();
  const target = event.currentTarget.getBoundingClientRect();
  const center = target.left + target.width / 2 - container.left;
  return Math.max(8, Math.min(container.width - 252, center - 122));
}

function TokenBreakdown({ row, zh }) {
  const values = [
    [zh ? '输入（含缓存写）' : 'Input (incl. cache write)', (row.inputTokens || 0) + (row.cacheWriteInputTokens || 0), COLORS.input],
    [zh ? '缓存读' : 'Cache read', row.cacheReadInputTokens || 0, COLORS.cache],
    [zh ? '输出' : 'Output', row.outputTokens || 0, COLORS.output],
    [zh ? '推理' : 'Reasoning', row.reasoningOutputTokens || 0, COLORS.reasoning],
  ];
  return <div className="trend-tooltip-breakdown">{values.map(([label, value, color]) => <span key={label}><i style={{ background: color }}/><em>{label}</em><b>{compact(value)}</b></span>)}</div>;
}

function TrendCore({ rows, metric, zh, currency, average = true, plotHeight = 192, tooltipTitle, tooltipNote }) {
  const viewport = useRef(null);
  const [hovered, setHovered] = useState(null);
  const max = Math.max(0, ...rows.map((row) => metricValue(row, metric)));
  if (max <= 0) return <div className="chart-empty">{zh ? '该范围内暂无数据' : 'No data in this range'}</div>;

  const count = rows.length;
  const padL = 46; const padR = 10; const padT = 12; const padB = 22;
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
        {ticks.map((tick, index) => <g key={index}><line x1={padL} y1={y(tick)} x2={width - padR} y2={y(tick)} className="trend-grid-line"/><text x={padL - 8} y={y(tick) + 3.5} textAnchor="end" className="trend-axis-text">{axisText(tick, metric, currency)}</text></g>)}
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
            return <rect key={segment} x={x} y={cursor} width={barWidth} height={Math.max(barHeight, 1.5)} rx="1" fill={fill}/>;
          })}</g>;
        })}
        {averagePath ? <path d={averagePath} className="trend-average-line"/> : null}
        {rows.map((row, index) => labels.has(index) ? <text key={row.key} x={index === 0 ? padL - 4 : index === count - 1 ? width - padR + 4 : padL + index * slot + slot / 2} y={height - 6} textAnchor={index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle'} className="trend-axis-text">{row.label}</text> : null)}
      </svg>
      <div className="trend-hit-zones" style={{ left: `${padL / width * 100}%`, top: `${padT / height * 100}%`, width: `${plotWidth / width * 100}%`, height: `${plotHeight / height * 100}%` }}>{rows.map((row, index) => <button key={row.key} type="button" aria-label={`${row.label}: ${metricText(row, metric, zh, currency)}`} onMouseEnter={(event) => setHovered({ index, left: tooltipLeft(event, viewport.current) })} onFocus={(event) => setHovered({ index, left: tooltipLeft(event, viewport.current) })} onBlur={() => setHovered(null)}/>)}</div>
    </div></div></div>
    {active && hovered ? <aside className="trend-tooltip" role="tooltip" style={{ left: hovered.left }}><strong>{tooltipTitle ? tooltipTitle(active) : active.label}</strong><div className="trend-tooltip-total"><span>{metricText(active, metric, zh, currency)}</span>{metric === 'tokens' ? <small>{zh ? '命中率' : 'hit'} {cacheHit(active)}</small> : null}</div>{tooltipNote?.(active, hovered.index)}{metric === 'tokens' ? <TokenBreakdown row={active} zh={zh}/> : null}<footer>{zh ? '标准 API 估算' : 'Standard API estimate'} · {costText(active.costMicros || 0, currency)} · {zh ? '活跃' : 'active'} {duration(active.activeSeconds || 0, zh)} · {active.userMessageCount || 0} {zh ? '条用户消息' : 'user messages'}</footer></aside> : null}
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

export function DailyTrend({ report, zh, metric, onMetric, currency }) {
  const title = report.seriesUnit === 'hour' ? (zh ? '每小时趋势' : 'Hourly trend') : report.seriesUnit === 'week' ? (zh ? '每周趋势' : 'Weekly trend') : (zh ? '每日趋势' : 'Daily trend');
  return <section className="panel trend-panel" id="trend"><header className="panel-header"><div><h2>{title}</h2><p>{timezoneLabel()} · {zh ? '30 分钟事实桶聚合' : '30-minute fact buckets'}</p></div><div className="chart-controls">{metric === 'tokens' ? <div className="chart-legend"><span><i style={{ background: COLORS.input }}/>{zh ? '输入（含缓存写）' : 'Input'}</span><span><i style={{ background: COLORS.cache }}/>{zh ? '缓存读' : 'Cache read'}</span><span><i style={{ background: COLORS.output }}/>{zh ? '输出' : 'Output'}</span><span><i style={{ background: COLORS.reasoning }}/>{zh ? '推理' : 'Reasoning'}</span><span><i className="dash"/>{zh ? '7 日均值' : '7-slot avg'}</span></div> : null}<MetricTabs active={metric} onChange={onMetric} zh={zh}/></div></header><div className="trend-chart"><TrendCore rows={report.series} metric={metric} zh={zh} currency={currency}/></div></section>;
}

export function WeeklyTrend({ report, zh, currency }) {
  const current = report.weeklySeries.at(-1)?.totalTokens || 0;
  const previous = report.weeklySeries.at(-2)?.totalTokens || 0;
  const change = current >= previous ? 'up' : 'down';
  return <section className="panel weekly-panel"><header className="panel-header"><div><h2>{zh ? '自然周趋势' : 'Natural-week trend'}</h2><p>{zh ? `截至所选范围末尾的 12 周 · 周一 00:00 → 下周一 00:00 · ${timezoneLabel()}` : `12 weeks ending at the selection · Monday 00:00 → next Monday 00:00 · ${timezoneLabel()}`}</p></div></header><div className="weekly-summary"><span>{zh ? '本周' : 'This week'} <b>{compact(current)}</b></span><span>{zh ? '上周' : 'Last week'} <b>{compact(previous)}</b></span><em className={change}>{percentDelta(current, previous)}</em></div><div className="weekly-chart"><TrendCore rows={report.weeklySeries} metric="tokens" zh={zh} currency={currency} average={false} plotHeight={140} tooltipTitle={(row) => `${dateStamp(row.key)} → ${weekEnd(row.key)}`} tooltipNote={(row, index) => <p className="trend-tooltip-note">{zh ? '环比' : 'WoW'} {percentDelta(row.totalTokens, report.weeklySeries[index - 1]?.totalTokens || 0)}</p>}/></div></section>;
}

function heatValueText(value, metric, zh, currency) {
  if (metric === 'cost') return costText(value, currency);
  if (metric === 'duration') return duration(value, zh);
  if (metric === 'prompts') return `${Math.round(value)} ${zh ? '条' : 'msgs'}`;
  return `${compact(value)} tokens`;
}

export function ActivityHeatmap({ report, zh, metric, onMetric, currency }) {
  const weekdays = zh ? ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const weekdayShort = zh ? ['一', '二', '三', '四', '五', '六', '日'] : ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  const view = useMemo(() => heatmapView(report.heatmap, metric), [report.heatmap, metric]);
  const [hovered, setHovered] = useState(null);
  const selectedCell = hovered ? report.heatmap.cells[hovered.day][hovered.hour] : null;
  const selectedHit = selectedCell && (selectedCell.inputTokens + selectedCell.cacheWriteInputTokens + selectedCell.cacheReadInputTokens) > 0
    ? selectedCell.cacheReadInputTokens / (selectedCell.inputTokens + selectedCell.cacheWriteInputTokens + selectedCell.cacheReadInputTokens)
    : null;
  const offsetMinutes = -new Date().getTimezoneOffset();
  const offset = offsetMinutes / 60;
  const timezone = `GMT${offset >= 0 ? '+' : ''}${Number.isInteger(offset) ? offset : offset.toFixed(1)}`;
  return <div className="activity-layout" id="activity">
    <section className="panel heatmap-panel" onMouseLeave={() => setHovered(null)}>
      <header className="panel-header"><div><h2>{zh ? '分时活跃' : 'Activity by hour'}</h2><p>{zh ? '星期 × 本地小时 · 新版 Collector 精确到小时' : 'Weekday × local hour · exact hourly facts from current collectors'}</p></div><MetricTabs zh={zh} active={metric} onChange={onMetric} prompts/></header>
      <div className="heatmap-scroll"><div className="heatmap-grid">{report.heatmap.cells.map((row, day) => <div className="heatmap-row" key={weekdays[day]}><span>{weekdayShort[day]}</span><div>{row.map((cell, hour) => {
        const value = metric === 'cost' ? cell.costMicros : metric === 'duration' ? cell.activeSeconds : metric === 'prompts' ? cell.userMessageCount : cell.totalTokens;
        const level = value > 0 && view.max ? Math.max(1, Math.ceil((value / view.max) * 6)) : 0;
        const title = `${weekdays[day]} ${String(hour).padStart(2, '0')}:00 · ${compact(cell.totalTokens)} tokens · ${costText(cell.costMicros, currency)} · ${duration(cell.activeSeconds, zh)} · ${cell.userMessageCount} ${zh ? '条用户消息' : 'user messages'} · ${zh ? '输入' : 'input'} ${compact(cell.inputTokens + cell.cacheWriteInputTokens)} · ${zh ? '缓存读' : 'cache'} ${compact(cell.cacheReadInputTokens)} · ${zh ? '输出' : 'output'} ${compact(cell.outputTokens)} · ${zh ? '推理' : 'reasoning'} ${compact(cell.reasoningOutputTokens)}`;
        const peak = view.peak?.day === day && view.peak?.hour === hour && value > 0;
        if (!cell.observed) return <i key={hour} className="heatmap-missing" aria-hidden="true"/>;
        return <button type="button" key={hour} data-level={level} data-peak={peak ? 'true' : undefined} title={title} aria-label={title} onMouseEnter={() => setHovered({ day, hour })} onFocus={() => setHovered({ day, hour })} onBlur={() => setHovered(null)}/>;
      })}</div></div>)}<div/><div className="heatmap-hours">{Array.from({ length: 24 }, (_, hour) => <span key={hour}>{hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}</span>)}</div></div></div>
      {hovered && selectedCell ? <aside className="heatmap-tooltip" role="tooltip">
        <header><strong>{weekdays[hovered.day]} {String(hovered.hour).padStart(2, '0')}:00</strong><span>{compact(selectedCell.totalTokens)} tokens</span><small>{zh ? '命中率' : 'hit'} {selectedHit == null ? '—' : percent(selectedHit)}</small></header>
        <div><span><i style={{ background: COLORS.input }}/>{zh ? '输入（含缓存写）' : 'Input + cache write'}</span><b>{compact(selectedCell.inputTokens + selectedCell.cacheWriteInputTokens)}</b></div>
        <div><span><i style={{ background: COLORS.cache }}/>{zh ? '缓存读' : 'Cache read'}</span><b>{compact(selectedCell.cacheReadInputTokens)}</b></div>
        <div><span><i style={{ background: COLORS.output }}/>{zh ? '输出' : 'Output'}</span><b>{compact(selectedCell.outputTokens)}</b></div>
        <div><span><i style={{ background: COLORS.reasoning }}/>{zh ? '推理' : 'Reasoning'}</span><b>{compact(selectedCell.reasoningOutputTokens)}</b></div>
        <footer>{zh ? '估费' : 'Cost'} {costText(selectedCell.costMicros, currency)} · {zh ? '活跃' : 'Active'} {duration(selectedCell.activeSeconds, zh)} · {selectedCell.userMessageCount} {zh ? '条用户消息' : 'user messages'}</footer>
      </aside> : null}
      <footer className="heatmap-footer"><div><span className="heatmap-ramp"><em>{zh ? '少' : 'Less'}</em>{[1,2,3,4,5,6].map((level) => <i key={level} data-level={level}/>)}<em>{zh ? '多' : 'More'}</em></span><span><i className="legend-missing"/>{zh ? '描边 = 无数据（采集缺口）' : 'Dashed = no data (collection gap)'}</span><span>{zh ? '白圈 = 峰值 · 悬停查看数值' : 'White ring = peak · hover for values'}</span></div><span>{zh ? `时区：${timezone}（浏览器本地）` : `Timezone: ${timezone} (browser local)`}</span></footer>
    </section>
    <section className="panel busiest-panel"><header className="panel-header"><div><h2>{zh ? '最活跃时段' : 'Busiest slots'}</h2><p>{zh ? 'TOP 5 · 随热图指标联动' : 'Top 5 · follows heatmap metric'}</p></div></header><ol>{view.slots.length ? view.slots.map((slot, index) => <li key={`${slot.day}-${slot.hour}`}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{weekdays[slot.day]} {String(slot.hour).padStart(2, '0')}:00</b><i><em style={{ width: `${Math.max(2, slot.value / view.slots[0].value * 100)}%` }}/></i></div><strong>{heatValueText(slot.value, metric, zh, currency)}</strong></li>) : <p className="empty">{zh ? '当前范围暂无数据' : 'No data in this range'}</p>}</ol></section>
  </div>;
}

const DIST_ICONS = { source: Terminal, model: Cpu, project: Folder, device: Monitor };

export function DistributionCard({ type, rows, zh, currency }) {
  const [metric, setMetric] = useState('tokens');
  const labels = { source: zh ? 'Agent' : 'Agents', model: zh ? '模型' : 'Models', project: zh ? '项目' : 'Projects', device: zh ? '设备' : 'Devices' };
  const Icon = DIST_ICONS[type] || CalendarDays;
  const shown = [...rows].sort((a, b) => metric === 'cost' ? b.costMicros - a.costMicros : b.totalTokens - a.totalTokens).slice(0, 6);
  const total = shown.reduce((sum, row) => sum + (metric === 'cost' ? row.costMicros : row.totalTokens), 0);
  return <section className="panel distribution-card"><header className="panel-header"><h2><Icon size={14}/>{labels[type]}</h2><div className="tiny-tabs"><button type="button" className={metric === 'tokens' ? 'active' : ''} onClick={() => setMetric('tokens')}>Token</button><button type="button" className={metric === 'cost' ? 'active' : ''} onClick={() => setMetric('cost')}>{zh ? '费用' : 'Cost'}</button></div></header><div className="distribution-list">{shown.length ? shown.map((row, index) => {
    const value = metric === 'cost' ? row.costMicros : row.totalTokens;
    const share = total > 0 ? value / total : 0;
    return <div className="distribution-row" key={row.id}><span className="rank">{String(index + 1).padStart(2, '0')}</span><span className="distribution-name">{type === 'source' ? <ToolGlyph id={row.id} size={14}/> : null}<b title={row.label || row.id}>{type === 'source' ? sourceLabel(row.id) : row.label || row.id || (zh ? '未上传' : 'Not uploaded')}</b></span><span className="distribution-value">{metric === 'cost' ? costText(row.costMicros, currency) : compact(row.totalTokens)} <small>{percent(share)}</small>{metric === 'tokens' ? <em>{costText(row.costMicros, currency)}</em> : null}</span><span className="distribution-track"><i style={{ width: `${Math.max(2, share * 100)}%` }}/></span></div>;
  }) : <p className="empty">{type === 'project' ? (zh ? '项目名未采集；本地日志仍保持私有' : 'Project names were not collected; local logs remain private') : (zh ? '当前范围暂无数据' : 'No data in this range')}</p>}</div></section>;
}
