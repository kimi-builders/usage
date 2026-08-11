import { useEffect, useMemo, useState } from 'react';
import {
  Activity, BarChart3, Bell, BookOpen, CheckCircle2, ChevronDown, CircleDollarSign,
  Clock3, Cloud, Command, Database, Download, ExternalLink, FileText, Gauge, Globe2,
  Home, Info, LayoutDashboard, Lightbulb, Menu, Monitor, Moon, PanelLeftClose,
  RefreshCw, Rocket, Search, Settings, Share2, ShieldCheck, Sparkles, Star, Sun,
  Terminal, UserRound, Users, Wrench, X,
} from 'lucide-react';
import { analyze, availableModels, RANGE_OPTIONS } from './analytics.js';
import { ActivityHeatmap, DailyTrend, DistributionCard, RecordsTable, WeeklyTrend } from './UsageCharts.jsx';
import { ExportDialog, MethodDialog, ShareDialog } from './UsageDialogs.jsx';
import { compact, delta, duration, integer, money, percent, sourceLabel } from './format.js';
import { ToolGlyph } from './tool-glyphs.js';

const COPY = {
  zh: {
    title: '用量中心', subtitle: 'Kimi-first，多 Agent 兼容。这里不接收对话内容、完整路径或供应商凭据。',
    method: '计算与数据说明', export: '导出', share: '分享成绩', refresh: '重新扫描', local: '本地私有',
    lastSync: '最近扫描', allAgents: 'Agent 全部', allModels: '模型 全部', more: '更多筛选',
    cost: '预估费用', tokens: '总 Token', hit: '缓存命中率', peak: '峰值 TOKEN', active: '活跃时长',
    engaged: '投入时长', sessions: '会话数', messages: '总消息数', userMessages: '用户消息', avg: '平均耗时',
    requests: '请求数', lifetime: '累计 TOKEN', reasoning: '推理', coverage: '已定价覆盖', good: '良好',
    sourceStatus: '数据源与设备', sourceSubtitle: '本次扫描结果、Agent 版本与设备环境。', scan: '扫描', community: '社区版',
  },
  en: {
    title: 'Usage Center', subtitle: 'Kimi-first, multi-agent compatible. No conversation body, full path, or provider credential is read.',
    method: 'Calculation notes', export: 'Export', share: 'Share stats', refresh: 'Rescan', local: 'Local private',
    lastSync: 'Last scanned', allAgents: 'All agents', allModels: 'All models', more: 'More filters',
    cost: 'Estimated cost', tokens: 'Total tokens', hit: 'Cache hit rate', peak: 'Peak tokens', active: 'Active time',
    engaged: 'Engaged time', sessions: 'Sessions', messages: 'Messages', userMessages: 'User messages', avg: 'Avg request',
    requests: 'Requests', lifetime: 'Lifetime tokens', reasoning: 'Reasoning', coverage: 'Pricing coverage', good: 'Good',
    sourceStatus: 'Sources & device', sourceSubtitle: 'Latest scan result, agent versions, and local environment.', scan: 'Scan', community: 'Community',
  },
};

function Change({ value }) {
  if (value == null || !Number.isFinite(value)) return null;
  return <span className={`change ${value >= 0 ? 'up' : 'down'}`}>{value >= 0 ? '↗' : '↘'} {Math.abs(value * 100).toFixed(1)}%</span>;
}

function Button({ children, primary = false, className = '', ...props }) {
  return <button className={`${primary ? 'primary-btn' : 'ghost-btn'} ${className}`} {...props}>{children}</button>;
}

function HeroCard({ label, value, deltaValue, children, tone = '' }) {
  return <article className={`hero-card ${tone}`}><div className="hero-label"><span>{label}</span><Info size={12}/><Change value={deltaValue}/></div><strong>{value}</strong><p>{children}</p></article>;
}

function Stat({ label, value, change, sub }) {
  return <article className="stat-cell"><span>{label}</span><strong>{value}</strong><Change value={change}/>{sub ? <small>{sub}</small> : null}</article>;
}

