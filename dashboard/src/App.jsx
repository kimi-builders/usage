import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Activity, BarChart3, Cloud, Command, Database, Download, ExternalLink, FileText,
  Gauge, Globe2, Home, Info, LayoutDashboard, Menu, Moon, RefreshCw, Settings2,
  Share2, ShieldCheck, Sun, X,
} from 'lucide-react';
import { analyze, EMPTY_FILTERS, filterOptions } from './analytics.js';
import { ActivityHeatmap, DailyTrend, DistributionCard, WeeklyTrend } from './UsageCharts.jsx';
import { ExportDialog, MethodDialog, ShareDialog } from './UsageDialogs.jsx';
import { UsageFilterBar } from './UsageFilters.jsx';
import { UsageManagement } from './UsageManagement.jsx';
import { RecordsSection } from './UsageRecords.jsx';
import { LimitSettingsDialog, SubscriptionLimits } from './SubscriptionLimits.jsx';
import { compact, delta, duration, integer, percent } from './format.js';

const COPY = {
  zh: {
    title: '用量中心', subtitle: 'Kimi-first，多 Agent 兼容。这里只读取 Token、时间与计数，不读取对话内容、完整路径或供应商凭据。',
    method: '计算说明', export: '导出', share: '分享成绩', refresh: '重新扫描', local: '本地私有', lastSync: '最近扫描',
    cost: '预估费用', tokens: '总 Token', hit: '缓存命中率', peak: '峰值 TOKEN', active: '活跃时长', engaged: '投入时长', sessions: '会话数',
    messages: '总消息数', userMessages: '用户消息', avg: '平均耗时', requests: '请求数', lifetime: '累计 TOKEN', reasoning: '推理', good: '良好',
  },
  en: {
    title: 'Usage Center', subtitle: 'Kimi-first, multi-agent ready. Only token, timing, and count metrics are read—never conversations, full paths, or provider credentials.',
    method: 'Calculation notes', export: 'Export', share: 'Share stats', refresh: 'Rescan', local: 'Local private', lastSync: 'Last scanned',
    cost: 'Estimated cost', tokens: 'Total tokens', hit: 'Cache hit rate', peak: 'Peak tokens', active: 'Active time', engaged: 'Engaged time', sessions: 'Sessions',
    messages: 'Messages', userMessages: 'User messages', avg: 'Avg active', requests: 'Requests', lifetime: 'Lifetime tokens', reasoning: 'Reasoning', good: 'Good',
  },
};

function currencyMoney(micros, currency) {
  const value = (micros / 1e6) * (currency === 'cny' ? 7.2 : 1);
  return `${currency === 'cny' ? '¥' : '$'}${value.toFixed(2)}`;
}

function MetricHint({ children, text, className = '' }) {
  const tooltipId = useId();
  return <button type="button" className={`metric-hint ${className}`} aria-label={text} aria-describedby={tooltipId}>
    {children}
    <span className="metric-hint-popover" id={tooltipId} role="tooltip">{text}</span>
  </button>;
}

function Change({ value, label, current, previous, zh }) {
  if (value == null || !Number.isFinite(value)) return null;
  const percentage = `${value >= 0 ? '+' : '-'}${Math.abs(value * 100).toFixed(1)}%`;
  const text = zh
    ? `${label}与紧邻的上一等长周期相比：当前 ${current}，上期 ${previous}。变化 =（当前 − 上期）÷ 上期 = ${percentage}。`
    : `${label} versus the immediately preceding equal-length period: ${current} now, ${previous} before. Change = (current − previous) ÷ previous = ${percentage}.`;
  return <MetricHint text={text} className="change-hint"><span className={`change ${value >= 0 ? 'up' : 'down'}`}>{value >= 0 ? '↗' : '↘'} {Math.abs(value * 100).toFixed(1)}%</span></MetricHint>;
}

function Button({ children, primary = false, className = '', ...props }) {
  return <button type="button" className={`${primary ? 'primary-btn' : 'ghost-btn'} ${className}`} {...props}>{children}</button>;
}

function HeroCard({ label, value, deltaValue, previousValue, children, tone = '', onHelp, zh }) {
  return <article className={`hero-card ${tone}`}><div className="hero-label"><span>{label}</span>{onHelp ? <button type="button" onClick={onHelp} aria-label={`${label} info`}><Info size={12}/></button> : null}<Change value={deltaValue} label={label} current={value} previous={previousValue} zh={zh}/></div><strong>{value}</strong><p>{children}</p></article>;
}

