import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Activity, BarChart3, Cloud, CloudUpload, Command, Database, Download, ExternalLink, FileText,
  Circle, Gauge, Globe2, Home, Info, LayoutDashboard, Menu, Moon, RefreshCw, Settings2,
  Share2, ShieldCheck, Square, Sun, X,
} from 'lucide-react';
import { analyze, EMPTY_FILTERS, filterOptions } from './analytics.js';
import { ActivityHeatmap, DailyTrend, DistributionCard, WeeklyTrend } from './UsageCharts.jsx';
import { UsageAttributionSummary } from './UsageAttributionSummary.jsx';
import { Dialog, ExportDialog, MethodDialog, ShareDialog } from './UsageDialogs.jsx';
import { UsageFilterBar } from './UsageFilters.jsx';
import { UsageManagement } from './UsageManagement.jsx';
import { RecordsSection } from './UsageRecords.jsx';
import { LimitSettingsDialog } from './LimitSettingsDialog.jsx';
import { SubscriptionCenter, SubscriptionPulse } from './SubscriptionLimits.jsx';
import { SyncDialog } from './SyncDialog.jsx';
import { Onboarding } from './Onboarding.jsx';
import { analyzeBudget, analyzeMilestones, analyzeSpikes } from './usage-insights.js';
import { BudgetDialog, readBudget, storeBudget, UsageInsightAlerts, UsageInsightSummary } from './UsageInsights.jsx';
import { compactNumber, delta, DISPLAY_CURRENCIES, DISPLAY_FX_AS_OF, DISPLAY_FX_SOURCE, displayMoney, duration, integer, percent } from './format.js';
import { resolveCommunityStatus } from './device-authorization.js';
import { isBenefitSection, isStandaloneSection, sectionFromHash, titleForSection, USAGE_SECTION_IDS } from './navigation.js';
import { Button, PageState } from './ui.jsx';
import { normalizeVibe } from './visual-preferences.js';

const COPY = {
  zh: {
    title: '用量中心', subtitle: 'Kimi-first，多 Agent 兼容。这里只读取 Token、时间与计数，不读取对话内容、完整路径或供应商凭据。',
    method: '计算说明', export: '导出', share: '分享用量', refresh: '重新扫描', sync: '同步数据', local: '本机分析', lastSync: '最近扫描',
    cost: 'API 等价价值', tokens: '总 Token', hit: '缓存命中率', peak: '峰值 TOKEN', active: '活跃时长', engaged: '投入时长', sessions: '会话数',
    messages: '总消息数', userMessages: '用户消息', avg: '平均耗时', requests: '请求数', lifetime: '累计 TOKEN', reasoning: '推理', good: '良好',
  },
  en: {
    title: 'Usage Center', subtitle: 'Kimi-first, multi-agent ready. Only token, timing, and count metrics are read—never conversations, full paths, or provider credentials.',
    method: 'Calculation notes', export: 'Export', share: 'Share usage', refresh: 'Rescan', sync: 'Sync data', local: 'On-device', lastSync: 'Last scanned',
    cost: 'API-equivalent value', tokens: 'Total tokens', hit: 'Cache hit rate', peak: 'Peak tokens', active: 'Active time', engaged: 'Engaged time', sessions: 'Sessions',
    messages: 'Messages', userMessages: 'User messages', avg: 'Avg active', requests: 'Requests', lifetime: 'Lifetime tokens', reasoning: 'Reasoning', good: 'Good',
  },
};

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

function HeroCard({ label, value, deltaValue, previousValue, children, tone = '', onHelp, zh }) {
  return <article className={`hero-card ${tone}`}><div className="hero-label"><span>{label}</span>{onHelp ? <button type="button" onClick={onHelp} aria-label={zh ? `查看${label}计算说明` : `View ${label} calculation notes`}><Info size={12}/></button> : null}<Change value={deltaValue} label={label} current={value} previous={previousValue} zh={zh}/></div><strong>{value}</strong><p>{children}</p></article>;
}

function Stat({ label, value, change, previousValue, sub, onHelp, zh }) {
  return <article className="stat-cell"><span>{label}{onHelp ? <button type="button" onClick={onHelp} aria-label={zh ? `查看${label}计算说明` : `View ${label} calculation notes`}><Info size={10}/></button> : null}</span><strong>{value}</strong><Change value={change} label={label} current={value} previous={previousValue} zh={zh}/>{sub ? <small>{sub}</small> : null}</article>;
}

