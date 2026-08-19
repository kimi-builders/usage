import { useEffect, useState } from 'react';
import {
  AlertTriangle, Check, CircleCheck, Cloud, CloudUpload, Copy, ExternalLink, LoaderCircle, LogOut, Monitor,
  RefreshCw, ShieldCheck, TimerReset, Trash2, Unplug,
} from 'lucide-react';
import { Dialog } from './Dialog.jsx';
import { SourceModeRows, policiesFromSources } from './DataSourceControls.jsx';
import { DeviceAuthorizationCard } from './DeviceAuthorizationCard.jsx';
import { buildSyncOutcome, formatSyncDuration } from './sync-feedback.js';

const PACKAGE = '@kimi.builders/usage';
const INTERVALS = [5, 15, 30, 60];

async function copyText(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Some embedded browsers expose Clipboard but deny it; use the user-gesture fallback.
  }
  const input = document.createElement('textarea');
  input.value = value; input.style.position = 'fixed'; input.style.opacity = '0';
  document.body.appendChild(input); input.select();
  const copied = document.execCommand('copy'); input.remove();
  if (!copied) throw new Error('Copy is unavailable in this browser.');
}

function CommandRow({ label, command, zh }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await copyText(command); setCopied(true); window.setTimeout(() => setCopied(false), 1_500);
  };
  return <div className="sync-command"><span>{label}</span><code>{command}</code><button type="button" onClick={copy} aria-label={copied ? (zh ? `${label} 已复制` : `${label} copied`) : `${zh ? '复制' : 'Copy'} ${label}`}>{copied ? <Check size={14}/> : <Copy size={14}/>}<i>{copied ? (zh ? '已复制' : 'Copied') : (zh ? '复制' : 'Copy')}</i></button></div>;
}

