import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  Check, ChevronDown, ChevronRight, CircleAlert, ExternalLink, GripVertical, KeyRound,
  RefreshCw, Search, ShieldCheck, Sparkles, X,
} from 'lucide-react';
import { ProviderIcon } from './SubscriptionLimits.jsx';
import { moveEnabledProvider, reorderEnabledProviders } from './provider-order.js';
import {
  ENTITLEMENT_TYPES, entitlementBadge, entitlementLabel, entitlementNote,
  credentialState, hasOpenCodeCredential, idSegment, isValidOpenCodeWorkspaceId, kimiConnectionStatusText, localizedCount,
  quotaErrorMessage, quotaProviderCatalogCopy, regionalProviderPatch, regionalDraftDetection, quotaSaveFailures,
} from './subscription-limits-utils.js';
import { createLimitSettingsState, isLimitSettingsDirty, limitSettingsReducer } from './limit-settings-state.js';

/* 权益设置弹窗(20261010 主从布局重构):左栏平台导航,右栏只渲染当前平台的
   连接与标注设置;多账号平台拆成「账号行列表 + 单账号编辑卡」。
   安全行为不变:dirty 守卫、遮罩不关闭、焦点圈、区域切换清凭据草稿。 */

const SETTINGS_PROVIDER_PANEL_ID = 'limit-provider-settings-panel';
const ORDER_NAV_ID = '__order';

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

function shortStatus(provider, item, zh) {
  if (provider.quotaSupport === 'unavailable') return zh ? '额度暂不可查' : 'No quota';
  const state = provider.detection?.state;
  if (['detected', 'configured'].includes(state)) return provider.detection.label;
  if (state === 'expired') return zh ? '登录已过期' : 'Expired';
  if (state === 'needs_login') return zh ? '需要登录' : 'Sign-in needed';
  if (state === 'manual') return zh ? '待手动连接' : 'Setup needed';
  if (item.enabled) return zh ? '已选择' : 'Enabled';
  return zh ? '未检测' : 'Not checked';
}

function connectionModeLabel(account, zh) {
  if (account.connectionType === 'local') return zh ? '本机 CLI 登录' : 'Local CLI login';
  if (account.connectionType === 'web-token') return zh ? '网页登录令牌' : 'Website token';
  if (account.connectionType === 'api-key') return 'API Key';
  return 'Cookie + Workspace';
}

function accountName(account, zh) {
  return account.label.trim() || (zh ? '未命名账户' : 'Unnamed account');
}

/* 两步移除(20261010):已保存凭据的账号移除时,确认条写明「保存后同时清除凭据」,
   未保存凭据的账号(纯草稿)直接移除,靠关闭不保存兜底。 */
