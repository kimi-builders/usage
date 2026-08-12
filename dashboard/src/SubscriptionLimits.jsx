import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, BarChart3, Check, ChevronDown, ChevronRight, CircleAlert, Code2,
  ExternalLink, GripVertical, Info, KeyRound, RefreshCw, Search, Settings2,
  ShieldCheck, Sparkles, Terminal, X,
} from 'lucide-react';
import { compact } from './format.js';
import { buildSubscriptionInsights } from './subscription-insights.js';
import { ToolGlyph } from './tool-glyphs.js';
import { moveEnabledProvider, reorderEnabledProviders } from './provider-order.js';

const PROVIDER_TONES = {
  codex: 'blue', 'kimi-code': 'amber', warp: 'violet', 'gemini-cli': 'violet',
  antigravity: 'green', 'jetbrains-ai': 'pink', 'claude-code': 'amber', cursor: 'blue',
  copilot: 'violet', opencode: 'amber', qoder: 'green', trae: 'blue', windsurf: 'blue',
};

function ProviderIcon({ id, size = 18 }) {
  if (id === 'warp') return <span className="limit-provider-icon limit-provider-icon--warp"><Terminal size={size}/></span>;
  if (id === 'jetbrains-ai') return <span className="limit-provider-icon limit-provider-icon--jetbrains"><Code2 size={size}/></span>;
  return <ToolGlyph id={id} size={size}/>;
}