function dateTime(value, zh) {
  if (!value) return zh ? '尚未成功同步' : 'No successful sync yet';
  return new Date(value).toLocaleString(zh ? 'zh-CN' : 'en-US', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function SyncDialog({ open, onClose, zh, control, onControlAction, onControlChange }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [interval, setInterval] = useState(15);
  const [localControl, setLocalControl] = useState(control);
  const [policies, setPolicies] = useState(() => policiesFromSources(control?.sources));
  const [authorization, setAuthorization] = useState(null);
  const [confirmAction, setConfirmAction] = useState('');
  const [fullSyncRequired, setFullSyncRequired] = useState(false);
  const [disconnectFallback, setDisconnectFallback] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState(null);
  const [syncStartedAt, setSyncStartedAt] = useState(0);
  const [syncElapsed, setSyncElapsed] = useState(0);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/sync', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(await response.text() || `Sync status failed (${response.status})`);
      const next = await response.json(); setStatus(next);
      if (next.daemon?.intervalMinutes) setInterval(next.daemon.intervalMinutes);
    } catch (reason) { setError(reason?.message || String(reason)); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!open) return;
    setNotice('');
    load();
    const refresh = onControlChange?.();
    refresh?.then((next) => { setLocalControl(next); setPolicies(policiesFromSources(next.sources)); setAuthorization(next.community?.authorization || null); }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (control) { setLocalControl(control); setPolicies(policiesFromSources(control.sources)); setAuthorization(control.community?.authorization || null); }
  }, [control]);

  useEffect(() => {
    if (!['sync', 'sync-full'].includes(busy) || !syncStartedAt) return undefined;
    const update = () => setSyncElapsed(Date.now() - syncStartedAt);
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [busy, syncStartedAt]);

  useEffect(() => {
    if (!authorization || authorization.status !== 'pending') return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await onControlAction({ action: 'connect-poll' });
        if (cancelled) return;
        if (next.status === 'connected') {
          setAuthorization(null); setLocalControl(next); setPolicies(policiesFromSources(next.sources));
          await load();
          setNotice(zh ? '社区账户已连接。请确认下方每个 Agent 的同步范围。' : 'Community connected. Confirm the per-agent sync scope below.');
        } else if (['expired', 'access_denied'].includes(next.status)) {
          setAuthorization(next.community?.authorization || { ...authorization, status: next.status });
          setError(next.status === 'expired' ? (zh ? '验证码已过期，请重试。' : 'The code expired. Try again.') : (zh ? '设备授权已拒绝。' : 'Device authorization was denied.'));
        } else if (next.community?.authorization) {
          setAuthorization(next.community.authorization);
        }
      } catch (reason) { if (!cancelled) setError(reason?.message || String(reason)); }
    };
    const timer = window.setInterval(poll, Math.max(2, Number(authorization.interval || 5)) * 1_000);
    poll();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [authorization, onControlAction, zh]);

  const action = async (name) => {
    const syncAction = ['sync', 'sync-full'].includes(name);
    const startedAt = Date.now();
    setBusy(name); setError(''); setNotice('');
    if (syncAction) {
      setSyncStartedAt(startedAt);
      setSyncElapsed(0);
      setSyncFeedback({
        tone: 'running',
        title: name === 'sync-full'
          ? (zh ? '正在完整同步' : 'Complete sync in progress')
          : (zh ? '正在同步' : 'Sync in progress'),
        text: zh
          ? 'Collector 正在扫描所选 Agent，并把新增或变化的标准化用量上传到社区。历史较多时可能需要几分钟。'
          : 'Collector is scanning the selected agents and uploading new or changed normalized usage. Large histories may take a few minutes.',
      });
    }
    try {
      if (['sync', 'sync-full', 'install', 'restart'].includes(name)) {
        if (!Object.values(policies).includes('private')) {
          throw new Error(zh ? '请先把至少一个 Agent 设为“本机并同步”。' : 'Mark at least one agent as “Local + sync” first.');
        }
        const savedPolicies = policiesFromSources(localControl?.sources);
        if (JSON.stringify(savedPolicies) !== JSON.stringify(policies)) {
          const savedControl = await onControlAction({ action: 'save-sources', sourcePolicies: policies });
          setLocalControl(savedControl);
        }
      }
      const response = await fetch('/api/sync', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: name, intervalMinutes: interval }),
      });
      const body = await response.json().catch(() => null);
      if (body?.reconciliationRequired || body?.error?.code === 'sync_reconciliation_required') {
        setFullSyncRequired(true);
        setSyncFeedback({
          tone: 'warning',
          title: zh ? '需要确认完整同步' : 'Complete sync confirmation required',
          text: zh
            ? '当前本机 checkpoint 与社区设备无法证明一致。普通增量同步已安全取消，请核对上方 Agent 范围后再确认完整同步。'
            : 'The local checkpoint cannot be proven to match this community device. Incremental sync was safely cancelled; review the agent scope above, then confirm a complete sync.',
          details: zh ? '本次没有上传任何数据' : 'No data was uploaded',
        });
        return;
      }
      if (!response.ok) {
        throw new Error(body?.error?.message || `Sync action failed (${response.status})`);
      }
      const next = body; setStatus(next);
      if (['sync', 'sync-full'].includes(name)) setFullSyncRequired(false);
      if (syncAction) {
        const outcome = buildSyncOutcome(next.result, zh);
        const durationMs = Number(next.daemon?.lastSync?.lastDurationMs) || Date.now() - startedAt;
        setSyncFeedback({
          ...outcome,
          details: [outcome.details, zh ? `耗时 ${formatSyncDuration(durationMs, true)}` : `Took ${formatSyncDuration(durationMs, false)}`].filter(Boolean).join(' · '),
        });
      } else setNotice(name === 'uninstall'
          ? (zh ? '后台同步已停用；数据和连接配置均已保留。' : 'Background sync disabled; data and connection settings were kept.')
          : (zh ? `后台同步已启用：每 ${interval} 分钟一次。` : `Background sync enabled every ${interval} minutes.`));
    } catch (reason) {
      const message = reason?.message || String(reason);
      if (syncAction) {
        setSyncFeedback({
          tone: 'error',
          title: zh ? '同步失败' : 'Sync failed',
          text: message,
          details: zh ? `运行 ${formatSyncDuration(Date.now() - startedAt, true)} 后停止；未完成的数据不会覆盖社区旧数据。` : `Stopped after ${formatSyncDuration(Date.now() - startedAt, false)}; incomplete data did not overwrite prior community data.`,
        });
      } else setError(message);
    }
    finally { setBusy(''); }
  };

  const startConnection = async () => {
    setBusy('connect'); setError(''); setNotice('');
    try {
      const next = await onControlAction({ action: 'connect-start' });
      setAuthorization(next);
      window.open(next.verificationUriComplete, '_blank', 'noopener,noreferrer');
    } catch (reason) { setError(reason?.message || String(reason)); }
    finally { setBusy(''); }
  };

  const cancelConnection = async () => {
    setBusy('connect-cancel'); setError('');
    try {
      const next = await onControlAction({ action: 'connect-cancel' });
      setAuthorization(null); setLocalControl(next);
    } catch (reason) { setError(reason?.message || String(reason)); }
    finally { setBusy(''); }
  };

  const saveScope = async () => {
    setBusy('scope'); setError('');
    try {
      const next = await onControlAction({ action: 'save-sources', sourcePolicies: policies });
      setLocalControl(next); setPolicies(policiesFromSources(next.sources));
      setNotice(zh ? '同步范围已保存；之后的同步只包含标记为“本机并同步”的 Agent。' : 'Sync scope saved. Future syncs include only agents marked “Local + sync”.');
    } catch (reason) { setError(reason?.message || String(reason)); }
    finally { setBusy(''); }
  };

  const configureSource = async (sourceId, csvPath) => {
    const next = await onControlAction({ action: 'configure-source', sourceId, csvPath });
    setLocalControl(next);
    setPolicies((current) => ({ ...policiesFromSources(next.sources), ...current }));
    return next;
  };

  const destructiveAction = async (name) => {
    if (confirmAction !== name) { setConfirmAction(name); return; }
    setBusy(name); setError('');
    try {
      const next = await onControlAction({ action: name });
      setLocalControl(next); setPolicies(policiesFromSources(next.sources)); setConfirmAction('');
      setDisconnectFallback(false);
      await load();
      setNotice(name === 'delete-device-data'
        ? (zh ? '当前设备的社区用量数据已删除；本机历史仍保留。下次同步会按所选范围重新上传。' : 'This device’s community usage was deleted. Local history remains; the next sync replays the selected scope.')
        : name === 'disconnect-local'
          ? (zh ? '仅本机连接已清除。远端 Key 可能仍有效，请前往社区设备管理中撤销它。' : 'The local connection was forgotten. The remote key may still be active; revoke it in community device management.')
          : (zh ? '设备 Key 已撤销，本机已断开，后台同步已停用；社区已有历史未删除。' : 'Device key revoked, local connection removed, and background sync disabled; existing community history was kept.'));
    } catch (reason) {
      if (reason?.code === 'remote_revoke_failed') setDisconnectFallback(true);
      setError(reason?.message || String(reason));
    }
    finally { setBusy(''); }
  };

  const connected = Boolean(status?.connected || localControl?.community?.connected);
  const syncCount = Object.values(policies).filter((mode) => mode === 'private').length;
  const daemon = status?.daemon;
  const automatic = Boolean(daemon?.installed && daemon?.loaded);
  const installCommand = `npx ${PACKAGE} daemon install --interval ${interval}`;
  const statusFacts = [
    { label: zh ? '社区' : 'Community', value: status?.apiUrl || localControl?.community?.apiUrl || 'https://kimi.builders' },
    { label: zh ? '当前设备' : 'Current device', value: localControl?.community?.device?.name || (zh ? '当前电脑' : 'This computer') },
    { label: 'Collector', value: `v${localControl?.community?.device?.collectorVersion || '—'}` },
    { label: zh ? '方式' : 'Mode', value: automatic ? (zh ? `自动 · ${interval} 分钟` : `Automatic · ${interval} min`) : (zh ? '手动同步' : 'Manual sync') },
    { label: zh ? '最近成功' : 'Last success', value: dateTime(daemon?.lastSync?.lastSuccessAt, zh) },
  ];

  return <Dialog open={open} onClose={onClose} wide className="dialog--sync" title={zh ? '社区数据同步' : 'Community data sync'} subtitle={zh ? '本地看板负责扫描，Collector 负责上传；社区永远不会反向读取你的磁盘。' : 'The local dashboard scans; Collector uploads. The community never reads back from your disk.'}>
    <div className="sync-dialog-body">
      <section className={`sync-connection ${connected ? 'connected' : 'disconnected'}`}>
        <div className="sync-connection-icon">{connected ? <CircleCheck size={22}/> : <Unplug size={22}/>}</div>
        <div><span>{connected ? (zh ? '已连接 Kimi Builders' : 'Connected to Kimi Builders') : (zh ? '尚未连接社区' : 'Not connected yet')}</span><strong>{connected ? (status?.apiUrl || localControl?.community?.apiUrl) : (zh ? '先完成一次安全设备授权' : 'Authorize this device first')}</strong></div>
        <em>{loading ? <LoaderCircle className="spin" size={16}/> : automatic ? (zh ? '自动同步中' : 'Automatic') : connected ? (zh ? '按需同步' : 'On demand') : (zh ? '待配置' : 'Setup')}</em>
      </section>

      {connected ? <div className="sync-facts">{statusFacts.map((fact) => <div key={fact.label}><span>{fact.label}</span><strong>{fact.value}</strong></div>)}</div> : <section className="sync-setup"><AlertTriangle size={18}/><div><b>{zh ? '在这里连接，无需终端命令' : 'Connect here—no terminal required'}</b><p>{zh ? '浏览器登录并批准当前设备；凭据只保存在本机。批准连接不会自动上传，之后仍需选择 Agent 同步范围并点击同步。' : 'Sign in and approve this device in your browser; the credential stays local. Approval does not upload data—you still choose agent scope and start sync afterward.'}</p></div>{authorization ? <DeviceAuthorizationCard authorization={authorization} zh={zh} onCancel={cancelConnection} onRetry={startConnection} compact/> : <button className="primary-btn" type="button" onClick={startConnection} disabled={busy === 'connect'}>{busy === 'connect' ? <LoaderCircle className="spin" size={15}/> : <Cloud size={15}/>} {zh ? '连接社区账户' : 'Connect community account'}</button>}<details><summary>{zh ? '终端备用方式' : 'CLI fallback'}</summary><CommandRow zh={zh} label={zh ? '连接' : 'Connect'} command={`npx ${PACKAGE} init`}/></details></section>}

      {localControl?.sources?.length ? <section className="sync-scope-card"><header><div><b>{zh ? '按 Agent 控制同步范围' : 'Per-agent sync scope'}</b><p>{zh ? '关闭 = 不扫描；仅本机 = 只在当前设备分析；本机并同步 = 允许发送到你的社区账户。账号公开设置另行决定这些聚合数据是否公开。' : 'Off = no scan; Local only = analyze on this device; Local + sync = may upload to your community account. Account-level visibility settings separately decide whether those aggregates are public.'}</p></div><button className="ghost-btn" type="button" onClick={saveScope} disabled={busy === 'scope'}>{busy === 'scope' ? <LoaderCircle className="spin" size={14}/> : <Check size={14}/>} {zh ? '保存范围' : 'Save scope'}</button></header><SourceModeRows sources={localControl.sources} policies={policies} onChange={setPolicies} onConfigure={configureSource} connected={connected} zh={zh} compact/></section> : null}

      <section className="sync-mode-card">
        <header><div className="sync-mode-icon"><CloudUpload size={19}/></div><div><b>{zh ? '立即同步一次' : 'Sync once now'}</b><p>{zh ? `扫描本机变化并上传 ${syncCount} 个已允许 Agent 的标准化用量；不会上传对话正文、完整路径或供应商凭据。` : `Scan changes and upload normalized usage from ${syncCount} allowed agent${syncCount === 1 ? '' : 's'}—never conversations, full paths, or provider credentials.`}</p></div>{connected ? <button className="primary-btn" type="button" disabled={Boolean(busy) || syncCount === 0} onClick={() => action('sync')}>{busy === 'sync' ? <LoaderCircle className="spin" size={15}/> : <RefreshCw size={15}/>} {busy === 'sync' ? (zh ? '同步中' : 'Syncing') : (zh ? '立即同步' : 'Sync now')}</button> : null}</header>
        {syncFeedback ? <div className={`sync-action-feedback ${syncFeedback.tone}`} role={syncFeedback.tone === 'error' ? 'alert' : 'status'} aria-live="polite">
          {syncFeedback.tone === 'running' ? <LoaderCircle className="spin" size={17}/> : syncFeedback.tone === 'success' ? <CircleCheck size={17}/> : <AlertTriangle size={17}/>}
          <div><b>{syncFeedback.title}</b><p>{syncFeedback.text}</p><small>{syncFeedback.tone === 'running'
            ? (zh ? `已用时 ${formatSyncDuration(syncElapsed, true)} · 正在等待 Collector 返回可验证结果` : `${formatSyncDuration(syncElapsed, false)} elapsed · waiting for a verified Collector result`)
            : syncFeedback.details}</small></div>
          {syncFeedback.tone === 'running' ? <span className="sync-indeterminate" role="progressbar" aria-label={zh ? '同步进行中' : 'Sync in progress'}><i/></span> : null}
        </div> : null}
        {fullSyncRequired ? <div className="sync-reconcile"><AlertTriangle size={17}/><div><b>{zh ? '需要完整重建一次' : 'One complete replay is required'}</b><p>{zh ? `这会重新上传当前标记为“本机并同步”的 ${syncCount} 个 Agent，用于补齐当前设备缺失的数据；不会上传关闭或仅本机来源。` : `This re-uploads the ${syncCount} agents currently marked “Local + sync” to fill missing data for this device. Off and local-only sources remain local.`}</p></div><button type="button" className="danger-confirm" disabled={Boolean(busy) || syncCount === 0} onClick={() => action('sync-full')}>{busy === 'sync-full' ? <LoaderCircle className="spin" size={14}/> : <CloudUpload size={14}/>} {zh ? '确认完整同步' : 'Confirm complete sync'}</button></div> : null}
        <CommandRow zh={zh} label={zh ? '单次' : 'Once'} command={`npx ${PACKAGE} sync`}/>
        {fullSyncRequired ? <CommandRow zh={zh} label={zh ? '完整' : 'Full'} command={`npx ${PACKAGE} sync --full`}/> : null}
      </section>

      <section className="sync-mode-card">
        <header><div className="sync-mode-icon purple"><TimerReset size={19}/></div><div><b>{zh ? '后台持续同步' : 'Continuous background sync'}</b><p>{zh ? `使用 ${daemon?.scheduler?.label || 'system scheduler'}，无需保持看板页面打开；仅在设备唤醒且联网时运行。` : `Uses ${daemon?.scheduler?.label || 'the system scheduler'}; the dashboard can stay closed. Runs while the device is awake and online.`}</p></div>{daemon?.supported && connected ? (automatic ? <button className="ghost-btn danger-soft" type="button" disabled={Boolean(busy)} onClick={() => action('uninstall')}>{busy === 'uninstall' ? <LoaderCircle className="spin" size={15}/> : <Unplug size={15}/>} {zh ? '停用' : 'Disable'}</button> : <button className="primary-btn" type="button" disabled={Boolean(busy) || syncCount === 0} onClick={() => action('install')}>{busy === 'install' ? <LoaderCircle className="spin" size={15}/> : <Monitor size={15}/>} {zh ? '启用自动同步' : 'Enable automatic sync'}</button>) : null}</header>
        <div className="sync-interval"><span>{zh ? '同步间隔' : 'Sync interval'}</span><div>{INTERVALS.map((minutes) => <button type="button" key={minutes} className={interval === minutes ? 'active' : ''} onClick={() => setInterval(minutes)}>{minutes < 60 ? `${minutes}m` : '1h'}</button>)}</div>{automatic && daemon?.intervalMinutes !== interval ? <button type="button" className="sync-apply" disabled={Boolean(busy)} onClick={() => action('restart')}>{busy === 'restart' ? <LoaderCircle className="spin" size={13}/> : <RefreshCw size={13}/>} {zh ? '应用' : 'Apply'}</button> : null}</div>
        <div className="sync-command-stack">
          <CommandRow zh={zh} label={zh ? '安装' : 'Install'} command={installCommand}/>
          <CommandRow zh={zh} label={zh ? '状态' : 'Status'} command={`npx ${PACKAGE} daemon status`}/>
          <CommandRow zh={zh} label={zh ? '重载' : 'Restart'} command={`npx ${PACKAGE} daemon restart`}/>
          <CommandRow zh={zh} label={zh ? '卸载' : 'Remove'} command={`npx ${PACKAGE} daemon uninstall`}/>
        </div>
      </section>

      <section className="sync-boundary"><ShieldCheck size={18}/><div><b>{zh ? '“重新扫描”不等于“同步数据”' : '“Rescan” is not “Sync”'}</b><p>{zh ? '重新扫描只刷新当前本地页面，零上传；立即同步或后台同步才会把增量发送到已连接的社区账户。云端没有命令可以主动拉取本机日志。' : 'Rescan only refreshes this local page with zero upload. Sync now or background sync sends increments to the connected community account. The cloud cannot pull local logs.'}</p><small>{zh ? '运行日志' : 'Run log'} · {daemon?.logPath || (zh ? '首次同步后生成' : 'created after first sync')}</small></div></section>
      {connected ? <section className="sync-ownership"><header><div><b>{zh ? '远程数据由你控制' : 'You control remote data'}</b><p>{zh ? '停止同步只停后台任务；断开会撤销当前设备 Key，但保留社区历史。删除数据是独立操作。' : 'Stopping sync only stops the background job. Disconnecting revokes this device key but keeps community history. Data deletion is separate.'}</p></div><a href={localControl?.community?.dashboardUrl || status?.apiUrl} target="_blank" rel="noreferrer">{zh ? '社区设备与公开设置' : 'Community devices & visibility'}<ExternalLink size={12}/></a></header><div><button type="button" className={confirmAction === 'disconnect' ? 'danger-confirm' : 'ghost-btn'} onClick={() => destructiveAction('disconnect')} disabled={Boolean(busy)}><LogOut size={14}/>{confirmAction === 'disconnect' ? (zh ? '确认撤销 Key 并断开' : 'Revoke key and disconnect') : (zh ? '安全断开当前设备' : 'Safely disconnect device')}</button><button type="button" className={confirmAction === 'delete-device-data' ? 'danger-confirm' : 'ghost-btn'} onClick={() => destructiveAction('delete-device-data')} disabled={Boolean(busy)}><Trash2 size={14}/>{confirmAction === 'delete-device-data' ? (zh ? '再次点击删除云端数据' : 'Click again to delete cloud data') : (zh ? '删除当前设备云端数据' : 'Delete this device’s cloud data')}</button></div>{disconnectFallback ? <div className="sync-revoke-warning"><AlertTriangle size={17}/><div><b>{zh ? '社区暂时无法确认撤销' : 'Remote revocation could not be confirmed'}</b><p>{zh ? '为避免留下一个你看不见的有效 Key，本机连接仍完整保留。只有在你准备稍后到社区设备管理手动撤销时，才使用下面的本机清除。' : 'Your local connection was kept so an active key is not hidden from you. Use local-only removal only if you will revoke it later in community device management.'}</p></div><button type="button" className={confirmAction === 'disconnect-local' ? 'danger-confirm' : 'ghost-btn'} onClick={() => destructiveAction('disconnect-local')} disabled={Boolean(busy)}>{confirmAction === 'disconnect-local' ? (zh ? '确认仅清除本机' : 'Confirm local-only removal') : (zh ? '仅清除本机连接' : 'Forget locally only')}</button></div> : null}</section> : null}
      {notice ? <p className={`sync-notice ${typeof notice === 'object' && notice.tone === 'warning' ? 'warning' : ''}`} role="status" aria-live="polite">{typeof notice === 'object' && notice.tone === 'warning' ? <AlertTriangle size={15}/> : <CircleCheck size={15}/>} {typeof notice === 'object' ? notice.text : notice}</p> : null}
      {error ? <p className="sync-error" role="alert"><AlertTriangle size={15}/>{error}</p> : null}
    </div>
  </Dialog>;
}