function RemoveAccountButton({ hasSavedCredential, onRemove, zh, className = '' }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = window.setTimeout(() => setArmed(false), 6_000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  if (!armed) return <button type="button" className={`remove-account-btn ${className}`.trim()} onClick={() => setArmed(true)}>{zh ? '移除' : 'Remove'}</button>;
  return <span className="remove-account-confirm" role="group" aria-label={zh ? '确认移除账户' : 'Confirm account removal'}>
    {hasSavedCredential ? <small>{zh ? '保存后将同时清除本机保存的凭据' : 'Saving will also erase the stored credential'}</small> : null}
    <button type="button" className="danger" onClick={onRemove}>{zh ? '确认移除' : 'Confirm'}</button>
    <button type="button" onClick={() => setArmed(false)}>{zh ? '取消' : 'Cancel'}</button>
  </span>;
}

function SetupSteps({ provider, zh, needsSetup }) {
  const [override, setOverride] = useState(null);
  const body = (() => {
    if (provider?.id === 'workbuddy') return <><ol>
      <li><a href={provider.dashboardUrl} target="_blank" rel="noreferrer">{zh ? '登录官网并打开套餐用量页' : 'Sign in and open plan usage'}<ExternalLink size={11}/></a></li>
      <li>{zh ? '开发者工具 → 网络，刷新页面，找到 get-user-resource-summary 请求。' : 'In DevTools → Network, refresh and select get-user-resource-summary.'}</li>
      <li>{zh ? '复制同一请求中的 Cookie 与 User-Agent 到下方。会话过期或更换浏览器后，两项一起更新。' : 'Copy Cookie and User-Agent from that same request. Replace both when the session expires or the browser changes.'}</li>
    </ol><p>{zh ? '使用环境变量时，值为 {"cookie":"…","userAgent":"…"} JSON。不会导入浏览器凭据。' : 'For an environment variable, use JSON: {"cookie":"…","userAgent":"…"}. Browser credentials are never imported.'}</p></>;
    if (provider?.id === 'claude-code') return <><p>{zh ? '自动登录可读取重置券与赠送云额度（若账号支持）。续费/到期日需要额外验证：手动模式可提供 OAuth Access Token 和同一账户 claude.ai 的 Cookie。两者身份不一致或无法验证时，不显示日期。' : 'Local login can read reset vouchers and promotional cloud credits when supported. Renewal/expiry dates require extra verification: manual mode accepts an OAuth access token and a claude.ai Cookie for the same account. Dates stay unavailable if ownership cannot be verified.'}</p><p>{zh ? '环境变量支持原 Token，或 {"accessToken":"…","sessionCookie":"sessionKey=…"}。Cookie 可选，不会自动读取浏览器，也不会修改 Claude 登录。' : 'The environment variable accepts a plain token or {"accessToken":"…","sessionCookie":"sessionKey=…"}. Cookie is optional; browser sessions are never imported and Claude login is never modified.'}</p></>;
    if (provider?.sites && provider.id !== 'alibaba-coding') return <ol>
      <li>{zh ? '先选择与你购买套餐一致的地区。' : 'Select the region where you purchased the plan.'}</li>
      <li><a href={provider.dashboardUrl} target="_blank" rel="noreferrer">{zh ? '打开官方用量页并创建/复制套餐 API Key' : 'Open official usage and create/copy a plan API key'}<ExternalLink size={11}/></a></li>
      <li>{zh ? '在下方安全粘贴 Key，或填写已配置的环境变量名，再保存验证。无需密码，不会上传到社区。' : 'Paste the key securely below or select a configured environment variable, then save to verify. No password is needed and nothing is uploaded to the community.'}</li>
    </ol>;
    if (provider?.id === 'alibaba-coding') return <ol>
      <li><a href={provider.dashboardUrl} target="_blank" rel="noreferrer">{zh ? '打开所选地区的 Coding Plan 用量页' : 'Open Coding Plan usage in the selected region'}<ExternalLink size={11}/></a></li>
      <li>{zh ? '开发者工具 → 网络，刷新页面，找到 queryCodingPlanInstanceInfoV2 请求。' : 'In DevTools → Network, refresh and find the queryCodingPlanInstanceInfoV2 request.'}</li>
      <li>{zh ? '复制该请求的 Cookie 请求头或 cURL，粘贴到凭据框；不要填写 DashScope API Key。会话过期后需要重新复制。' : 'Copy its Cookie header or cURL into the credential field, not a DashScope API key. Copy a fresh cookie when the session expires.'}</li>
    </ol>;
    if (!provider || !['opencode', 'qoder', 'cursor'].includes(provider.id)) return null;
    if (provider.id === 'opencode') return <ol>
      <li>{zh ? 'API Key：粘贴 OpenCode Go API Key，不需要 Workspace ID。' : 'API Key: paste an OpenCode Go API key; no Workspace ID is needed.'}</li>
      <li>{zh ? <><a href={provider.dashboardUrl} target="_blank" rel="noreferrer">网页登录方式<ExternalLink size={11}/></a>：进入 Go 用量页，从地址栏复制 wrk_… Workspace ID。</> : <><a href={provider.dashboardUrl} target="_blank" rel="noreferrer">Web session method<ExternalLink size={11}/></a>: open Go usage and copy the wrk_… Workspace ID from the address bar.</>}</li>
      <li>{zh ? '网页登录方式还需从开发者工具 → 网络复制同一账户的 Cookie 请求头或 cURL。' : 'The web-session method also needs a Cookie header or cURL copied from DevTools → Network for the same account.'}</li>
    </ol>;
    return <ol>
      <li>{zh ? <><a href={provider.dashboardUrl} target="_blank" rel="noreferrer">打开并登录 {provider.label}<ExternalLink size={11}/></a></> : <>Open and sign in to {provider.label}</>}</li>
      <li>{zh ? '打开浏览器开发者工具 → 网络（Network），刷新用量页并点开任意同域请求。' : 'Open DevTools → Network, refresh the usage page, and select a same-domain request.'}</li>
      <li>{zh ? '复制“请求标头”里的 Cookie 整行，或直接复制该请求的 cURL；两种格式都可粘贴。' : 'Copy the Cookie request header or the request as cURL; either format works.'}</li>
    </ol>;
  })();
  if (body == null) return null;
  const title = provider.id === 'workbuddy' ? (zh ? '连接 WorkBuddy 官网' : 'Connect the WorkBuddy website')
    : provider.id === 'claude-code' ? (zh ? '额外权益来自官方响应，不做推测' : 'Additional benefits use official evidence only')
    : provider.id === 'opencode' ? (zh ? '两种连接方式，按账户任选一种' : 'Choose one connection method per account')
    : provider.sites && provider.id !== 'alibaba-coding' ? (zh ? '连接个人套餐' : 'Connect a personal plan')
    : provider.id === 'alibaba-coding' ? (zh ? '连接百炼控制台会话' : 'Connect a Bailian console session')
    : (zh ? '不会配？照着 3 步做' : 'Three-step setup');
  return <details className="provider-setup-steps" open={override ?? needsSetup} onToggle={(event) => setOverride(event.target.open)}>
    <summary>{title}<ChevronDown size={13}/></summary>
    {body}
  </details>;
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
  if (credentialState(account) !== 'absent') {
    const key = `${providerId}:${account.id}`;
    setClearAccountSecrets((current) => current.includes(key) ? current : [...current, key]);
  }
}

function CopilotConnectionPanel({
  item, updateProvider, setClearAccountSecrets, enableMaster,
  onCopilotDeviceAction, onCopilotConnected, statusCheck, zh,
}) {
  const [device, setDevice] = useState({ status: 'idle' });
  const [deviceBusy, setDeviceBusy] = useState(false);
  useEffect(() => {
    if (!onCopilotDeviceAction) return undefined;
    let cancelled = false;
    onCopilotDeviceAction('status').then((next) => { if (!cancelled) setDevice(next); }).catch(() => {});
    return () => { cancelled = true; };
  }, [onCopilotDeviceAction, statusCheck]);
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
    {device.status === 'error' ? <p className="dialog-error" role="alert">{zh ? device.message : 'GitHub authorization failed. Try again.'}</p> : null}
    <div className="account-row-list">{item.accounts.map((account) => <div className="account-row" key={account.id}>
      <span className="account-row-main"><b>{accountName(account, zh)}</b><small>{account.hasSecret ? (zh ? '设备授权已保存' : 'Device authorization saved') : credentialState(account) === 'unchecked' ? (zh ? '凭据尚未检测' : 'Credential not checked') : (zh ? '凭据待连接' : 'Needs authorization')}</small></span>
      <RemoveAccountButton hasSavedCredential={credentialState(account) !== 'absent'} onRemove={() => removeConnectedAccount('copilot', account, item, updateProvider, setClearAccountSecrets)} zh={zh}/>
    </div>)}{!item.accounts.length ? <p>{zh ? '还没有通过设备授权连接的 GitHub 账户。' : 'No GitHub account has been connected yet.'}</p> : null}</div>
  </div>;
}

function OpenCodeGoConnectionPanel({
  item, provider, savedAccounts, updateProvider, accountSecrets, setAccountSecrets,
  clearAccountSecrets, setClearAccountSecrets, enableMaster, editorAccountId, setEditorAccountId, zh,
}) {
  const selected = item.accounts.find((account) => account.id === editorAccountId)
    || item.accounts.find((account) => account.id === item.activeAccountId)
    || item.accounts[0] || null;
  /* OpenCode Go 每个账户只拥有一套完整连接元组：名称 + API Key，
     或名称 + Cookie + Workspace；每项都在所选账户的编辑卡内修改。 */
  const [touched, setTouched] = useState({});
  const fieldError = (accountId, kind) => {
    const account = item.accounts.find((entry) => entry.id === accountId);
    if (!account) return '';
    if (kind === 'label' && !account.label.trim()) {
      return zh ? '请填写便于区分的账户名称。' : 'Enter a name that identifies this account.';
    }
    if (kind === 'credential' && !hasOpenCodeCredential(account, savedAccounts.find((entry) => entry.id === accountId), accountSecrets.opencode?.[accountId], clearAccountSecrets.includes(`opencode:${accountId}`))) {
      return account.connectionType === 'api-key'
        ? (zh ? '需要粘贴该账户的 API Key。' : 'Paste this account’s API key.')
        : (zh ? '需要粘贴该账户的 Cookie。' : 'Paste this account’s Cookie.');
    }
    if (kind === 'workspace' && account.connectionType !== 'api-key' && !isValidOpenCodeWorkspaceId(account.workspaceId)) {
      return zh ? '需要填写该账户对应的 wrk_… Workspace ID。' : 'Enter the wrk_… Workspace ID for this account.';
    }
    return '';
  };
  const updateAccount = (accountId, patch) => updateProvider('opencode', {
    accounts: item.accounts.map((account) => account.id === accountId ? { ...account, ...patch } : account),
  });
  const setConnectionType = (account, connectionType) => {
    if (account.connectionType === connectionType) return;
    const credentialKey = `opencode:${account.id}`;
    updateAccount(account.id, { connectionType, hasSecret: false, credentialState: 'absent' });
    setAccountSecrets((current) => ({ ...current, opencode: { ...current.opencode, [account.id]: '' } }));
    if (credentialState(account) !== 'absent') setClearAccountSecrets((current) => current.includes(credentialKey)
      ? current : [...current, credentialKey]);
    setTouched((current) => ({ ...current, [`credential:${account.id}`]: false, [`workspace:${account.id}`]: false }));
  };
  const addOpenCodeAccount = () => {
    const id = accountIdentifier();
    enableMaster();
    updateProvider('opencode', {
      enabled: true,
      authMode: 'keychain',
      accounts: [...item.accounts, {
        id, label: '',
        connectionType: 'workspace', workspaceId: '', externalIdentifier: '', hasSecret: false, credentialState: 'absent',
        entitlementType: 'unknown', subscriptionPrice: null,
        subscriptionCurrency: 'usd', billingCycle: 'monthly', renewsAt: '',
      }],
      activeAccountId: id,
    });
    setEditorAccountId(id);
  };
  return <div className="account-provider-config">
    {!item.accounts.length ? <div className="provider-local-login"><b>{zh ? '本机 OpenCode 登录' : 'Local OpenCode login'}</b><p>{zh ? '只读查询当前本机登录的 Go 额度。切换本机登录后，额度历史按账号分开；也可添加手动账户。' : 'Read Go quotas for the current local login. Switching logins keeps quota histories separate; you can also add a manual account.'}</p><button type="button" className="provider-connect-button" aria-pressed={item.authMode === 'local'} onClick={() => { enableMaster(); updateProvider('opencode', { enabled: true, authMode: 'local', workspaceId: '' }); }}>{zh ? (item.authMode === 'local' ? '已选择本机登录' : '使用本机登录') : (item.authMode === 'local' ? 'Local login selected' : 'Use local login')}</button></div> : null}
    <div className="account-config-heading"><div><b>{zh ? 'OpenCode Go 账户' : 'OpenCode Go accounts'}</b><span>{zh ? '点账号行编辑；「额度展示」决定看板默认显示哪个账号。' : 'Click a row to edit; “displayed” decides which account the dashboard shows by default.'}</span></div><button className="provider-connect-button" type="button" onClick={addOpenCodeAccount}><span aria-hidden="true">＋</span>{zh ? '添加账户' : 'Add account'}</button></div>
    <SetupSteps key={provider.id} provider={provider} zh={zh} needsSetup={!item.accounts.length}/>
    <div className="account-row-list opencode-rows" role="radiogroup" aria-label={zh ? 'OpenCode Go 账户' : 'OpenCode Go accounts'}>{item.accounts.map((account) => <div className={`account-row${selected?.id === account.id ? ' selected' : ''}`} key={account.id}>
      <label className="opencode-session-select"><input type="radio" name="opencode-active-account" checked={(item.activeAccountId || item.accounts[0]?.id) === account.id} onChange={() => updateProvider('opencode', { activeAccountId: account.id })}/><span className="sr-only">{zh ? `额度展示账户 ${accountName(account, zh)}` : `Displayed account ${accountName(account, zh)}`}</span></label>
      <button type="button" className="account-row-main" aria-pressed={selected?.id === account.id} onClick={() => setEditorAccountId(account.id)}>
        <b>{accountName(account, zh)}</b>
        <small>{connectionModeLabel(account, zh)}{credentialState(account) === 'present' ? (zh ? ' · 凭据已保存' : ' · credential saved') : credentialState(account) === 'unchecked' && account.hasSecret ? (zh ? ' · 凭据已保存' : ' · credential saved') : ''}</small>
        <em className={`entitlement-badge entitlement-badge--${account.entitlementType || 'unknown'}`} title={entitlementLabel(account.entitlementType, zh)}>{entitlementBadge(account.entitlementType, zh)}</em>
        {selected?.id === account.id ? <ChevronRight size={13}/> : null}
      </button>
    </div>)}{!item.accounts.length ? <p>{zh ? '添加账户后，为该账户选择一种连接方式并完整填写。' : 'Add an account, choose one connection method, and complete its fields.'}</p> : null}</div>
    {selected ? <div className="opencode-account-list">
      <fieldset className="account-editor">
        <legend>{zh ? `编辑 · ${accountName(selected, zh)}` : `Edit · ${accountName(selected, zh)}`}</legend>
        <label className="opencode-account-label"><span>{zh ? '账户名称' : 'Account name'}</span><input aria-invalid={touched[`label:${selected.id}`] && fieldError(selected.id, 'label') ? 'true' : undefined} value={selected.label} onChange={(event) => updateAccount(selected.id, { label: event.target.value })} onBlur={() => setTouched((current) => ({ ...current, [`label:${selected.id}`]: true }))} placeholder={zh ? '个人 / 工作' : 'Personal / work'}/>{touched[`label:${selected.id}`] && fieldError(selected.id, 'label') ? <small className="field-error">{fieldError(selected.id, 'label')}</small> : null}</label>
        <label className="opencode-connection-type"><span>{zh ? '连接方式' : 'Connection method'}</span><select value={selected.connectionType || 'workspace'} onChange={(event) => setConnectionType(selected, event.target.value)}><option value="workspace">Cookie + Workspace</option><option value="api-key">API Key</option></select><small>{zh ? '切换方式需重新填写凭据，避免误用旧凭据。' : 'Switching methods requires a fresh credential to prevent reuse of the wrong secret.'}</small></label>
        <label className="opencode-cookie-field"><span>{selected.connectionType === 'api-key' ? 'API Key' : 'Cookie'}</span><input type="password" autoComplete="off" spellCheck="false" aria-invalid={touched[`credential:${selected.id}`] && fieldError(selected.id, 'credential') ? 'true' : undefined} value={accountSecrets.opencode?.[selected.id] || ''} onChange={(event) => setAccountSecrets((current) => ({ ...current, opencode: { ...current.opencode, [selected.id]: event.target.value } }))} onBlur={() => setTouched((current) => ({ ...current, [`credential:${selected.id}`]: true }))} placeholder={selected.hasSecret ? (zh ? '已安全保存 · 留空保持' : 'Saved securely · leave blank to keep') : credentialState(selected) === 'unchecked' ? (zh ? '尚未检测 · 留空保留原凭据' : 'Not checked · leave blank to keep existing') : selected.connectionType === 'api-key' ? 'opencode_…' : 'auth=…'}/><small className={touched[`credential:${selected.id}`] && fieldError(selected.id, 'credential') ? 'field-error' : undefined}>{fieldError(selected.id, 'credential') || (selected.connectionType === 'api-key' ? (zh ? '只发送给 OpenCode Go 官方用量接口。' : 'Sent only to the official OpenCode Go usage API.') : (zh ? '支持 Cookie 请求头或复制的 cURL。' : 'Accepts a Cookie header or copied cURL.'))}</small>{clearAccountSecrets.includes(`opencode:${selected.id}`) ? <small className="account-secret-warning">{zh ? '保存后会替换或清除原凭据' : 'The previous credential will be replaced or removed on save'}</small> : null}</label>
        {selected.connectionType !== 'api-key' ? <label className="opencode-workspace-field"><span>Workspace ID</span><input aria-invalid={touched[`workspace:${selected.id}`] && fieldError(selected.id, 'workspace') ? 'true' : undefined} value={selected.workspaceId || ''} onChange={(event) => updateAccount(selected.id, { workspaceId: event.target.value })} onBlur={() => setTouched((current) => ({ ...current, [`workspace:${selected.id}`]: true }))} placeholder="wrk_…"/><small className={touched[`workspace:${selected.id}`] && fieldError(selected.id, 'workspace') ? 'field-error' : undefined}>{fieldError(selected.id, 'workspace') || (zh ? '与上面的 Cookie 属于同一个 OpenCode Go 账户。' : 'Must belong to the same OpenCode Go account as the Cookie above.')}</small></label> : null}
        <div className="account-editor-footer">
          <EntitlementFields className="account-entitlement" item={selected} onChange={(patch) => updateAccount(selected.id, patch)} zh={zh}/>
          <RemoveAccountButton hasSavedCredential={credentialState(selected) !== 'absent'} onRemove={() => { removeConnectedAccount('opencode', selected, item, updateProvider, setClearAccountSecrets); setEditorAccountId(''); }} zh={zh}/>
        </div>
      </fieldset>
    </div> : null}
  </div>;
}

function CredentialTupleFields({ provider, value, onChange, zh }) {
  const workbuddy = provider.id === 'workbuddy';
  let tuple = {};
  try { tuple = JSON.parse(value || '{}'); } catch { if (!workbuddy) tuple = { accessToken: value }; }
  if (!tuple || typeof tuple !== 'object') tuple = {};
  const fields = workbuddy ? [['cookie', 'Cookie'], ['userAgent', 'User-Agent']]
    : [['accessToken', 'OAuth Access Token'], ['sessionCookie', zh ? '官网 Cookie（可选）' : 'Website Cookie (optional)']];
  const update = (key, content) => {
    const next = { ...tuple, [key]: content };
    onChange(fields.some(([field]) => next[field]?.trim()) ? JSON.stringify(next) : '');
  };
  return <div className="benefit-credential-tuple">{fields.map(([key, label]) => <label key={key}><span>{label}</span><input type="password" autoComplete="off" spellCheck="false" aria-label={`${provider.label} ${label}`} value={tuple[key] || ''} onChange={event => update(key, event.target.value)} disabled={!provider.supportsKeychain} placeholder={zh ? '全部留空保持已保存凭据' : 'Leave all blank to keep saved credentials'}/></label>)}<small>{zh ? '此处不回显已保存凭据。更换时请重新填写整套；仅发送到本地服务并存入钥匙串。' : 'Saved secrets are never displayed. Re-enter the whole tuple to replace it; it is sent only to the local service and stored in Keychain.'}</small></div>;
}

function KimiConnectionPanel({ provider, item, updateProvider, accountSecrets, setAccountSecrets, editorAccountId, setEditorAccountId, zh }) {
  const selected = item.accounts.find((account) => account.id === editorAccountId)
    || item.accounts.find((account) => account.id === item.activeAccountId)
    || item.accounts[0] || null;
  const updateAccount = (id, patch) => updateProvider('kimi-code', { accounts: item.accounts.map(account => account.id === id ? { ...account, ...patch } : account) });
  const clearDraftSecret = id => setAccountSecrets(current => ({ ...current, 'kimi-code': { ...current['kimi-code'], [id]: '' } }));
  const add = connectionType => {
    const id = accountIdentifier();
    const account = { id, label: '', connectionType, authMode: connectionType === 'local' ? 'local' : provider.supportsKeychain ? 'keychain' : 'environment',
      environmentVariable: '', legacyCredential: false, hasSecret: false, credentialState: 'absent',
      entitlementType: 'unknown', subscriptionPrice: null, subscriptionCurrency: 'usd', billingCycle: 'monthly', renewsAt: '' };
    updateProvider('kimi-code', { accountsInitialized: true, accounts: [...item.accounts, account], activeAccountId: item.activeAccountId || id });
    setEditorAccountId(id);
  };
  return <div className="kimi-accounts-config">
    <p>{zh ? '本机登录与每个 Kimi for Coding API Key 独立查询，不切换 CLI 登录。一个账户的多个 Key 共享额度，不是每个 Key 各有一份套餐。' : 'Query the local login and each Kimi for Coding API key independently without switching CLI accounts. Keys belonging to one account share its quota.'}</p>
    <div className="account-row-list">{item.accounts.map((account) => <div className={`account-row${selected?.id === account.id ? ' selected' : ''}`} key={account.id}>
      <button type="button" className="account-row-main" aria-pressed={selected?.id === account.id} onClick={() => setEditorAccountId(account.id)}>
        <b>{accountName(account, zh)}</b>
        <small>{connectionModeLabel(account, zh)} · {kimiConnectionStatusText(account, zh)}</small>
        <em className={`entitlement-badge entitlement-badge--${account.entitlementType || 'unknown'}`} title={entitlementLabel(account.entitlementType, zh)}>{entitlementBadge(account.entitlementType, zh)}</em>
        {selected?.id === account.id ? <ChevronRight size={13}/> : null}
      </button>
    </div>)}{!item.accounts.length ? <p>{zh ? '还没有账户。先添加一个本机登录或 API Key 账户。' : 'No accounts yet. Add a local login or an API-key account first.'}</p> : null}</div>
    <div className="kimi-account-actions"><button type="button" className="ghost-btn" disabled={item.accounts.length >= 20} onClick={() => add('api-key')}>{zh ? '+ 添加 API Key 账户' : '+ Add API-key account'}</button>{!item.accounts.some(account => account.connectionType === 'local') ? <button type="button" className="ghost-btn" disabled={item.accounts.length >= 20} onClick={() => add('local')}>{zh ? '+ 添加本机登录' : '+ Add local login'}</button> : null}</div>
    {selected ? <fieldset className="kimi-account-fields account-editor">
      <legend>{zh ? `编辑 · ${accountName(selected, zh)}` : `Edit · ${accountName(selected, zh)}`}</legend>
      <label><span>{zh ? '账户名称 / Key 标签' : 'Account name / key label'}</span><input value={selected.label} maxLength={80} onChange={event => updateAccount(selected.id, { label: event.target.value })} placeholder={zh ? '例如：个人 Pro / 工作' : 'e.g. Personal Pro / Work'}/></label>
      <label><span>{zh ? '连接方式' : 'Connection method'}</span><select value={selected.connectionType} onChange={event => { clearDraftSecret(selected.id); updateAccount(selected.id, { connectionType: event.target.value, authMode: event.target.value === 'local' ? 'local' : provider.supportsKeychain ? 'keychain' : 'environment', legacyCredential: false, hasSecret: false, credentialState: 'absent' }); }}>
        <option value="api-key">Kimi for Coding API Key</option><option value="local" disabled={item.accounts.some(other => other.id !== selected.id && other.connectionType === 'local')}>{zh ? '本机 CLI 登录' : 'Local CLI login'}</option>{selected.connectionType === 'web-token' ? <option value="web-token">{zh ? '原有网页登录令牌' : 'Existing website token'}</option> : null}
      </select></label>
      {selected.connectionType === 'local' ? <p className="kimi-account-help">{zh ? '查询时读取当前 Kimi CLI 登录；切换登录后不会沿用旧账户的额度历史。本机历史日志没有 Key 证据时，不自动归属给此账户。' : 'Reads the current Kimi CLI login at query time. Switching login isolates quota history; local logs without key evidence are not automatically assigned to this account.'}</p> : <>
        <label><span>{zh ? '凭据来源' : 'Credential source'}</span><select value={selected.authMode} onChange={event => { clearDraftSecret(selected.id); updateAccount(selected.id, { authMode: event.target.value }); }}><option value="keychain" disabled={!provider.supportsKeychain}>{zh ? '安全保存到钥匙串' : 'Save to Keychain'}</option><option value="environment">{zh ? '环境变量' : 'Environment variable'}</option></select></label>
        {selected.authMode === 'environment' ? <label><span>{zh ? '此账户的环境变量名' : 'Environment variable for this account'}</span><input value={selected.environmentVariable} placeholder="KIMI_CODE_WORK_KEY" onChange={event => updateAccount(selected.id, { environmentVariable: event.target.value })}/></label> : <label><span>{selected.connectionType === 'api-key' ? 'API Key' : (zh ? '网页登录令牌' : 'Website token')}</span><input type="password" autoComplete="off" spellCheck="false" value={accountSecrets['kimi-code']?.[selected.id] || ''} onChange={event => setAccountSecrets(current => ({ ...current, 'kimi-code': { ...current['kimi-code'], [selected.id]: event.target.value } }))} placeholder={selected.hasSecret === false ? 'sk-kimi-…' : zh ? '留空保留已保存凭据' : 'Leave blank to keep saved credential'}/></label>}
        <p className="kimi-account-help">{zh ? '使用 Kimi Code 控制台创建的 Key，不是 Moonshot 开放平台 Key。保存后不回显，也不进入本机用量、导出或社区同步。' : 'Use a key created in the Kimi Code console, not a Moonshot platform key. Saved secrets are never returned or included in usage records, exports, or community sync.'}</p>
      </>}
      <div className="account-editor-footer">
        <EntitlementFields className="kimi-account-entitlement" item={selected} onChange={patch => updateAccount(selected.id, patch)} zh={zh}/>
        <RemoveAccountButton hasSavedCredential={selected.authMode === 'keychain' && credentialState(selected) !== 'absent'} onRemove={() => { clearDraftSecret(selected.id); const accounts = item.accounts.filter(other => other.id !== selected.id); updateProvider('kimi-code', { accountsInitialized: true, accounts, activeAccountId: item.activeAccountId === selected.id ? accounts[0]?.id || '' : item.activeAccountId }); setEditorAccountId(''); }} zh={zh}/>
      </div>
    </fieldset> : null}
    <p>{zh ? '新套餐可能只有 5 小时和月度窗口；只展示官方返回的数据，不补造周额度。无法确认两个连接属于同一账户时，请勿把它们当成独立套餐相加。' : 'New plans may expose only 5-hour and monthly windows. Missing weekly quotas are not invented. Connections without verified identity must not be assumed to be separate plans.'}</p>
  </div>;
}

function StandardProviderConfig({
  provider, item, updateProvider, secrets, setSecrets, clearSecrets, setClearSecrets, zh,
}) {
  const selectedSite = provider.sites?.[item.site];
  provider = { ...provider, dashboardUrl: selectedSite?.dashboardUrl || provider.dashboardUrl,
    hasSecret: provider.siteSecrets ? provider.siteSecrets[item.site] : provider.hasSecret,
    credentialState: provider.siteCredentialStates?.[item.site] ?? credentialState(provider) };
  const secretPlaceholder = provider.sites && provider.id !== 'alibaba-coding'
    ? (zh ? '粘贴此地区的套餐 API Key' : 'Paste this region’s plan API key')
    : (zh ? '粘贴 Cookie、Token 或 cURL 片段' : 'Paste cookie, token, or cURL snippet');
  const changeSite = (site) => {
    updateProvider(provider.id, regionalProviderPatch(provider, item, site));
    // A draft pasted for one region must not be saved under another region.
    setSecrets(current => ({ ...current, [provider.id]: '' }));
    setClearSecrets(current => current.filter(id => id !== provider.id));
  };
  const needsSetup = !['detected', 'configured'].includes(provider.detection?.state);
  return <>
    <p>{provider.localHint}</p>
    {provider.sites ? <label className="provider-region-field"><span>{zh ? '套餐地区' : 'Plan region'}</span><select value={item.site} onChange={event => changeSite(event.target.value)}>{Object.entries(provider.sites).map(([site, value]) => <option value={site} key={site}>{value.host} · {site === 'china' ? (zh ? '中国站' : 'China') : (zh ? '国际站' : 'International')}</option>)}</select><small>{zh ? '各地区凭据独立保存，不会跨地区重试；切换地区会清空尚未保存的凭据输入。' : 'Credentials are stored separately by region, with no cross-region retries. Switching clears unsaved credential input.'}</small></label> : null}
    {provider.authModes.length > 1 ? <div className="provider-auth-modes" role="radiogroup" aria-label={zh ? '凭据来源' : 'Credential source'}>{provider.authModes.map((mode) => <button type="button" role="radio" aria-checked={item.authMode === mode} className={item.authMode === mode ? 'active' : ''} onClick={() => updateProvider(provider.id, { authMode: mode })} disabled={mode === 'keychain' && !provider.supportsKeychain} key={mode}>{item.authMode === mode ? <Check size={11}/> : null}{authLabel(mode, zh)}</button>)}</div> : null}
    <SetupSteps key={`${provider.id}:${needsSetup}`} provider={provider} zh={zh} needsSetup={needsSetup}/>
    <div className="provider-auth-fields">
      {item.authMode === 'environment' ? <label><span>{zh ? '环境变量名（凭据内容不要填在这里）' : 'Environment variable name—not the secret itself'}</span><input value={item.environmentVariable} onChange={(event) => updateProvider(provider.id, { environmentVariable: event.target.value })} placeholder={provider.defaultEnvironmentVariable || 'TOKEN'}/><small>{zh ? `在启动看板前设置 ${item.environmentVariable || provider.defaultEnvironmentVariable}，保存后会自动验证。` : 'Set this variable before starting the dashboard; saving will verify it.'}</small></label> : null}
      {item.authMode === 'keychain' ? <div className="benefit-credential-field">{['workbuddy', 'claude-code'].includes(provider.id) ? <CredentialTupleFields provider={provider} value={secrets[provider.id] || ''} onChange={value => setSecrets(current => ({ ...current, [provider.id]: value }))} zh={zh}/> : <label><span>{secretLabel(provider, zh)}</span><input type="password" autoComplete="off" spellCheck="false" value={secrets[provider.id] || ''} onChange={(event) => setSecrets((current) => ({ ...current, [provider.id]: event.target.value }))} placeholder={provider.hasSecret ? (zh ? '已安全保存 · 留空保持不变' : 'Saved securely · leave blank to keep') : credentialState(provider) === 'unchecked' ? (zh ? '尚未检测 · 留空保留原凭据' : 'Not checked · leave blank to keep existing') : secretPlaceholder} disabled={!provider.supportsKeychain}/><small>{zh ? '只会提交给 127.0.0.1 本地服务，并保存到系统钥匙串。' : 'Sent only to the local 127.0.0.1 service and stored in Keychain.'}</small></label>}{provider.supportsKeychain && credentialState(provider) !== 'absent' ? <button type="button" onClick={() => setClearSecrets((current) => current.includes(provider.id) ? current.filter((id) => id !== provider.id) : [...current, provider.id])}>{clearSecrets.includes(provider.id) ? (zh ? '撤销清除' : 'Keep secret') : (zh ? '清除本机凭据（如有）' : 'Clear local secret if saved')}</button> : null}</div> : null}
      {provider.extraFields?.includes('workspaceId') ? <label><span>{zh ? 'Workspace ID 或账单页链接（可选）' : 'Workspace ID or billing URL (optional)'}</span><input value={item.workspaceId} onChange={(event) => updateProvider(provider.id, { workspaceId: event.target.value })} placeholder="https://opencode.ai/workspace/wrk_…/billing"/></label> : null}
      {!provider.sites && provider.extraFields?.includes('site') ? <label><span>{zh ? 'Qoder 站点' : 'Qoder site'}</span><select value={item.site} onChange={(event) => updateProvider(provider.id, { site: event.target.value })}><option value="international">qoder.com · {zh ? '国际站' : 'International'}</option><option value="china">qoder.com.cn · {zh ? '中国站' : 'China'}</option></select></label> : null}
      {provider.extraFields?.includes('customPath') ? <label><span>{zh ? 'IDE 配置目录（通常留空）' : 'IDE config directory (usually blank)'}</span><input value={item.customPath} onChange={(event) => updateProvider(provider.id, { customPath: event.target.value })} placeholder="~/Library/Application Support/JetBrains/WebStorm2026.2"/></label> : null}
    </div>
    {provider.dashboardUrl ? <a className="provider-dashboard-link" href={provider.dashboardUrl} target="_blank" rel="noreferrer">{zh ? `打开 ${provider.label} 用量页` : `Open ${provider.label} usage`}<ExternalLink size={11}/></a> : null}
  </>;
}

/* 权益标注(20260816):随平台/账户走——选择器与付费字段就在详情面板的
   「标注」分组里;说明文字就近精简 */
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

function OrderEditor({ draft, orderedEnabled, draggingId, dragOverId, setDraggingId, setDragOverId, reorderProvider, finishDrag, setDraft, zh }) {
  return <section className="limit-provider-order provider-detail-order">
    <header><div><b>{zh ? '额度显示顺序' : 'Quota display order'}</b><span>{zh ? '拖动右侧手柄即可排序；触屏也可拖动，方向键同样可用，结果保存在本机。' : 'Drag the handle to reorder. Touch and arrow keys work too; the result stays on this device.'}</span></div><small>{zh ? `${orderedEnabled.length} 个已启用平台` : `${orderedEnabled.length} enabled`}</small></header>
    {orderedEnabled.length ? <ol onMouseMove={(event) => { if (!draggingId) return; const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-provider-order-id]')?.dataset.providerOrderId; if (!target || target === draggingId) return; setDragOverId(target); reorderProvider(draggingId, target); }} onMouseUp={finishDrag}>{orderedEnabled.map((provider, index) => <li key={provider.id} data-provider-order-id={provider.id} className={`${draggingId === provider.id ? 'dragging' : ''} ${dragOverId === provider.id && draggingId !== provider.id ? 'drag-over' : ''}`}>
      <span className="provider-order-index">{String(index + 1).padStart(2, '0')}</span>
      <span className="provider-order-label"><ProviderIcon id={provider.id} size={15}/><b>{provider.label}</b></span>
      <button type="button" className="provider-order-handle" onMouseDown={() => { setDraggingId(provider.id); setDragOverId(provider.id); }} onPointerDown={(event) => { if (event.button !== 0 && event.button !== -1) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDraggingId(provider.id); setDragOverId(provider.id); }} onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-provider-order-id]')?.dataset.providerOrderId; if (!target || target === provider.id) return; setDragOverId(target); reorderProvider(provider.id, target); }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); finishDrag(); }} onPointerCancel={finishDrag} onKeyDown={(event) => { const direction = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : 0; if (!direction) return; event.preventDefault(); setDraft((current) => moveEnabledProvider(current, provider.id, direction)); }} aria-label={zh ? `拖动调整 ${provider.label}；也可按方向键移动` : `Drag to reorder ${provider.label}; arrow keys also work`} title={zh ? '拖动排序' : 'Drag to reorder'}><GripVertical size={16}/></button>
    </li>)}</ol> : <p>{zh ? '启用至少一个平台后即可调整顺序。' : 'Enable a provider to arrange its position.'}</p>}
    <p className="provider-order-note">{zh ? '顺序用于权益中心与用量中心的额度卡片排列。' : 'This order arranges quota cards across the benefit and usage centers.'}</p>
  </section>;
}

