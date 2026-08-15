import { forwardRef } from 'react';
import { compactNumber, duration, money, percent, sourceLabel } from './format.js';
import { ToolGlyph } from './tool-glyphs.js';
import { localDateKey } from './usage-insights.js';

const RANGE_LABELS = {
  today: ['今天', 'TODAY'], '24h': ['近 24 小时', '24H'], '7d': ['近 7 天', '7D'],
  '30d': ['近 30 天', '30D'], '90d': ['近 90 天', '90D'], all: ['全部时间', 'ALL'],
};

const POSTER_COPY = {
  zh: {
    flow: 'TOKEN 流向', flowNote: '对数带宽 · 输入 → 上下文 → 输出', input: '输入', cache: '缓存读', output: '输出', reasoning: '推理',
    hourlyBars: '每柱一小时 · 四类 Token 堆叠', dailyBars: '每柱一天 · 虚线为 7 日均值',
    weekdays: ['一', '二', '三', '四', '五', '六', '日'], sparseWeekdays: ['一', '三', '五', '日'], less: '少', more: '多', peak: '峰值', emptyHeat: '近 7 天 · 星期 × 小时',
    labels: { '7d': '7 天活跃时段', '90d': '90 天构建足迹', all: '半年构建足迹', today: '构建脉冲', '24h': '构建脉冲', '30d': '30 天 TOKEN 构成' },
    weeklyStreak: '周连续构建', dateSpan: '数据起止 SPAN', cumulative: '累计', requests: '次请求', apiValue: 'API 等价价值', active: '活跃时长',
    dayStreak: '天连续构建', longestStreak: '天最长连续', cacheHit: '缓存命中', inputWithWrite: '输入（含缓存写）',
    cost: '◉ 费用 COST', activeKpi: '◷ 活跃时长 ACTIVE', peakKpi: '⌁ 单日峰值 PEAK', hitKpi: 'ϟ 缓存命中 HIT', sessions: '▱ 会话 SESS',
    agents: 'AGENT 阵列', ranking: '按 TOKEN 排名', topModel: '主力模型 / TOP MODEL', effort: '推理强度 / REASONING', reasoningToken: '推理 TOKEN',
    localNote: '由本机数据生成 · 可安全分享 · 不含项目、设备、路径或对话内容', estimate: '标准 API 计价估算 · 非订阅账单', localOnly: '本地分析 · 零上传', leverage: '杠杆', leverageFormula: '总量 ÷ 新鲜输入',
  },
  en: {
    flow: 'TOKEN FLOW', flowNote: 'Logarithmic bandwidth · Input → Context → Output', input: 'Input', cache: 'Cache read', output: 'Output', reasoning: 'Reasoning',
    hourlyBars: 'One bar per hour · four Token types', dailyBars: 'One bar per day · dashed line is 7-day average',
    weekdays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], sparseWeekdays: ['MON', 'WED', 'FRI', 'SUN'], less: 'Less', more: 'More', peak: 'Peak', emptyHeat: 'Last 7 days · weekday × hour',
    labels: { '7d': '7-DAY ACTIVE HOURS', '90d': '90-DAY BUILD FOOTPRINT', all: '6-MONTH BUILD FOOTPRINT', today: 'BUILD PULSE', '24h': 'BUILD PULSE', '30d': '30-DAY TOKEN MIX' },
    weeklyStreak: 'Week build streak', dateSpan: 'Date span', cumulative: 'LIFETIME', requests: 'REQUESTS', apiValue: 'API-EQUIVALENT VALUE', active: 'ACTIVE TIME',
    dayStreak: 'day build streak', longestStreak: 'day longest streak', cacheHit: 'Cache hit', inputWithWrite: 'Input (incl. cache write)',
    cost: '◉ COST', activeKpi: '◷ ACTIVE TIME', peakKpi: '⌁ DAILY PEAK', hitKpi: 'ϟ CACHE HIT', sessions: '▱ SESSIONS',
    agents: 'AGENT MATRIX', ranking: 'RANKED BY TOKEN', topModel: 'TOP MODEL', effort: 'REASONING EFFORT', reasoningToken: 'REASONING TOKEN',
    localNote: 'Generated from on-device data · safe to share · excludes projects, devices, paths, and conversations', estimate: 'Standard API price estimate · not a subscription bill', localOnly: 'On-device analytics · zero upload', leverage: 'Leverage', leverageFormula: 'total ÷ fresh input',
  },
};

const compact = (value, zh) => compactNumber(value, zh ? 'zh' : 'en');