function useNow(interval = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

function resetText(value, now, zh) {
  if (!value) return zh ? '未提供重置时间' : 'Reset time unavailable';
  const delta = Date.parse(value) - now;
  if (!Number.isFinite(delta) || delta <= 0) return zh ? '即将刷新' : 'Resetting soon';
  const minutes = Math.max(1, Math.ceil(delta / 60_000));
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const mins = minutes % 60;
  const parts = [];
  if (days) parts.push(`${days}${zh ? '天' : 'd'}`);
  if (hours) parts.push(`${hours}${zh ? '小时' : 'h'}`);
  if (!days && mins) parts.push(`${mins}${zh ? '分' : 'm'}`);
  return `${zh ? '重置于' : 'Resets in'} ${parts.join(' ')}`;
}

function relativeUpdated(value, now, zh) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000));
  if (!Number.isFinite(minutes) || minutes < 1) return zh ? '刚刚更新' : 'Updated now';
  if (minutes < 60) return zh ? `${minutes} 分钟前更新` : `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return zh ? `${hours} 小时前更新` : `Updated ${hours}h ago`;
}

function absoluteReset(value, zh) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Date(value).toLocaleString(zh ? 'zh-CN' : 'en-US', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function confidenceLabel(value, zh) {
  if (value === 'high') return zh ? '样本较完整' : 'Strong sample';
  if (value === 'medium') return zh ? '样本一般' : 'Moderate sample';
  return zh ? '样本较少' : 'Limited sample';
}

function estimateText(value, zh) {
  return value == null ? '—' : `${zh ? '约 ' : '~'}${compact(value)}`;
}

function subscriptionMoney(value, currency, suffix = '') {
  if (value == null) return '—';
  return `${currency === 'cny' ? '¥' : '$'}${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}${suffix}`;
}

function portfolioSpend(summary, zh) {
  const parts = [];
  if (summary.spendByCurrency.usd > 0) parts.push(subscriptionMoney(summary.spendByCurrency.usd, 'usd'));
  if (summary.spendByCurrency.cny > 0) parts.push(subscriptionMoney(summary.spendByCurrency.cny, 'cny'));
  return parts.length ? parts.join(' + ') : (zh ? '未填写' : 'Not set');
}

function usageSegments(percentUsed, tone, zh) {
  const used = Math.max(0, Math.min(100, percentUsed));
  return <div className="limit-progress">
    <div className="limit-progress-meta"><span>{zh ? '已消耗' : 'Used'} {used.toFixed(used % 1 ? 1 : 0)}%</span><small>{zh ? '每格 20%' : '20% per segment'}</small></div>
    <div className={`limit-segments tone-${tone}`} role="progressbar" aria-label={zh ? '额度消耗进度' : 'Quota usage'} aria-valuemin="0" aria-valuemax="100" aria-valuenow={used}>
      {Array.from({ length: 5 }, (_, index) => {
        const fill = Math.max(0, Math.min(100, (used - index * 20) * 5));
        return <i key={index}><span style={{ width: `${fill}%` }}/></i>;
      })}
    </div>
  </div>;
}

function WindowRow({ window, tone, now, zh }) {
  const remaining = Number(window.remainingPercent);
  const left = Number.isFinite(remaining) ? Math.max(0, Math.min(100, remaining)) : 0;
  const used = 100 - left;
  const detail = window.limit != null
    ? `${Number(window.value || 0).toLocaleString()} / ${Number(window.limit).toLocaleString()} ${window.unit || ''}`
    : window.detail;
  return <article className="limit-window">
    <header><div><b>{window.label}</b>{detail ? <span>{detail}</span> : null}</div><div><strong>{left.toFixed(left % 1 ? 1 : 0)}%</strong><small>{zh ? '剩余' : 'left'}</small></div></header>
    {usageSegments(used, tone, zh)}
    <footer><span>{resetText(window.resetsAt, now, zh)}</span>{window.windowSeconds ? <small>{Math.round(window.windowSeconds / 3_600)}h window</small> : null}</footer>
    <div className="limit-token-facts">
      <div><span>{zh ? '本窗口本机 TOKEN' : 'LOCAL TOKENS IN WINDOW'}</span><strong>{window.observedFrom ? compact(window.localTotals.totalTokens) : '—'}</strong></div>
      <div><span>{zh ? '推算窗口总容量' : 'EST. WINDOW CAPACITY'}</span><strong>{estimateText(window.estimatedCapacityTokens, zh)}</strong></div>
      <div><span>{zh ? '推算剩余 TOKEN' : 'EST. TOKENS LEFT'}</span><strong>{estimateText(window.estimatedRemainingTokens, zh)}</strong></div>
      <div><span>{zh ? '30 天等效容量' : '30-DAY EQUIVALENT'}</span><strong>{estimateText(window.monthlyEquivalentTokens, zh)}</strong></div>
    </div>
    <p className="limit-estimate-note"><Info size={11}/>{window.estimatedCapacityTokens != null
      ? (zh ? `${confidenceLabel(window.estimationConfidence, zh)} · 用官方消耗比例与本机同窗 Token 反推，不是官方 Token 上限。` : `${confidenceLabel(window.estimationConfidence, zh)} · inferred from official utilization and local tokens, not an official token cap.`)
      : (zh ? '当前比例、时间窗或本机样本不足，暂不推算 Token 容量。' : 'Quota ratio, time window, or local sample is insufficient for a token estimate.')}</p>
  </article>;
}

function ModelScenario({ provider, zh }) {
  const [modelId, setModelId] = useState(provider.modelRows[0]?.id || '');
  useEffect(() => {
    if (!provider.modelRows.some((model) => model.id === modelId)) setModelId(provider.modelRows[0]?.id || '');
  }, [modelId, provider.modelRows]);
  if (!provider.modelRows.length) return <section className="model-scenario model-scenario--empty"><div><b>{zh ? '单模型容量情景' : 'Single-model capacity scenario'}</b><p>{zh ? '还没有与该订阅对应的本机 Token 记录。同步或继续使用后即可分析。' : 'No matching local token history yet. Use or sync this agent to unlock estimates.'}</p></div></section>;
  const selectedModel = provider.modelRows.find((model) => model.id === modelId) || provider.modelRows[0];
  const scenarios = provider.windows.map((window) => ({
    window,
    value: window.modelScenarios.find((scenario) => scenario.id === selectedModel.id),
  })).filter((item) => item.value?.capacityTokens != null);
  const primary = provider.primaryWindow?.modelScenarios.find((scenario) => scenario.id === selectedModel.id);
  return <section className="model-scenario">
    <header><div><span>{zh ? '单模型容量情景' : 'SINGLE-MODEL CAPACITY'}</span><b>{zh ? `如果只使用 ${selectedModel.label}` : `If you only used ${selectedModel.label}`}</b></div><label><span className="visually-hidden">{zh ? '选择模型' : 'Choose model'}</span><select value={selectedModel.id} onChange={(event) => setModelId(event.target.value)}>{provider.modelRows.map((model) => <option value={model.id} key={model.id}>{model.label}</option>)}</select></label></header>
    <div className="model-scenario-grid">
      {scenarios.map(({ window, value }) => <article key={window.id}><span>{window.label}</span><strong>{estimateText(value.capacityTokens, zh)}</strong><small>{zh ? `剩余约 ${compact(value.remainingTokens)}` : `~${compact(value.remainingTokens)} left`}</small></article>)}
      <article><span>{zh ? '30 天等效' : '30-day equivalent'}</span><strong>{estimateText(primary?.monthlyEquivalentTokens, zh)}</strong><small>{zh ? '按最长可估算额度窗折算' : 'from longest estimable window'}</small></article>
    </div>
    <footer><span>{zh ? `本机累计 ${compact(selectedModel.totalTokens)} · 当前占该订阅 Token 的 ${(selectedModel.share * 100).toFixed(1)}%` : `${compact(selectedModel.totalTokens)} local lifetime · ${(selectedModel.share * 100).toFixed(1)}% of this subscription's tokens`}</span><small>{zh ? '按标准 API 等价成本换算；订阅方可能采用不同权重，仅用于计划与对比。' : 'Converted with standard API-equivalent cost; provider weights may differ. Use for planning and comparison only.'}</small></footer>
  </section>;
}

