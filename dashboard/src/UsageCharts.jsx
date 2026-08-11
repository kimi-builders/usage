import {
  Bar, BarChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { CalendarDays, Clock3, Folder, Monitor, Terminal, Cpu } from 'lucide-react';
import { compact, duration, money, percent, sourceLabel } from './format.js';
import { ToolGlyph } from './tool-glyphs.js';

const COLORS = {
  input: '#1a88ff', cache: '#20d39a', output: '#c5c8cc', reasoning: '#f6a609', avg: '#8a9099',
};

function MetricTabs({ active = 'token', zh }) {
  return <div className="mini-tabs" aria-label={zh ? '图表指标' : 'Chart metric'}><button className={active === 'token' ? 'active' : ''}>Token</button><button>{zh ? '费用' : 'Cost'}</button><button>{zh ? '时长' : 'Time'}</button></div>;
}

function TrendTooltip({ active, payload, label, zh }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div className="usage-tooltip">
      <strong>{label} · {compact(row.totalTokens)} tokens</strong>
      <span><i style={{ background: COLORS.input }} />{zh ? '输入（含缓存写）' : 'Input + cache write'} {compact((row.inputTokens || 0) + (row.cacheWriteInputTokens || 0))}</span>
      <span><i style={{ background: COLORS.cache }} />{zh ? '缓存读' : 'Cache read'} {compact(row.cacheReadInputTokens || 0)}</span>
      <span><i style={{ background: COLORS.output }} />{zh ? '输出' : 'Output'} {compact(row.outputTokens || 0)}</span>
      <span><i style={{ background: COLORS.reasoning }} />{zh ? '推理' : 'Reasoning'} {compact(row.reasoningOutputTokens || 0)}</span>
      <small>{zh ? '标准 API 估算' : 'Standard API estimate'} · {money(row.costMicros || 0)}</small>
    </div>
  );
}

