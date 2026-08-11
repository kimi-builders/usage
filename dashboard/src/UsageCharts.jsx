import { useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { CalendarDays, Clock3, Cpu, Folder, Monitor, Terminal } from 'lucide-react';
import { heatmapView } from './analytics.js';
import { compact, duration, money, percent, sourceLabel } from './format.js';
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

function TrendTooltip({ active, payload, label, zh, metric, currency }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return <div className="usage-tooltip">
    <strong>{label} · {metric === 'cost' ? costText(row.costMicros || 0, currency) : metric === 'duration' ? duration(row.activeSeconds || 0, zh) : `${compact(row.totalTokens)} tokens`}</strong>
    <span><i style={{ background: COLORS.input }}/>{zh ? '输入（含缓存写）' : 'Input + cache write'} {compact((row.inputTokens || 0) + (row.cacheWriteInputTokens || 0))}</span>
    <span><i style={{ background: COLORS.cache }}/>{zh ? '缓存读' : 'Cache read'} {compact(row.cacheReadInputTokens || 0)}</span>
    <span><i style={{ background: COLORS.output }}/>{zh ? '输出' : 'Output'} {compact(row.outputTokens || 0)}</span>
    <span><i style={{ background: COLORS.reasoning }}/>{zh ? '推理' : 'Reasoning'} {compact(row.reasoningOutputTokens || 0)}</span>
    <small>{zh ? '标准 API 估算' : 'Standard API estimate'} · {costText(row.costMicros || 0, currency)} · {zh ? '活跃' : 'active'} {duration(row.activeSeconds || 0, zh)} · {row.userMessageCount || 0} {zh ? '条用户消息' : 'user messages'}</small>
  </div>;
}

function metricConfig(metric, currency, zh) {
  if (metric === 'cost') return { dataKey: 'cost', rolling: 'rollingCost', tick: (value) => `${currency === 'cny' ? '¥' : '$'}${compact(value * (currency === 'cny' ? 7.2 : 1))}` };
  if (metric === 'duration') return { dataKey: 'activeHours', rolling: 'rollingDuration', tick: (value) => value >= 1 ? `${value.toFixed(value >= 10 ? 0 : 1)}h` : `${Math.round(value * 60)}m` };
  return { dataKey: 'totalTokens', rolling: 'rollingTokens', tick: compact };
}

export function DailyTrend({ report, zh, metric, onMetric, currency }) {
  const config = metricConfig(metric, currency, zh);
  const title = report.seriesUnit === 'hour' ? (zh ? '每小时趋势' : 'Hourly trend') : report.seriesUnit === 'week' ? (zh ? '每周趋势' : 'Weekly trend') : (zh ? '每日趋势' : 'Daily trend');
  return <section className="panel trend-panel" id="trend">
    <header className="panel-header">
      <div><h2>{title}</h2><p>{zh ? '本地时区 · 30 分钟事实桶聚合' : 'Local timezone · 30-minute fact buckets'}</p></div>
      <div className="chart-controls">
        {metric === 'tokens' ? <div className="chart-legend">
          <span><i style={{ background: COLORS.input }}/>{zh ? '输入（含缓存写）' : 'Input'}</span><span><i style={{ background: COLORS.cache }}/>{zh ? '缓存读' : 'Cache read'}</span><span><i style={{ background: COLORS.output }}/>{zh ? '输出' : 'Output'}</span><span><i style={{ background: COLORS.reasoning }}/>{zh ? '推理' : 'Reasoning'}</span><span><i className="dash"/>7 {zh ? '段均值' : 'slot avg'}</span>
        </div> : null}
        <MetricTabs active={metric} onChange={onMetric} zh={zh}/>
      </div>
    </header>
    <div className="trend-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={report.series} margin={{ top: 12, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
          <CartesianGrid stroke="var(--line)" vertical={false}/><XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={26} tick={{ fill: 'var(--grey)', fontSize: 10 }}/><YAxis axisLine={false} tickLine={false} width={52} tickFormatter={config.tick} tick={{ fill: 'var(--grey)', fontSize: 10 }}/>
          <Tooltip cursor={{ fill: 'var(--hover)' }} content={<TrendTooltip zh={zh} metric={metric} currency={currency}/>}/>
          {metric === 'tokens' ? <>
            <Bar dataKey="inputTokens" stackId="token" fill={COLORS.input}/><Bar dataKey="cacheWriteInputTokens" stackId="token" fill="#54a3ff"/><Bar dataKey="cacheReadInputTokens" stackId="token" fill={COLORS.cache}/><Bar dataKey="outputTokens" stackId="token" fill={COLORS.output}/><Bar dataKey="reasoningOutputTokens" stackId="token" fill={COLORS.reasoning} radius={[2, 2, 0, 0]}/>
          </> : <Bar dataKey={config.dataKey} fill={metric === 'cost' ? 'var(--green)' : 'var(--blue)'} radius={[2, 2, 0, 0]}/>}
          <Line dataKey={config.rolling} dot={false} stroke={COLORS.avg} strokeWidth={1.5} strokeDasharray="7 6" isAnimationActive={false}/>
        </BarChart>
      </ResponsiveContainer>
    </div>
  </section>;
}

export function WeeklyTrend({ report, zh, metric, currency }) {
  const config = metricConfig(metric, currency, zh);
  const current = report.weeklySeries.at(-1)?.[config.dataKey] || 0;
  const previous = report.weeklySeries.at(-2)?.[config.dataKey] || 0;
  const change = previous > 0 ? (current - previous) / previous : null;
  const valueText = metric === 'cost' ? `${currency === 'cny' ? '¥' : '$'}${(current * (currency === 'cny' ? 7.2 : 1)).toFixed(2)}` : metric === 'duration' ? `${current.toFixed(1)}h` : compact(current);
  return <section className="panel weekly-panel">
    <header className="panel-header"><div><h2>{zh ? '自然周趋势' : 'Natural-week trend'}</h2><p>{zh ? '最近 12 周 · 周一 00:00 → 下周一 00:00' : 'Last 12 weeks · Monday 00:00 → next Monday 00:00'}</p></div><div className="weekly-summary"><small>{zh ? '本周' : 'This week'}</small><b>{valueText}</b>{change == null ? null : <em className={change >= 0 ? 'up' : 'down'}>{change >= 0 ? '↗' : '↘'} {Math.abs(change * 100).toFixed(1)}%</em>}</div></header>
    <div className="weekly-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={report.weeklySeries} barCategoryGap="30%"><CartesianGrid stroke="var(--line)" vertical={false}/><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--grey)', fontSize: 9 }}/><YAxis axisLine={false} tickLine={false} width={48} tickFormatter={config.tick} tick={{ fill: 'var(--grey)', fontSize: 9 }}/><Tooltip cursor={{ fill: 'var(--hover)' }} content={<TrendTooltip zh={zh} metric={metric} currency={currency}/>}/><Bar dataKey={config.dataKey} fill="var(--blue)" radius={[2, 2, 0, 0]}/></BarChart></ResponsiveContainer></div>
  </section>;
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