function ProviderCard({ provider, now, zh, onSettings }) {
  const tone = PROVIDER_TONES[provider.id] || 'blue';
  if (provider.status === 'error') return <article className="limit-card limit-card--error">
    <div className="limit-error-copy"><header><span>{zh ? '查询不可用' : 'Unavailable'}</span><small>{provider.label}</small></header><strong>{provider.error?.message || (zh ? '额度查询失败' : 'Quota request failed')}</strong><p>{zh ? `本地 Token 用量不受影响，已识别累计 ${compact(provider.lifetimeTotals.totalTokens)}。更新登录或设置后可单独重试订阅额度。` : `Local token analytics still work; ${compact(provider.lifetimeTotals.totalTokens)} lifetime tokens are linked. Update login or settings, then retry quotas.`}</p></div>
    <button type="button" className="ghost-btn" onClick={onSettings}>{zh ? '检查设置' : 'Check settings'}</button>
  </article>;
  return <article className={`limit-card tone-${tone}`}>
    <dl className="limit-provider-summary">
      <div><dt>{zh ? '账户' : 'Account'}</dt><dd>{provider.account || (zh ? '本机账户' : 'Local account')}</dd></div>
      {provider.plan ? <div><dt>{zh ? '方案' : 'Plan'}</dt><dd>{String(provider.plan).replaceAll('_', ' ')}</dd></div> : null}
      <div><dt>{zh ? '本机累计 TOKEN' : 'LOCAL LIFETIME TOKENS'}</dt><dd>{compact(provider.lifetimeTotals.totalTokens)}</dd></div>
      <div><dt>{zh ? '主要模型' : 'TOP MODEL'}</dt><dd>{provider.modelRows[0]?.label || '—'}</dd></div>
      <div><dt>{zh ? '月均订阅支出' : 'MONTHLY SUBSCRIPTION'}</dt><dd>{provider.subscription.monthlyPrice == null ? (zh ? '未填写' : 'Not set') : subscriptionMoney(provider.subscription.monthlyPrice, provider.subscription.currency, zh ? '/月' : '/mo')}</dd></div>
      <div><dt>{zh ? '近 30 天 API 等价价值' : '30D API EQUIVALENT'}</dt><dd>{subscriptionMoney(provider.recentTotals.costMicros / 1_000_000, 'usd')}</dd></div>
      <div><dt>{zh ? '更新' : 'Updated'}</dt><dd>{relativeUpdated(provider.updatedAt, now, zh)}</dd></div>
      <div><dt>{zh ? '来源' : 'Source'}</dt><dd>{provider.source || '—'}</dd></div>
    </dl>
    <div className="limit-window-list">{provider.windows?.map((window) => <WindowRow window={window} tone={tone} now={now} zh={zh} key={window.id}/>)}</div>
    <ModelScenario provider={provider} zh={zh}/>
    {provider.resetCredits?.availableCount > 0 ? <div className="reset-credit"><div><span><b>{zh ? '额度重置券' : 'Limit reset credits'}</b><small>{provider.resetCredits.nextExpiry ? resetText(provider.resetCredits.nextExpiry, now, zh) : (zh ? '无到期时间' : 'No expiry')}</small></span></div><strong>{provider.resetCredits.availableCount}</strong></div> : null}
    {provider.notice ? <p className="limit-notice">{provider.notice}</p> : null}
  </article>;
}

export function SubscriptionPulse({ data, usageData, settings, loading, onOpen, onSettings, zh }) {
  const insights = useMemo(() => buildSubscriptionInsights(usageData, data, { settings }), [usageData, data, settings]);
  if (!data?.enabled) return <section className="subscription-pulse subscription-pulse--empty">
    <div><BarChart3 size={17}/><span><b>{zh ? '订阅中心尚未启用' : 'Subscription Center is off'}</b><small>{zh ? '连接订阅后，可把官方额度与本机 Token 放在一起分析。' : 'Connect subscriptions to compare official quotas with local tokens.'}</small></span></div><button type="button" onClick={onSettings}>{zh ? '连接订阅' : 'Connect'}<ArrowRight size={13}/></button>
  </section>;
  return <section className="subscription-pulse">
    <div><BarChart3 size={17}/><span><b>{zh ? '订阅中心' : 'Subscription Center'}</b><small>{loading ? (zh ? '正在刷新额度…' : 'Refreshing quotas…') : (zh ? `${data.summary?.available || 0}/${data.summary?.configured || 0} 可用 · 已关联 ${compact(insights.summary.trackedTokens)} 本机 Token` : `${data.summary?.available || 0}/${data.summary?.configured || 0} available · ${compact(insights.summary.trackedTokens)} local tokens linked`)}</small></span></div><button type="button" onClick={onOpen}>{zh ? '查看额度与容量' : 'View quotas & capacity'}<ArrowRight size={13}/></button>
  </section>;
}