export function DailyTrend({ report, zh }) {
  return (
    <section className="panel trend-panel" id="trend">
      <header className="panel-header">
        <div><h2>{zh ? '每日趋势' : 'Daily trend'}</h2><p>{zh ? '本地时区 · 按当前范围自动聚合' : 'Local time · adaptive aggregation'}</p></div>
        <div className="chart-controls">
          <div className="chart-legend">
            <span><i style={{ background: COLORS.input }} />{zh ? '输入（含缓存写）' : 'Input'}</span>
            <span><i style={{ background: COLORS.cache }} />{zh ? '缓存读' : 'Cache read'}</span>
            <span><i style={{ background: COLORS.output }} />{zh ? '输出' : 'Output'}</span>
            <span><i style={{ background: COLORS.reasoning }} />{zh ? '推理' : 'Reasoning'}</span>
            <span><i className="dash" />7 {zh ? '日均值' : 'slot avg'}</span>
          </div>
          <MetricTabs zh={zh} />
        </div>
      </header>
      <div className="trend-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={report.series} margin={{ top: 12, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={26} tick={{ fill: 'var(--grey)', fontSize: 10 }} />
            <YAxis axisLine={false} tickLine={false} width={48} tickFormatter={(value) => compact(value)} tick={{ fill: 'var(--grey)', fontSize: 10 }} />
            <Tooltip cursor={{ fill: 'var(--hover)' }} content={<TrendTooltip zh={zh} />} />
            <Bar dataKey="inputTokens" stackId="token" fill={COLORS.input} />
            <Bar dataKey="cacheWriteInputTokens" stackId="token" fill="#54a3ff" />
            <Bar dataKey="cacheReadInputTokens" stackId="token" fill={COLORS.cache} />
            <Bar dataKey="outputTokens" stackId="token" fill={COLORS.output} />
            <Bar dataKey="reasoningOutputTokens" stackId="token" fill={COLORS.reasoning} radius={[2, 2, 0, 0]} />
            <Line dataKey="rollingAverage" dot={false} stroke={COLORS.avg} strokeWidth={1.5} strokeDasharray="7 6" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function WeeklyTrend({ report, zh }) {
  return (
    <section className="panel weekly-panel">
      <header className="panel-header"><div><h2>{zh ? '自然周趋势' : 'Natural-week trend'}</h2><p>{zh ? '周一至下周一 · 最近 12 周' : 'Monday to Monday · last 12 weeks'}</p></div><span className="panel-meta">12 WEEKS</span></header>
      <div className="weekly-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={report.weeklySeries} barCategoryGap="30%">
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--grey)', fontSize: 9 }} />
            <YAxis axisLine={false} tickLine={false} width={44} tickFormatter={compact} tick={{ fill: 'var(--grey)', fontSize: 9 }} />
            <Tooltip cursor={{ fill: 'var(--hover)' }} formatter={(value) => [`${compact(value)} tokens`, zh ? '自然周' : 'Week']} />
            <Bar dataKey="totalTokens" fill="var(--blue)" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function ActivityHeatmap({ report, zh }) {
  const weekdays = zh ? ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <section className="panel heatmap-panel" id="activity">
      <header className="panel-header"><div><h2>{zh ? '分时活跃' : 'Activity by hour'}</h2><p>{zh ? '本地时区 · 颜色越亮，活跃时长越高' : 'Local time · brighter means more active'}</p></div><MetricTabs zh={zh} active="time" /></header>
      <div className="heatmap-scroll">
        <div className="heatmap-grid">
          <div />
          <div className="heatmap-hours">{[0, 3, 6, 9, 12, 15, 18, 21].map((hour) => <span key={hour}>{String(hour).padStart(2, '0')}</span>)}</div>
          {report.heatmap.cells.map((row, day) => (
            <div className="heatmap-row" key={weekdays[day]}>
              <span>{weekdays[day]}</span>
              <div>{row.map((seconds, hour) => {
                const level = report.heatmap.max ? Math.ceil((seconds / report.heatmap.max) * 5) : 0;
                const title = `${weekdays[day]} ${String(hour).padStart(2, '0')}:00 · ${duration(seconds, zh)} · ${Math.round(seconds / 60)} ${zh ? '活跃分钟' : 'active minutes'}`;
                return <i key={hour} data-level={level} title={title} aria-label={title} />;
              })}</div>
            </div>
          ))}
        </div>
      </div>
      <footer className="heatmap-footer">
        <div>{report.heatmap.slots.map((slot, index) => <span key={`${slot.day}-${slot.hour}`}><b>#{index + 1}</b> {weekdays[slot.day]} {String(slot.hour).padStart(2, '0')}:00 · {duration(slot.seconds, zh)}</span>)}</div>
        <span>{zh ? '少' : 'Less'} <i data-level="1"/><i data-level="2"/><i data-level="3"/><i data-level="4"/><i data-level="5"/> {zh ? '多' : 'More'}</span>
      </footer>
    </section>
  );
}

const DIST_ICONS = { source: Terminal, model: Cpu, project: Folder, device: Monitor };

export function DistributionCard({ type, rows, zh }) {
  const labels = {
    source: zh ? '工具分布' : 'Agent distribution', model: zh ? '模型分布' : 'Model distribution',
    project: zh ? '项目分布' : 'Project distribution', device: zh ? '设备分布' : 'Device distribution',
  };
  const Icon = DIST_ICONS[type] || CalendarDays;
  const shown = rows.slice(0, 6);
  return (
    <section className="panel distribution-card">
      <header className="panel-header"><h2><Icon size={14} />{labels[type]}</h2><div className="tiny-tabs"><button className="active">Token</button><button>{zh ? '费用' : 'Cost'}</button></div></header>
      <div className="distribution-list">
        {shown.length ? shown.map((row, index) => (
          <div className="distribution-row" key={row.id}>
            <span className="rank">{String(index + 1).padStart(2, '0')}</span>
            <span className="distribution-name">{type === 'source' ? <ToolGlyph id={row.id} size={14} /> : null}<b title={row.id}>{type === 'source' ? sourceLabel(row.id) : row.id}</b></span>
            <span className="distribution-value">{compact(row.totalTokens)} <small>{percent(row.share)}</small></span>
            <span className="distribution-track"><i style={{ width: `${Math.max(2, row.share * 100)}%` }} /></span>
          </div>
        )) : <p className="empty">{zh ? '当前范围暂无数据' : 'No data in this range'}</p>}
      </div>
    </section>
  );
}

export function RecordsTable({ report, zh }) {
  return (
    <section className="panel records-panel" id="records">
      <header className="panel-header"><div><h2>{zh ? '详细记录' : 'Detailed records'}</h2><p>{zh ? `显示 ${Math.min(100, report.records.length)} / ${report.records.length} 条` : `Showing ${Math.min(100, report.records.length)} / ${report.records.length}`}</p></div><span className="panel-meta">30 MIN BUCKETS</span></header>
      <div className="records-scroll"><table><thead><tr>
        <th>{zh ? '日期' : 'Date'}</th><th>{zh ? '工具' : 'Agent'}</th><th>{zh ? '模型 / 推理强度' : 'Model / effort'}</th><th>{zh ? '项目' : 'Project'}</th><th>{zh ? '输入 TOKEN' : 'Input'}</th><th>{zh ? '缓存 TOKEN' : 'Cache'}</th><th>{zh ? '输出 TOKEN' : 'Output'}</th><th>{zh ? '推理' : 'Reasoning'}</th><th>{zh ? '预估费用' : 'Estimate'}</th>
      </tr></thead><tbody>{report.records.slice(0, 100).map((record) => <tr key={record.id}>
        <td>{new Date(record.bucketStart).toLocaleString(zh ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</td>
        <td><span className="agent-chip"><ToolGlyph id={record.source} size={12} />{sourceLabel(record.source)}</span></td>
        <td><b>{record.modelCanonical || record.model}</b>{record.reasoningEffort ? <small>{record.reasoningEffort}</small> : null}</td>
        <td>{record.project || '•••'}</td><td>{compact((record.inputTokens || 0) + (record.cacheWriteInputTokens || 0))}</td><td>{compact(record.cacheReadInputTokens)}</td><td>{compact(record.outputTokens)}</td><td>{compact(record.reasoningOutputTokens)}</td><td className={record.status === 'unpriced' ? '' : 'green'}>{record.status === 'unpriced' ? (zh ? '未定价' : 'Unpriced') : money(record.costMicros)}</td>
      </tr>)}</tbody></table></div>
    </section>
  );
}