function Stat({ label, value, change, previousValue, sub, onHelp, zh }) {
  return <article className="stat-cell"><span>{label}{onHelp ? <button type="button" onClick={onHelp}><Info size={10}/></button> : null}</span><strong>{value}</strong><Change value={change} label={label} current={value} previous={previousValue} zh={zh}/>{sub ? <small>{sub}</small> : null}</article>;
}

const LOCAL_LINKS = [
  ['#top', Home, '总览', 'Overview'], ['#limits', Gauge, '额度', 'Limits'], ['#trend', BarChart3, '趋势', 'Trends'], ['#activity', Activity, '活跃', 'Activity'],
  ['#distribution', LayoutDashboard, '分布', 'Distribution'], ['#records', FileText, '明细', 'Records'], ['#sources', Database, '本机', 'Device'],
];
const LOCAL_SECTION_IDS = LOCAL_LINKS.map(([href]) => href.slice(1));

function sectionFromHash(hash = '') {
  const id = hash.replace(/^#/, '');
  return LOCAL_SECTION_IDS.includes(id) ? id : 'top';
}

function DesktopNav({ zh, communityUrl, activeSection, onNavigate, onSettings }) {
  return <aside className="left-nav"><a className="community-cta primary-btn" href={communityUrl} target="_blank" rel="noreferrer"><Cloud size={14}/>{zh ? '打开社区看板' : 'Open community'}</a><nav>{LOCAL_LINKS.map(([href, Icon, cn, en]) => { const active = activeSection === href.slice(1); return <a className={active ? 'active' : ''} href={href} key={href} aria-current={active ? 'location' : undefined} onClick={(event) => onNavigate(event, href)}><Icon size={15}/>{zh ? cn : en}</a>; })}</nav><nav className="nav-bottom"><button type="button" onClick={onSettings}><Settings2 size={15}/>{zh ? '额度设置' : 'Limit settings'}</button><a href="https://kimi.builders" target="_blank" rel="noreferrer"><Globe2 size={15}/>{zh ? '社区首页' : 'Community'}</a><a href="https://github.com/kimi-builders/usage" target="_blank" rel="noreferrer"><Command size={15}/>GitHub</a><a href="#sources" onClick={(event) => onNavigate(event, '#sources')}><Info size={15}/>{zh ? '隐私与数据源' : 'Privacy & sources'}</a></nav></aside>;
}

function MobileDrawer({ open, onClose, zh, communityUrl, theme, setTheme, setLocale, activeSection, onNavigate, onSettings }) {
  if (!open) return null;
  return <div className="mobile-drawer-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="mobile-drawer"><header><a className="brand" href="#top" onClick={(event) => { onNavigate(event, '#top'); onClose(); }}><img src="/brand/logo-tile.svg" alt=""/><span>kimi.builders</span><small>LOCAL</small></a><button className="icon-btn" type="button" onClick={onClose}><X size={19}/></button></header><div className="drawer-account"><ShieldCheck size={18}/><div><b>{zh ? '本地私有看板' : 'Private local dashboard'}</b><span>127.0.0.1 · {zh ? '零上传' : 'zero upload'}</span></div></div><nav>{LOCAL_LINKS.map(([href, Icon, cn, en]) => { const active = activeSection === href.slice(1); return <a className={active ? 'active' : ''} href={href} key={href} aria-current={active ? 'location' : undefined} onClick={(event) => { onNavigate(event, href); onClose(); }}><Icon size={17}/>{zh ? cn : en}</a>; })}</nav><div className="drawer-actions"><button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>} {zh ? '切换主题' : 'Switch theme'}</button><button type="button" onClick={() => setLocale(zh ? 'en' : 'zh')}><Globe2 size={16}/>{zh ? 'English' : '中文'}</button><button type="button" onClick={() => { onSettings(); onClose(); }}><Settings2 size={16}/>{zh ? '额度设置' : 'Limit settings'}</button></div><a className="drawer-community" href={communityUrl} target="_blank" rel="noreferrer"><Cloud size={16}/>{zh ? '打开社区用量中心' : 'Open community usage'}<ExternalLink size={13}/></a></aside></div>;
}

function MobileNav({ zh, activeSection, onNavigate }) {
  const links = [LOCAL_LINKS[0], LOCAL_LINKS[1], LOCAL_LINKS[2], LOCAL_LINKS[5], LOCAL_LINKS[6]];
  return <nav className="mobile-tabs">{links.map(([href, Icon, cn, en]) => { const active = activeSection === href.slice(1); return <a href={href} className={active ? 'active' : ''} aria-current={active ? 'location' : undefined} onClick={(event) => onNavigate(event, href)} key={href}><span className={active ? 'primary' : ''}><Icon size={active ? 18 : 19}/></span><small>{zh ? cn : en}</small></a>; })}</nav>;
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
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [theme, setTheme] = useState(() => localStorage.getItem('kbu.theme') || 'dark');
  const [locale, setLocale] = useState(() => localStorage.getItem('kbu.locale') || 'zh');
  const [currency, setCurrency] = useState(() => localStorage.getItem('kbu.currency') || 'usd');
  const [trendMetric, setTrendMetric] = useState('tokens');
  const [heatMetric, setHeatMetric] = useState('tokens');
  const [dialog, setDialog] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [limitData, setLimitData] = useState(null);
  const [limitSettings, setLimitSettings] = useState(null);
  const [limitLoading, setLimitLoading] = useState(true);
  const [limitSaving, setLimitSaving] = useState(false);
  const [limitError, setLimitError] = useState('');
  const [activeSection, setActiveSection] = useState(() => typeof window === 'undefined' ? 'top' : sectionFromHash(window.location.hash));
  const initialAnchorHandled = useRef(false);
  const navigationTarget = useRef(null);
  const navigationSettleTimer = useRef(0);
  const scheduleScrollSpy = useRef(null);
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

  const loadLimits = async (refresh = false) => {
    setLimitLoading(true); setLimitError('');
    try {
      const response = await fetch(`/api/limits${refresh ? '?refresh=1' : ''}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(`Limit request failed (${response.status})`);
      const next = await response.json(); setLimitData(next); return next;
    } catch (reason) { setLimitError(reason?.message || String(reason)); }
    finally { setLimitLoading(false); }
  };

  const loadLimitSettings = async () => {
    const response = await fetch('/api/limits/settings', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error(`Limit settings request failed (${response.status})`);
    const next = await response.json(); setLimitSettings(next); return next;
  };

  const saveLimitPreferences = async (payload) => {
    setLimitSaving(true);
    try {
      const response = await fetch('/api/limits/settings', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await response.text() || `Settings save failed (${response.status})`);
      setLimitSettings(await response.json());
      return await loadLimits(true);
    } finally { setLimitSaving(false); }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    Promise.all([loadLimitSettings(), loadLimits()]).catch((reason) => {
      setLimitError(reason?.message || String(reason)); setLimitLoading(false);
    });
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('kbu.theme', theme); }, [theme]);
  useEffect(() => { document.documentElement.lang = zh ? 'zh-CN' : 'en'; localStorage.setItem('kbu.locale', locale); }, [locale, zh]);
  useEffect(() => { localStorage.setItem('kbu.currency', currency); }, [currency]);
  useEffect(() => {
    if (!data) return undefined;
    let frame = 0;
    const updateActiveSection = () => {
      frame = 0;
      const lockedTarget = navigationTarget.current;
      if (lockedTarget) {
        setActiveSection((current) => current === lockedTarget ? current : lockedTarget);
        return;
      }
      const marker = window.scrollY + 88;
      let next = 'top';
      for (const id of LOCAL_SECTION_IDS) {
        const section = document.getElementById(id);
        if (section && section.getBoundingClientRect().top + window.scrollY <= marker) next = id;
      }
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) next = LOCAL_SECTION_IDS.at(-1);
      setActiveSection((current) => current === next ? current : next);
    };
    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateActiveSection);
    };
    const releaseNavigationLock = () => {
      navigationTarget.current = null;
      navigationSettleTimer.current = 0;
      scheduleUpdate();
    };
    const scheduleNavigationRelease = () => {
      if (navigationSettleTimer.current) window.clearTimeout(navigationSettleTimer.current);
      navigationSettleTimer.current = window.setTimeout(releaseNavigationLock, 140);
    };
    const handleScroll = () => {
      if (navigationTarget.current) scheduleNavigationRelease();
      scheduleUpdate();
    };
    scheduleScrollSpy.current = scheduleUpdate;
    if (!initialAnchorHandled.current) {
      initialAnchorHandled.current = true;
      const initialId = sectionFromHash(window.location.hash);
      window.requestAnimationFrame(() => {
        document.getElementById(initialId)?.scrollIntoView({ behavior: 'instant', block: 'start' });
        setActiveSection(initialId);
        window.requestAnimationFrame(updateActiveSection);
      });
    } else {
      scheduleUpdate();
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('hashchange', scheduleUpdate);
    window.addEventListener('popstate', scheduleUpdate);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (navigationSettleTimer.current) window.clearTimeout(navigationSettleTimer.current);
      navigationTarget.current = null;
      navigationSettleTimer.current = 0;
      scheduleScrollSpy.current = null;
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('hashchange', scheduleUpdate);
      window.removeEventListener('popstate', scheduleUpdate);
    };
  }, [data]);

  const navigateSection = (event, href) => {
    event.preventDefault();
    const id = sectionFromHash(href);
    const section = document.getElementById(id);
    if (!section) return;
    if (window.location.hash !== href) window.history.pushState(null, '', href);
    navigationTarget.current = id;
    if (navigationSettleTimer.current) window.clearTimeout(navigationSettleTimer.current);
    navigationSettleTimer.current = window.setTimeout(() => {
      navigationTarget.current = null;
      navigationSettleTimer.current = 0;
      scheduleScrollSpy.current?.();
    }, 180);
    setActiveSection(id);
    section.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };

  const options = useMemo(() => data ? filterOptions(data) : null, [data]);
  const report = useMemo(() => data ? analyze(data, filters) : null, [data, filters]);

  if (!data && !error) return <Loading zh={zh}/>;
  if (!data && error) return <ErrorState zh={zh} error={error} retry={() => load()}/>;

  const previous = report.previous;
  const staleHours = Math.max(0, (Date.now() - Date.parse(data.generatedAt)) / 3_600_000);
  const terminal = `${data.device?.terminal?.name || 'Terminal'}${data.device?.terminal?.version ? ` v${String(data.device.terminal.version).replace(/^v/i, '')}` : ''}`;
  const os = `${data.device?.os?.name || 'OS'}${data.device?.os?.version ? ` ${data.device.os.version}` : ''}`;
  const device = `${terminal} · ${os}`;
  const inputSide = report.totals.inputTokens + report.totals.cacheWriteInputTokens;
  const dimensionFiltersActive = ['models', 'efforts'].some((key) => filters[key].length);
  const lastSeries = report.series.reduce((best, item) => item.totalTokens > (best?.totalTokens || 0) ? item : best, null);

  return <div className="app-shell" id="top">
    <header className="global-topbar"><div className="mobile-brand-wrap"><button className="mobile-menu-button" type="button" onClick={() => setDrawer(true)}><Menu size={20}/></button><a className="brand" href="#top"><img src="/brand/logo-tile.svg" alt=""/><span>kimi<span>.</span>builders</span><small>LOCAL</small></a></div><div className="global-actions"><span className="local-pill"><ShieldCheck size={12}/>{t.local}</span><button className="icon-btn" type="button" onClick={() => setDialog('limit-settings')} title={zh ? '额度设置' : 'Limit settings'}><Settings2 size={16}/></button><button className="icon-btn" type="button" onClick={() => setLocale(zh ? 'en' : 'zh')} title="Language">{zh ? '文' : 'En'}</button><button className="icon-btn" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Theme">{theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>}</button></div></header>
    <DesktopNav zh={zh} communityUrl={data.community.url} activeSection={activeSection} onNavigate={navigateSection} onSettings={() => setDialog('limit-settings')}/><MobileDrawer open={drawer} onClose={() => setDrawer(false)} zh={zh} communityUrl={data.community.url} theme={theme} setTheme={setTheme} setLocale={setLocale} activeSection={activeSection} onNavigate={navigateSection} onSettings={() => setDialog('limit-settings')}/><MobileNav zh={zh} activeSection={activeSection} onNavigate={navigateSection}/>
    <main className="page-content">
      <section className="page-heading"><div><h1><BarChart3 size={22}/>{t.title}</h1><p>{t.subtitle}</p><div className="privacy-line"><ShieldCheck size={13}/><span>{t.local}</span><i/><span>{t.lastSync} {new Date(data.generatedAt).toLocaleString(zh ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</span>{staleHours > 24 ? <b>{zh ? `超过 ${Math.floor(staleHours)} 小时未扫描` : `${Math.floor(staleHours)}h stale`}</b> : null}</div></div><div className="page-actions"><Button onClick={() => setDialog('method')}><Info size={14}/>{t.method}</Button><Button onClick={() => setDialog('export')}><Download size={14}/>{t.export}</Button><Button onClick={() => setDialog('share')}><Share2 size={14}/>{t.share}</Button><Button primary onClick={() => load(true)} disabled={refreshing}><RefreshCw className={refreshing ? 'spin' : ''} size={14}/>{t.refresh}</Button></div></section>

      <UsageFilterBar filters={filters} options={options} onChange={setFilters} currency={currency} onCurrency={setCurrency} zh={zh}/>

      {staleHours > 24 ? <section className="stale-banner"><Info size={19}/><div><b>{zh ? '这份看板可能已经过期' : 'This dashboard may be stale'}</b><p>{zh ? '点击重新扫描即可更新本机数据；页面不会自行读取日志。' : 'Rescan to refresh local logs; the page never reads them on its own.'}</p></div><code>kbu-usage dashboard</code></section> : null}

      <SubscriptionLimits data={limitData} settings={limitSettings} loading={limitLoading} error={limitError} onRefresh={loadLimits} onSettings={() => setDialog('limit-settings')} zh={zh}/>

      <section className="hero-grid">
        <HeroCard zh={zh} label={report.pricingCoverage < .9995 ? (zh ? '已定价部分' : 'Priced portion') : t.cost} value={currencyMoney(report.totals.costMicros, currency)} previousValue={currencyMoney(previous?.totals.costMicros || 0, currency)} deltaValue={delta(report.totals.costMicros, previous?.totals.costMicros)} onHelp={() => setDialog('method')}>{zh ? `vs 上一周期 · 覆盖 ${percent(report.pricingCoverage)} Token · ${compact(report.totals.unpricedTokens)} 未定价` : `vs prior · ${percent(report.pricingCoverage)} coverage · ${compact(report.totals.unpricedTokens)} unpriced`}</HeroCard>
        <HeroCard zh={zh} label={t.tokens} value={compact(report.totals.totalTokens)} previousValue={compact(previous?.totals.totalTokens || 0)} deltaValue={delta(report.totals.totalTokens, previous?.totals.totalTokens)} onHelp={() => setDialog('method')}>{zh ? `输入 ${compact(inputSide)} · 输出 ${compact(report.totals.outputTokens)} · 缓存读 ${compact(report.totals.cacheReadInputTokens)}` : `Input ${compact(inputSide)} · Output ${compact(report.totals.outputTokens)} · Cache ${compact(report.totals.cacheReadInputTokens)}`}</HeroCard>
        <HeroCard zh={zh} label={t.hit} value={report.cacheHitRate == null ? '—' : percent(report.cacheHitRate)} tone="hero-card--green">
          {report.cacheHitRate != null ? <MetricHint className="quality-hint" text={zh ? `缓存命中率 = 缓存读 ÷（输入 + 缓存写 + 缓存读）。当前 ${percent(report.cacheHitRate)}；85% 以上为“良好”，60%–85% 为“一般”，低于 60% 为“偏低”。命中率越高，通常意味着重复上下文的 API 等价成本越低。` : `Cache hit rate = cache read ÷ (input + cache write + cache read). Current: ${percent(report.cacheHitRate)}. Good is ≥85%, Fair is 60–85%, Low is <60%. A higher rate usually lowers API-equivalent cost for repeated context.`}><span className="quality"><i/>{report.cacheHitRate >= .85 ? t.good : report.cacheHitRate >= .6 ? (zh ? '一般' : 'Fair') : (zh ? '偏低' : 'Low')}</span></MetricHint> : null}
          {zh ? `缓存写 ${compact(report.totals.cacheWriteInputTokens)} · 命中率越高，费用越低` : `Cache write ${compact(report.totals.cacheWriteInputTokens)} · higher is cheaper`}
        </HeroCard>
      </section>

      <section className="stats-grid"><Stat zh={zh} label={t.peak} value={compact(report.peakTokens)} sub={lastSeries?.label}/><Stat zh={zh} label={t.active} value={duration(report.activeSeconds, zh)} previousValue={duration(previous?.activeSeconds || 0, zh)} change={delta(report.activeSeconds, previous?.activeSeconds)} onHelp={() => setDialog('method')}/><Stat zh={zh} label={t.engaged} value={duration(report.engagedSeconds, zh)} previousValue={duration(previous?.engagedSeconds || 0, zh)} change={delta(report.engagedSeconds, previous?.engagedSeconds)} sub={zh ? '单次空闲最多计 30 分钟' : 'idle gaps capped at 30m'}/><Stat zh={zh} label={t.sessions} value={integer(report.sessions.length)} previousValue={integer(previous?.sessions || 0)} change={delta(report.sessions.length, previous?.sessions)}/><Stat zh={zh} label={t.messages} value={compact(report.messageCount)} previousValue={compact(previous?.messageCount || 0)} change={delta(report.messageCount, previous?.messageCount)}/><Stat zh={zh} label={t.userMessages} value={compact(report.userMessageCount)} previousValue={compact(previous?.userMessageCount || 0)} change={delta(report.userMessageCount, previous?.userMessageCount)}/><Stat zh={zh} label={t.avg} value={`${report.avgRequestSeconds.toFixed(1)}s`} sub={zh ? '≈ 活跃时长 ÷ 请求数' : '≈ active time ÷ requests'}/><Stat zh={zh} label={t.requests} value={compact(report.totals.requestCount)}/><Stat zh={zh} label={t.lifetime} value={compact(report.lifetimeTotals.totalTokens)} sub={zh ? '全部本地历史 · 保留维度筛选' : 'all local history · filters apply'}/><Stat zh={zh} label={t.reasoning} value={compact(report.totals.reasoningOutputTokens)} sub={report.topReasoning || (zh ? '未记录强度' : 'Effort not recorded')}/></section>
      {dimensionFiltersActive ? <p className="metric-scope-note">{zh ? '会话与时长指标无法按模型或推理强度拆分，仍显示当前 Agent 范围。' : 'Sessions and time cannot be split by model or effort; the current Agent scope is shown.'}</p> : null}

      <DailyTrend report={report} zh={zh} metric={trendMetric} onMetric={setTrendMetric} currency={currency}/><WeeklyTrend report={report} zh={zh} metric={trendMetric} currency={currency}/><ActivityHeatmap report={report} zh={zh} metric={heatMetric} onMetric={setHeatMetric} currency={currency}/>
      <p className="section-eyebrow">{zh ? '分布 · 独立切换 TOKEN / 费用' : 'BREAKDOWN · SWITCH TOKENS / COST'}</p><section className="distribution-grid" id="distribution"><DistributionCard type="source" rows={report.sourceRows} zh={zh} currency={currency}/><DistributionCard type="model" rows={report.modelRows} zh={zh} currency={currency}/><DistributionCard type="project" rows={report.projectRows} zh={zh} currency={currency}/><DistributionCard type="device" rows={report.deviceRows} zh={zh} currency={currency}/></section>
      <RecordsSection report={report} zh={zh} currency={currency} device={device}/><UsageManagement data={data} zh={zh}/>

      <footer className="page-footer"><span>kimi.builders / usage · LOCAL</span><p>{zh ? '数据属于你。分析在本机，社区同步永远可选。' : 'Your data. Local analysis. Community sync is always optional.'}</p><a href={data.community.url} target="_blank" rel="noreferrer">{zh ? '社区版' : 'Community'}<ExternalLink size={12}/></a></footer>
    </main>
    <MethodDialog open={dialog === 'method'} onClose={() => setDialog(null)} zh={zh} data={data} report={report} currency={currency}/><ExportDialog open={dialog === 'export'} onClose={() => setDialog(null)} report={report} data={data} filters={filters} zh={zh}/><ShareDialog open={dialog === 'share'} onClose={() => setDialog(null)} data={data} filters={filters} initialRange={filters.range} zh={zh}/><LimitSettingsDialog open={dialog === 'limit-settings'} settings={limitSettings} saving={limitSaving} onSave={saveLimitPreferences} onClose={() => setDialog(null)} zh={zh}/>
  </div>;
}