export function SubscriptionCenter({ data, usageData, settings, loading, error, onRefresh, onSettings, zh }) {
  const now = useNow();
  const insights = useMemo(() => buildSubscriptionInsights(usageData, data, { settings }), [usageData, data, settings]);
  const providers = insights.providers;
  const [selected, setSelected] = useState('');
  useEffect(() => {
    if (!providers.some((provider) => provider.id === selected)) setSelected(providers[0]?.id || '');
  }, [providers, selected]);
  const active = providers.find((provider) => provider.id === selected) || providers[0];
  if (loading && !data) return <section className="panel limits-panel limits-panel--loading" id="subscriptions"><div><h2>{zh ? '正在读取订阅中心' : 'Loading Subscription Center'}</h2><p>{zh ? '未启用供应商时不会发起外部网络请求。' : 'No external requests are made until a provider is enabled.'}</p></div></section>;
  if (!data?.enabled) return <section className="panel limits-panel limits-panel--empty" id="subscriptions">
    <div><h2>{zh ? '把花出去的钱、官方额度与本机 Token 放在一起看' : 'Compare spend, official quotas, and local tokens'}</h2><p>{zh ? '默认关闭且零联网。连接后显示额度窗口、Token 已用量、观测容量和单模型使用情景；凭据仍只留在本机。' : 'Off and network-free by default. Connect to see quota windows, local token use, observed capacity, and model-only scenarios.'}</p></div><button className="primary-btn" type="button" onClick={onSettings}><Settings2 size={15}/>{zh ? '连接订阅账户' : 'Connect subscriptions'}<ChevronRight size={14}/></button>
  </section>;
  return <section className="subscription-center" id="subscriptions">
    <section className="subscription-overview-grid">
      <article><span>{zh ? '已连接订阅' : 'CONNECTED'}</span><strong>{data.summary?.available || 0}<small> / {data.summary?.configured || 0}</small></strong><p>{data.summary?.needsAttention ? (zh ? `${data.summary.needsAttention} 个需要处理` : `${data.summary.needsAttention} need attention`) : (zh ? '当前连接正常' : 'Connections healthy')}</p></article>
      <article><span>{zh ? '月均实际订阅支出' : 'MONTHLY ACTUAL SPEND'}</span><strong>{portfolioSpend(insights.summary, zh)}</strong><p>{zh ? `${insights.summary.pricedSubscriptions}/${providers.length} 个订阅已填写价格` : `${insights.summary.pricedSubscriptions}/${providers.length} prices entered`}</p></article>
      <article><span>{zh ? '已关联本机 TOKEN' : 'LINKED LOCAL TOKENS'}</span><strong>{compact(insights.summary.trackedTokens)}</strong><p>{zh ? `${insights.summary.trackedProviders} 个订阅有本机用量` : `${insights.summary.trackedProviders} subscriptions have local usage`}</p></article>
      <article><span>{zh ? '可估算额度窗口' : 'ESTIMABLE WINDOWS'}</span><strong>{insights.summary.estimableWindows}</strong><p>{zh ? '同时具备比例、时窗和 Token 样本' : 'quota ratio + window + token sample'}</p></article>
      <article><span>{zh ? '最近重置' : 'NEXT RESET'}</span><strong>{data.summary?.nextResetAt ? resetText(data.summary.nextResetAt, now, zh).replace(zh ? '重置于 ' : 'Resets in ', '') : '—'}</strong><p>{absoluteReset(data.summary?.nextResetAt, zh)}</p></article>
    </section>
    <section className="panel limits-panel">
    <header className="panel-header limits-header"><div><h2>{zh ? '订阅额度与 Token 容量' : 'Subscription quotas & token capacity'}</h2><p>{zh ? '官方额度是事实；Token 容量是基于本机同窗数据的观测估算，不受用量中心筛选影响' : 'Official quotas are facts; token capacity is an observed local estimate and ignores Usage Center filters'}</p></div><div className="limits-actions"><span>{data.summary?.available || 0}/{data.summary?.configured || 0} {zh ? '可用' : 'available'}</span><button className="icon-btn" type="button" onClick={onSettings} aria-label={zh ? '订阅设置' : 'Subscription settings'}><Settings2 size={16}/></button><button className="icon-btn" type="button" onClick={() => onRefresh(true)} disabled={loading} aria-label={zh ? '刷新订阅额度' : 'Refresh subscription quotas'}><RefreshCw className={loading ? 'spin' : ''} size={16}/></button></div></header>
    {error ? <div className="limits-banner">{error}</div> : null}
    <nav className="provider-tabs" style={{ '--provider-count': Math.max(1, providers.length) }} role="tablist" aria-label={zh ? '额度供应商' : 'Quota providers'}>{providers.map((provider, index) => { const isActive = provider.id === active?.id; return <button type="button" role="tab" aria-selected={isActive} aria-controls="subscription-limit-panel" tabIndex={isActive ? 0 : -1} className={isActive ? 'active' : ''} data-tone={PROVIDER_TONES[provider.id]} onClick={() => setSelected(provider.id)} onKeyDown={(event) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? providers.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + providers.length) % providers.length; setSelected(providers[nextIndex].id); event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[nextIndex]?.focus(); }} key={provider.id}><ProviderIcon id={provider.id} size={16}/><span>{provider.label}</span>{provider.status === 'error' ? <small>{zh ? '需处理' : 'Issue'}</small> : null}</button>; })}</nav>
    <div className="limit-card-stage" id="subscription-limit-panel" role="tabpanel">{active ? <ProviderCard provider={active} now={now} zh={zh} onSettings={onSettings}/> : <div className="limit-card-empty">{zh ? '没有已启用的供应商' : 'No providers enabled'}</div>}</div>
    <footer className="limits-privacy"><ShieldCheck size={13}/><span>{zh ? '凭据只在本地服务进程使用；Token 估算只读取本机统计，不进入导出文件或社区同步。' : 'Credentials stay in the local server process; token estimates use local statistics only and never enter exports or community sync.'}</span>{settings?.refreshMinutes ? <small>{zh ? `额度缓存 ${settings.refreshMinutes} 分钟` : `${settings.refreshMinutes}m quota cache`}</small> : null}</footer>
    </section>
    <section className="subscription-method-note"><Info size={16}/><div><b>{zh ? '为什么是“推算容量”，不是“官方 Token 上限”？' : 'Why “estimated capacity” instead of an official token cap?'}</b><p>{zh ? 'ChatGPT Pro、Claude Max 等订阅通常只返回额度消耗百分比，并不公开一个固定 Token 上限。本工具把同一额度时间窗内的本机 Token 与官方消耗比例对应，反推当前工作方式下的大致容量；“只用某模型”再按版本化的标准 API 等价价格换算。账号在其他设备或网页端的用量、供应商内部权重和样本不足都会影响结果。' : 'Subscriptions such as ChatGPT Pro and Claude Max usually expose utilization, not a fixed token cap. We correlate local tokens in the same window with official utilization, then use versioned standard API-equivalent pricing for model-only scenarios. Other devices, web usage, provider weights, and limited samples can change the result.'}</p></div></section>
  </section>;
}