/* 初始选中:优先已启用的第一个平台,否则按显示顺序取第一个;
   SSR 首帧也要渲染出详情面板,所以 useState 用惰性初始化 */
function initialSelection(settings) {
  const order = settings?.providerOrder || [];
  const enabled = order.find((id) => settings?.providers?.[id]?.enabled);
  return enabled || order[0] || settings?.catalog?.[0]?.id || '';
}

export function LimitSettingsDialog({ open, settings, onClose, onSave, onCopilotDeviceAction, onDetect, detecting, detectionError, saving, zh }) {
  const dialogRef = useRef(null);
  const detailRef = useRef(null);
  const [draftState, dispatch] = useReducer(limitSettingsReducer, settings, createLimitSettingsState);
  // Include incoming account/detection changes even before the receive effect runs.
  const form = draftState.base === settings ? draftState : limitSettingsReducer(draftState, { type: 'receive', settings });
  const { draft, secrets, clearSecrets, accountSecrets, clearAccountSecrets } = form;
  const setDraft = value => dispatch({ type: 'edit', field: 'draft', value });
  const setSecrets = value => dispatch({ type: 'edit', field: 'secrets', value });
  const setClearSecrets = value => dispatch({ type: 'edit', field: 'clearSecrets', value });
  const setAccountSecrets = value => dispatch({ type: 'edit', field: 'accountSecrets', value });
  const setClearAccountSecrets = value => dispatch({ type: 'edit', field: 'clearAccountSecrets', value });
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('info');
  const [validationErrors, setValidationErrors] = useState([]);
  const [view, setView] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(() => initialSelection(settings));
  const [editorAccountId, setEditorAccountId] = useState('');
  const [draggingId, setDraggingId] = useState('');
  const [dragOverId, setDragOverId] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [mobileNavigation, setMobileNavigation] = useState(false);
  const [copilotAuthorization, setCopilotAuthorization] = useState('idle');
  const [copilotStatusCheck, setCopilotStatusCheck] = useState(0);
  const wasOpen = useRef(false);
  const copilotAction = useCallback(async action => {
    setCopilotAuthorization('checking');
    try {
      const next = await onCopilotDeviceAction(action);
      setCopilotAuthorization(next.status === 'pending' ? 'pending' : 'idle');
      return next;
    } catch (error) {
      // A failed follow-up read is not proof that authorization failed to save.
      // Block a stale save until status + settings can be confirmed again.
      setCopilotAuthorization('unknown');
      if (error?.code === 'account_settings_unconfirmed') throw new Error(zh
        ? '尚未确认已连接账户的设置，请检查授权状态后再保存。'
        : 'The connected account settings are unconfirmed. Check authorization before saving.');
      throw error;
    }
  }, [onCopilotDeviceAction, zh]);
  const handleCopilotConnected = useCallback(() => {
    setMessageTone('success');
    setMessage(zh ? 'GitHub 账户已连接，账户列表已更新。' : 'GitHub account connected and the account list updated.');
  }, [zh]);
  useEffect(() => {
    dispatch({ type: open && wasOpen.current ? 'receive' : 'reset', settings });
    wasOpen.current = open;
  }, [open, settings]);
  // Navigation resets on open; server updates rebase edits without resetting it.
  useEffect(() => {
    if (!open) return;
    setMessage('');
    setValidationErrors([]);
    setView('all');
    setQuery('');
    setDraggingId('');
    setDragOverId('');
    setConfirmDiscard(false);
    setEditorAccountId('');
    setMobileNavigation(false);
    setSelectedId(copilotAuthorization !== 'idle' ? 'copilot' : initialSelection(settings));
  }, [open]);
  /* dirty 守卫(20260816):草稿偏离已保存设置(或新输入过凭据)时,
     关闭动作先出确认条,再放弃;提交成功照常直接关闭 */
  const dirty = isLimitSettingsDirty(form);
  const closeStateRef = useRef({ dirty: false, confirmDiscard: false });
  closeStateRef.current = { dirty, confirmDiscard, saving };
  const requestClose = () => {
    const current = closeStateRef.current;
    if (current.saving) return;
    if (current.dirty && !current.confirmDiscard) { setConfirmDiscard(true); return; }
    onClose();
  };
  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const focusable = () => [...(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') || [])]
      .filter(element => element.getClientRects().length > 0 && !element.closest('[inert]'));
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
    if (saving || copilotAuthorization !== 'idle') return;
    setMessage('');
    setMessageTone('info');
    setValidationErrors([]);
    try {
      const kimi = draft.providers['kimi-code'];
      if (kimi?.enabled && !kimi.accounts.length) throw new Error(zh ? '请至少添加一个 Kimi 账户。' : 'Add at least one Kimi account.');
      for (const account of kimi?.accounts || []) {
        const saved = settings.providers['kimi-code'].accounts.find(value => value.id === account.id);
        const unchanged = saved?.connectionType === account.connectionType && saved?.authMode === account.authMode && saved?.legacyCredential === account.legacyCredential;
        if (!account.label.trim() || (account.authMode === 'environment' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(account.environmentVariable))
          || (account.authMode === 'keychain' && !accountSecrets['kimi-code']?.[account.id]?.trim() && (!unchanged || saved.hasSecret === false))) {
          throw new Error(zh ? '请为每个 Kimi 账户填写名称及对应凭据；新增或切换连接方式后需要重新填写。' : 'Complete each Kimi account name and its credential. New or changed connections require a fresh credential.');
        }
      }
      const openCode = draft.providers.opencode;
      if (openCode.enabled && openCode.authMode !== 'local' && !openCode.accounts.length) throw new Error(zh
        ? 'OpenCode Go 已启用，请先添加至少一个账户。'
        : 'OpenCode Go is enabled. Add at least one account.');
      const incompleteOpenCode = openCode.accounts.filter((account) => (
        !account.label.trim()
        || (account.connectionType !== 'api-key' && !isValidOpenCodeWorkspaceId(account.workspaceId))
        || !hasOpenCodeCredential(account, settings.providers.opencode.accounts.find((entry) => entry.id === account.id), accountSecrets.opencode?.[account.id], clearAccountSecrets.includes(`opencode:${account.id}`))
      ));
      if (incompleteOpenCode.length) throw new Error(zh
        ? 'OpenCode Go 每个账户都需要名称，并完整配置 API Key 或 Cookie + 有效的 wrk_… Workspace ID。'
        : 'Every OpenCode Go account needs a name and either an API key or Cookie + a valid wrk_… Workspace ID.');
      const result = await onSave({
        settings: draft, secrets, clearSecrets, accountSecrets, clearAccountSecrets,
      }, {
        onSaved: savedSettings => {
          dispatch({ type: 'saved', settings: savedSettings, submitted: form });
          setConfirmDiscard(false);
        },
      });
      const failures = quotaSaveFailures(result);
      if (closeAfterSave) { onClose(); return; }
      setValidationErrors(failures);
      setMessageTone(failures.length ? 'warning' : 'success');
      if (failures.length) {
        setMessage(zh
          ? `设置已保存，但 ${failures.map((provider) => provider.label).join('、')} 仍需处理。请按下方提示修正后重试。`
          : `Saved, but ${failures.map((provider) => provider.label).join(', ')} still need attention.`);
        const firstFailure = failures[0];
        setSelectedId(firstFailure.id);
        setEditorAccountId(firstFailure.accountId || '');
        if (detailRef.current) detailRef.current.scrollTop = 0;
      } else if (!result) {
        setMessageTone('warning');
        setMessage(zh ? '设置已保存，但额度刷新失败，请稍后重试。' : 'Settings saved, but quotas could not be refreshed. Try again shortly.');
      } else setMessage(zh ? '设置已保存，额度已刷新。' : 'Settings saved and quotas refreshed.');
    }
    catch (reason) {
      setMessageTone('error');
      const reasonText = reason?.message || String(reason);
      setMessage(zh || !/\p{Script=Han}/u.test(reasonText)
        ? reasonText
        : 'Could not save settings. Check the fields below and try again.');
    }
  };
  const catalog = draft.catalog.map((provider) => quotaProviderCatalogCopy(provider, zh));
  const catalogById = new Map(catalog.map((provider) => [provider.id, provider]));
  const detectionChecked = catalog.some((provider) => provider.detection?.state && provider.detection.state !== 'unchecked');
  const ready = catalog.filter((provider) => ['detected', 'configured'].includes(provider.detection?.state));
  const enabledCount = Object.values(draft.providers).filter((provider) => provider.enabled).length;
  const settingsTabs = [
    ['detected', zh ? '已检测' : 'Detected'],
    ['all', zh ? '全部平台' : 'All platforms'],
  ];
  const visible = catalog.filter((provider) => {
    const matches = !query || `${provider.label} ${provider.description}`.toLowerCase().includes(query.toLowerCase());
    if (!matches) return false;
    if (view === 'detected') return ['detected', 'configured'].includes(provider.detection?.state) || draft.providers[provider.id]?.enabled;
    return true;
  }).sort((a, b) => (draft.providers[b.id]?.enabled ? 1 : 0) - (draft.providers[a.id]?.enabled ? 1 : 0));
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
  const selectProvider = (id) => {
    setSelectedId(id);
    setMobileNavigation(false);
    if (id !== ORDER_NAV_ID) setEditorAccountId('');
    if (detailRef.current) detailRef.current.scrollTop = 0;
  };
  const enableProvider = (provider, item, enabled) => {
    const patch = { enabled };
    if (enabled && provider.quotaSupport === 'manual' && provider.supportsKeychain) patch.authMode = 'keychain';
    if (enabled && provider.id === 'opencode' && item.authMode !== 'local' && !item.accounts.length) {
      const id = accountIdentifier();
      patch.accounts = [{
        id, label: '',
        connectionType: 'workspace', workspaceId: '', externalIdentifier: '', hasSecret: false, credentialState: 'absent',
        entitlementType: 'unknown', subscriptionPrice: null,
        subscriptionCurrency: 'usd', billingCycle: 'monthly', renewsAt: '',
      }];
      patch.activeAccountId = id;
    }
    updateProvider(provider.id, patch);
    if (enabled) {
      setDraft((current) => ({ ...current, enabled: true }));
      setSelectedId(provider.id);
    }
  };
  const selectedProvider = selectedId === ORDER_NAV_ID ? null : catalogById.get(selectedId) || null;
  const selectedDetail = (() => {
    if (selectedId === ORDER_NAV_ID) return <OrderEditor draft={draft} orderedEnabled={orderedEnabled} draggingId={draggingId} dragOverId={dragOverId} setDraggingId={setDraggingId} setDragOverId={setDragOverId} reorderProvider={reorderProvider} finishDrag={finishDrag} setDraft={setDraft} zh={zh}/>;
    if (!selectedProvider) return <div className="provider-detail-empty"><KeyRound size={20}/><p>{zh ? '在左侧选择一个平台，连接账号并标注权益。' : 'Pick a platform on the left to connect an account and tag its benefit.'}</p></div>;
    const provider = selectedProvider;
    const item = draft.providers[provider.id];
    const localized = { ...provider, detection: regionalDraftDetection(provider, item, settings.providers[provider.id], zh) };
    const unavailable = provider.quotaSupport === 'unavailable';
    const isMultiAccount = ['kimi-code', 'opencode', 'copilot'].includes(provider.id);
    const entitlementItem = ['opencode', 'kimi-code'].includes(provider.id)
      ? item.accounts.find((account) => account.id === item.activeAccountId) || item.accounts[0] || item
      : item;
    const needsSetup = !['detected', 'configured'].includes(localized.detection?.state) && !item.enabled;
    return <article className={`provider-detail${item.enabled ? ' enabled' : ''}${unavailable ? ' unavailable' : ''}`}>
      <div className="provider-detail-head">
        <ProviderIcon id={provider.id}/>
        <div className="provider-detail-title">
          <b>{provider.label}{provider.popular ? <em>{zh ? '热门' : 'Popular'}</em> : null}{item.enabled ? <em className={`entitlement-badge entitlement-badge--${entitlementItem.entitlementType || 'unknown'}`} title={entitlementLabel(entitlementItem.entitlementType, zh)}>{entitlementBadge(entitlementItem.entitlementType, zh)}</em> : null}</b>
          <small>{provider.description}</small>
        </div>
        <Toggle checked={item.enabled} onChange={(enabled) => enableProvider(provider, item, enabled)} label={zh ? `启用 ${provider.label}` : `Enable ${provider.label}`} disabled={unavailable}/>
      </div>
      {unavailable ? <div className="provider-unavailable-copy"><p>{localized.localHint}</p>{provider.dashboardUrl ? <a href={provider.dashboardUrl} target="_blank" rel="noreferrer">{zh ? '打开官方页面' : 'Open official site'}<ExternalLink size={11}/></a> : null}</div> : <>
        <div className={`provider-detection ${detectionClass(localized.detection?.state)}`}>{['detected', 'configured'].includes(localized.detection?.state) ? <Check size={12}/> : <CircleAlert size={12}/>}<span>{localized.detection?.label}</span>{localized.detection?.detail ? <small>{localized.detection.detail}</small> : null}</div>
        {isMultiAccount ? null : <section className="detail-group">
          <h3 className="detail-group-title">{zh ? '连接' : 'Connection'}</h3>
          <StandardProviderConfig provider={localized} item={item} updateProvider={updateProvider} secrets={secrets} setSecrets={setSecrets} clearSecrets={clearSecrets} setClearSecrets={setClearSecrets} zh={zh}/>
        </section>}
        {provider.id === 'kimi-code' ? <section className="detail-group"><h3 className="detail-group-title">{zh ? '账号' : 'Accounts'}</h3><KimiConnectionPanel provider={provider} item={item} updateProvider={updateProvider} accountSecrets={accountSecrets} setAccountSecrets={setAccountSecrets} editorAccountId={editorAccountId} setEditorAccountId={setEditorAccountId} zh={zh}/></section> : null}
        {provider.id === 'opencode' ? <section className="detail-group"><h3 className="detail-group-title">{zh ? '账号' : 'Accounts'}</h3><OpenCodeGoConnectionPanel item={item} provider={provider} savedAccounts={settings.providers.opencode.accounts} updateProvider={updateProvider} accountSecrets={accountSecrets} setAccountSecrets={setAccountSecrets} clearAccountSecrets={clearAccountSecrets} setClearAccountSecrets={setClearAccountSecrets} enableMaster={() => setDraft((current) => ({ ...current, enabled: true }))} editorAccountId={editorAccountId} setEditorAccountId={setEditorAccountId} zh={zh}/></section> : null}
        {provider.id === 'copilot' ? <section className="detail-group"><h3 className="detail-group-title">{zh ? '账号' : 'Accounts'}</h3><CopilotConnectionPanel item={item} updateProvider={updateProvider} setClearAccountSecrets={setClearAccountSecrets} enableMaster={() => setDraft((current) => ({ ...current, enabled: true }))} onCopilotDeviceAction={onCopilotDeviceAction ? copilotAction : undefined} onCopilotConnected={handleCopilotConnected} statusCheck={copilotStatusCheck} zh={zh}/></section> : null}
        {item.enabled && provider.id !== 'opencode' && provider.id !== 'kimi-code' ? <section className="detail-group"><h3 className="detail-group-title">{zh ? '权益标注（可选）' : 'Benefit tag (optional)'}</h3><p className="detail-group-hint">{zh ? '标注决定这项权益是否计入个人支出与续费分析。' : 'Tags decide whether this benefit enters personal spend and renewal analysis.'}</p><EntitlementBlock provider={provider} item={item} updateProvider={updateProvider} zh={zh}/></section> : null}
        {needsSetup && !isMultiAccount && !unavailable ? <p className="provider-setup-hint">{zh ? '按上方步骤连接后保存，本工具会先验证凭据再读取额度。' : 'Follow the steps above and save; the credential is verified before quotas are read.'}</p> : null}
      </>}
    </article>;
  })();
  return <div className="dialog-layer" role="presentation"><section ref={dialogRef} className="dialog dialog--limit-settings" role="dialog" aria-modal="true" aria-label={zh ? '账户权益与额度设置' : 'Account benefit and quota settings'}><header><div><h2>{zh ? '连接并标注账户权益' : 'Connect and classify account benefits'}</h2><p>{zh ? '选择平台 → 连接账号 → 保存验证额度；额度读取失败不影响本机 Token 分析。' : 'Pick a platform, connect an account, then save to verify quotas. Quota failures never block local Token analytics.'}</p></div><button autoFocus className="icon-btn" type="button" onClick={requestClose} aria-label={zh ? '关闭账户权益设置' : 'Close account benefit settings'}><X size={18}/></button></header>
    <div className="limit-settings-layout" inert={saving || undefined} aria-busy={saving}>
      <div className="limit-settings-nav" data-mobile-expanded={mobileNavigation}>
        <button className="limit-mobile-navigation" type="button" aria-expanded={mobileNavigation} aria-controls="limit-settings-navigation" onClick={() => setMobileNavigation(current => !current)}>
          <span>{selectedProvider?.label || (zh ? '额度显示顺序' : 'Quota display order')}</span><small>{mobileNavigation ? (zh ? '收起' : 'Collapse') : (zh ? '切换 / 管理' : 'Switch / manage')}</small><ChevronDown size={14}/>
        </button>
        <div className="limit-navigation-controls" id="limit-settings-navigation">
        <div className="limit-nav-tools">
          <div className="limit-nav-detect">
            <button type="button" onClick={onDetect} disabled={detecting || dirty}>{zh ? (detecting ? '检测中…' : '检测本机登录') : (detecting ? 'Detecting…' : 'Detect local logins')}</button>
            <span>{detectionError ? <b className="limit-nav-detect-error" role="alert">{detectionError}</b> : (detectionChecked
              ? (zh ? `检测到 ${ready.length} 个平台` : `${localizedCount(ready.length, false, '', 'provider', 'providers')} detected`)
              : (zh ? '点击检测本机已有登录' : 'Check existing local logins'))}</span>
          </div>
          <button type="button" className="limit-nav-enable" onClick={enableDetected} disabled={!ready.length}><Check size={12}/>{zh ? '一键启用已检测' : 'Enable detected'}</button>
          <div className="limit-master-inline"><span>{zh ? `${enabledCount} 个已选择` : `${enabledCount} selected`}</span><Toggle checked={draft.enabled} onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))} label={draft.enabled ? (zh ? '总开关已开启' : 'Master on') : (zh ? '总开关已关闭' : 'Master off')}/></div>
        </div>
        <div className="limit-provider-toolbar"><div role="tablist" aria-orientation="horizontal" aria-label={zh ? '筛选账户平台' : 'Filter account providers'}>{settingsTabs.map(([id, label], index) => <button type="button" role="tab" id={settingsProviderTabId(id)} aria-controls={SETTINGS_PROVIDER_PANEL_ID} aria-selected={view === id} tabIndex={view === id ? 0 : -1} className={view === id ? 'active' : ''} onClick={() => setView(id)} onKeyDown={(event) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? settingsTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + settingsTabs.length) % settingsTabs.length; setView(settingsTabs[nextIndex][0]); event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[nextIndex]?.focus(); }} key={id}>{label}</button>)}</div><label><Search size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '搜索平台' : 'Search providers'}/></label></div>
        <div className="limit-nav-list" id={SETTINGS_PROVIDER_PANEL_ID} role="tabpanel" aria-labelledby={settingsProviderTabId(view)} tabIndex={0}>{visible.map((provider) => {
          const item = draft.providers[provider.id];
          const localized = { ...provider, detection: regionalDraftDetection(provider, item, settings.providers[provider.id], zh) };
          const isSelected = selectedId === provider.id;
          const unavailable = provider.quotaSupport === 'unavailable';
          const entitlementItem = ['opencode', 'kimi-code'].includes(provider.id)
            ? item.accounts.find((account) => account.id === item.activeAccountId) || item.accounts[0] || item
            : item;
          return <div className={`limit-nav-row${isSelected ? ' selected' : ''}${item.enabled ? ' enabled' : ''}${unavailable ? ' unavailable' : ''}`} key={provider.id}>
            <button type="button" className="limit-nav-row-main" id={`limit-account-provider-${provider.id}`} aria-current={isSelected ? 'true' : undefined} onClick={() => selectProvider(provider.id)}>
              <ProviderIcon id={provider.id} size={16}/>
              <span className="limit-nav-row-copy"><b>{provider.label}{provider.popular ? <em>{zh ? '热门' : 'Popular'}</em> : null}</b><small>{shortStatus(localized, item, zh)}</small></span>
              {item.enabled ? <em className={`entitlement-badge entitlement-badge--${entitlementItem.entitlementType || 'unknown'}`} title={entitlementLabel(entitlementItem.entitlementType, zh)}>{entitlementBadge(entitlementItem.entitlementType, zh)}</em> : null}
            </button>
            <Toggle checked={item.enabled} onChange={(enabled) => enableProvider(provider, item, enabled)} label={zh ? `启用 ${provider.label}` : `Enable ${provider.label}`} disabled={unavailable}/>
          </div>;
        })}{!visible.length ? <p className="limit-nav-empty">{zh ? '没有匹配的平台，换个关键词试试。' : 'No providers match; try another search.'}</p> : null}</div>
        <button type="button" className={`limit-nav-order-entry${selectedId === ORDER_NAV_ID ? ' selected' : ''}`} aria-current={selectedId === ORDER_NAV_ID ? 'true' : undefined} onClick={() => selectProvider(ORDER_NAV_ID)}>
          <GripVertical size={14}/>
          <span className="limit-nav-row-copy"><b>{zh ? '额度显示顺序' : 'Quota display order'}</b><small>{zh ? `${orderedEnabled.length} 个已启用平台` : `${orderedEnabled.length} enabled`}</small></span>
          <ChevronRight size={13}/>
        </button>
        </div>
      </div>
      <div className="limit-settings-detail" ref={detailRef}>
        {selectedDetail}
        <details className="limit-security-note">
          <summary><ShieldCheck size={15}/><b>{zh ? '敏感信息边界' : 'Sensitive-data boundary'}</b><ChevronDown size={14}/></summary>
          <p>{zh ? '浏览器只提交你主动输入的凭据一次；服务端把手动凭据交给 macOS 钥匙串，普通 config.json 只保存开关、来源和变量名。接口响应永远不包含 Token 或 Cookie，只显示不暴露主目录的来源提示。' : 'The browser submits manually entered secrets once. The local server stores them in macOS Keychain; config.json keeps only toggles, source modes, and variable names. Responses never contain tokens or cookies and show only home-redacted source hints.'}</p>
        </details>
        <div className="limit-sticky-alerts">
          {copilotAuthorization !== 'idle' ? <div className="limit-authorization-status" role="status"><span>{copilotAuthorization === 'unknown' ? (zh ? '尚未确认 GitHub 授权结果，确认前不能保存设置。' : 'GitHub authorization is unconfirmed. Check its status before saving.') : (zh ? 'GitHub 授权进行中，完成后即可保存设置。' : 'GitHub authorization is in progress. Save settings after it completes.')}</span><button type="button" disabled={copilotAuthorization === 'checking'} onClick={() => { selectProvider('copilot'); setCopilotAuthorization('checking'); setCopilotStatusCheck(current => current + 1); }}>{zh ? '检查授权' : 'Check authorization'}</button></div> : null}
          {validationErrors.length ? <div className="provider-validation-errors" role="alert">{validationErrors.map((provider) => <div key={`${provider.id}:${provider.accountId || ''}`}><CircleAlert size={14}/><span><b>{provider.label}</b><small>{quotaErrorMessage(provider, zh)}</small></span><button type="button" onClick={() => { setSelectedId(provider.id); setEditorAccountId(provider.accountId || ''); if (detailRef.current) detailRef.current.scrollTop = 0; }}>{zh ? '去修复' : 'Fix'}</button></div>)}</div> : null}
          {message ? <p className={`limit-save-message limit-save-message--${messageTone}`} role={messageTone === 'error' || messageTone === 'warning' ? 'alert' : 'status'}>{message}</p> : null}
        </div>
      </div>
    </div>
    {confirmDiscard ? <div className="dialog-dirty-bar" role="alertdialog" aria-label={zh ? '未保存的更改' : 'Unsaved changes'}>
      <span>{zh ? '有未保存的更改' : 'You have unsaved changes'}</span>
      <span className="dialog-dirty-actions">
        <button type="button" autoFocus onClick={() => setConfirmDiscard(false)}>{zh ? '继续编辑' : 'Keep editing'}</button>
        <button type="button" className="danger" disabled={saving} onClick={onClose}>{zh ? '放弃并关闭' : 'Discard & close'}</button>
      </span>
    </div> : null}
    <footer className="dialog-actions"><button type="button" className="ghost-btn limit-cancel-action" disabled={saving} onClick={requestClose}>{zh ? '取消' : 'Cancel'}</button><button type="button" className="ghost-btn limit-refresh-action" onClick={() => submit()} disabled={saving || copilotAuthorization !== 'idle'}>{saving ? <RefreshCw className="spin" size={14}/> : <RefreshCw size={14}/>} {zh ? '保存并刷新额度' : 'Save & refresh quotas'}</button><button type="button" className="primary-btn limit-close-action" onClick={() => submit({ closeAfterSave: true })} disabled={saving || copilotAuthorization !== 'idle'}>{saving ? <RefreshCw className="spin" size={14}/> : <KeyRound size={14}/>} {zh ? '保存并关闭' : 'Save & close'}</button></footer>
  </section></div>;
}
