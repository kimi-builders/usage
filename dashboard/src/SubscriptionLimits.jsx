import { useEffect, useRef, useState } from 'react';
import {
  Check, ChevronDown, ChevronRight, CircleAlert, Code2, ExternalLink, KeyRound,
  RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Terminal, X,
} from 'lucide-react';
import { ToolGlyph } from './tool-glyphs.js';

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
  </article>;
}

function ProviderCard({ provider, now, zh, onSettings }) {
  const tone = PROVIDER_TONES[provider.id] || 'blue';
  if (provider.status === 'error') return <article className="limit-card limit-card--error">
    <div className="limit-error-copy"><header><span>{zh ? '查询不可用' : 'Unavailable'}</span><small>{provider.label}</small></header><strong>{provider.error?.message || (zh ? '额度查询失败' : 'Quota request failed')}</strong><p>{zh ? '本地 Token 用量不受影响。更新登录或设置后可单独重试额度查询。' : 'Local token analytics still work. Update login or settings, then retry quotas.'}</p></div>
    <button type="button" className="ghost-btn" onClick={onSettings}>{zh ? '检查设置' : 'Check settings'}</button>
  </article>;
  return <article className={`limit-card tone-${tone}`}>
    <dl className="limit-provider-summary">
      <div><dt>{zh ? '账户' : 'Account'}</dt><dd>{provider.account || (zh ? '本机账户' : 'Local account')}</dd></div>
      {provider.plan ? <div><dt>{zh ? '方案' : 'Plan'}</dt><dd>{String(provider.plan).replaceAll('_', ' ')}</dd></div> : null}
      <div><dt>{zh ? '更新' : 'Updated'}</dt><dd>{relativeUpdated(provider.updatedAt, now, zh)}</dd></div>
      <div><dt>{zh ? '来源' : 'Source'}</dt><dd>{provider.source || '—'}</dd></div>
    </dl>
    <div className="limit-window-list">{provider.windows?.map((window) => <WindowRow window={window} tone={tone} now={now} zh={zh} key={window.id}/>)}</div>
    {provider.resetCredits?.availableCount > 0 ? <div className="reset-credit"><div><span><b>{zh ? '额度重置券' : 'Limit reset credits'}</b><small>{provider.resetCredits.nextExpiry ? resetText(provider.resetCredits.nextExpiry, now, zh) : (zh ? '无到期时间' : 'No expiry')}</small></span></div><strong>{provider.resetCredits.availableCount}</strong></div> : null}
    {provider.notice ? <p className="limit-notice">{provider.notice}</p> : null}
  </article>;
}

