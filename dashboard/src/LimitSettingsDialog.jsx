import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check, ChevronDown, CircleAlert, ExternalLink, GripVertical, KeyRound,
  RefreshCw, Search, ShieldCheck, Sparkles, X,
} from 'lucide-react';
import { ProviderIcon } from './SubscriptionLimits.jsx';
import { moveEnabledProvider, reorderEnabledProviders } from './provider-order.js';
import {
  ENTITLEMENT_TYPES, entitlementBadge, entitlementLabel, entitlementNote,
  hasEnteredSecrets, idSegment, isValidOpenCodeWorkspaceId, localizedCount,
} from './subscription-limits-utils.js';

/* 权益设置弹窗(20260816 自 SubscriptionLimits.jsx 拆出,只导出组件) */

const SETTINGS_PROVIDER_PANEL_ID = 'limit-provider-settings-panel';

function settingsProviderTabId(view) {
  return `limit-provider-settings-tab-${idSegment(view)}`;
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
  if (!provider || !['opencode', 'qoder', 'cursor'].includes(provider.id)) return null;
  if (provider.id === 'opencode') return <div className="provider-setup-steps"><b>{zh ? '不会配？照着 3 步做' : 'Three-step setup'}</b><ol>
    <li>{zh ? <><a href={provider.dashboardUrl} target="_blank" rel="noreferrer">打开并登录 {provider.label}<ExternalLink size={11}/></a>，进入对应账户的 Go 用量页。</> : <><a href={provider.dashboardUrl} target="_blank" rel="noreferrer">Open and sign in to {provider.label}<ExternalLink size={11}/></a>, then open that account&apos;s Go usage page.</>}</li>
    <li>{zh ? '从地址栏复制 wrk_… Workspace ID；它只属于当前这一条账户配置。' : 'Copy the wrk_… Workspace ID from the address bar; it belongs only to this account entry.'}</li>
    <li>{zh ? '打开开发者工具 → 网络（Network），刷新页面，复制任意 opencode.ai 请求的 Cookie 请求头或 cURL。' : 'Open DevTools → Network, refresh the page, then copy a Cookie header or cURL from an opencode.ai request.'}</li>
  </ol></div>;
  return <div className="provider-setup-steps"><b>{zh ? '不会配？照着 3 步做' : 'Three-step setup'}</b><ol>
    <li>{zh ? <><a href={provider.dashboardUrl} target="_blank" rel="noreferrer">打开并登录 {provider.label}<ExternalLink size={11}/></a></> : <>Open and sign in to {provider.label}</>}</li>
    <li>{zh ? '打开浏览器开发者工具 → 网络（Network），刷新用量页并点开任意同域请求。' : 'Open DevTools → Network, refresh the usage page, and select a same-domain request.'}</li>
    <li>{zh ? '复制“请求标头”里的 Cookie 整行，或直接复制该请求的 cURL；两种格式都可粘贴。' : 'Copy the Cookie request header or the request as cURL; either format works.'}</li>
  </ol></div>;
}

function accountIdentifier() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replaceAll('-', '');
  return `account_${Date.now().toString(36)}`;
}

function removeConnectedAccount(providerId, account, item, updateProvider, setClearAccountSecrets) {
  const accounts = item.accounts.filter((value) => value.id !== account.id);
  updateProvider(providerId, {
    accounts,
    enabled: providerId === 'opencode' && !accounts.length ? false : item.enabled,
    activeAccountId: item.activeAccountId === account.id ? accounts[0]?.id || '' : item.activeAccountId,
  });
  if (account.hasSecret) {
    const key = `${providerId}:${account.id}`;
    setClearAccountSecrets((current) => current.includes(key) ? current : [...current, key]);
  }
}