function Toggle({ checked, onChange, label, disabled = false }) {
  return <label className={`switch-control${disabled ? ' disabled' : ''}`}><input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)}/><span/><em>{label}</em></label>;
}

function secretLabel(provider, zh) {
  return provider.secretKind || (zh ? '登录凭据' : 'Credential');
}

function detectionClass(state) {
  if (state === 'detected' || state === 'configured') return 'ready';
  if (state === 'expired') return 'warning';
  if (state === 'unavailable') return 'muted';
  return 'neutral';
}

function authLabel(mode, zh) {
  if (mode === 'local') return zh ? '自动读取本机登录' : 'Detect local login';
  if (mode === 'environment') return zh ? '环境变量' : 'Environment variable';
  return zh ? '安全保存到钥匙串' : 'Save to Keychain';
}

function SetupSteps({ provider, zh }) {
  if (!['opencode', 'qoder', 'cursor'].includes(provider.id)) return null;
  return <div className="provider-setup-steps"><b>{zh ? '不会配？照着 3 步做' : 'Three-step setup'}</b><ol>
    <li>{zh ? <><a href={provider.dashboardUrl} target="_blank" rel="noreferrer">打开并登录 {provider.label}<ExternalLink size={11}/></a></> : <>Open and sign in to {provider.label}</>}</li>
    <li>{zh ? '打开浏览器开发者工具 → 网络（Network），刷新用量页并点开任意同域请求。' : 'Open DevTools → Network, refresh the usage page, and select a same-domain request.'}</li>
    <li>{zh ? '复制“请求标头”里的 Cookie 整行，或直接复制该请求的 cURL；两种格式都可粘贴。' : 'Copy the Cookie request header or the request as cURL; either format works.'}</li>
  </ol></div>;
}