function DesktopNav({ zh, communityUrl }) {
  const top = [
    ['#top', Home, zh ? '总览' : 'Overview'], ['#trend', BarChart3, zh ? '趋势' : 'Trends'],
    ['#activity', Activity, zh ? '活跃' : 'Activity'], ['#distribution', LayoutDashboard, zh ? '分布' : 'Distribution'],
    ['#records', FileText, zh ? '明细' : 'Records'], ['#sources', Database, zh ? '数据源' : 'Sources'],
  ];
  return <aside className="left-nav">
    <Button primary className="community-cta" onClick={() => window.open(communityUrl, '_blank', 'noopener,noreferrer')}><Cloud size={14}/>{zh ? '打开社区看板' : 'Open community'}</Button>
    <nav>{top.map(([href, Icon, label], index) => <a className={index === 0 ? 'active' : ''} href={href} key={href}><Icon size={15}/>{label}</a>)}</nav>
    <nav className="nav-bottom"><a href="https://kimi.builders" target="_blank" rel="noreferrer"><Globe2 size={15}/>{zh ? '社区首页' : 'Community'}</a><a href="https://github.com/kimi-builders/usage" target="_blank" rel="noreferrer"><Command size={15}/>GitHub</a><a href="#sources"><Info size={15}/>{zh ? '关于本地版' : 'About local'}</a></nav>
    <div className="nav-view"><span>{zh ? '界面' : 'View'}</span><button><PanelLeftClose size={13}/>{zh ? '收起导航' : 'Collapse'}</button></div>
  </aside>;
}

function MobileNav({ zh }) {
  return <nav className="mobile-tabs">
    <a href="#top"><Home size={20}/><span>{zh ? '总览' : 'Home'}</span></a>
    <a href="#trend"><BarChart3 size={20}/><span>{zh ? '趋势' : 'Trend'}</span></a>
    <a href="#activity" className="active"><Activity size={20}/><span>{zh ? '用量' : 'Usage'}</span></a>
    <a href="#records"><FileText size={20}/><span>{zh ? '明细' : 'Records'}</span></a>
    <a href="#sources"><Database size={20}/><span>{zh ? '数据源' : 'Sources'}</span></a>
  </nav>;
}

function Loading({ zh }) {
  return <main className="state-page"><img src="/brand/logo-tile.svg" alt=""/><RefreshCw className="spin"/><h1>{zh ? '正在扫描本地用量' : 'Scanning local usage'}</h1><p>{zh ? '只读取本机 Agent 日志，没有数据离开这台设备。' : 'Reading local agent logs; no data leaves this device.'}</p></main>;
}

function ErrorState({ error, retry, zh }) {
  return <main className="state-page"><Info size={38}/><h1>{zh ? '本地扫描失败' : 'Local scan failed'}</h1><p>{error}</p><Button primary onClick={retry}>{zh ? '重试' : 'Retry'}</Button></main>;
}

