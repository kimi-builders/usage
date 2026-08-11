import { forwardRef, useMemo } from 'react';
import { Ecc, QrCode } from '@rc-component/qrcode/es/libs/qrcodegen';
import { generatePath } from '@rc-component/qrcode/es/utils';
import { compact, duration, money, percent, sourceLabel } from './format.js';
import { ToolGlyph } from './tool-glyphs.js';

const RANGE_LABELS = {
  today: ['今天', 'TODAY'], '24h': ['近 24 小时', '24H'], '7d': ['近 7 天', '7D'],
  '30d': ['近 30 天', '30D'], '90d': ['近 90 天', '90D'], all: ['全部时间', 'ALL'],
};

function posterDuration(seconds) {
  const hours = Math.floor((seconds || 0) / 3600);
  const minutes = Math.floor(((seconds || 0) % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function Qr({ value }) {
  const qr = useMemo(() => QrCode.encodeText(value, Ecc.MEDIUM), [value]);
  const modules = qr.getModules();
  const margin = 3;
  return (
    <svg viewBox={`0 0 ${modules.length + margin * 2} ${modules.length + margin * 2}`} aria-label="QR code">
      <rect width="100%" height="100%" fill="#f4f6f8" />
      <path d={generatePath(modules, margin)} fill="#050607" />
    </svg>
  );
}

function PosterFlow({ report }) {
  const cache = report.totals.cacheReadInputTokens || 0;
  const output = report.totals.outputTokens || 0;
  const reasoning = report.totals.reasoningOutputTokens || 0;
  const input = (report.totals.inputTokens || 0) + (report.totals.cacheWriteInputTokens || 0);
  return (
    <section className="poster-flow">
      <div className="poster-subhead"><span>TOKEN 流向</span><small>对数带宽 · 输入 → 上下文 → 输出</small></div>
      <div className="flow-graphic">
        <div className="flow-input"><span>输入</span><strong>{compact(input)}</strong><i /></div>
        <svg viewBox="0 0 880 190" preserveAspectRatio="none" aria-hidden="true">
          <defs><pattern id="dots" width="11" height="11" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="#03291f" opacity=".58" /></pattern></defs>
          <path d="M0,93 C170,93 170,15 350,15 L540,15 C650,15 670,65 735,65 C790,65 820,28 880,28 L880,50 C820,50 790,86 735,86 C650,86 630,156 520,156 L350,156 C170,156 170,114 0,114 Z" fill="#20d39a" />
          <path d="M0,93 C170,93 170,15 350,15 L540,15 C650,15 670,65 735,65 C790,65 820,28 880,28 L880,50 C820,50 790,86 735,86 C650,86 630,156 520,156 L350,156 C170,156 170,114 0,114 Z" fill="url(#dots)" />
          <path d="M0,84 C170,84 190,0 350,0 L540,0 C650,0 670,51 735,51 C795,51 820,18 880,18 L880,28 C820,28 790,65 735,65 C670,65 650,15 540,15 L350,15 C170,15 170,93 0,93 Z" fill="#1478ff" opacity=".9" />
          <path d="M735,86 C790,86 820,68 880,68 L880,80 C820,80 790,101 735,101 Z" fill="#f6a609" />
        </svg>
        <div className="flow-cache"><span>缓存读</span><strong>{compact(cache)}</strong></div>
        <div className="flow-outs"><span>输出 <b>{compact(output)}</b></span><span>推理 <b>{compact(reasoning)}</b></span></div>
      </div>
    </section>
  );
}

function StackedBars({ report, range }) {
  const data = report.series.slice(-30);
  const max = Math.max(1, ...data.map((item) => item.totalTokens));
  return (
    <div className="poster-bars">
      <div className="poster-gridlines"><i /><i /><i /><i /></div>
      <div className="poster-bar-columns">
        {data.map((item, index) => {
          const height = Math.max(2, (item.totalTokens / max) * 100);
          const cacheShare = item.totalTokens ? (item.cacheReadInputTokens / item.totalTokens) * height : 0;
          const inputShare = item.totalTokens ? ((item.inputTokens + item.cacheWriteInputTokens) / item.totalTokens) * height : 0;
          const outputShare = item.totalTokens ? (item.outputTokens / item.totalTokens) * height : 0;
          const reasoningShare = item.totalTokens ? (item.reasoningOutputTokens / item.totalTokens) * height : 0;
          return <div className="poster-bar-col" key={item.key} title={`${item.label} · ${compact(item.totalTokens)}`}>
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
      <svg className="poster-average" viewBox="0 0 900 200" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={data.map((item, index) => `${(index / Math.max(1, data.length - 1)) * 900},${190 - (item.rollingAverage / max) * 176}`).join(' ')} fill="none" stroke="#8a9099" strokeWidth="2" strokeDasharray="8 7" />
      </svg>
      <span className="poster-chart-type">{range === 'today' || range === '24h' ? '每柱一小时' : '每柱一天'} · TOKEN 峰叠</span>
    </div>
  );
}

function PosterHeatmap({ report }) {
  return <div className="poster-week-heat"><div className="poster-heat-hours">{[0, 3, 6, 9, 12, 15, 18, 21].map((h) => <span key={h}>{String(h).padStart(2, '0')}</span>)}</div>{report.heatmap.cells.map((row, day) => <div key={day}><span>{['一','二','三','四','五','六','日'][day]}</span>{row.map((value, hour) => <i key={hour} style={{ opacity: report.heatmap.max ? .15 + .85 * value / report.heatmap.max : .08 }} />)}</div>)}</div>;
}

function ContributionCalendar({ report }) {
  const groups = new Map();
  for (const bucket of report.buckets) {
    const key = new Date(bucket.bucketStart).toISOString().slice(0, 10);
    groups.set(key, (groups.get(key) || 0) + (bucket.totalTokens || 0));
  }
  const values = [...groups.values()];
  const max = Math.max(1, ...values);
  const days = [];
  const cursor = new Date(report.end);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - 90);
  for (let i = 0; i < 91; i += 1) {
    const key = cursor.toISOString().slice(0, 10);
    days.push({ key, value: groups.get(key) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return <div className="poster-contributions">{days.map((day) => <i key={day.key} title={`${day.key} ${compact(day.value)}`} style={{ opacity: day.value ? .18 + .82 * day.value / max : .06 }} />)}</div>;
}

function PosterActivity({ report, range }) {
  if (range === '7d') return <PosterHeatmap report={report} />;
  if (range === '90d' || range === 'all') return <ContributionCalendar report={report} />;
  return <StackedBars report={report} range={range} />;
}

export const UsagePoster = forwardRef(function UsagePoster({ report, range, identity, communityUrl, generatedAt }, ref) {
  const [rangeZh, rangeEn] = RANGE_LABELS[range] || RANGE_LABELS['30d'];
  const start = report.start || (report.buckets[0] ? new Date(report.buckets[0].bucketStart) : new Date(generatedAt));
  const fmt = (date) => new Date(date).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replaceAll('/', '.');
  const barsLabel = range === '7d' ? '7 天 × 24 小时活跃热图' : range === '90d' || range === 'all' ? '近 13 周贡献日历' : `${rangeZh} TOKEN 构成`;
  return (
    <article className="usage-poster" ref={ref}>
      <header className="poster-header"><strong>KIMI BUILDERS <b>/ USAGE</b></strong><span>TOKEN X-RAY <i>{rangeZh}</i></span></header>
      <section className="poster-identity">
        <div className="poster-avatar">{identity.name.slice(0, 2).toUpperCase()}</div>
        <div><strong>{identity.name}</strong><span>@{identity.handle}　<b>kimi.builders/usage</b></span></div>
        <div className="poster-streak"><b>{report.streaks.weeklyCurrent}</b><strong>周连续构建</strong><span>WEEK STREAK</span></div>
        <div className="poster-span"><strong>{fmt(start)} — {fmt(report.end)}</strong><span>数据起止 SPAN</span></div>
      </section>
      <section className="poster-hero">
        <div><strong>{compact(report.totals.totalTokens)}</strong><span>{rangeZh} TOKEN　<small>LIFETIME {compact(report.lifetimeTotals.totalTokens)} · {report.totals.requestCount.toLocaleString('en-US')} REQUESTS</small></span></div>
        <div><strong>{money(report.totals.costMicros)}</strong><span>API 等价价值</span></div>
        <div><strong>{posterDuration(report.activeSeconds)}</strong><span>活跃时长</span></div>
      </section>
      <PosterFlow report={report} />
      <section className="poster-activity">
        <div className="poster-subhead"><span>{barsLabel}</span><small>缓存命中 {percent(report.cacheHitRate)}</small></div>
        <div className="poster-chart-legend"><span><i className="p-input" />输入（含缓存写）</span><span><i className="p-cache" />缓存读</span><span><i className="p-output" />输出</span><span><i className="p-reason" />推理</span></div>
        <PosterActivity report={report} range={range} />
      </section>
      <section className="poster-kpis">
        <div><span>◉ 费用 COST</span><strong>{money(report.totals.costMicros)}</strong></div>
        <div><span>◷ 活跃时长 ACTIVE</span><strong>{posterDuration(report.activeSeconds)}</strong></div>
        <div><span>⌁ 单日峰值 PEAK</span><strong>{compact(report.peakTokens)}</strong></div>
        <div><span>ϟ 缓存命中 HIT</span><strong>{percent(report.cacheHitRate)}</strong></div>
        <div><span>▱ 会话 SESS</span><strong>{report.sessions.length.toLocaleString('en-US')}</strong></div>
      </section>
      <section className="poster-agents">
        <div className="poster-subhead"><span>常用 AGENT</span><small>共 {report.sourceRows.length} 个 · 按 TOKEN</small></div>
        <div>{report.sourceRows.slice(0, 5).map((row) => <article key={row.id}><ToolGlyph id={row.id} size={25} /><strong>{sourceLabel(row.id)}</strong><span>{compact(row.totalTokens)} · {percent(row.share, 0)}</span><i><b style={{ width: `${Math.max(3, row.share * 100)}%` }} /></i></article>)}</div>
      </section>
      <section className="poster-model"><span>主力模型</span><strong>{report.topModel || 'NO MODEL DATA'}</strong><b>{compact(report.modelRows[0]?.totalTokens || 0)} · {percent(report.modelRows[0]?.share || 0, 0)}</b></section>
      <footer className="poster-footer">
        <div className="poster-qr"><Qr value={communityUrl} /></div>
        <div><strong>@{identity.handle} · {rangeZh} · {fmt(generatedAt)}</strong><span>扫码查看实时用量看板</span></div>
        <div><span>标准 API 计价估算</span><span>本地私密同步 · 不含对话内容</span><span>杠杆 ×{report.inputLeverage.toFixed(1)} = 总量 ÷ 新鲜输入</span></div>
      </footer>
      <span className="poster-corner">{rangeEn}</span>
    </article>
  );
});