const LOCAL_LINKS = [
  ['#top', Home, '总览', 'Overview'], ['#trend', BarChart3, '趋势', 'Trends'], ['#activity', Activity, '活跃', 'Activity'],
  ['#distribution', LayoutDashboard, '分布', 'Distribution'], ['#records', FileText, '明细', 'Records'],
];
const BENEFIT_LINKS = [
  ['#subscriptions', Home, '总览', 'Overview'],
  ['#subscription-trend', BarChart3, '额度趋势', 'Quota trends'],
  ['#subscription-activity', Activity, '使用节奏', 'Usage rhythm'],
  ['#subscription-distribution', LayoutDashboard, '消耗构成', 'Consumption mix'],
  ['#subscription-records', FileText, '观测明细', 'Observation log'],
];
const DEVICE_LINK = ['#sources', Database, '本机', 'Device'];
function DesktopNav({ zh, communityUrl, activeSection, onNavigate, onSettings }) {
  const benefitCenter = isBenefitSection(activeSection);
  const usageCenter = !benefitCenter && activeSection !== 'sources';
  const links = benefitCenter ? BENEFIT_LINKS : LOCAL_LINKS;
  return <aside className="left-nav"><a className="community-cta primary-btn" href={communityUrl} target="_blank" rel="noreferrer"><Cloud size={14}/>{zh ? '打开社区看板' : 'Open community'}</a><div className="center-switch" role="navigation" aria-label={zh ? '分析中心' : 'Analytics centers'}><a href="#top" className={usageCenter ? 'active' : ''} aria-current={usageCenter ? 'page' : undefined} onClick={(event) => onNavigate(event, '#top')}><BarChart3 size={15}/><span>{zh ? '用量中心' : 'Usage Center'}</span></a><a href="#subscriptions" className={benefitCenter ? 'active' : ''} aria-current={benefitCenter ? 'page' : undefined} onClick={(event) => onNavigate(event, '#subscriptions')}><Gauge size={15}/><span>{zh ? '权益中心' : 'Benefit Center'}</span></a></div><nav className="center-sections" aria-label={benefitCenter ? (zh ? '权益中心页面' : 'Benefit Center pages') : (zh ? '用量中心页面' : 'Usage Center pages')}>{links.map(([href, Icon, cn, en]) => { const active = activeSection === href.slice(1); return <a className={active ? 'active' : ''} href={href} key={href} aria-current={active ? 'location' : undefined} onClick={(event) => onNavigate(event, href)}><Icon size={15}/>{zh ? cn : en}</a>; })}</nav><nav className="nav-bottom"><a className={activeSection === 'sources' ? 'active' : ''} href={DEVICE_LINK[0]} aria-current={activeSection === 'sources' ? 'location' : undefined} onClick={(event) => onNavigate(event, DEVICE_LINK[0])}><Database size={15}/>{zh ? '本机与数据源' : 'Device & sources'}</a><button type="button" onClick={onSettings}><Settings2 size={15}/>{zh ? '权益设置' : 'Benefit settings'}</button><a href="https://kimi.builders" target="_blank" rel="noreferrer"><Globe2 size={15}/>{zh ? '社区首页' : 'Community'}</a><a href="https://github.com/kimi-builders/usage" target="_blank" rel="noreferrer"><Command size={15}/>GitHub</a></nav></aside>;
}

