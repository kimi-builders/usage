import { useMemo, useState } from 'react';
import { Activity, BarChart3, CircleAlert, Clock3, FileText, LayoutDashboard, ShieldCheck } from 'lucide-react';
import { compact, percent } from './format.js';
import { ToolGlyph } from './tool-glyphs.js';

const COLORS = { tokens: '#1a88ff', quota: '#20d39a', warning: '#f6a609' };

function money(value) {
  return `$${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateLabel(value, zh, includeTime = false) {
  const options = includeTime
    ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
    : { month: 'numeric', day: 'numeric' };
  return new Date(value).toLocaleString(zh ? 'zh-CN' : 'en-US', options);
}

function EmptyEvidence({ title, body, zh }) {
  return <div className="benefit-empty-evidence"><CircleAlert size={22}/><div><b>{title}</b><p>{body}</p><small>{zh ? '缺失不会按 0 处理，也不会参与趋势判断。' : 'Missing evidence is never treated as zero or used for trend decisions.'}</small></div></div>;
}

export function BenefitProviderPicker({ providers, active, onChange, zh }) {
  return <section className="benefit-provider-picker"><div><span>{zh ? '分析账户' : 'ANALYSIS ACCOUNT'}</span><b>{zh ? '以下页面只分析当前订阅' : 'The pages below analyze one benefit at a time'}</b></div><div role="tablist" aria-label={zh ? '选择权益账户' : 'Choose benefit account'}>{providers.map((provider) => <button type="button" role="tab" aria-selected={provider.id === active?.id} className={provider.id === active?.id ? 'active' : ''} onClick={() => onChange(provider.id)} key={provider.id}><ToolGlyph id={provider.id} size={15}/><span>{provider.label}</span>{provider.quotaObservation?.state !== 'current' ? <small>{zh ? '仅本机' : 'Local only'}</small> : null}</button>)}</div></section>;
}

function QuotaLine({ points }) {
  if (!points.length) return null;
  const first = Date.parse(points[0].observedAt);
  const last = Date.parse(points.at(-1).observedAt);
  const span = Math.max(1, last - first);
  const path = points.map((point, index) => {
    const x = 42 + (Date.parse(point.observedAt) - first) / span * 838;
    const y = 176 - Math.max(0, Math.min(100, Number(point.usedPercent) || 0)) * 1.32;
    return `${index ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  return <path className="benefit-quota-line" d={path}/>;
}

export function BenefitTrendView({ provider, zh }) {
  const windows = provider.windows.filter((window) => window.historyPoints?.length);
  const [windowId, setWindowId] = useState(windows[0]?.id || '');
  const selected = windows.find((window) => window.id === windowId) || windows[0];
  const points = selected?.historyPoints || [];
  const timeline = provider.timeline.slice(-30);
  const maxTokens = Math.max(1, ...timeline.map((item) => item.totalTokens));
  return <section className="benefit-view-stack">
    <section className="panel benefit-hero-panel"><header className="panel-header"><div><h2><BarChart3 size={15}/>{zh ? '额度趋势' : 'Quota trends'}</h2><p>{zh ? '供应商额度事实与本机 Token 分轨展示；虚线代表官方消耗比例' : 'Provider quota facts and local Tokens stay on separate scales; the dashed line is official utilization'}</p></div>{windows.length > 1 ? <select aria-label={zh ? '选择额度窗口' : 'Choose quota window'} value={selected?.id || ''} onChange={(event) => setWindowId(event.target.value)}>{windows.map((window) => <option value={window.id} key={window.id}>{window.label}</option>)}</select> : null}</header>
      {timeline.length ? <div className="benefit-combo-chart"><svg viewBox="0 0 920 218" role="img" aria-label={zh ? `${provider.label}额度和本机 Token 趋势` : `${provider.label} quota and local Token trend`}>
        {[0, 25, 50, 75, 100].map((value) => <g key={value}><line x1="42" x2="880" y1={176 - value * 1.32} y2={176 - value * 1.32}/><text x="4" y={180 - value * 1.32}>{value}%</text></g>)}
        {timeline.map((item, index) => { const width = Math.max(4, 794 / timeline.length); const height = item.totalTokens / maxTokens * 128; const x = 62 + index * (798 / timeline.length); return <rect className="benefit-token-bar" x={x} y={176 - height} width={width} height={height} rx="2" key={item.key}><title>{dateLabel(item.key, zh)} · {compact(item.totalTokens)} Token · {money(item.costMicros / 1e6)}</title></rect>; })}
        <QuotaLine points={points}/>
      </svg><div className="benefit-chart-axis"><span>{timeline[0] ? dateLabel(timeline[0].key, zh) : '—'}</span><span>{zh ? '蓝柱：本机 Token　绿线：官方已用额度' : 'Blue: local Tokens　Green: official quota used'}</span><span>{timeline.at(-1) ? dateLabel(timeline.at(-1).key, zh) : '—'}</span></div></div> : <EmptyEvidence zh={zh} title={zh ? '还没有该订阅的本机趋势' : 'No local trend yet'} body={zh ? '继续使用或重新扫描后，这里会按自然日积累 Token 与标准 API 等价价值。' : 'Continue using or rescan to build daily Token and API-equivalent history.'}/>} 
      {!points.length ? <div className="benefit-inline-warning"><CircleAlert size={14}/><span>{provider.quotaObservation?.state === 'unavailable' ? (zh ? '该账户当前没有可验证的官方额度窗口，只展示本机趋势。' : 'This account has no verifiable official quota window; only local trends are shown.') : (zh ? '额度历史从成功刷新后开始积累，至少两个样本才计算速度。' : 'Quota history begins after successful refresh and needs two samples for pace.')}</span></div> : null}
    </section>
    <section className="benefit-kpi-row"><article><span>{zh ? '近 30 天 TOKEN' : '30D TOKENS'}</span><strong>{compact(provider.recentTotals.totalTokens)}</strong><small>{provider.recentTotals.requestCount.toLocaleString()} {zh ? '次请求' : 'requests'}</small></article><article><span>{zh ? 'API 等价价值' : 'API EQUIVALENT'}</span><strong>{money(provider.economics.apiEquivalentUsd)}</strong><small>{zh ? '标准价格，不是账单' : 'standard pricing, not a bill'}</small></article><article><span>{zh ? '完整周期样本' : 'COMPLETE CYCLES'}</span><strong>{Math.max(0, ...provider.windows.map((window) => window.cycleStats?.sampledCycles || 0))}</strong><small>{zh ? '覆盖率 ≥90% 且接近重置' : '≥90% coverage near reset'}</small></article><article><span>{zh ? '官方额度状态' : 'QUOTA STATUS'}</span><strong>{provider.quotaObservation?.state === 'current' ? (zh ? '当前可读' : 'Current') : provider.quotaObservation?.state === 'historical' ? (zh ? '仅历史' : 'History') : (zh ? '不可观测' : 'Hidden')}</strong><small>{zh ? '不以缺失推断无限' : 'missing never means unlimited'}</small></article></section>
  </section>;
}

export function BenefitActivityView({ provider, zh }) {
  const cells = provider.activity || [];
  const max = Math.max(1, ...cells.flat().map((cell) => cell.totalTokens));
  const weekdays = zh ? ['一','二','三','四','五','六','日'] : ['MO','TU','WE','TH','FR','SA','SU'];
  const activeDays = cells.filter((row) => row.some((cell) => cell.totalTokens > 0)).length;
  const peak = cells.flatMap((row, day) => row.map((cell, hour) => ({ ...cell, day, hour }))).sort((a, b) => b.totalTokens - a.totalTokens)[0];
  return <section className="benefit-view-stack"><section className="panel benefit-activity-panel"><header className="panel-header"><div><h2><Activity size={15}/>{zh ? '使用节奏' : 'Usage rhythm'}</h2><p>{zh ? '星期 × 本地小时 · 只使用已归因到该订阅的本机 Token' : 'Weekday × local hour · only local Tokens attributed to this benefit'}</p></div><span className="evidence-badge"><ShieldCheck size={11}/>{zh ? '本机证据' : 'Local evidence'}</span></header><div className="benefit-heatmap"><div className="benefit-heat-hours">{Array.from({ length: 24 }, (_, hour) => <span key={hour}>{hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}</span>)}</div>{cells.map((row, day) => <div className="benefit-heat-row" key={day}><span>{weekdays[day]}</span><div>{row.map((cell, hour) => { const level = cell.totalTokens ? Math.max(1, Math.ceil(cell.totalTokens / max * 6)) : 0; const title = `${weekdays[day]} ${String(hour).padStart(2,'0')}:00 · ${compact(cell.totalTokens)} Token · ${cell.requestCount} ${zh ? '次请求' : 'requests'} · ${money(cell.costMicros / 1e6)}`; return <button type="button" data-level={level} aria-label={title} title={title} key={hour}/>; })}</div></div>)}</div><footer className="benefit-heat-footer"><span>{zh ? '少' : 'Less'} {[1,2,3,4,5,6].map((level) => <i data-level={level} key={level}/>)} {zh ? '多' : 'More'}</span><span>{zh ? '悬停查看 Token、请求与 API 等价价值' : 'Hover for Tokens, requests, and API-equivalent value'}</span></footer></section><section className="benefit-kpi-row"><article><span>{zh ? '活跃星期' : 'ACTIVE WEEKDAYS'}</span><strong>{activeDays} / 7</strong><small>{zh ? '按全部本机历史' : 'all local history'}</small></article><article><span>{zh ? '峰值时段' : 'PEAK SLOT'}</span><strong>{peak?.totalTokens ? `${weekdays[peak.day]} ${String(peak.hour).padStart(2,'0')}:00` : '—'}</strong><small>{compact(peak?.totalTokens || 0)} Token</small></article><article><span>{zh ? '额度撞线证据' : 'LIMIT EVENTS'}</span><strong>{provider.decisionSignals.some((signal) => signal.code === 'exhausted') ? (zh ? '发现' : 'Found') : (zh ? '未发现' : 'None')}</strong><small>{zh ? '仅供应商返回的额度事实' : 'provider-reported facts only'}</small></article><article><span>{zh ? '节奏覆盖范围' : 'RHYTHM COVERAGE'}</span><strong>{compact(provider.lifetimeTotals.totalTokens)}</strong><small>{zh ? '已归因本机 Token' : 'attributed local Tokens'}</small></article></section></section>;
}

function MixCard({ title, rows, zh }) {
  const shown = rows.slice(0, 6);
  const total = shown.reduce((sum, row) => sum + row.totalTokens, 0);
  return <section className="panel benefit-mix-card"><header className="panel-header"><h2>{title}</h2><span>{shown.length} {zh ? '项' : 'items'}</span></header><div>{shown.length ? shown.map((row, index) => { const share = total ? row.totalTokens / total : 0; return <article key={row.id}><span>{String(index + 1).padStart(2,'0')}</span><div><b title={row.label}>{row.label}</b><i><em style={{ width: `${Math.max(2, share * 100)}%` }}/></i></div><strong>{compact(row.totalTokens)}<small>{percent(share)}</small></strong></article>; }) : <p>{zh ? '当前没有可归因记录' : 'No attributable records yet'}</p>}</div></section>;
}

export function BenefitDistributionView({ provider, zh }) {
  const tokenTypeRows = [
    { id: 'input', label: zh ? '输入（含缓存写）' : 'Input + cache write', totalTokens: provider.lifetimeTotals.inputTokens + provider.lifetimeTotals.cacheWriteInputTokens },
    { id: 'cache', label: zh ? '缓存读' : 'Cache read', totalTokens: provider.lifetimeTotals.cacheReadInputTokens },
    { id: 'output', label: zh ? '输出' : 'Output', totalTokens: provider.lifetimeTotals.outputTokens },
    { id: 'reasoning', label: zh ? '推理' : 'Reasoning', totalTokens: provider.lifetimeTotals.reasoningOutputTokens },
  ].sort((a,b) => b.totalTokens - a.totalTokens);
  return <section className="benefit-view-stack"><section className="benefit-section-heading"><div><span>{zh ? '单一订阅构成' : 'ONE-BENEFIT BREAKDOWN'}</span><h2><LayoutDashboard size={16}/>{zh ? `${provider.label} 的消耗构成` : `${provider.label} consumption mix`}</h2><p>{zh ? '构成来自本机 Agent 日志，不代表供应商账单内部权重。' : 'The mix comes from local Agent logs and is not the provider billing weight.'}</p></div><strong>{compact(provider.lifetimeTotals.totalTokens)} Token</strong></section><div className="benefit-distribution-grid"><MixCard title={zh ? '模型' : 'Models'} rows={provider.modelRows} zh={zh}/><MixCard title={zh ? 'Token 类型' : 'Token types'} rows={tokenTypeRows} zh={zh}/><MixCard title={zh ? '推理强度' : 'Reasoning effort'} rows={provider.effortRows} zh={zh}/><MixCard title={zh ? '项目 / 工作负载' : 'Projects / workload'} rows={provider.projectRows} zh={zh}/></div><div className="benefit-attribution-note"><ShieldCheck size={14}/><span>{zh ? `归因范围：${provider.sources.join('、')}。无法确认账户归属的数据不会被强行放进这个订阅。` : `Attribution scope: ${provider.sources.join(', ')}. Data without reliable account attribution is not forced into this benefit.`}</span></div></section>;
}

export function BenefitRecordsView({ provider, zh }) {
  const [kind, setKind] = useState('quota');
  const rows = provider.observationLog.slice(0, 100);
  const usageRows = provider.usageRecords.slice(0, 100);
  const shown = kind === 'quota' ? rows.length : usageRows.length;
  const total = kind === 'quota' ? provider.observationLog.length : provider.usageRecords.length;
  return <section className="panel benefit-records-panel"><header className="panel-header"><div><h2><FileText size={15}/>{zh ? '观测明细' : 'Observation log'}</h2><p>{zh ? '脱敏额度快照与本机用量事实；不包含凭据、Cookie、完整路径或原始响应' : 'Sanitized quota snapshots and local usage facts; no credentials, cookies, full paths, or raw responses'}</p></div><div className="benefit-record-kind"><button type="button" className={kind === 'quota' ? 'active' : ''} onClick={() => setKind('quota')}>{zh ? '额度快照' : 'Quota snapshots'}</button><button type="button" className={kind === 'usage' ? 'active' : ''} onClick={() => setKind('usage')}>{zh ? '本机用量' : 'Local usage'}</button><span>{shown} / {total}</span></div></header>{kind === 'quota' ? (rows.length ? <div className="benefit-records-table" role="table" aria-label={zh ? `${provider.label}额度观测明细` : `${provider.label} quota observation log`}><div className="benefit-records-head" role="row"><span>{zh ? '时间' : 'Observed'}</span><span>{zh ? '窗口' : 'Window'}</span><span>{zh ? '官方已用' : 'Official used'}</span><span>{zh ? '本机 TOKEN' : 'Local Tokens'}</span><span>{zh ? '覆盖率' : 'Coverage'}</span><span>{zh ? '重置' : 'Reset'}</span></div>{rows.map((row, index) => <div className="benefit-records-row" role="row" key={`${row.observedAt}-${row.id}-${index}`}><span>{dateLabel(row.observedAt, zh, true)}</span><span>{row.label}</span><strong>{row.usedPercent == null ? '—' : `${Number(row.usedPercent).toFixed(1)}%`}</strong><span>{compact(row.localTotals?.totalTokens || 0)}</span><span>{row.localCoverage == null ? '—' : percent(row.localCoverage)}</span><span>{row.resetsAt ? dateLabel(row.resetsAt, zh, true) : '—'}</span></div>)}</div> : <EmptyEvidence zh={zh} title={zh ? '还没有额度观测记录' : 'No quota observations yet'} body={provider.quotaObservation?.state === 'unavailable' ? (zh ? '该账户当前不提供稳定的可读额度；可切换到“本机用量”查看已归因 Token。' : 'This account exposes no stable quota; switch to Local usage for attributed Tokens.') : (zh ? '点击“刷新额度”后，从首个成功的脱敏快照开始积累。' : 'Refresh quotas to begin with the first successful sanitized snapshot.')}/>) : (usageRows.length ? <div className="benefit-records-table" role="table" aria-label={zh ? `${provider.label}本机用量明细` : `${provider.label} local usage log`}><div className="benefit-records-head benefit-usage-head" role="row"><span>{zh ? '时间' : 'Time'}</span><span>{zh ? '模型' : 'Model'}</span><span>TOKEN</span><span>{zh ? '请求' : 'Requests'}</span><span>{zh ? '推理强度' : 'Reasoning'}</span><span>{zh ? 'API 等价价值' : 'API equivalent'}</span></div>{usageRows.map((row) => <div className="benefit-records-row benefit-usage-row" role="row" key={row.id}><span>{dateLabel(row.observedAt, zh, true)}</span><span title={row.model}>{row.model}</span><strong>{compact(row.totalTokens)}</strong><span>{row.requestCount.toLocaleString()}</span><span>{row.reasoningEffort || (zh ? '未记录' : 'Not recorded')}</span><span>{money(row.costMicros / 1e6)}</span></div>)}</div> : <EmptyEvidence zh={zh} title={zh ? '还没有该账户的本机用量' : 'No local usage for this account'} body={zh ? '供应商额度与本机日志相互独立；有额度不等于这台设备已经产生 Token。' : 'Provider quota and local logs are independent; having a quota does not mean this device produced Tokens.'}/>)}<footer><Clock3 size={13}/><span>{kind === 'quota' ? (zh ? '额度历史由本地服务管理并按时间降采样；重复读取缓存不会追加相同快照。' : 'Quota history is backend-owned and downsampled over time; cached reads do not append duplicates.') : (zh ? '本机用量按原始事实桶展示；完整路径与对话内容从不进入页面。' : 'Local usage uses raw fact buckets; full paths and conversation content never enter the page.')}</span></footer></section>;
}