export function SubscriptionLimits({ data, settings, loading, error, onRefresh, onSettings, zh }) {
  const now = useNow();
  const providers = data?.providers || [];
  const [selected, setSelected] = useState('');
  useEffect(() => {
    if (!providers.some((provider) => provider.id === selected)) setSelected(providers[0]?.id || '');
  }, [providers, selected]);
  const active = providers.find((provider) => provider.id === selected) || providers[0];
  if (loading && !data) return <section className="panel limits-panel limits-panel--loading" id="limits"><div><h2>{zh ? '正在读取订阅额度' : 'Loading subscription limits'}</h2><p>{zh ? '未启用供应商时不会发起外部网络请求。' : 'No external requests are made until a provider is enabled.'}</p></div></section>;
  if (!data?.enabled) return <section className="panel limits-panel limits-panel--empty" id="limits">
    <div><h2>{zh ? '把订阅额度与 Token 用量放在一起看' : 'See subscription limits beside token usage'}</h2><p>{zh ? '默认关闭且零联网。启用后只在本机查询你选择的供应商，显示剩余额度、已用比例和重置倒计时。' : 'Off and network-free by default. Enable only providers you choose to see remaining quota, usage, and reset countdowns.'}</p></div><button className="primary-btn" type="button" onClick={onSettings}><Settings2 size={15}/>{zh ? '设置订阅额度' : 'Set up limits'}<ChevronRight size={14}/></button>
  </section>;
  return <section className="panel limits-panel" id="limits">
    <header className="panel-header limits-header"><div><h2>{zh ? '订阅额度' : 'Subscription limits'}</h2><p>{zh ? '账户限额窗口，不等同于下方的本地 Token 消耗或 API 账单' : 'Account quota windows—not local token usage or an API bill'}</p></div><div className="limits-actions"><span>{data.summary?.available || 0}/{data.summary?.configured || 0} {zh ? '可用' : 'available'}</span><button className="icon-btn" type="button" onClick={onSettings} aria-label={zh ? '额度设置' : 'Quota settings'}><Settings2 size={16}/></button><button className="icon-btn" type="button" onClick={() => onRefresh(true)} disabled={loading} aria-label={zh ? '刷新额度' : 'Refresh quotas'}><RefreshCw className={loading ? 'spin' : ''} size={16}/></button></div></header>
    {error ? <div className="limits-banner">{error}</div> : null}
    <nav className="provider-tabs" style={{ '--provider-count': Math.max(1, providers.length) }} role="tablist" aria-label={zh ? '额度供应商' : 'Quota providers'}>{providers.map((provider, index) => { const isActive = provider.id === active?.id; return <button type="button" role="tab" aria-selected={isActive} aria-controls="subscription-limit-panel" tabIndex={isActive ? 0 : -1} className={isActive ? 'active' : ''} data-tone={PROVIDER_TONES[provider.id]} onClick={() => setSelected(provider.id)} onKeyDown={(event) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? providers.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + providers.length) % providers.length; setSelected(providers[nextIndex].id); event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[nextIndex]?.focus(); }} key={provider.id}><ProviderIcon id={provider.id} size={16}/><span>{provider.label}</span>{provider.status === 'error' ? <small>{zh ? '需处理' : 'Issue'}</small> : null}</button>; })}</nav>
    <div className="limit-card-stage" id="subscription-limit-panel" role="tabpanel">{active ? <ProviderCard provider={active} now={now} zh={zh} onSettings={onSettings}/> : <div className="limit-card-empty">{zh ? '没有已启用的供应商' : 'No providers enabled'}</div>}</div>
    <footer className="limits-privacy"><ShieldCheck size={13}/><span>{zh ? '凭据只在本地服务进程使用，不进入浏览器、导出文件或社区同步。' : 'Credentials stay in the local server process and never enter the browser, exports, or community sync.'}</span>{settings?.refreshMinutes ? <small>{zh ? `缓存 ${settings.refreshMinutes} 分钟` : `${settings.refreshMinutes}m cache`}</small> : null}</footer>
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
  const [view, setView] = useState('recommended');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState('');
  useEffect(() => { if (open) { setDraft(settings); setSecrets({}); setClearSecrets([]); setMessage(''); setValidationErrors([]); setView('recommended'); setQuery(''); setExpanded(''); } }, [open, settings]);
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
    if (view === 'recommended') return provider.group === 'recommended';
    return true;
  });
  const enableDetected = () => setDraft((current) => ({
    ...current, enabled: true,
    providers: Object.fromEntries(Object.entries(current.providers).map(([id, item]) => [id, {
      ...item, enabled: item.enabled || ready.some((provider) => provider.id === id),
    }])),
  }));
  return <div className="dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section ref={dialogRef} className="dialog dialog--limit-settings" role="dialog" aria-modal="true" aria-label={zh ? '订阅额度设置' : 'Subscription limit settings'}><header><div><h2>{zh ? '连接订阅账户' : 'Connect subscriptions'}</h2><p>{zh ? '先自动检测，再按需手动连接。不会读取对话内容，也不会把凭据交给浏览器。' : 'Local detection first, manual connection only when needed. No conversation content is read.'}</p></div><button autoFocus className="icon-btn" type="button" onClick={onClose} aria-label={zh ? '关闭额度设置' : 'Close limit settings'}><X size={18}/></button></header>
    <div className="limit-settings-body"><section className="limit-setup-summary"><div className="limit-setup-score"><Sparkles size={18}/><div><b>{zh ? `自动检测到 ${ready.length} 个账户` : `${ready.length} accounts detected`}</b><span>{zh ? '无需复制 Token，推荐直接启用已检测账户。' : 'No token copying needed for detected accounts.'}</span></div></div><button type="button" onClick={enableDetected} disabled={!ready.length}><Check size={14}/>{zh ? '一键启用已检测' : 'Enable detected'}</button><div className="limit-master-inline"><span>{zh ? `${enabledCount} 个已选择` : `${enabledCount} selected`}</span><Toggle checked={draft.enabled} onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))} label={draft.enabled ? (zh ? '总开关已开启' : 'Master on') : (zh ? '总开关已关闭' : 'Master off')}/></div></section>
      <section className="limit-provider-toolbar"><div role="tablist">{[['recommended', zh ? '推荐' : 'Recommended'], ['detected', zh ? '已检测' : 'Detected'], ['all', zh ? '全部平台' : 'All platforms']].map(([id, label]) => <button type="button" role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)} key={id}>{label}</button>)}</div><label><Search size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '搜索平台' : 'Search providers'}/></label></section>
      <div className="limit-provider-settings">{visible.map((provider) => { const item = draft.providers[provider.id]; const unavailable = provider.quotaSupport === 'unavailable'; const isExpanded = expanded === provider.id; const setEnabled = (enabled) => { const patch = { enabled }; if (enabled && provider.quotaSupport === 'manual' && provider.supportsKeychain) patch.authMode = 'keychain'; updateProvider(provider.id, patch); if (enabled) { setDraft((current) => ({ ...current, enabled: true })); setExpanded(provider.id); } }; return <article className={`${item.enabled ? 'enabled' : ''} ${isExpanded ? 'expanded' : ''} ${unavailable ? 'unavailable' : ''}`} key={provider.id}><div className="provider-setting-head"><ProviderIcon id={provider.id}/><button type="button" className="provider-setting-copy" onClick={() => !unavailable && setExpanded(isExpanded ? '' : provider.id)}><span><b>{provider.label}{provider.popular ? <em>{zh ? '热门' : 'Popular'}</em> : null}</b><small>{provider.description}</small></span><ChevronDown className={isExpanded ? 'expanded' : ''} size={15}/></button><Toggle checked={item.enabled} onChange={setEnabled} label={zh ? `启用 ${provider.label}` : `Enable ${provider.label}`} disabled={unavailable}/></div><div className={`provider-detection ${detectionClass(provider.detection?.state)}`}>{['detected', 'configured'].includes(provider.detection?.state) ? <Check size={12}/> : <CircleAlert size={12}/>}<span>{provider.detection?.label}</span>{provider.detection?.detail ? <small>{provider.detection.detail}</small> : null}</div>{unavailable ? <div className="provider-unavailable-copy"><p>{provider.localHint}</p>{provider.dashboardUrl ? <a href={provider.dashboardUrl} target="_blank" rel="noreferrer">{zh ? '打开官方页面' : 'Open official site'}<ExternalLink size={11}/></a> : null}</div> : null}{isExpanded && !unavailable ? <div className="provider-config-panel"><p>{provider.localHint}</p>{provider.authModes.length > 1 ? <div className="provider-auth-modes" role="radiogroup" aria-label={zh ? '凭据来源' : 'Credential source'}>{provider.authModes.map((mode) => <button type="button" role="radio" aria-checked={item.authMode === mode} className={item.authMode === mode ? 'active' : ''} onClick={() => updateProvider(provider.id, { authMode: mode })} disabled={mode === 'keychain' && !provider.supportsKeychain} key={mode}>{item.authMode === mode ? <Check size={11}/> : null}{authLabel(mode, zh)}</button>)}</div> : null}<SetupSteps provider={provider} zh={zh}/><div className="provider-auth-fields">{item.authMode === 'environment' ? <label><span>{zh ? '环境变量名（凭据内容不要填在这里）' : 'Environment variable name—not the secret itself'}</span><input value={item.environmentVariable} onChange={(event) => updateProvider(provider.id, { environmentVariable: event.target.value })} placeholder={provider.defaultEnvironmentVariable || 'TOKEN'}/><small>{zh ? `在启动看板前设置 ${item.environmentVariable || provider.defaultEnvironmentVariable}，保存后会自动验证。` : 'Set this variable before starting the dashboard; saving will verify it.'}</small></label> : null}{item.authMode === 'keychain' ? <label><span>{secretLabel(provider, zh)}</span><input type="password" autoComplete="off" spellCheck="false" value={secrets[provider.id] || ''} onChange={(event) => setSecrets((current) => ({ ...current, [provider.id]: event.target.value }))} placeholder={provider.hasSecret ? (zh ? '已安全保存 · 留空保持不变' : 'Saved securely · leave blank to keep') : (zh ? '粘贴 Cookie、Token 或 cURL 片段' : 'Paste cookie, token, or cURL snippet')} disabled={!provider.supportsKeychain}/><small>{zh ? '只会提交给 127.0.0.1 本地服务，并保存到系统钥匙串。' : 'Sent only to the local 127.0.0.1 service and stored in Keychain.'}</small>{provider.hasSecret ? <button type="button" onClick={() => setClearSecrets((current) => current.includes(provider.id) ? current.filter((id) => id !== provider.id) : [...current, provider.id])}>{clearSecrets.includes(provider.id) ? (zh ? '撤销清除' : 'Keep secret') : (zh ? '清除已保存凭据' : 'Clear saved secret')}</button> : null}</label> : null}{provider.extraFields?.includes('workspaceId') ? <label><span>{zh ? 'Workspace ID 或账单页链接（可选）' : 'Workspace ID or billing URL (optional)'}</span><input value={item.workspaceId} onChange={(event) => updateProvider(provider.id, { workspaceId: event.target.value })} placeholder="https://opencode.ai/workspace/wrk_…/billing"/></label> : null}{provider.extraFields?.includes('site') ? <label><span>{zh ? 'Qoder 站点' : 'Qoder site'}</span><select value={item.site} onChange={(event) => updateProvider(provider.id, { site: event.target.value })}><option value="international">qoder.com · 国际站</option><option value="china">qoder.com.cn · 中国站</option></select></label> : null}{provider.extraFields?.includes('customPath') ? <label><span>{zh ? 'IDE 配置目录（通常留空）' : 'IDE config directory (usually blank)'}</span><input value={item.customPath} onChange={(event) => updateProvider(provider.id, { customPath: event.target.value })} placeholder="~/Library/Application Support/JetBrains/WebStorm2026.2"/></label> : null}</div>{provider.dashboardUrl ? <a className="provider-dashboard-link" href={provider.dashboardUrl} target="_blank" rel="noreferrer">{zh ? `打开 ${provider.label} 用量页` : `Open ${provider.label} usage`}<ExternalLink size={11}/></a> : null}</div> : null}</article>; })}</div>
      <section className="refresh-setting"><span>{zh ? '自动刷新间隔' : 'Refresh interval'}</span><div>{[5, 10, 15, 30].map((minutes) => <button type="button" className={draft.refreshMinutes === minutes ? 'active' : ''} onClick={() => setDraft((current) => ({ ...current, refreshMinutes: minutes }))} key={minutes}>{minutes}m</button>)}</div><small>{zh ? '手动刷新始终绕过缓存；只有已启用平台才联网。' : 'Manual refresh bypasses cache; only enabled providers access the network.'}</small></section>
      <div className="limit-security-note"><ShieldCheck size={17}/><div><b>{zh ? '敏感信息边界' : 'Sensitive-data boundary'}</b><p>{zh ? '浏览器只提交你主动输入的凭据一次；服务端把手动凭据交给 macOS 钥匙串，普通 config.json 只保存开关、来源和变量名。接口响应永远不包含 Token 或 Cookie，只显示不暴露主目录的来源提示。' : 'The browser submits manually entered secrets once. The local server stores them in macOS Keychain; config.json keeps only toggles, source modes, and variable names. Responses never contain tokens or cookies and show only home-redacted source hints.'}</p></div></div>{validationErrors.length ? <div className="provider-validation-errors" role="alert">{validationErrors.map((provider) => <div key={provider.id}><CircleAlert size={14}/><span><b>{provider.label}</b><small>{provider.error?.message || (zh ? '连接验证失败' : 'Connection validation failed')}</small></span><button type="button" onClick={() => { setView('all'); setExpanded(provider.id); }}>{zh ? '去修复' : 'Fix'}</button></div>)}</div> : null}{message ? <p className="dialog-error">{message}</p> : null}</div>
    <footer className="dialog-actions"><button type="button" className="ghost-btn" onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button type="button" className="primary-btn" onClick={submit} disabled={saving}>{saving ? <RefreshCw className="spin" size={14}/> : <KeyRound size={14}/>} {zh ? '保存并刷新' : 'Save & refresh'}</button></footer>
  </section></div>;
}