function posterDuration(seconds) {
  const hours = Math.floor((seconds || 0) / 3600);
  const minutes = Math.floor(((seconds || 0) % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function PosterFlow({ report, zh }) {
  const copy = POSTER_COPY[zh ? 'zh' : 'en'];
  const cache = report.totals.cacheReadInputTokens || 0;
  const output = report.totals.outputTokens || 0;
  const reasoning = report.totals.reasoningOutputTokens || 0;
  const input = (report.totals.inputTokens || 0) + (report.totals.cacheWriteInputTokens || 0);
  return (
    <section className="poster-flow">
      <div className="poster-subhead"><span>{copy.flow}</span><small>{copy.flowNote}</small></div>
      <div className="flow-graphic">
        <svg viewBox="0 0 972 168" preserveAspectRatio="none" aria-hidden="true">
          <defs><pattern id="poster-cache-dots" width="15" height="15" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="1.7" fill="rgba(3,41,31,.42)" /></pattern></defs>
          <path d="M0 108 C200 108,290 16,460 16 C550 16,610 44,640 78 L640 130 C610 164,550 168,460 168 L0 168 Z" fill="#20d39a" />
          <path d="M0 108 C200 108,290 16,460 16 C550 16,610 44,640 78 L640 130 C610 164,550 168,460 168 L0 168 Z" fill="url(#poster-cache-dots)" />
          <path d="M640 78 C740 76,780 36,856 32 L856 53 C780 57,740 100,640 100 Z" fill="#1478ff" />
          <path d="M640 102 C740 104,780 96,856 92 L856 112 C780 116,740 132,640 132 Z" fill="#f6a609" />
          <rect x="0" y="79" width="40" height="29" fill="#39424e" /><rect x="0" y="79" width="40" height="4" fill="#54a3ff" />
        </svg>
        <div className="flow-input"><span>{copy.input}</span><strong>{compact(input, zh)}</strong></div>
        <div className="flow-cache"><span>{copy.cache}</span><strong>{compact(cache, zh)}</strong></div>
        <div className="flow-outs"><span>{copy.output} <b>{compact(output, zh)}</b></span><span>{copy.reasoning} <b>{compact(reasoning, zh)}</b></span></div>
      </div>
    </section>
  );
}

function StackedBars({ report, range, zh }) {
  const copy = POSTER_COPY[zh ? 'zh' : 'en'];
  const data = report.series.slice(range === 'today' || range === '24h' ? -24 : -30);
  const max = Math.max(1, ...data.map((item) => item.totalTokens));
  return (
    <div className="poster-bars">
      <div className="poster-y-axis"><span>{compact(max, zh)}</span><span>{compact(max * .75, zh)}</span><span>{compact(max * .5, zh)}</span><span>{compact(max * .25, zh)}</span><span>0</span></div>
      <div className="poster-gridlines"><i /><i /><i /><i /></div>
      <div className="poster-bar-columns">
        {data.map((item, index) => {
          const height = Math.max(2, (item.totalTokens / max) * 100);
          const cacheShare = item.totalTokens ? (item.cacheReadInputTokens / item.totalTokens) * height : 0;
          const inputShare = item.totalTokens ? ((item.inputTokens + item.cacheWriteInputTokens) / item.totalTokens) * height : 0;
          const outputShare = item.totalTokens ? (item.outputTokens / item.totalTokens) * height : 0;
          const reasoningShare = item.totalTokens ? (item.reasoningOutputTokens / item.totalTokens) * height : 0;
          return <div className="poster-bar-col" key={item.key} title={`${item.label} · ${compact(item.totalTokens, zh)}`}>
            <div className="poster-stack" style={{ height: `${height}%` }}>
              <i className="p-input" style={{ height: `${Math.max(0, inputShare / height * 100)}%` }} />
              <i className="p-cache" style={{ height: `${Math.max(0, cacheShare / height * 100)}%` }} />
              <i className="p-output" style={{ height: `${Math.max(0, outputShare / height * 100)}%` }} />
              <i className="p-reason" style={{ height: `${Math.max(0, reasoningShare / height * 100)}%` }} />
            </div>
            {(index === 0 || index === data.length - 1 || (data.length > 8 && index % Math.ceil(data.length / 4) === 0)) ? <span>{item.label}</span> : null}
          </div>;
        })}
      </div>
      {range === '30d' ? <svg className="poster-average" viewBox="0 0 900 200" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={data.map((item, index) => `${(index / Math.max(1, data.length - 1)) * 900},${190 - ((item.rollingTokens || 0) / max) * 176}`).join(' ')} fill="none" stroke="#8a9099" strokeWidth="2" strokeDasharray="8 7" />
      </svg> : null}
      <span className="poster-chart-type">{range === 'today' || range === '24h' ? copy.hourlyBars : copy.dailyBars}</span>
    </div>
  );
}

function PosterHeatmap({ report, zh }) {
  const copy = POSTER_COPY[zh ? 'zh' : 'en'];
  const max = Math.max(0, ...report.heatmap.cells.flat().map((cell) => cell.totalTokens));
  const peak = report.heatmap.cells.flatMap((row, day) => row.map((cell, hour) => ({ day, hour, value: cell.totalTokens }))).sort((left, right) => right.value - left.value)[0];
  return <div className="poster-week-heat"><div className="poster-heat-hours">{[0, 3, 6, 9, 12, 15, 18, 21].map((h) => <span key={h}>{String(h).padStart(2, '0')}</span>)}</div>{report.heatmap.cells.map((row, day) => <div key={day}><span>{copy.weekdays[day]}</span>{row.map((cell, hour) => cell.observed
    ? <i key={hour} data-peak={peak?.value > 0 && peak.day === day && peak.hour === hour ? 'true' : undefined} style={{ opacity: max ? .15 + .85 * cell.totalTokens / max : .08 }} />
    : <i key={hour} className="poster-heat-missing" />)}</div>)}<footer><span>{peak?.value > 0 ? `${copy.peak} ${copy.weekdays[peak.day]} ${String(peak.hour).padStart(2,'0')}:00 · ${compact(peak.value, zh)}` : copy.emptyHeat}</span><div className="poster-heat-legend"><span>{copy.less}</span>{[.12,.28,.46,.68,1].map((opacity) => <i key={opacity} style={{opacity}} />)}<span>{copy.more}</span></div></footer></div>;
}

function ContributionCalendar({ report, range, zh }) {
  const copy = POSTER_COPY[zh ? 'zh' : 'en'];
  const groups = new Map();
  for (const bucket of report.buckets) {
    const key = localDateKey(bucket.bucketStart);
    groups.set(key, (groups.get(key) || 0) + (bucket.totalTokens || 0));
  }
  const values = [...groups.values()];
  const max = Math.max(1, ...values);
  const days = [];
  const weeks = range === 'all' ? 26 : 13;
  const cursor = new Date(report.end);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (weeks * 7 - 1));
  for (let i = 0; i < weeks * 7; i += 1) {
    const key = localDateKey(cursor);
    days.push({ key, value: groups.get(key) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  const columns = Array.from({ length: weeks }, (_, index) => days.slice(index * 7, index * 7 + 7));
  return <div className={`poster-contribution-wrap ${range === 'all' ? 'poster-contribution-wrap--all' : ''}`}><div className="poster-month-labels">{columns.map((column, index) => <span key={column[0]?.key || index}>{index === 0 || column[0]?.key.slice(5,7) !== columns[index - 1]?.[0]?.key.slice(5,7) ? new Date(`${column[0]?.key}T00:00:00`).toLocaleDateString(zh ? 'zh-CN' : 'en-US',{month:'short'}).toUpperCase() : ''}</span>)}</div><div className="poster-contribution-body"><div className="poster-week-labels">{copy.sparseWeekdays.map((day) => <span key={day}>{day}</span>)}</div><div className="poster-contributions" style={{ gridTemplateColumns: `repeat(${weeks},1fr)` }}>{days.map((day) => <i key={day.key} title={`${day.key} ${compact(day.value, zh)}`} style={{ opacity: day.value ? .18 + .82 * day.value / max : .06 }} />)}</div></div><div className="poster-heat-legend"><span>{copy.less}</span>{[.12,.28,.46,.68,1].map((opacity) => <i key={opacity} style={{opacity}} />)}<span>{copy.more}</span></div></div>;
}

function PosterActivity({ report, range, zh }) {
  if (range === '7d') return <PosterHeatmap report={report} zh={zh} />;
  if (range === '90d' || range === 'all') return <ContributionCalendar report={report} range={range} zh={zh} />;
  return <StackedBars report={report} range={range} zh={zh} />;
}

export const UsagePoster = forwardRef(function UsagePoster({ report, range, identity, generatedAt, zh = true }, ref) {
  const [rangeZh, rangeEn] = RANGE_LABELS[range] || RANGE_LABELS['30d'];
  const copy = POSTER_COPY[zh ? 'zh' : 'en'];
  const rangeLabel = zh ? rangeZh : rangeEn;
  const start = report.start || (report.buckets[0] ? new Date(report.buckets[0].bucketStart) : new Date(generatedAt));
  const fmt = (date) => new Date(date).toLocaleDateString(zh ? 'zh-CN' : 'en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).replaceAll('/', '.');
  const barsLabel = copy.labels[range] || copy.labels['30d'];
  const weekStreak = report.weeklyStreaks?.current || report.weeklyStreaks?.longest || 0;
  return (
    <article className="usage-poster" ref={ref}>
      <header className="poster-header"><strong>KIMI BUILDERS <b>/ USAGE</b></strong><span>TOKEN X-RAY <i>{rangeLabel}</i></span></header>
      <section className="poster-identity">
        <div className={`poster-avatar ${identity.avatar ? 'has-image' : ''}`}>{identity.avatar ? <img src={identity.avatar} alt=""/> : identity.name.slice(0, 2).toUpperCase()}</div>
        <div><strong>{identity.name}</strong><span>@{identity.handle}　<b>LOCAL · ZERO UPLOAD</b></span></div>
        <div className="poster-streak"><b>{weekStreak}</b><strong>{copy.weeklyStreak}</strong><span>WEEK STREAK</span></div>
        <div className="poster-span"><strong>{fmt(start)} — {fmt(report.end)}</strong><span>{copy.dateSpan}</span></div>
      </section>
      <section className="poster-hero">
        <div><strong>{compact(report.totals.totalTokens, zh)}</strong><span>{rangeLabel} TOKEN　<small>{copy.cumulative} {compact(report.lifetimeTotals.totalTokens, zh)} · {compact(report.totals.requestCount, zh)} {copy.requests}</small></span></div>
        <div><strong>{money(report.totals.costMicros)}</strong><span>{copy.apiValue}</span></div>
        <div><strong>{posterDuration(report.activeSeconds)}</strong><span>{copy.active}</span></div>
      </section>
      <PosterFlow report={report} zh={zh} />
      <section className="poster-activity">
        <div className="poster-subhead"><span>{barsLabel}</span><small>{range === '7d' ? `${report.streaks.current || report.streaks.longest} ${copy.dayStreak}` : range === '90d' || range === 'all' ? `${report.streaks.longest} ${copy.longestStreak}` : `${copy.cacheHit} ${percent(report.cacheHitRate)}`}</small></div>
        {range === 'today' || range === '24h' || range === '30d' ? <div className="poster-chart-legend"><span><i className="p-input" />{copy.inputWithWrite}</span><span><i className="p-cache" />{copy.cache}</span><span><i className="p-output" />{copy.output}</span><span><i className="p-reason" />{copy.reasoning}</span></div> : null}
        <PosterActivity report={report} range={range} zh={zh} />
      </section>
      <section className="poster-kpis">
        <div><span>{copy.cost}</span><strong>{money(report.totals.costMicros)}</strong></div>
        <div><span>{copy.activeKpi}</span><strong>{posterDuration(report.activeSeconds)}</strong></div>
        <div><span>{copy.peakKpi}</span><strong>{compact(report.peakTokens, zh)}</strong></div>
        <div><span>{copy.hitKpi}</span><strong>{percent(report.cacheHitRate)}</strong></div>
        <div><span>{copy.sessions}</span><strong>{report.sessions.length.toLocaleString(zh ? 'zh-CN' : 'en-US')}</strong></div>
      </section>
      <section className="poster-agents">
        <div className="poster-subhead"><span>{copy.agents}</span><small>TOP {Math.min(5, report.sourceRows.length)} / {report.sourceRows.length} · {copy.ranking}</small></div>
        <div>{report.sourceRows.slice(0, 5).map((row, index) => <article key={row.id}><small className="poster-agent-rank">0{index + 1}</small><ToolGlyph id={row.id} size={25} /><strong>{sourceLabel(row.id)}</strong><span>{compact(row.totalTokens, zh)} <b>{percent(row.share, 0)}</b></span><i><b style={{ width: `${Math.max(3, row.share * 100)}%` }} /></i></article>)}</div>
      </section>
      <section className="poster-model">
        <div><span>{copy.topModel}</span><strong>{report.topModel || 'NO MODEL DATA'}</strong><small>{compact(report.modelRows[0]?.totalTokens || 0, zh)} · {percent(report.modelRows[0]?.share || 0, 0)}</small></div>
        <div><span>{copy.effort}</span><strong>{report.topReasoning ? report.topReasoning.toUpperCase() : 'NOT RECORDED'}</strong><small>{compact(report.totals.reasoningOutputTokens, zh)} {copy.reasoningToken}</small></div>
      </section>
      <footer className="poster-footer">
        <div className="poster-local-seal"><strong>LOCAL</strong><span>PRIVATE<br/>ANALYTICS</span></div>
        <div><strong>@{identity.handle} · {rangeLabel} · {fmt(generatedAt)}</strong><span>{copy.localNote}</span></div>
        <div><span>{copy.estimate}</span><span>{copy.localOnly}</span><span>{copy.leverage} ×{report.inputLeverage == null ? '—' : report.inputLeverage.toFixed(1)} = {copy.leverageFormula}</span></div>
      </footer>
      <span className="poster-corner">{rangeEn}</span>
    </article>
  );
});