function CopilotConnectionPanel({
  item, updateProvider, setClearAccountSecrets, enableMaster,
  onCopilotDeviceAction, onCopilotConnected, zh,
}) {
  const [device, setDevice] = useState({ status: 'idle' });
  const [deviceBusy, setDeviceBusy] = useState(false);
  useEffect(() => {
    if (!onCopilotDeviceAction) return undefined;
    let cancelled = false;
    onCopilotDeviceAction('status').then((next) => { if (!cancelled) setDevice(next); }).catch(() => {});
    return () => { cancelled = true; };
  }, [onCopilotDeviceAction]);
  useEffect(() => {
    if (device.status !== 'pending' || !onCopilotDeviceAction) return undefined;
    const delay = Math.max(2, Number(device.intervalSeconds) || 5) * 1_000;
    const timer = window.setTimeout(async () => {
      try {
        const next = await onCopilotDeviceAction('poll');
        setDevice(next);
        if (next.status === 'connected') onCopilotConnected?.(next);
      } catch (reason) {
        setDevice({ status: 'error', message: reason?.message || String(reason) });
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [device, onCopilotConnected, onCopilotDeviceAction]);
  const connectCopilot = async () => {
    setDeviceBusy(true);
    try {
      const next = await onCopilotDeviceAction('start');
      setDevice(next);
      enableMaster();
      if (next.verificationUri) window.open(next.verificationUri, '_blank', 'noopener,noreferrer');
    } catch (reason) {
      setDevice({ status: 'error', message: reason?.message || String(reason) });
    } finally { setDeviceBusy(false); }
  };
  return <div className="account-provider-config">
    <div className="account-config-heading"><div><b>{zh ? 'GitHub 设备授权' : 'GitHub device authorization'}</b><span>{zh ? '浏览器确认后自动保存，可连接多个 GitHub 账户。' : 'Approve in the browser; multiple GitHub accounts are supported.'}</span></div><button className="provider-connect-button" type="button" onClick={connectCopilot} disabled={deviceBusy || device.status === 'pending'}>{deviceBusy ? <RefreshCw className="spin" size={13}/> : <ExternalLink size={13}/>} {zh ? '连接 GitHub 账户' : 'Connect GitHub account'}</button></div>
    {device.status === 'pending' ? <div className="copilot-device-state" role="status"><span>{zh ? '在 GitHub 页面输入验证码' : 'Enter this code on GitHub'}</span><strong>{device.userCode}</strong><a href={device.verificationUri} target="_blank" rel="noreferrer">{zh ? '打开授权页' : 'Open authorization'}<ExternalLink size={11}/></a><small>{zh ? '授权完成后这里会自动确认，不需要粘贴 Token。' : 'This page confirms automatically after approval; no token paste needed.'}</small></div> : null}
    {device.status === 'error' ? <p className="dialog-error" role="alert">{device.message}</p> : null}
    <div className="limit-account-list">{item.accounts.map((account) => <div key={account.id}><span><b>@{account.label}</b><small>{account.hasSecret ? (zh ? '设备授权有效' : 'Device authorization saved') : (zh ? '凭据待连接' : 'Needs authorization')}</small></span><button type="button" onClick={() => removeConnectedAccount('copilot', account, item, updateProvider, setClearAccountSecrets)} aria-label={zh ? `移除 ${account.label}` : `Remove ${account.label}`}><X size={13}/></button></div>)}{!item.accounts.length ? <p>{zh ? '还没有通过设备授权连接的 GitHub 账户。' : 'No GitHub account has been connected yet.'}</p> : null}</div>
  </div>;
}

function OpenCodeGoConnectionPanel({
  item, provider, updateProvider, accountSecrets, setAccountSecrets,
  clearAccountSecrets, setClearAccountSecrets, enableMaster, zh,
}) {
  const active = item.accounts.find((account) => account.id === item.activeAccountId) || item.accounts[0] || null;
  /* OpenCode Go 的名称、Cookie、Workspace 是不可拆分的账户配置；
     每项都在所属账户卡内编辑，并在失焦时前置校验。 */
  const [touched, setTouched] = useState({});
  const fieldError = (accountId, kind) => {
    const account = item.accounts.find((entry) => entry.id === accountId);
    if (!account) return '';
    if (kind === 'label' && !account.label.trim()) {
      return zh ? '请填写便于区分的账户名称。' : 'Enter a name that identifies this account.';
    }
    if (kind === 'cookie' && !(accountSecrets.opencode?.[accountId] || '').trim() && !account.hasSecret) {
      return zh ? '需要粘贴该账户的 Cookie。' : 'Paste this account’s Cookie.';
    }
    if (kind === 'workspace' && !isValidOpenCodeWorkspaceId(account.workspaceId)) {
      return zh ? '需要填写该账户对应的 wrk_… Workspace ID。' : 'Enter the wrk_… Workspace ID for this account.';
    }
    return '';
  };
  const updateAccount = (accountId, patch) => updateProvider('opencode', {
    accounts: item.accounts.map((account) => account.id === accountId ? { ...account, ...patch } : account),
  });
  const addOpenCodeAccount = () => {
    const id = accountIdentifier();
    enableMaster();
    updateProvider('opencode', {
      enabled: true,
      accounts: [...item.accounts, {
        id, label: '',
        workspaceId: '', externalIdentifier: '', hasSecret: false,
        entitlementType: 'unknown', subscriptionPrice: null,
        subscriptionCurrency: 'usd', billingCycle: 'monthly', renewsAt: '',
      }],
      activeAccountId: id,
    });
  };
  return <div className="account-provider-config">
    <div className="account-config-heading"><div><b>{zh ? 'OpenCode Go 账户' : 'OpenCode Go accounts'}</b><span>{zh ? '名称、Cookie 与 Workspace ID 按账户独立保存；三项齐全后才查询。' : 'Name, Cookie, and Workspace ID are stored per account; all three are required.'}</span></div><button className="provider-connect-button" type="button" onClick={addOpenCodeAccount}><span aria-hidden="true">＋</span>{zh ? '添加账户' : 'Add account'}</button></div>
    <SetupSteps provider={provider} zh={zh}/>
    <div className="opencode-account-list" role="radiogroup" aria-label={zh ? 'OpenCode Go 账户' : 'OpenCode Go accounts'}>{item.accounts.map((account, index) => {
        const credentialKey = `opencode:${account.id}`;
        const labelError = touched[`label:${account.id}`] ? fieldError(account.id, 'label') : '';
        const cookieError = touched[`cookie:${account.id}`] ? fieldError(account.id, 'cookie') : '';
        const workspaceError = touched[`workspace:${account.id}`] ? fieldError(account.id, 'workspace') : '';
        return <fieldset className={active?.id === account.id ? 'selected' : ''} key={account.id}>
          <legend>{zh ? `账户 ${index + 1}` : `Account ${index + 1}`}</legend>
          <label className="opencode-session-select"><input type="radio" name="opencode-active-account" checked={active?.id === account.id} onChange={() => updateProvider('opencode', { activeAccountId: account.id })}/><span className="sr-only">{zh ? `选择账户 ${index + 1}` : `Select account ${index + 1}`}</span></label>
          <label className="opencode-account-label"><span>{zh ? '账户名称' : 'Account name'}</span><input aria-invalid={labelError ? 'true' : undefined} value={account.label} onChange={(event) => updateAccount(account.id, { label: event.target.value })} onBlur={() => setTouched((current) => ({ ...current, [`label:${account.id}`]: true }))} placeholder={zh ? '个人 / 工作' : 'Personal / work'}/>{labelError ? <small className="field-error">{labelError}</small> : null}</label>
          <label className="opencode-cookie-field"><span>Cookie</span><input type="password" autoComplete="off" spellCheck="false" aria-invalid={cookieError ? 'true' : undefined} value={accountSecrets.opencode?.[account.id] || ''} onChange={(event) => setAccountSecrets((current) => ({ ...current, opencode: { ...current.opencode, [account.id]: event.target.value } }))} onBlur={() => setTouched((current) => ({ ...current, [`cookie:${account.id}`]: true }))} placeholder={account.hasSecret ? (zh ? '已安全保存 · 留空保持' : 'Saved securely · leave blank to keep') : 'auth=…'}/><small className={cookieError ? 'field-error' : undefined}>{cookieError || (zh ? '支持 Cookie 请求头或复制的 cURL。' : 'Accepts a Cookie header or copied cURL.')}</small>{clearAccountSecrets.includes(credentialKey) ? <small className="account-secret-warning">{zh ? '保存后会清除该账户凭据' : 'This account credential will be removed on save'}</small> : null}</label>
          <label className="opencode-workspace-field"><span>Workspace ID</span><input aria-invalid={workspaceError ? 'true' : undefined} value={account.workspaceId || ''} onChange={(event) => updateAccount(account.id, { workspaceId: event.target.value })} onBlur={() => setTouched((current) => ({ ...current, [`workspace:${account.id}`]: true }))} placeholder="wrk_…"/><small className={workspaceError ? 'field-error' : undefined}>{workspaceError || (zh ? '与上面的 Cookie 属于同一个 OpenCode Go 账户。' : 'Must belong to the same OpenCode Go account as the Cookie above.')}</small></label>
          <button className="remove-account-btn" type="button" onClick={() => removeConnectedAccount('opencode', account, item, updateProvider, setClearAccountSecrets)}><X size={12}/>{zh ? '移除' : 'Remove'}</button>
          <EntitlementFields className="account-entitlement" item={account} onChange={(patch) => updateAccount(account.id, patch)} zh={zh}/>
        </fieldset>;
      })}{!item.accounts.length ? <p>{zh ? '添加账户后，为该账户分别填写名称、Cookie 与 Workspace ID。' : 'Add an account, then enter its name, Cookie, and Workspace ID.'}</p> : null}</div>
  </div>;
}

function StandardProviderConfig({
  provider, item, updateProvider, secrets, setSecrets, clearSecrets, setClearSecrets, zh,
}) {
  return <>
    <p>{provider.localHint}</p>
    {provider.authModes.length > 1 ? <div className="provider-auth-modes" role="radiogroup" aria-label={zh ? '凭据来源' : 'Credential source'}>{provider.authModes.map((mode) => <button type="button" role="radio" aria-checked={item.authMode === mode} className={item.authMode === mode ? 'active' : ''} onClick={() => updateProvider(provider.id, { authMode: mode })} disabled={mode === 'keychain' && !provider.supportsKeychain} key={mode}>{item.authMode === mode ? <Check size={11}/> : null}{authLabel(mode, zh)}</button>)}</div> : null}
    <SetupSteps provider={provider} zh={zh}/>
    <div className="provider-auth-fields">
      {item.authMode === 'environment' ? <label><span>{zh ? '环境变量名（凭据内容不要填在这里）' : 'Environment variable name—not the secret itself'}</span><input value={item.environmentVariable} onChange={(event) => updateProvider(provider.id, { environmentVariable: event.target.value })} placeholder={provider.defaultEnvironmentVariable || 'TOKEN'}/><small>{zh ? `在启动看板前设置 ${item.environmentVariable || provider.defaultEnvironmentVariable}，保存后会自动验证。` : 'Set this variable before starting the dashboard; saving will verify it.'}</small></label> : null}
      {item.authMode === 'keychain' ? <label><span>{secretLabel(provider, zh)}</span><input type="password" autoComplete="off" spellCheck="false" value={secrets[provider.id] || ''} onChange={(event) => setSecrets((current) => ({ ...current, [provider.id]: event.target.value }))} placeholder={provider.hasSecret ? (zh ? '已安全保存 · 留空保持不变' : 'Saved securely · leave blank to keep') : (zh ? '粘贴 Cookie、Token 或 cURL 片段' : 'Paste cookie, token, or cURL snippet')} disabled={!provider.supportsKeychain}/><small>{zh ? '只会提交给 127.0.0.1 本地服务，并保存到系统钥匙串。' : 'Sent only to the local 127.0.0.1 service and stored in Keychain.'}</small>{provider.hasSecret ? <button type="button" onClick={() => setClearSecrets((current) => current.includes(provider.id) ? current.filter((id) => id !== provider.id) : [...current, provider.id])}>{clearSecrets.includes(provider.id) ? (zh ? '撤销清除' : 'Keep secret') : (zh ? '清除已保存凭据' : 'Clear saved secret')}</button> : null}</label> : null}
      {provider.extraFields?.includes('workspaceId') ? <label><span>{zh ? 'Workspace ID 或账单页链接（可选）' : 'Workspace ID or billing URL (optional)'}</span><input value={item.workspaceId} onChange={(event) => updateProvider(provider.id, { workspaceId: event.target.value })} placeholder="https://opencode.ai/workspace/wrk_…/billing"/></label> : null}
      {provider.extraFields?.includes('site') ? <label><span>{zh ? 'Qoder 站点' : 'Qoder site'}</span><select value={item.site} onChange={(event) => updateProvider(provider.id, { site: event.target.value })}><option value="international">qoder.com · 国际站</option><option value="china">qoder.com.cn · 中国站</option></select></label> : null}
      {provider.extraFields?.includes('customPath') ? <label><span>{zh ? 'IDE 配置目录（通常留空）' : 'IDE config directory (usually blank)'}</span><input value={item.customPath} onChange={(event) => updateProvider(provider.id, { customPath: event.target.value })} placeholder="~/Library/Application Support/JetBrains/WebStorm2026.2"/></label> : null}
    </div>
    {provider.dashboardUrl ? <a className="provider-dashboard-link" href={provider.dashboardUrl} target="_blank" rel="noreferrer">{zh ? `打开 ${provider.label} 用量页` : `Open ${provider.label} usage`}<ExternalLink size={11}/></a> : null}
  </>;
}

/* 权益标注(20260816):随平台走——选择器与付费字段就在各平台展开面板里,
   说明文字只出现一次;原独立的「权益来源与实际支出」大区块(738px)删除 */
function EntitlementFields({ item, onChange, zh, className = '' }) {
  const isPaid = item.entitlementType === 'paid';
  const setEntitlementType = (entitlementType) => onChange(entitlementType === 'paid'
    ? { entitlementType }
    : { entitlementType, subscriptionPrice: null, renewsAt: '' });
  return <div className={`provider-entitlement entitlement-${item.entitlementType || 'unknown'} ${className}`.trim()}>
    <label className="entitlement-kind-field">
      <span>{zh ? '权益类型' : 'Benefit type'}</span>
      <select value={item.entitlementType || 'unknown'} onChange={(event) => setEntitlementType(event.target.value)}>
        {ENTITLEMENT_TYPES.map((type) => <option value={type} key={type}>{entitlementLabel(type, zh)}</option>)}
      </select>
      <small>{entitlementNote(item.entitlementType, zh)}</small>
    </label>
    {isPaid ? <div className="subscription-paid-fields">
      <label><span>{zh ? '实际价格' : 'Actual price'}</span><input type="number" inputMode="decimal" min="0" max="1000000" step="0.01" value={item.subscriptionPrice ?? ''} onChange={(event) => onChange({ subscriptionPrice: event.target.value === '' ? null : Number(event.target.value) })} placeholder="—"/></label>
      <label><span>{zh ? '货币' : 'Currency'}</span><select value={item.subscriptionCurrency || 'usd'} onChange={(event) => onChange({ subscriptionCurrency: event.target.value })}><option value="usd">USD · $</option><option value="cny">CNY · ¥</option></select></label>
      <label><span>{zh ? '账期' : 'Cycle'}</span><select value={item.billingCycle || 'monthly'} onChange={(event) => onChange({ billingCycle: event.target.value })}><option value="monthly">{zh ? '每月' : 'Monthly'}</option><option value="yearly">{zh ? '每年' : 'Yearly'}</option></select></label>
      <label><span>{zh ? '下次续费' : 'Renewal'}</span><input type="date" value={item.renewsAt || ''} onChange={(event) => onChange({ renewsAt: event.target.value })}/></label>
    </div> : null}
  </div>;
}

function EntitlementBlock({ provider, item, updateProvider, zh }) {
  return <EntitlementFields item={item} onChange={(patch) => updateProvider(provider.id, patch)} zh={zh}/>;
}

export function LimitSettingsDialog({ open, settings, onClose, onSave, onCopilotDeviceAction, saving, zh }) {
  const dialogRef = useRef(null);
  const bodyRef = useRef(null);
  const [draft, setDraft] = useState(settings);
  const [secrets, setSecrets] = useState({});
  const [clearSecrets, setClearSecrets] = useState([]);
  const [accountSecrets, setAccountSecrets] = useState({});
  const [clearAccountSecrets, setClearAccountSecrets] = useState([]);
  const [message, setMessage] = useState('');
  const [validationErrors, setValidationErrors] = useState([]);
  const [view, setView] = useState('detected');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState('');
  const [draggingId, setDraggingId] = useState('');
  const [dragOverId, setDragOverId] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [activeAnchor, setActiveAnchor] = useState('providers');
  useEffect(() => { if (open) { setDraft(settings); setSecrets({}); setClearSecrets([]); setAccountSecrets({}); setClearAccountSecrets([]); setMessage(''); setValidationErrors([]); setView('detected'); setQuery(''); setExpanded(''); setDraggingId(''); setDragOverId(''); setConfirmDiscard(false); setActiveAnchor('providers'); } }, [open, settings]);
  /* dirty 守卫(20260816):草稿偏离已保存设置(或新输入过凭据)时,
     关闭动作先出确认条,再放弃;提交成功照常直接关闭 */
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)
    || hasEnteredSecrets(secrets)
    || clearSecrets.length > 0
    || hasEnteredSecrets(accountSecrets)
    || clearAccountSecrets.length > 0;
  const closeStateRef = useRef({ dirty: false, confirmDiscard: false });
  closeStateRef.current = { dirty, confirmDiscard };
  const requestClose = () => {
    const current = closeStateRef.current;
    if (current.dirty && !current.confirmDiscard) { setConfirmDiscard(true); return; }
    onClose();
  };
  /* 分区锚点:滚动时点亮当前段(连接平台 / 显示顺序) */
  useEffect(() => {
    if (!open) return undefined;
    const body = bodyRef.current;
    if (!body) return undefined;
    const onScroll = () => {
      const order = body.querySelector('.limit-provider-order');
      if (!order) return;
      /* 触底即视为进入末段(底部内容不足一屏时,段落顶到不了阈值线) */
      const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 4;
      const orderTop = order.getBoundingClientRect().top;
      const bodyTop = body.getBoundingClientRect().top;
      setActiveAnchor(atBottom || orderTop <= bodyTop + 120 ? 'order' : 'providers');
    };
    body.addEventListener('scroll', onScroll, { passive: true });
    return () => body.removeEventListener('scroll', onScroll);
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const focusable = () => [...(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') || [])];
    const key = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); if (closeStateRef.current.confirmDiscard) setConfirmDiscard(false); else requestClose(); return; }
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
  const submit = async ({ closeAfterSave = false } = {}) => {
    setMessage('');
    setValidationErrors([]);
    try {
      const openCode = draft.providers.opencode;
      if (openCode.enabled && !openCode.accounts.length) throw new Error(zh
        ? 'OpenCode Go 已启用，请先添加至少一个账户。'
        : 'OpenCode Go is enabled. Add at least one account.');
      const incompleteOpenCode = openCode.accounts.filter((account) => (
        !account.label.trim()
        || !isValidOpenCodeWorkspaceId(account.workspaceId)
        || (!account.hasSecret && !(accountSecrets.opencode?.[account.id] || '').trim())
      ));
      if (incompleteOpenCode.length) throw new Error(zh
        ? 'OpenCode Go 每个账户都必须填写名称、Cookie 与有效的 wrk_… Workspace ID。'
        : 'Every OpenCode Go account requires a name, Cookie, and valid wrk_… Workspace ID.');
      const result = await onSave({
        settings: draft, secrets, clearSecrets, accountSecrets, clearAccountSecrets,
      });
      const failures = result?.providers?.filter((provider) => (
        provider.status === 'error' && provider.quotaCoverage !== 'best-effort'
      )) || [];
      if (closeAfterSave) { onClose(); return; }
      setValidationErrors(failures);
      if (failures.length) {
        setMessage(zh
          ? `设置已保存，但 ${failures.map((provider) => provider.label).join('、')} 仍需处理。请按下方提示修正后重试。`
          : `Saved, but ${failures.map((provider) => provider.label).join(', ')} still need attention.`);
        setExpanded(failures[0].id);
      } else setMessage(zh ? '设置已保存，额度已刷新。' : 'Settings saved and quotas refreshed.');
    }
    catch (reason) { setMessage(reason?.message || String(reason)); }
  };
  const ready = draft.catalog.filter((provider) => ['detected', 'configured'].includes(provider.detection?.state));
  const enabledCount = Object.values(draft.providers).filter((provider) => provider.enabled).length;
  const settingsTabs = [
    ['detected', zh ? '已检测' : 'Detected'],
    ['all', zh ? '全部平台' : 'All platforms'],
  ];
  const visible = draft.catalog.filter((provider) => {
    const matches = !query || `${provider.label} ${provider.description}`.toLowerCase().includes(query.toLowerCase());
    if (!matches) return false;
    if (view === 'detected') return ['detected', 'configured'].includes(provider.detection?.state) || draft.providers[provider.id]?.enabled;
    return true;
  }).sort((a, b) => (draft.providers[b.id]?.enabled ? 1 : 0) - (draft.providers[a.id]?.enabled ? 1 : 0));
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
  const handleCopilotConnected = () => {
    setMessage(zh ? 'GitHub 账户已连接，正在刷新账户列表与额度。' : 'GitHub account connected. Refreshing accounts and quotas.');
  };
  return <div className="dialog-layer" role="presentation"><section ref={dialogRef} className="dialog dialog--limit-settings" role="dialog" aria-modal="true" aria-label={zh ? '账户权益与额度设置' : 'Account benefit and quota settings'}><header><div><h2>{zh ? '连接并标注账户权益' : 'Connect and classify account benefits'}</h2><p>{zh ? '先自动检测账户，再标注付费、免费、活动或单位权益。额度读取失败不影响本机 Token 分析。' : 'Detect accounts first, then classify them as paid, free, promotional, or organization-provided. Quota failures never block local Token analytics.'}</p></div><button autoFocus className="icon-btn" type="button" onClick={requestClose} aria-label={zh ? '关闭账户权益设置' : 'Close account benefit settings'}><X size={18}/></button></header>
    <div className="limit-settings-body" ref={bodyRef}><section className="limit-setup-summary"><div className="limit-setup-score"><Sparkles size={18}/><div><b>{zh ? `自动检测到 ${ready.length} 个平台` : `${localizedCount(ready.length, false, '', 'provider', 'providers')} detected`}</b><span>{zh ? '无需复制 Token，推荐直接启用已检测平台。' : 'No token copying needed for detected providers.'}</span></div></div><button type="button" onClick={enableDetected} disabled={!ready.length}><Check size={14}/>{zh ? '一键启用已检测' : 'Enable detected'}</button><div className="limit-master-inline"><span>{zh ? `${enabledCount} 个已选择` : `${enabledCount} selected`}</span><Toggle checked={draft.enabled} onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))} label={draft.enabled ? (zh ? '总开关已开启' : 'Master on') : (zh ? '总开关已关闭' : 'Master off')}/></div></section>
      <section className="limit-provider-toolbar"><div role="tablist" aria-orientation="horizontal" aria-label={zh ? '筛选账户平台' : 'Filter account providers'}>{settingsTabs.map(([id, label], index) => <button type="button" role="tab" id={settingsProviderTabId(id)} aria-controls={SETTINGS_PROVIDER_PANEL_ID} aria-selected={view === id} tabIndex={view === id ? 0 : -1} className={view === id ? 'active' : ''} onClick={() => setView(id)} onKeyDown={(event) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? settingsTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + settingsTabs.length) % settingsTabs.length; setView(settingsTabs[nextIndex][0]); event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[nextIndex]?.focus(); }} key={id}>{label}</button>)}</div><label><Search size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '搜索平台' : 'Search providers'}/></label></section>
      <nav className="limit-section-nav" aria-label={zh ? '设置分区' : 'Settings sections'}>
        {[['providers', zh ? '① 连接平台' : '① Connect'], ['order', zh ? '② 显示顺序' : '② Order']].map(([id, label]) => <a key={id} href={`#limit-sec-${id}`} className={activeAnchor === id ? 'active' : ''} aria-current={activeAnchor === id ? 'location' : undefined} onClick={(event) => { event.preventDefault(); bodyRef.current?.querySelector(`#limit-sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{label}</a>)}
      </nav>
      <div id="limit-sec-providers" className="limit-section">
      <div className="limit-provider-settings" id={SETTINGS_PROVIDER_PANEL_ID} role="tabpanel" aria-labelledby={settingsProviderTabId(view)} tabIndex={0}>{visible.map((provider) => {
        const item = draft.providers[provider.id];
        const unavailable = provider.quotaSupport === 'unavailable';
        const isExpanded = expanded === provider.id;
        const setEnabled = (enabled) => {
          const patch = { enabled };
          if (enabled && provider.quotaSupport === 'manual' && provider.supportsKeychain) patch.authMode = 'keychain';
          if (enabled && provider.id === 'opencode' && !item.accounts.length) {
            const id = accountIdentifier();
            patch.accounts = [{
              id, label: '',
              workspaceId: '', externalIdentifier: '', hasSecret: false,
              entitlementType: 'unknown', subscriptionPrice: null,
              subscriptionCurrency: 'usd', billingCycle: 'monthly', renewsAt: '',
            }];
            patch.activeAccountId = id;
          }
          updateProvider(provider.id, patch);
          if (enabled) {
            setDraft((current) => ({ ...current, enabled: true }));
            setExpanded(provider.id);
          }
        };
        const entitlementItem = provider.id === 'opencode'
          ? item.accounts.find((account) => account.id === item.activeAccountId) || item.accounts[0] || item
          : item;
        return <article className={`${item.enabled ? 'enabled' : ''} ${isExpanded ? 'expanded' : ''} ${unavailable ? 'unavailable' : ''}`} id={`limit-account-provider-${provider.id}`} key={provider.id}>
          <div className="provider-setting-head"><ProviderIcon id={provider.id}/><button type="button" className="provider-setting-copy" onClick={() => !unavailable && setExpanded(isExpanded ? '' : provider.id)}><span><b>{provider.label}{provider.popular ? <em>{zh ? '热门' : 'Popular'}</em> : null}{item.enabled ? <em className={`entitlement-badge entitlement-badge--${entitlementItem.entitlementType || 'unknown'}`} title={entitlementLabel(entitlementItem.entitlementType, zh)}>{entitlementBadge(entitlementItem.entitlementType, zh)}</em> : null}</b><small>{provider.description}</small></span><ChevronDown className={isExpanded ? 'expanded' : ''} size={15}/></button><Toggle checked={item.enabled} onChange={setEnabled} label={zh ? `启用 ${provider.label}` : `Enable ${provider.label}`} disabled={unavailable}/></div>
          <div className={`provider-detection ${detectionClass(provider.detection?.state)}`}>{['detected', 'configured'].includes(provider.detection?.state) ? <Check size={12}/> : <CircleAlert size={12}/>}<span>{provider.detection?.label}</span>{provider.detection?.detail ? <small>{provider.detection.detail}</small> : null}</div>
          {unavailable ? <div className="provider-unavailable-copy"><p>{provider.localHint}</p>{provider.dashboardUrl ? <a href={provider.dashboardUrl} target="_blank" rel="noreferrer">{zh ? '打开官方页面' : 'Open official site'}<ExternalLink size={11}/></a> : null}</div> : null}
          {isExpanded && !unavailable ? <div className="provider-config-panel">
            {provider.id === 'copilot' ? <CopilotConnectionPanel item={item} updateProvider={updateProvider} setClearAccountSecrets={setClearAccountSecrets} enableMaster={() => setDraft((current) => ({ ...current, enabled: true }))} onCopilotDeviceAction={onCopilotDeviceAction} onCopilotConnected={handleCopilotConnected} zh={zh}/> : provider.id === 'opencode' ? <OpenCodeGoConnectionPanel item={item} provider={provider} updateProvider={updateProvider} accountSecrets={accountSecrets} setAccountSecrets={setAccountSecrets} clearAccountSecrets={clearAccountSecrets} setClearAccountSecrets={setClearAccountSecrets} enableMaster={() => setDraft((current) => ({ ...current, enabled: true }))} zh={zh}/> : <StandardProviderConfig provider={provider} item={item} updateProvider={updateProvider} secrets={secrets} setSecrets={setSecrets} clearSecrets={clearSecrets} setClearSecrets={setClearSecrets} zh={zh}/>}
            {item.enabled && provider.id !== 'opencode' ? <EntitlementBlock provider={provider} item={item} updateProvider={updateProvider} zh={zh}/> : null}
          </div> : null}
        </article>;
      })}</div>
      </div>
      <section className="limit-provider-order" id="limit-sec-order">
        <header><div><b>{zh ? '额度显示顺序' : 'Quota display order'}</b><span>{zh ? '拖动右侧手柄即可排序；触屏也可拖动，结果保存在本机。' : 'Drag the handle to reorder. Touch is supported and the result stays on this device.'}</span></div><small>{zh ? `${orderedEnabled.length} 个已启用平台` : `${orderedEnabled.length} enabled`}</small></header>
        {orderedEnabled.length ? <ol onMouseMove={(event) => { if (!draggingId) return; const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-provider-order-id]')?.dataset.providerOrderId; if (!target || target === draggingId) return; setDragOverId(target); reorderProvider(draggingId, target); }} onMouseUp={finishDrag}>{orderedEnabled.map((provider, index) => <li key={provider.id} data-provider-order-id={provider.id} className={`${draggingId === provider.id ? 'dragging' : ''} ${dragOverId === provider.id && draggingId !== provider.id ? 'drag-over' : ''}`}>
          <span className="provider-order-index">{String(index + 1).padStart(2, '0')}</span>
          <span className="provider-order-label"><ProviderIcon id={provider.id} size={15}/><b>{provider.label}</b></span>
          <button type="button" className="provider-order-handle" onMouseDown={() => { setDraggingId(provider.id); setDragOverId(provider.id); }} onPointerDown={(event) => { if (event.button !== 0 && event.button !== -1) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDraggingId(provider.id); setDragOverId(provider.id); }} onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-provider-order-id]')?.dataset.providerOrderId; if (!target || target === provider.id) return; setDragOverId(target); reorderProvider(provider.id, target); }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); finishDrag(); }} onPointerCancel={finishDrag} onKeyDown={(event) => { const direction = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : 0; if (!direction) return; event.preventDefault(); setDraft((current) => moveEnabledProvider(current, provider.id, direction)); }} aria-label={zh ? `拖动调整 ${provider.label}；也可按方向键移动` : `Drag to reorder ${provider.label}; arrow keys also work`} title={zh ? '拖动排序' : 'Drag to reorder'}><GripVertical size={16}/></button>
        </li>)}</ol> : <p>{zh ? '启用至少一个平台后即可调整顺序。' : 'Enable a provider to arrange its position.'}</p>}
      </section>
      <details className="limit-security-note">
        <summary><ShieldCheck size={15}/><b>{zh ? '敏感信息边界' : 'Sensitive-data boundary'}</b><ChevronDown size={14}/></summary>
        <p>{zh ? '浏览器只提交你主动输入的凭据一次；服务端把手动凭据交给 macOS 钥匙串，普通 config.json 只保存开关、来源和变量名。接口响应永远不包含 Token 或 Cookie，只显示不暴露主目录的来源提示。' : 'The browser submits manually entered secrets once. The local server stores them in macOS Keychain; config.json keeps only toggles, source modes, and variable names. Responses never contain tokens or cookies and show only home-redacted source hints.'}</p>
      </details>
      <div className="limit-sticky-alerts">
        {validationErrors.length ? <div className="provider-validation-errors" role="alert">{validationErrors.map((provider) => <div key={provider.id}><CircleAlert size={14}/><span><b>{provider.label}</b><small>{provider.error?.message || (zh ? '连接验证失败' : 'Connection validation failed')}</small></span><button type="button" onClick={() => { if (provider.id === 'copilot' || provider.id === 'opencode') { document.getElementById(`limit-account-provider-${provider.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; } setView('all'); setExpanded(provider.id); }}>{zh ? '去修复' : 'Fix'}</button></div>)}</div> : null}
        {message ? <p className="dialog-error" role="alert">{message}</p> : null}
      </div></div>
    {confirmDiscard ? <div className="dialog-dirty-bar" role="alertdialog" aria-label={zh ? '未保存的更改' : 'Unsaved changes'}>
      <span>{zh ? '有未保存的更改' : 'You have unsaved changes'}</span>
      <span className="dialog-dirty-actions">
        <button type="button" autoFocus onClick={() => setConfirmDiscard(false)}>{zh ? '继续编辑' : 'Keep editing'}</button>
        <button type="button" className="danger" onClick={onClose}>{zh ? '放弃并关闭' : 'Discard & close'}</button>
      </span>
    </div> : null}
    <footer className="dialog-actions"><button type="button" className="ghost-btn limit-cancel-action" onClick={requestClose}>{zh ? '取消' : 'Cancel'}</button><button type="button" className="ghost-btn limit-refresh-action" onClick={() => submit()} disabled={saving}>{saving ? <RefreshCw className="spin" size={14}/> : <RefreshCw size={14}/>} {zh ? '保存并刷新额度' : 'Save & refresh quotas'}</button><button type="button" className="primary-btn limit-close-action" onClick={() => submit({ closeAfterSave: true })} disabled={saving}>{saving ? <RefreshCw className="spin" size={14}/> : <KeyRound size={14}/>} {zh ? '保存并关闭' : 'Save & close'}</button></footer>
  </section></div>;
}