export function LimitSettingsDialog({ open, settings, onClose, onSave, saving, zh }) {
  const dialogRef = useRef(null);
  const [draft, setDraft] = useState(settings);
  const [secrets, setSecrets] = useState({});
  const [clearSecrets, setClearSecrets] = useState([]);
  const [message, setMessage] = useState('');
  const [validationErrors, setValidationErrors] = useState([]);
  const [view, setView] = useState('detected');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState('');
  const [draggingId, setDraggingId] = useState('');
  const [dragOverId, setDragOverId] = useState('');
  useEffect(() => { if (open) { setDraft(settings); setSecrets({}); setClearSecrets([]); setMessage(''); setValidationErrors([]); setView('detected'); setQuery(''); setExpanded(''); setDraggingId(''); setDragOverId(''); } }, [open, settings]);
  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const focusable = () => [...(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') || [])];
    const key = (event) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key); document.body.classList.add('dialog-open');
    return () => {
      document.removeEventListener('keydown', key);
      document.body.classList.remove('dialog-open'); previousFocus?.focus?.();
    };
  }, [open, onClose]);
  if (!open || !draft) return null;
  const updateProvider = (id, patch) => setDraft((current) => ({
    ...current, providers: { ...current.providers, [id]: { ...current.providers[id], ...patch } },
  }));
  const submit = async () => {
    setMessage('');
    setValidationErrors([]);
    try {
      const result = await onSave({ settings: draft, secrets, clearSecrets });
      const failures = result?.providers?.filter((provider) => provider.status === 'error') || [];
      setValidationErrors(failures);
      if (failures.length) {
        setMessage(zh
          ? `设置已保存，但 ${failures.map((provider) => provider.label).join('、')} 仍需处理。请按下方提示修正后重试。`
          : `Saved, but ${failures.map((provider) => provider.label).join(', ')} still need attention.`);
        setExpanded(failures[0].id);
      } else onClose();
    }
    catch (reason) { setMessage(reason?.message || String(reason)); }
  };
  const ready = draft.catalog.filter((provider) => ['detected', 'configured'].includes(provider.detection?.state));
  const enabledCount = Object.values(draft.providers).filter((provider) => provider.enabled).length;
  const visible = draft.catalog.filter((provider) => {
    const matches = !query || `${provider.label} ${provider.description}`.toLowerCase().includes(query.toLowerCase());
    if (!matches) return false;
    if (view === 'detected') return ['detected', 'configured'].includes(provider.detection?.state) || draft.providers[provider.id]?.enabled;
    return true;
  });
  const catalogById = new Map(draft.catalog.map((provider) => [provider.id, provider]));
  const orderedEnabled = draft.providerOrder
    .map((id) => catalogById.get(id))
    .filter((provider) => provider && draft.providers[provider.id]?.enabled);
  const reorderProvider = (activeId, overId) => setDraft((current) => reorderEnabledProviders(current, activeId, overId));
  const finishDrag = () => { setDraggingId(''); setDragOverId(''); };
  const enableDetected = () => setDraft((current) => ({
    ...current, enabled: true,
    providers: Object.fromEntries(Object.entries(current.providers).map(([id, item]) => [id, {
      ...item, enabled: item.enabled || ready.some((provider) => provider.id === id),
    }])),
  }));
  return <div className="dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section ref={dialogRef} className="dialog dialog--limit-settings" role="dialog" aria-modal="true" aria-label={zh ? '订阅额度设置' : 'Subscription limit settings'}><header><div><h2>{zh ? '连接订阅账户' : 'Connect subscriptions'}</h2><p>{zh ? '先自动检测，再按需手动连接。不会读取对话内容，也不会把凭据交给浏览器。' : 'Local detection first, manual connection only when needed. No conversation content is read.'}</p></div><button autoFocus className="icon-btn" type="button" onClick={onClose} aria-label={zh ? '关闭额度设置' : 'Close limit settings'}><X size={18}/></button></header>
    <div className="limit-settings-body"><section className="limit-setup-summary"><div className="limit-setup-score"><Sparkles size={18}/><div><b>{zh ? `自动检测到 ${ready.length} 个账户` : `${ready.length} accounts detected`}</b><span>{zh ? '无需复制 Token，推荐直接启用已检测账户。' : 'No token copying needed for detected accounts.'}</span></div></div><button type="button" onClick={enableDetected} disabled={!ready.length}><Check size={14}/>{zh ? '一键启用已检测' : 'Enable detected'}</button><div className="limit-master-inline"><span>{zh ? `${enabledCount} 个已选择` : `${enabledCount} selected`}</span><Toggle checked={draft.enabled} onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))} label={draft.enabled ? (zh ? '总开关已开启' : 'Master on') : (zh ? '总开关已关闭' : 'Master off')}/></div></section>
      <section className="limit-provider-toolbar"><div role="tablist">{[['detected', zh ? '已检测' : 'Detected'], ['all', zh ? '全部平台' : 'All platforms']].map(([id, label]) => <button type="button" role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)} key={id}>{label}</button>)}</div><label><Search size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '搜索平台' : 'Search providers'}/></label></section>
      <div className="limit-provider-settings">{visible.map((provider) => { const item = draft.providers[provider.id]; const unavailable = provider.quotaSupport === 'unavailable'; const isExpanded = expanded === provider.id; const setEnabled = (enabled) => { const patch = { enabled }; if (enabled && provider.quotaSupport === 'manual' && provider.supportsKeychain) patch.authMode = 'keychain'; updateProvider(provider.id, patch); if (enabled) { setDraft((current) => ({ ...current, enabled: true })); setExpanded(provider.id); } }; return <article className={`${item.enabled ? 'enabled' : ''} ${isExpanded ? 'expanded' : ''} ${unavailable ? 'unavailable' : ''}`} key={provider.id}><div className="provider-setting-head"><ProviderIcon id={provider.id}/><button type="button" className="provider-setting-copy" onClick={() => !unavailable && setExpanded(isExpanded ? '' : provider.id)}><span><b>{provider.label}{provider.popular ? <em>{zh ? '热门' : 'Popular'}</em> : null}</b><small>{provider.description}</small></span><ChevronDown className={isExpanded ? 'expanded' : ''} size={15}/></button><Toggle checked={item.enabled} onChange={setEnabled} label={zh ? `启用 ${provider.label}` : `Enable ${provider.label}`} disabled={unavailable}/></div><div className={`provider-detection ${detectionClass(provider.detection?.state)}`}>{['detected', 'configured'].includes(provider.detection?.state) ? <Check size={12}/> : <CircleAlert size={12}/>}<span>{provider.detection?.label}</span>{provider.detection?.detail ? <small>{provider.detection.detail}</small> : null}</div>{unavailable ? <div className="provider-unavailable-copy"><p>{provider.localHint}</p>{provider.dashboardUrl ? <a href={provider.dashboardUrl} target="_blank" rel="noreferrer">{zh ? '打开官方页面' : 'Open official site'}<ExternalLink size={11}/></a> : null}</div> : null}{isExpanded && !unavailable ? <div className="provider-config-panel"><p>{provider.localHint}</p>{provider.authModes.length > 1 ? <div className="provider-auth-modes" role="radiogroup" aria-label={zh ? '凭据来源' : 'Credential source'}>{provider.authModes.map((mode) => <button type="button" role="radio" aria-checked={item.authMode === mode} className={item.authMode === mode ? 'active' : ''} onClick={() => updateProvider(provider.id, { authMode: mode })} disabled={mode === 'keychain' && !provider.supportsKeychain} key={mode}>{item.authMode === mode ? <Check size={11}/> : null}{authLabel(mode, zh)}</button>)}</div> : null}<SetupSteps provider={provider} zh={zh}/><div className="provider-auth-fields">{item.authMode === 'environment' ? <label><span>{zh ? '环境变量名（凭据内容不要填在这里）' : 'Environment variable name—not the secret itself'}</span><input value={item.environmentVariable} onChange={(event) => updateProvider(provider.id, { environmentVariable: event.target.value })} placeholder={provider.defaultEnvironmentVariable || 'TOKEN'}/><small>{zh ? `在启动看板前设置 ${item.environmentVariable || provider.defaultEnvironmentVariable}，保存后会自动验证。` : 'Set this variable before starting the dashboard; saving will verify it.'}</small></label> : null}{item.authMode === 'keychain' ? <label><span>{secretLabel(provider, zh)}</span><input type="password" autoComplete="off" spellCheck="false" value={secrets[provider.id] || ''} onChange={(event) => setSecrets((current) => ({ ...current, [provider.id]: event.target.value }))} placeholder={provider.hasSecret ? (zh ? '已安全保存 · 留空保持不变' : 'Saved securely · leave blank to keep') : (zh ? '粘贴 Cookie、Token 或 cURL 片段' : 'Paste cookie, token, or cURL snippet')} disabled={!provider.supportsKeychain}/><small>{zh ? '只会提交给 127.0.0.1 本地服务，并保存到系统钥匙串。' : 'Sent only to the local 127.0.0.1 service and stored in Keychain.'}</small>{provider.hasSecret ? <button type="button" onClick={() => setClearSecrets((current) => current.includes(provider.id) ? current.filter((id) => id !== provider.id) : [...current, provider.id])}>{clearSecrets.includes(provider.id) ? (zh ? '撤销清除' : 'Keep secret') : (zh ? '清除已保存凭据' : 'Clear saved secret')}</button> : null}</label> : null}{provider.extraFields?.includes('workspaceId') ? <label><span>{zh ? 'Workspace ID 或账单页链接（可选）' : 'Workspace ID or billing URL (optional)'}</span><input value={item.workspaceId} onChange={(event) => updateProvider(provider.id, { workspaceId: event.target.value })} placeholder="https://opencode.ai/workspace/wrk_…/billing"/></label> : null}{provider.extraFields?.includes('site') ? <label><span>{zh ? 'Qoder 站点' : 'Qoder site'}</span><select value={item.site} onChange={(event) => updateProvider(provider.id, { site: event.target.value })}><option value="international">qoder.com · 国际站</option><option value="china">qoder.com.cn · 中国站</option></select></label> : null}{provider.extraFields?.includes('customPath') ? <label><span>{zh ? 'IDE 配置目录（通常留空）' : 'IDE config directory (usually blank)'}</span><input value={item.customPath} onChange={(event) => updateProvider(provider.id, { customPath: event.target.value })} placeholder="~/Library/Application Support/JetBrains/WebStorm2026.2"/></label> : null}</div>{provider.dashboardUrl ? <a className="provider-dashboard-link" href={provider.dashboardUrl} target="_blank" rel="noreferrer">{zh ? `打开 ${provider.label} 用量页` : `Open ${provider.label} usage`}<ExternalLink size={11}/></a> : null}</div> : null}</article>; })}</div>
      {orderedEnabled.length ? <section className="subscription-cost-settings">
        <header><div><b>{zh ? '实际订阅支出（可选）' : 'Actual subscription spend (optional)'}</b><span>{zh ? '只记录你实际支付的金额，用于月均支出与后续性价比分析；留空不会猜测价格。' : 'Enter only what you actually pay for monthly spend and later value analysis. Blank values are never guessed.'}</span></div></header>
        <div>{orderedEnabled.map((provider) => { const item = draft.providers[provider.id]; return <article key={provider.id}><span className="subscription-cost-provider"><ProviderIcon id={provider.id} size={15}/><b>{provider.label}</b></span><label><span>{zh ? '价格' : 'Price'}</span><input type="number" inputMode="decimal" min="0" max="1000000" step="0.01" value={item.subscriptionPrice ?? ''} onChange={(event) => updateProvider(provider.id, { subscriptionPrice: event.target.value === '' ? null : Number(event.target.value) })} placeholder="—"/></label><label><span>{zh ? '货币' : 'Currency'}</span><select value={item.subscriptionCurrency} onChange={(event) => updateProvider(provider.id, { subscriptionCurrency: event.target.value })}><option value="usd">USD · $</option><option value="cny">CNY · ¥</option></select></label><label><span>{zh ? '账期' : 'Cycle'}</span><select value={item.billingCycle} onChange={(event) => updateProvider(provider.id, { billingCycle: event.target.value })}><option value="monthly">{zh ? '每月' : 'Monthly'}</option><option value="yearly">{zh ? '每年' : 'Yearly'}</option></select></label><label><span>{zh ? '下次续费' : 'Renewal'}</span><input type="date" value={item.renewsAt || ''} onChange={(event) => updateProvider(provider.id, { renewsAt: event.target.value })}/></label></article>; })}</div>
      </section> : null}
      <section className="limit-provider-order">
        <header><div><b>{zh ? '额度显示顺序' : 'Quota display order'}</b><span>{zh ? '拖动右侧手柄即可排序；触屏也可拖动，结果保存在本机。' : 'Drag the handle to reorder. Touch is supported and the result stays on this device.'}</span></div><small>{zh ? `${orderedEnabled.length} 个已启用平台` : `${orderedEnabled.length} enabled`}</small></header>
        {orderedEnabled.length ? <ol onMouseMove={(event) => { if (!draggingId) return; const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-provider-order-id]')?.dataset.providerOrderId; if (!target || target === draggingId) return; setDragOverId(target); reorderProvider(draggingId, target); }} onMouseUp={finishDrag}>{orderedEnabled.map((provider, index) => <li key={provider.id} data-provider-order-id={provider.id} className={`${draggingId === provider.id ? 'dragging' : ''} ${dragOverId === provider.id && draggingId !== provider.id ? 'drag-over' : ''}`}>
          <span className="provider-order-index">{String(index + 1).padStart(2, '0')}</span>
          <span className="provider-order-label"><ProviderIcon id={provider.id} size={15}/><b>{provider.label}</b></span>
          <button type="button" className="provider-order-handle" onMouseDown={() => { setDraggingId(provider.id); setDragOverId(provider.id); }} onPointerDown={(event) => { if (event.button !== 0 && event.button !== -1) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDraggingId(provider.id); setDragOverId(provider.id); }} onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-provider-order-id]')?.dataset.providerOrderId; if (!target || target === provider.id) return; setDragOverId(target); reorderProvider(provider.id, target); }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); finishDrag(); }} onPointerCancel={finishDrag} onKeyDown={(event) => { const direction = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : 0; if (!direction) return; event.preventDefault(); setDraft((current) => moveEnabledProvider(current, provider.id, direction)); }} aria-label={zh ? `拖动调整 ${provider.label}；也可按方向键移动` : `Drag to reorder ${provider.label}; arrow keys also work`} title={zh ? '拖动排序' : 'Drag to reorder'}><GripVertical size={16}/></button>
        </li>)}</ol> : <p>{zh ? '启用至少一个平台后即可调整顺序。' : 'Enable a provider to arrange its position.'}</p>}
      </section>
      <section className="refresh-setting"><span>{zh ? '自动刷新间隔' : 'Refresh interval'}</span><div>{[5, 10, 15, 30].map((minutes) => <button type="button" className={draft.refreshMinutes === minutes ? 'active' : ''} onClick={() => setDraft((current) => ({ ...current, refreshMinutes: minutes }))} key={minutes}>{minutes}m</button>)}</div><small>{zh ? '手动刷新始终绕过缓存；只有已启用平台才联网。' : 'Manual refresh bypasses cache; only enabled providers access the network.'}</small></section>
      <div className="limit-security-note"><ShieldCheck size={17}/><div><b>{zh ? '敏感信息边界' : 'Sensitive-data boundary'}</b><p>{zh ? '浏览器只提交你主动输入的凭据一次；服务端把手动凭据交给 macOS 钥匙串，普通 config.json 只保存开关、来源和变量名。接口响应永远不包含 Token 或 Cookie，只显示不暴露主目录的来源提示。' : 'The browser submits manually entered secrets once. The local server stores them in macOS Keychain; config.json keeps only toggles, source modes, and variable names. Responses never contain tokens or cookies and show only home-redacted source hints.'}</p></div></div>{validationErrors.length ? <div className="provider-validation-errors" role="alert">{validationErrors.map((provider) => <div key={provider.id}><CircleAlert size={14}/><span><b>{provider.label}</b><small>{provider.error?.message || (zh ? '连接验证失败' : 'Connection validation failed')}</small></span><button type="button" onClick={() => { setView('all'); setExpanded(provider.id); }}>{zh ? '去修复' : 'Fix'}</button></div>)}</div> : null}{message ? <p className="dialog-error">{message}</p> : null}</div>
    <footer className="dialog-actions"><button type="button" className="ghost-btn" onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button type="button" className="primary-btn" onClick={submit} disabled={saving}>{saving ? <RefreshCw className="spin" size={14}/> : <KeyRound size={14}/>} {zh ? '保存并刷新' : 'Save & refresh'}</button></footer>
  </section></div>;
}