function MobileDrawer({ open, onClose, zh, communityUrl, theme, setTheme, vibe, setVibe, setLocale, activeSection, onNavigate, onSettings, onSync }) {
  const drawerRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const focusables = () => [...(drawerRef.current?.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])') || [])];
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables(); const first = items[0]; const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.body.classList.add('drawer-open');
    document.addEventListener('keydown', onKeyDown);
    window.requestAnimationFrame(() => focusables()[0]?.focus());
    return () => {
      document.body.classList.remove('drawer-open');
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  const benefitCenter = isBenefitSection(activeSection);
  const usageCenter = !benefitCenter && activeSection !== 'sources';
  const links = benefitCenter ? BENEFIT_LINKS : LOCAL_LINKS;
  return <div className="mobile-drawer-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside ref={drawerRef} id="mobile-dashboard-drawer" className="mobile-drawer" role="dialog" aria-modal="true" aria-labelledby="mobile-drawer-title"><header><a className="brand" href="#top" onClick={(event) => { onNavigate(event, '#top'); onClose(); }}><img src="/brand/logo-tile.svg" alt=""/><span id="mobile-drawer-title">kimi.builders</span><small>LOCAL</small></a><button className="icon-btn" type="button" onClick={onClose} aria-label={zh ? '关闭导航菜单' : 'Close navigation menu'}><X size={19}/></button></header><div className="drawer-account"><ShieldCheck size={18}/><div><b>{zh ? '本机用量看板' : 'On-device usage dashboard'}</b><span>127.0.0.1 · {zh ? '同步范围由你控制' : 'you control sync scope'}</span></div></div><div className="drawer-center-switch" role="navigation" aria-label={zh ? '分析中心' : 'Analytics centers'}><button type="button" className={usageCenter ? 'active' : ''} aria-current={usageCenter ? 'page' : undefined} onClick={(event) => { onNavigate(event, '#top'); onClose(); }}><BarChart3 size={16}/>{zh ? '用量中心' : 'Usage Center'}</button><button type="button" className={benefitCenter ? 'active' : ''} aria-current={benefitCenter ? 'page' : undefined} onClick={(event) => { onNavigate(event, '#subscriptions'); onClose(); }}><Gauge size={16}/>{zh ? '权益中心' : 'Benefit Center'}</button></div><nav>{links.map(([href, Icon, cn, en]) => { const active = activeSection === href.slice(1); return <a className={active ? 'active' : ''} href={href} key={href} aria-current={active ? 'location' : undefined} onClick={(event) => { onNavigate(event, href); onClose(); }}><Icon size={17}/>{zh ? cn : en}</a>; })}</nav><div className="drawer-actions"><button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>} {zh ? '切换主题' : 'Switch theme'}</button><button type="button" onClick={() => setVibe(vibe === 'poster' ? 'soft' : 'poster')}>{vibe === 'poster' ? <Circle size={16}/> : <Square size={16}/>} {zh ? '切换气质' : 'Style'}</button><button type="button" onClick={() => setLocale(zh ? 'en' : 'zh')}><Globe2 size={16}/>{zh ? 'English' : '中文'}</button><a className="drawer-device-link" href={DEVICE_LINK[0]} onClick={(event) => { onNavigate(event, DEVICE_LINK[0]); onClose(); }}><Database size={16}/>{zh ? '本机与数据源' : 'Device & sources'}</a><button type="button" onClick={() => { onSettings(); onClose(); }}><Settings2 size={16}/>{zh ? '权益设置' : 'Benefit settings'}</button><button type="button" onClick={() => { onSync(); onClose(); }}><CloudUpload size={16}/>{zh ? '同步数据' : 'Sync data'}</button></div><a className="drawer-community" href={communityUrl} target="_blank" rel="noreferrer"><Cloud size={16}/>{zh ? '打开社区用量中心' : 'Open community usage'}<ExternalLink size={13}/></a></aside></div>;
}

function MobileNav({ zh, activeSection, onNavigate }) {
  const benefitCenter = isBenefitSection(activeSection);
  const links = benefitCenter ? BENEFIT_LINKS : [LOCAL_LINKS[0], LOCAL_LINKS[1], LOCAL_LINKS[2], LOCAL_LINKS[3], LOCAL_LINKS[4]];
  return <nav className="mobile-tabs">{links.map(([href, Icon, cn, en]) => { const active = activeSection === href.slice(1); return <a href={href} className={active ? 'active' : ''} aria-current={active ? 'location' : undefined} onClick={(event) => onNavigate(event, href)} key={href}><span className={active ? 'primary' : ''}><Icon size={active ? 18 : 19}/></span><small>{zh ? cn : en}</small></a>; })}</nav>;
}

function Loading({ zh }) {
  return <main className="state-page"><img src="/brand/logo-tile.svg" alt=""/><PageState kind="loading" title={zh ? '正在准备本机用量中心' : 'Preparing your local usage center'} body={zh ? '正在读取你选择的 Agent 数据源。' : 'Reading the agent data sources you selected.'}/></main>;
}

function ErrorState({ error, retry, zh }) {
  return <main className="state-page"><PageState kind="error" title={zh ? '本地扫描失败' : 'Local scan failed'} body={error} action={<Button variant="primary" onClick={retry}>{zh ? '重试' : 'Retry'}</Button>}/></main>;
}

export function App() {
  const [data, setData] = useState(null);
  const [control, setControl] = useState(null);
  const [onboardingActive, setOnboardingActive] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [theme, setTheme] = useState(() => localStorage.getItem('kbu.theme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  const [vibe, setVibe] = useState(() => normalizeVibe(localStorage.getItem('kbu.vibe')));
  useEffect(() => { document.documentElement.dataset.vibe = vibe; localStorage.setItem('kbu.vibe', vibe); }, [vibe]);
  const [locale, setLocale] = useState(() => localStorage.getItem('kbu.locale') || 'zh');
  const compactValue = (value) => compactNumber(value, locale);
  const [currency, setCurrency] = useState(() => localStorage.getItem('kbu.currency.v1') === 'cny' ? 'cny' : 'usd');
  useEffect(() => { localStorage.setItem('kbu.currency.v1', currency); }, [currency]);
  const changeCurrency = useCallback((value) => setCurrency(value === 'cny' ? 'cny' : 'usd'), []);
  const [trendMetric, setTrendMetric] = useState('tokens');
  const [heatMetric, setHeatMetric] = useState('tokens');
  const [dialog, setDialog] = useState(null);
  const [connectionNow, setConnectionNow] = useState(() => Date.now());
  const [budget, setBudget] = useState(readBudget);
  const [drawer, setDrawer] = useState(false);
  const [limitData, setLimitData] = useState(null);
  const [limitSettings, setLimitSettings] = useState(null);
  const [limitSettingsLoading, setLimitSettingsLoading] = useState(true);
  const [limitSettingsError, setLimitSettingsError] = useState('');
  const [limitLoading, setLimitLoading] = useState(true);
  const [limitSaving, setLimitSaving] = useState(false);
  const [limitError, setLimitError] = useState('');
  const [activeSection, setActiveSection] = useState(() => typeof window === 'undefined' ? 'top' : sectionFromHash(window.location.hash));
  const menuButtonRef = useRef(null);
  const initialAnchorHandled = useRef(false);
  const navigationTarget = useRef(null);
  const navigationSettleTimer = useRef(0);
  const scheduleScrollSpy = useRef(null);
  const zh = locale === 'zh';
  const t = COPY[locale];
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const closeDialog = useCallback(() => setDialog(null), []);
  const openLimitSettings = useCallback(() => setDialog('limit-settings'), []);
  const openSync = useCallback(() => setDialog('sync'), []);

  useEffect(() => {
    document.title = onboardingActive
      ? (zh ? '首次设置 — kimi.builders · Local' : 'First-time setup — kimi.builders · Local')
      : titleForSection(activeSection, locale);
  }, [activeSection, locale, onboardingActive, zh]);

  const load = async (refresh = false, { throwOnError = false } = {}) => {
    setRefreshing(refresh); setError('');
    try {
      const response = await fetch(`/api/snapshot${refresh ? '?refresh=1' : ''}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(`Snapshot request failed (${response.status})`);
      const next = await response.json(); setData(next); return next;
    } catch (reason) { setError(reason?.message || String(reason)); if (throwOnError) throw reason; return null; }
    finally { setRefreshing(false); }
  };

  const loadControl = useCallback(async () => {
    const response = await fetch('/api/control', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error(`Control request failed (${response.status})`);
    const next = await response.json(); setControl(next); return next;
  }, []);

  const controlAction = useCallback(async (payload) => {
    const response = await fetch('/api/control', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const next = await response.json();
    if (!response.ok) {
      const error = new Error(next?.error?.message || `Control action failed (${response.status})`);
      error.code = next?.error?.code;
      error.statusCode = response.status;
      throw error;
    }
    if (next.sources) setControl(next);
    return next;
  }, []);

  const syncAction = useCallback(async (action, intervalMinutes = 15) => {
    const response = await fetch('/api/sync', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, intervalMinutes }),
    });
    const next = await response.json();
    if (!response.ok) throw new Error(next?.error?.message || `Sync action failed (${response.status})`);
    return next;
  }, []);

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
    setLimitSettingsLoading(true); setLimitSettingsError('');
    try {
      const response = await fetch('/api/limits/settings', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(`Limit settings request failed (${response.status})`);
      const next = await response.json(); setLimitSettings(next); return next;
    } catch (reason) {
      setLimitSettingsError(reason?.message || String(reason));
      return null;
    } finally {
      setLimitSettingsLoading(false);
    }
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
      setLimitSettingsError('');
      return await loadLimits(true);
    } finally { setLimitSaving(false); }
  };

  const copilotDeviceAction = useCallback(async (action) => {
    const response = await fetch('/api/limits/copilot/device', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
    });
    const next = await response.json();
    if (!response.ok) throw new Error(next?.error?.message || `Copilot device authorization failed (${response.status})`);
    if (next.status === 'connected') {
      await Promise.all([loadLimitSettings(), loadLimits(true)]);
    }
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await loadControl();
        if (cancelled) return;
        setOnboardingActive(next.onboardingRequired);
        if (!next.onboardingRequired) {
          await load();
          await Promise.all([loadLimitSettings(), loadLimits()]);
        }
      } catch (reason) {
        if (!cancelled) setError(reason?.message || String(reason));
      }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('kbu.theme', theme); }, [theme]);
  useEffect(() => { document.documentElement.lang = zh ? 'zh-CN' : 'en'; localStorage.setItem('kbu.locale', locale); }, [locale, zh]);
  useEffect(() => {
    if (control?.community?.status !== 'pending') return undefined;
    const expiresAt = Date.parse(control.community.authorization?.expiresAt || '');
    if (!Number.isFinite(expiresAt)) return undefined;
    const timer = window.setTimeout(
      () => setConnectionNow(Date.now()),
      Math.max(0, expiresAt - Date.now()) + 50,
    );
    return () => window.clearTimeout(timer);
  }, [control?.community?.authorization?.expiresAt, control?.community?.status]);
  useEffect(() => {
    if (!data || onboardingActive) return undefined;
    let frame = 0;
    const updateActiveSection = () => {
      frame = 0;
      if (isStandaloneSection(sectionFromHash(window.location.hash))) {
        const standaloneSection = sectionFromHash(window.location.hash);
        setActiveSection((current) => current === standaloneSection ? current : standaloneSection);
        return;
      }
      const lockedTarget = navigationTarget.current;
      if (lockedTarget) {
        setActiveSection((current) => current === lockedTarget ? current : lockedTarget);
        return;
      }
      // The reading line follows the sections' scroll-margin-top, which is already
      // calibrated to clear the sticky topbar + filter bar; a fixed offset goes stale.
      const probe = document.getElementById('trend');
      const marginTop = probe ? Number.parseFloat(getComputedStyle(probe).scrollMarginTop) : Number.NaN;
      const marker = window.scrollY + (Number.isFinite(marginTop) ? marginTop + 8 : 88);
      let next = 'top';
      for (const id of USAGE_SECTION_IDS) {
        const section = document.getElementById(id);
        if (section && section.getBoundingClientRect().top + window.scrollY <= marker) next = id;
      }
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) next = USAGE_SECTION_IDS.at(-1);
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
    const handleLocationChange = () => {
      const id = sectionFromHash(window.location.hash);
      navigationTarget.current = id;
      setActiveSection(id);
      window.requestAnimationFrame(() => {
        if (isStandaloneSection(id) || isBenefitSection(id)) window.scrollTo({ top: 0, behavior: 'auto' });
        else document.getElementById(id)?.scrollIntoView({ behavior: 'auto', block: 'start' });
        navigationTarget.current = null;
        scheduleUpdate();
      });
    };
    scheduleScrollSpy.current = scheduleUpdate;
    if (!initialAnchorHandled.current) {
      initialAnchorHandled.current = true;
      const initialId = sectionFromHash(window.location.hash);
      window.requestAnimationFrame(() => {
        if (isStandaloneSection(initialId) || isBenefitSection(initialId)) window.scrollTo({ top: 0, behavior: 'auto' });
        else document.getElementById(initialId)?.scrollIntoView({ behavior: 'instant', block: 'start' });
        setActiveSection(initialId);
        window.requestAnimationFrame(updateActiveSection);
      });
    } else {
      scheduleUpdate();
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('hashchange', handleLocationChange);
    window.addEventListener('popstate', handleLocationChange);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (navigationSettleTimer.current) window.clearTimeout(navigationSettleTimer.current);
      navigationTarget.current = null;
      navigationSettleTimer.current = 0;
      scheduleScrollSpy.current = null;
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('hashchange', handleLocationChange);
      window.removeEventListener('popstate', handleLocationChange);
    };
  }, [data, onboardingActive]);

  const navigateSection = (event, href) => {
    event.preventDefault();
    const id = sectionFromHash(href);
    if (window.location.hash !== href) window.history.pushState(null, '', href);
    if (isStandaloneSection(id) || isBenefitSection(id)) {
      navigationTarget.current = null;
      setActiveSection(id);
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }
    const fromStandalonePage = isStandaloneSection(activeSection);
    navigationTarget.current = id;
    if (navigationSettleTimer.current) window.clearTimeout(navigationSettleTimer.current);
    navigationSettleTimer.current = window.setTimeout(() => {
      navigationTarget.current = null;
      navigationSettleTimer.current = 0;
      scheduleScrollSpy.current?.();
    }, 180);
    setActiveSection(id);
    const scrollToSection = () => document.getElementById(id)?.scrollIntoView({
      behavior: fromStandalonePage || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
    if (fromStandalonePage) window.requestAnimationFrame(scrollToSection);
    else scrollToSection();
  };

  const options = useMemo(() => data ? filterOptions(data) : null, [data]);
  const report = useMemo(() => data ? analyze(data, filters) : null, [data, filters]);
  const insightNow = useMemo(() => {
    const value = data?.generatedAt ? new Date(data.generatedAt) : new Date();
    return Number.isFinite(value.getTime()) ? value : new Date();
  }, [data]);
  const budgetInsight = useMemo(() => data ? analyzeBudget(data, budget, insightNow) : null, [data, budget, insightNow]);
  const spikeInsight = useMemo(() => data ? analyzeSpikes(data, insightNow) : null, [data, insightNow]);
  const milestoneInsight = useMemo(() => data ? analyzeMilestones(data, insightNow) : null, [data, insightNow]);
  const saveBudget = useCallback((value) => setBudget(storeBudget(value)), []);

  if (!control && !error) return <Loading zh={zh}/>;
  if (control && onboardingActive) return <Onboarding control={control} zh={zh} onLocale={() => setLocale(zh ? 'en' : 'zh')} onControlAction={controlAction} onScan={(refresh) => load(refresh, { throwOnError: true })} onSyncAction={syncAction} onFinish={async () => { const next = await loadControl(); await load(true, { throwOnError: true }); setOnboardingActive(false); await Promise.all([loadLimitSettings(), loadLimits()]); return next; }}/>;
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
  const displayCurrency = DISPLAY_CURRENCIES[currency] || DISPLAY_CURRENCIES.usd;
  const costLabel = report.pricingCoverage < .9995
    ? (zh ? `已定价 API 等价价值（${displayCurrency.label}）` : `Priced API-equivalent value (${displayCurrency.label})`)
    : `${t.cost} (${displayCurrency.label})`;
  const costBasis = currency === 'cny'
    ? (zh ? `标准 API 美元价格 · 1 USD = ¥${displayCurrency.rate} · ${DISPLAY_FX_SOURCE} · ${DISPLAY_FX_AS_OF}` : `Standard API USD prices · 1 USD = ¥${displayCurrency.rate} · ${DISPLAY_FX_SOURCE} · ${DISPLAY_FX_AS_OF}`)
    : (zh ? '标准 API 美元价格，不是账单' : 'Standard API USD pricing, not a bill');
  const subscriptionPage = isBenefitSection(activeSection);
  const sourcesPage = activeSection === 'sources';
  const subscriptionView = activeSection === 'subscriptions' ? 'overview' : activeSection.replace('subscription-', '');
  const communityStatus = resolveCommunityStatus(control?.community, connectionNow);
  const connectionLabel = {
    connected: zh ? '已连接' : 'Connected',
    pending: zh ? '等待批准' : 'Approval pending',
    expired: zh ? '验证码过期' : 'Code expired',
    access_denied: zh ? '连接已拒绝' : 'Connection denied',
    attention: zh ? '连接失效' : 'Reconnect',
    disconnected: zh ? '未连接' : 'Not connected',
  }[communityStatus] || (zh ? '连接状态' : 'Connection');

  return <div className="app-shell" id="top">
    <header className="global-topbar"><div className="mobile-brand-wrap"><button ref={menuButtonRef} className="mobile-menu-button" type="button" aria-label={zh ? '打开导航菜单' : 'Open navigation menu'} aria-expanded={drawer} aria-controls="mobile-dashboard-drawer" onClick={() => setDrawer(true)}><Menu size={20}/></button><a className="brand" href="#top" onClick={(event) => navigateSection(event, '#top')}><img src="/brand/logo-tile.svg" alt=""/><span>kimi<span>.</span>builders</span><small>LOCAL</small></a></div><div className="global-actions"><span className="local-pill"><ShieldCheck size={12}/>{t.local}</span><button className={`connection-pill ${communityStatus}`} type="button" onClick={openSync} aria-label={`${zh ? '社区连接状态' : 'Community connection status'}：${connectionLabel}`} title={zh ? '管理社区连接与同步' : 'Manage community connection and sync'}><Cloud size={13}/><span>{connectionLabel}</span></button><button className="icon-btn" type="button" onClick={openLimitSettings} aria-label={zh ? '权益设置' : 'Benefit settings'} title={zh ? '权益设置' : 'Benefit settings'}><Settings2 size={16}/></button><button className="icon-btn" type="button" onClick={() => setLocale(zh ? 'en' : 'zh')} aria-label={zh ? '切换为英文' : 'Switch to Chinese'} title="Language">{zh ? '文' : 'En'}</button><button className="icon-btn" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={zh ? '切换主题' : 'Switch theme'} title="Theme">{theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>}</button><button className="icon-btn" type="button" onClick={() => setVibe(vibe === 'poster' ? 'soft' : 'poster')} aria-label={zh ? '切换视觉气质' : 'Switch visual style'} title={zh ? '切换视觉气质(工程棱角/圆润经典)' : 'Switch visual style (sharp / classic)'}>{vibe === 'poster' ? <Circle size={16}/> : <Square size={16}/>}</button></div></header>
    <DesktopNav zh={zh} communityUrl={data.community.url} activeSection={activeSection} onNavigate={navigateSection} onSettings={openLimitSettings}/><MobileDrawer open={drawer} onClose={closeDrawer} zh={zh} communityUrl={data.community.url} theme={theme} setTheme={setTheme} vibe={vibe} setVibe={setVibe} setLocale={setLocale} activeSection={activeSection} onNavigate={navigateSection} onSettings={openLimitSettings} onSync={openSync}/><MobileNav zh={zh} activeSection={activeSection} onNavigate={navigateSection}/>
    <main className="page-content">
      {error ? <PageState className="snapshot-error-banner" compact kind="error" title={zh ? '重新扫描失败，仍显示上一次快照' : 'Rescan failed; showing the previous snapshot'} body={zh ? `${error}。当前页面保留 ${new Date(data.generatedAt).toLocaleString('zh-CN')} 生成的数据，重试成功前请按过期快照理解。` : `${error}. This page still shows data generated ${new Date(data.generatedAt).toLocaleString('en-US')}; treat it as stale until a retry succeeds.`} action={<Button variant="primary" onClick={() => load(true)} disabled={refreshing}><RefreshCw className={refreshing ? 'spin' : ''} size={14}/>{zh ? '重试扫描' : 'Retry scan'}</Button>}/>: null}
      {subscriptionPage ? <>
      <section className="page-heading subscription-page-heading"><div><h1><Gauge size={22}/>{zh ? '权益中心' : 'Benefit Center'}</h1><p>{zh ? '看清少数付费核心和多项免费/活动权益分别承载了多少工作；官方额度不可读时仍保留本机 Token 与价值分析。' : 'See how paid core subscriptions and free or promotional benefits each carry your workload. Local Token and value analysis remain available when official quota is hidden.'}</p><div className="privacy-line"><ShieldCheck size={13}/><span>{zh ? '凭据只留本机' : 'Credentials stay local'}</span><i/><span>{zh ? '不读取对话内容' : 'No conversation content'}</span></div></div><div className="page-actions"><Button onClick={(event) => navigateSection(event, '#top')}><BarChart3 size={14}/>{zh ? '用量中心' : 'Usage Center'}</Button><Button onClick={openLimitSettings}><Settings2 size={14}/>{zh ? '权益设置' : 'Benefit settings'}</Button><Button variant="primary" onClick={() => loadLimits(true)} disabled={limitLoading}><RefreshCw className={limitLoading ? 'spin' : ''} size={14}/>{zh ? '刷新额度' : 'Refresh quotas'}</Button></div></section>
      <SubscriptionCenter view={subscriptionView} onViewChange={(view) => navigateSection({ preventDefault() {} }, view === 'overview' ? '#subscriptions' : `#subscription-${view}`)} data={limitData} usageData={data} settings={limitSettings} loading={limitLoading} error={limitError} onRefresh={loadLimits} onSettings={openLimitSettings} onRefreshIntervalChange={limitSettings ? async (minutes) => { if (limitSettings.refreshMinutes === minutes) return; await saveLimitPreferences({ settings: { ...limitSettings, refreshMinutes: minutes }, secrets: {}, clearSecrets: [], accountSecrets: {}, clearAccountSecrets: [] }); } : undefined} zh={zh} currency={currency}/>
      </> : sourcesPage ? <>
      <section className="page-heading sources-page-heading"><div><h1><Database size={22}/>{zh ? '本机与数据源' : 'Device & data sources'}</h1><p>{zh ? '集中管理每个 Agent 的本机扫描与社区同步范围，并查看 Collector、终端、系统和解析健康度。' : 'Manage per-agent local scan and community sync scopes, then review Collector, terminal, OS, and parsing health.'}</p><div className="privacy-line"><ShieldCheck size={13}/><span>{zh ? '扫描范围由你选择' : 'You choose scan scope'}</span><i/><span>{zh ? '诊断信息已脱敏' : 'Diagnostics are redacted'}</span></div></div><div className="page-actions"><Button onClick={() => setDialog('method')}><Info size={14}/>{t.method}</Button><Button onClick={() => load(true)} disabled={refreshing}><RefreshCw className={refreshing ? 'spin' : ''} size={14}/>{t.refresh}</Button><Button variant="primary" onClick={() => setDialog('sync')}><CloudUpload size={14}/>{t.sync}</Button></div></section>
      <UsageManagement data={data} control={control} onControlAction={controlAction} onControlRefresh={loadControl} onRescan={() => load(true)} zh={zh}/>
      </> : <>
      <section className="page-heading"><div><h1><BarChart3 size={22}/>{t.title}</h1><p>{t.subtitle}</p><div className="privacy-line"><ShieldCheck size={13}/><span>{t.local}</span><i/><span>{t.lastSync} {new Date(data.generatedAt).toLocaleString(zh ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</span>{staleHours > 24 ? <b>{zh ? `超过 ${Math.floor(staleHours)} 小时未扫描` : `${Math.floor(staleHours)}h stale`}</b> : null}</div></div><div className="page-actions"><Button onClick={() => setDialog('method')}><Info size={14}/>{t.method}</Button><Button onClick={() => setDialog('export')}><Download size={14}/>{t.export}</Button><Button onClick={() => setDialog('share')}><Share2 size={14}/>{t.share}</Button><Button onClick={() => load(true)} disabled={refreshing}><RefreshCw className={refreshing ? 'spin' : ''} size={14}/>{t.refresh}</Button><Button variant="primary" onClick={() => setDialog('sync')}><CloudUpload size={14}/>{t.sync}</Button></div></section>

      <UsageFilterBar filters={filters} options={options} onChange={setFilters} currency={currency} onCurrency={changeCurrency} zh={zh}/>

      {staleHours > 24 ? <section className="stale-banner"><Info size={19}/><div><b>{zh ? '这份看板可能已经过期' : 'This dashboard may be stale'}</b><p>{zh ? '点击重新扫描即可更新本机数据；页面不会自行读取日志。' : 'Rescan to refresh local logs; the page never reads them on its own.'}</p></div><code>kbu-usage dashboard</code></section> : null}

      <UsageInsightAlerts budget={budgetInsight} spikes={spikeInsight} milestones={milestoneInsight} zh={zh} currency={currency} onEditBudget={() => setDialog('budget')}/>

      <section className="hero-grid">
        <HeroCard zh={zh} label={costLabel} value={displayMoney(report.totals.costMicros, currency)} previousValue={displayMoney(previous?.totals.costMicros || 0, currency)} deltaValue={delta(report.totals.costMicros, previous?.totals.costMicros)} onHelp={() => setDialog('method')}>{`${costBasis} · ${zh ? `覆盖 ${percent(report.pricingCoverage)} Token · ${compactValue(report.totals.unpricedTokens)} 未定价` : `${percent(report.pricingCoverage)} coverage · ${compactValue(report.totals.unpricedTokens)} unpriced`}`}</HeroCard>
        <HeroCard zh={zh} label={t.tokens} value={compactValue(report.totals.totalTokens)} previousValue={compactValue(previous?.totals.totalTokens || 0)} deltaValue={delta(report.totals.totalTokens, previous?.totals.totalTokens)} onHelp={() => setDialog('method')}>{zh ? `输入 ${compactValue(inputSide)} · 输出 ${compactValue(report.totals.outputTokens)} · 缓存读 ${compactValue(report.totals.cacheReadInputTokens)}` : `Input ${compactValue(inputSide)} · Output ${compactValue(report.totals.outputTokens)} · Cache ${compactValue(report.totals.cacheReadInputTokens)}`}</HeroCard>
        <HeroCard zh={zh} label={t.hit} value={report.cacheHitRate == null ? '—' : percent(report.cacheHitRate)} tone="hero-card--green">
          {report.cacheHitRate != null ? <MetricHint className="quality-hint" text={zh ? `缓存命中率 = 缓存读 ÷（输入 + 缓存写 + 缓存读）。当前 ${percent(report.cacheHitRate)}；85% 以上为“良好”，60%–85% 为“一般”，低于 60% 为“偏低”。命中率越高，通常意味着重复上下文的 API 等价成本越低。` : `Cache hit rate = cache read ÷ (input + cache write + cache read). Current: ${percent(report.cacheHitRate)}. Good is ≥85%, Fair is 60–85%, Low is <60%. A higher rate usually lowers API-equivalent cost for repeated context.`}><span className="quality"><i/>{report.cacheHitRate >= .85 ? t.good : report.cacheHitRate >= .6 ? (zh ? '一般' : 'Fair') : (zh ? '偏低' : 'Low')}</span></MetricHint> : null}
          {zh ? `缓存写 ${compactValue(report.totals.cacheWriteInputTokens)} · 命中率越高，费用越低` : `Cache write ${compactValue(report.totals.cacheWriteInputTokens)} · higher is cheaper`}
        </HeroCard>
      </section>

      <section className="stats-grid"><Stat zh={zh} label={t.peak} value={compactValue(report.peakTokens)} sub={lastSeries?.label}/><Stat zh={zh} label={t.active} value={duration(report.activeSeconds, zh)} previousValue={duration(previous?.activeSeconds || 0, zh)} change={delta(report.activeSeconds, previous?.activeSeconds)} onHelp={() => setDialog('method')}/><Stat zh={zh} label={t.engaged} value={duration(report.engagedSeconds, zh)} previousValue={duration(previous?.engagedSeconds || 0, zh)} change={delta(report.engagedSeconds, previous?.engagedSeconds)} sub={zh ? '单次空闲最多计 30 分钟' : 'idle gaps capped at 30m'}/><Stat zh={zh} label={t.sessions} value={integer(report.sessions.length)} previousValue={integer(previous?.sessions || 0)} change={delta(report.sessions.length, previous?.sessions)}/><Stat zh={zh} label={t.messages} value={compactValue(report.messageCount)} previousValue={compactValue(previous?.messageCount || 0)} change={delta(report.messageCount, previous?.messageCount)}/><Stat zh={zh} label={t.userMessages} value={compactValue(report.userMessageCount)} previousValue={compactValue(previous?.userMessageCount || 0)} change={delta(report.userMessageCount, previous?.userMessageCount)}/><Stat zh={zh} label={t.avg} value={`${report.avgRequestSeconds.toFixed(1)}s`} sub={zh ? '≈ 活跃时长 ÷ 请求数' : '≈ active time ÷ requests'}/><Stat zh={zh} label={t.requests} value={compactValue(report.totals.requestCount)}/><Stat zh={zh} label={t.lifetime} value={compactValue(report.lifetimeTotals.totalTokens)} sub={zh ? '全部本地历史 · 保留维度筛选' : 'all local history · filters apply'}/><Stat zh={zh} label={t.reasoning} value={compactValue(report.totals.reasoningOutputTokens)} sub={report.topReasoning || (zh ? '未记录强度' : 'Effort not recorded')}/></section>
      <UsageInsightSummary budget={budgetInsight} milestones={milestoneInsight} spikes={spikeInsight} zh={zh} currency={currency} onEditBudget={() => setDialog('budget')}/>
      <UsageAttributionSummary report={report} zh={zh} currency={currency}/>
      <SubscriptionPulse data={limitData} usageData={data} settings={limitSettings} loading={limitLoading} error={limitError} onRetry={() => loadLimits(true)} onOpen={(event) => navigateSection(event, '#subscriptions')} onSettings={openLimitSettings} zh={zh}/>
      {dimensionFiltersActive ? <p className="metric-scope-note">{zh ? '会话与时长指标无法按模型或推理强度拆分，仍显示当前 Agent 范围。' : 'Sessions and time cannot be split by model or effort; the current Agent scope is shown.'}</p> : null}

      <DailyTrend report={report} zh={zh} metric={trendMetric} onMetric={setTrendMetric} currency={currency}/><WeeklyTrend report={report} zh={zh} metric={trendMetric} currency={currency}/><ActivityHeatmap report={report} data={data} zh={zh} metric={heatMetric} onMetric={setHeatMetric} currency={currency}/>
      <p className="section-eyebrow">{zh ? '分布 · 独立切换 TOKEN / 费用' : 'BREAKDOWN · SWITCH TOKENS / COST'}</p><section className="distribution-grid" id="distribution"><DistributionCard type="source" rows={report.sourceRows} zh={zh} currency={currency}/><DistributionCard type="model" rows={report.modelRows} zh={zh} currency={currency}/><DistributionCard type="project" rows={report.projectRows} zh={zh} currency={currency}/><DistributionCard type="device" rows={report.deviceRows} zh={zh} currency={currency}/></section>
      <RecordsSection report={report} zh={zh} currency={currency} device={device}/>
      </>}

      <footer className="page-footer"><span>kimi.builders / usage · LOCAL</span><p>{zh ? '数据属于你。分析在本机，社区同步永远可选。' : 'Your data. Local analysis. Community sync is always optional.'}</p><a href={data.community.url} target="_blank" rel="noreferrer">{zh ? '社区版' : 'Community'}<ExternalLink size={12}/></a></footer>
    </main>
    <MethodDialog open={dialog === 'method'} onClose={closeDialog} zh={zh} data={data} report={report} currency={currency}/><ExportDialog open={dialog === 'export'} onClose={closeDialog} report={report} data={data} filters={filters} zh={zh}/><ShareDialog open={dialog === 'share'} onClose={closeDialog} data={data} filters={filters} initialRange={filters.range} zh={zh}/><BudgetDialog open={dialog === 'budget'} onClose={closeDialog} value={budget} onSave={saveBudget} zh={zh}/>{limitSettings ? <LimitSettingsDialog open={dialog === 'limit-settings'} settings={limitSettings} saving={limitSaving} onSave={saveLimitPreferences} onCopilotDeviceAction={copilotDeviceAction} onClose={closeDialog} zh={zh}/> : <Dialog open={dialog === 'limit-settings'} onClose={closeDialog} title={zh ? '账户权益与额度设置' : 'Account benefit and quota settings'} subtitle={zh ? '设置单独从本地服务读取；额度页面仍可独立工作。' : 'Settings load independently from the local service; quota views remain separate.'}><PageState kind={limitSettingsLoading ? 'loading' : 'error'} title={limitSettingsLoading ? (zh ? '正在读取权益设置' : 'Loading benefit settings') : (zh ? '权益设置读取失败' : 'Could not load benefit settings')} body={limitSettingsLoading ? (zh ? '正在读取本机配置，不会发起供应商请求。' : 'Reading local configuration without contacting providers.') : limitSettingsError || (zh ? '本地服务没有返回设置。' : 'The local service did not return settings.')} action={!limitSettingsLoading ? <Button variant="primary" onClick={loadLimitSettings}><RefreshCw size={14}/>{zh ? '重试读取' : 'Retry'}</Button> : null}/></Dialog>}<SyncDialog open={dialog === 'sync'} onClose={closeDialog} zh={zh} control={control} onControlAction={controlAction} onControlChange={loadControl}/>
  </div>;
}