export function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState('30d');
  const [source, setSource] = useState('all');
  const [model, setModel] = useState('all');
  const [theme, setTheme] = useState(() => localStorage.getItem('kbu.theme') || 'dark');
  const [locale, setLocale] = useState(() => localStorage.getItem('kbu.locale') || 'zh');
  const [dialog, setDialog] = useState(null);
  const zh = locale === 'zh';
  const t = COPY[locale];

  const load = async (refresh = false) => {
    setRefreshing(refresh); setError('');
    try {
      const response = await fetch(`/api/snapshot${refresh ? '?refresh=1' : ''}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(`Snapshot request failed (${response.status})`);
      setData(await response.json());
    } catch (reason) { setError(reason?.message || String(reason)); }
    finally { setRefreshing(false); }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('kbu.theme', theme); }, [theme]);
  useEffect(() => { document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'; localStorage.setItem('kbu.locale', locale); }, [locale]);
  useEffect(() => { setModel('all'); }, [source]);

  const models = useMemo(() => data ? availableModels(data, source) : [], [data, source]);
  const report = useMemo(() => data ? analyze(data, { range, source, model }) : null, [data, range, source, model]);

  if (!data && !error) return <Loading zh={zh}/>;
  if (!data && error) return <ErrorState zh={zh} error={error} retry={() => load()}/>;

  const previous = report.previous;
  const staleHours = Math.max(0, (Date.now() - Date.parse(data.generatedAt)) / 3_600_000);
  const device = `${data.device?.terminal?.name || 'Terminal'}${data.device?.terminal?.version ? ` ${data.device.terminal.version}` : ''} · ${data.device?.os?.name || 'OS'}${data.device?.os?.version ? ` ${data.device.os.version}` : ''}`;
  const filters = { range, source, model };
  const sourceId = (item) => item.source || item.id;

  return <div className="app-shell" id="top">
    <header className="global-topbar">
      <a className="brand" href="#top"><img src="/brand/logo-tile.svg" alt=""/><span>kimi.builders</span><small>LOCAL</small></a>
      <div className="global-actions"><span className="local-pill"><ShieldCheck size={12}/>{t.local}</span><button className="icon-btn" onClick={() => setLocale(zh ? 'en' : 'zh')} title="Language">{zh ? '文' : 'En'}</button><button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Theme">{theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>}</button></div>
    </header>
    <DesktopNav zh={zh} communityUrl={data.community.url}/>
    <MobileNav zh={zh}/>
    <main className="page-content">
      <section className="page-heading">
        <div><h1><BarChart3 size={22}/>{t.title}</h1><p>{t.subtitle}</p><div className="privacy-line"><ShieldCheck size={13}/><span>{t.local}</span><i/> <span>{t.lastSync} {new Date(data.generatedAt).toLocaleString(zh ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</span>{staleHours > 24 ? <b>{zh ? `超过 ${Math.floor(staleHours)} 小时未扫描` : `${Math.floor(staleHours)}h stale`}</b> : null}</div></div>
        <div className="page-actions"><Button onClick={() => setDialog('method')}><Info size={14}/>{t.method}</Button><Button onClick={() => setDialog('export')}><Download size={14}/>{t.export}</Button><Button onClick={() => setDialog('share')}><Share2 size={14}/>{t.share}</Button><Button primary onClick={() => load(true)} disabled={refreshing}><RefreshCw className={refreshing ? 'spin' : ''} size={14}/>{t.refresh}</Button></div>
      </section>

      <section className="filter-bar">
        <div className="range-segment">{RANGE_OPTIONS.map((item) => <button key={item.id} className={range === item.id ? 'active' : ''} onClick={() => setRange(item.id)}>{zh ? item.zh : item.en}</button>)}</div>
        <label className="select-control"><ToolGlyph id={source === 'all' ? 'kimi-code' : source} size={13}/><select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">{t.allAgents}</option>{data.sources.filter((item) => item.status !== 'skipped').map((item) => <option value={sourceId(item)} key={sourceId(item)}>{item.label || sourceLabel(sourceId(item))}</option>)}</select><ChevronDown size={12}/></label>
        <label className="select-control"><Wrench size={13}/><select value={model} onChange={(event) => setModel(event.target.value)}><option value="all">{t.allModels}</option>{models.map((item) => <option value={item} key={item}>{item}</option>)}</select><ChevronDown size={12}/></label>
        <button className="more-filter"><Settings size={13}/>{t.more} +3</button>
        <div className="currency-toggle"><button className="active">$</button><button>¥</button></div>
      </section>

      {staleHours > 24 ? <section className="stale-banner"><Clock3 size={19}/><div><b>{zh ? '这份看板可能已经过期' : 'This dashboard may be stale'}</b><p>{zh ? '点击重新扫描即可更新本机数据；站点不会主动读取本地日志。' : 'Rescan to refresh local logs; the site never reads them automatically.'}</p></div><code>kbu-usage dashboard</code></section> : null}

      <section className="hero-grid">
        <HeroCard label={t.cost} value={money(report.totals.costMicros)} deltaValue={delta(report.totals.costMicros, previous?.totals.costMicros)}>{zh ? `vs 上一周期 · 覆盖 ${percent(report.pricingCoverage)} Token · ${compact(report.totals.unpricedTokens)} 未定价` : `vs prior · ${percent(report.pricingCoverage)} coverage · ${compact(report.totals.unpricedTokens)} unpriced`}</HeroCard>
        <HeroCard label={t.tokens} value={compact(report.totals.totalTokens)} deltaValue={delta(report.totals.totalTokens, previous?.totals.totalTokens)}>{zh ? `输入 ${compact(report.totals.inputTokens + report.totals.cacheWriteInputTokens)} · 输出 ${compact(report.totals.outputTokens)} · 缓存读 ${compact(report.totals.cacheReadInputTokens)}` : `Input ${compact(report.totals.inputTokens)} · Output ${compact(report.totals.outputTokens)} · Cache ${compact(report.totals.cacheReadInputTokens)}`}</HeroCard>
        <HeroCard label={t.hit} value={percent(report.cacheHitRate)} tone="hero-card--green"><span className="quality"><i/>{report.cacheHitRate > .8 ? t.good : (zh ? '可提升' : 'Improve')}</span>{zh ? `缓存写 ${compact(report.totals.cacheWriteInputTokens)} · 命中率越高，费用越低` : `Cache write ${compact(report.totals.cacheWriteInputTokens)} · higher is cheaper`}</HeroCard>
      </section>

      <section className="stats-grid">
        <Stat label={t.peak} value={compact(report.peakTokens)} sub={report.series.reduce((best, item) => item.totalTokens > (best?.totalTokens || 0) ? item : best, null)?.label}/>
        <Stat label={t.active} value={duration(report.activeSeconds, zh)} change={delta(report.activeSeconds, previous?.activeSeconds)}/>
        <Stat label={t.engaged} value={duration(report.engagedSeconds, zh)}/>
        <Stat label={t.sessions} value={integer(report.sessions.length)} />
        <Stat label={t.messages} value={compact(report.messageCount)} change={delta(report.messageCount, previous?.messageCount)}/>
        <Stat label={t.userMessages} value={compact(report.userMessageCount)} change={delta(report.userMessageCount, previous?.userMessageCount)}/>
        <Stat label={t.avg} value={`${report.avgRequestSeconds.toFixed(1)}s`}/>
        <Stat label={t.requests} value={compact(report.totals.requestCount)}/>
        <Stat label={t.lifetime} value={compact(report.lifetimeTotals.totalTokens)} sub={zh ? '全部已同步历史' : 'All local history'}/>
        <Stat label={t.reasoning} value={compact(report.totals.reasoningOutputTokens)} sub={report.topReasoning || (zh ? '未记录强度' : 'Effort not recorded')}/>
      </section>

      <DailyTrend report={report} zh={zh}/>
      <WeeklyTrend report={report} zh={zh}/>
      <ActivityHeatmap report={report} zh={zh}/>
      <section className="distribution-grid" id="distribution"><DistributionCard type="source" rows={report.sourceRows} zh={zh}/><DistributionCard type="model" rows={report.modelRows} zh={zh}/><DistributionCard type="project" rows={report.projectRows} zh={zh}/><DistributionCard type="device" rows={report.deviceRows.map((row) => ({ ...row, id: device }))} zh={zh}/></section>
      <RecordsTable report={report} zh={zh}/>

      <section className="panel sources-panel" id="sources">
        <header className="panel-header"><div><h2>{t.sourceStatus}</h2><p>{t.sourceSubtitle}</p></div><span className="panel-meta">COLLECTOR {data.device?.collector?.version || data.device?.collectorVersion || 'LOCAL'}</span></header>
        <div className="source-summary"><article><Monitor size={18}/><div><span>{zh ? '当前设备' : 'Current device'}</span><b>{device}</b><small>{data.device?.collector?.version ? `Collector ${data.device.collector.version}` : 'Collector local'}</small></div></article><article><CircleDollarSign size={18}/><div><span>{zh ? '价格目录' : 'Price catalog'}</span><b>{data.pricing.version}</b><small>{data.pricing.entryCount} {zh ? '个标准 API 价格条目' : 'standard API entries'}</small></div></article><article><ShieldCheck size={18}/><div><span>{zh ? '网络状态' : 'Network state'}</span><b>{zh ? '看板零上传' : 'Zero dashboard uploads'}</b><small>{data.community.connected ? (zh ? '社区同步已配置' : 'Community sync configured') : (zh ? '社区同步未配置' : 'Community sync not configured')}</small></div></article></div>
        <div className="source-list">{data.sources.map((item) => <article key={sourceId(item)}><ToolGlyph id={sourceId(item)} size={17}/><div><b>{item.label || sourceLabel(sourceId(item))}</b><span>{item.bucketCount || 0} buckets · {item.sessionCount || 0} sessions</span></div><small>{data.agentVersions?.[sourceId(item)] || '—'}</small><em className={item.status === 'ok' ? 'ok' : item.status}>{item.status === 'ok' ? <CheckCircle2 size={13}/> : <Info size={13}/>} {item.status}</em></article>)}</div>
      </section>
      <footer className="page-footer"><span>kimi.builders / usage · LOCAL</span><p>{zh ? '数据属于你。分析在本机，社区同步永远可选。' : 'Your data. Local analysis. Community sync is always optional.'}</p><a href={data.community.url} target="_blank" rel="noreferrer">{t.community}<ExternalLink size={12}/></a></footer>
    </main>
    <MethodDialog open={dialog === 'method'} onClose={() => setDialog(null)} zh={zh}/>
    <ExportDialog open={dialog === 'export'} onClose={() => setDialog(null)} report={report} filters={filters} zh={zh}/>
    <ShareDialog open={dialog === 'share'} onClose={() => setDialog(null)} data={data} source={source} model={model} initialRange={range} zh={zh}/>
  </div>;
}
