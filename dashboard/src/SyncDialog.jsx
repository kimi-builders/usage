import { useEffect, useState } from 'react';
import {
  AlertTriangle, Check, CircleCheck, Cloud, CloudUpload, Copy, ExternalLink, LoaderCircle, LogOut, Monitor,
  RefreshCw, ShieldCheck, TimerReset, Trash2, Unplug,
} from 'lucide-react';
import { Dialog } from './UsageDialogs.jsx';
import { SourceModeRows, policiesFromSources } from './DataSourceControls.jsx';
import { sourceLabel } from './format.js';

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

function syncOutcome(result = {}, zh) {
  const changed = Number(result.buckets || 0) + Number(result.sessions || 0);
  const problemSources = (result.sources || []).filter((source) => ['failed', 'partial'].includes(source.status));
  const sourceNames = problemSources.slice(0, 3).map((source) => sourceLabel(source.source)).join('、');
  const more = problemSources.length > 3 ? (zh ? ` 等 ${problemSources.length} 个来源` : ` and ${problemSources.length - 3} more`) : '';
  const base = changed
    ? (zh ? `已同步 ${result.buckets || 0} 个 buckets、${result.sessions || 0} 个 sessions。` : `Synced ${result.buckets || 0} buckets and ${result.sessions || 0} sessions.`)
    : (zh ? '扫描完成，没有新增或变化的用量需要上传。' : 'Scan complete. No new or changed usage needed uploading.');
  if (problemSources.length) {
    return {
      tone: 'warning',
      text: `${base}${zh ? ` ${sourceNames}${more} 本次读取不完整，社区中的旧数据已保留。` : ` ${sourceNames}${more} could not be fully read; their previous community data was preserved.`}`,
    };
  }
  if (Number(result.rejected || 0) > 0) {
    return {
      tone: 'warning',
      text: `${base} ${zh ? `${result.rejected} 条异常记录已隔离。` : `${result.rejected} invalid records were isolated.`}`,
    };
  }
  return { tone: 'success', text: base };
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
    refresh?.then((next) => { setLocalControl(next); setPolicies(policiesFromSources(next.sources)); }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (control) { setLocalControl(control); setPolicies(policiesFromSources(control.sources)); }
  }, [control]);

  useEffect(() => {
    if (!authorization) return undefined;
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
          setAuthorization(null);
          setError(next.status === 'expired' ? (zh ? '验证码已过期，请重试。' : 'The code expired. Try again.') : (zh ? '设备授权已拒绝。' : 'Device authorization was denied.'));
        }
      } catch (reason) { if (!cancelled) setError(reason?.message || String(reason)); }
    };
    const timer = window.setInterval(poll, Math.max(2, Number(authorization.interval || 5)) * 1_000);
    poll();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [authorization, onControlAction, zh]);

  const action = async (name) => {
    setBusy(name); setError(''); setNotice('');
    try {
      if (['sync', 'install', 'restart'].includes(name)) {
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
      if (!response.ok) throw new Error((await response.text()).replace(/^Local dashboard error:\s*/, '') || `Sync action failed (${response.status})`);
      const next = await response.json(); setStatus(next);
      setNotice(name === 'sync'
        ? syncOutcome(next.result, zh)
        : name === 'uninstall'
          ? (zh ? '后台同步已停用；数据和连接配置均已保留。' : 'Background sync disabled; data and connection settings were kept.')
          : (zh ? `后台同步已启用：每 ${interval} 分钟一次。` : `Background sync enabled every ${interval} minutes.`));
    } catch (reason) { setError(reason?.message || String(reason)); }
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
      await load();
      setNotice(name === 'delete-device-data'
        ? (zh ? '当前设备的社区用量数据已删除；本机历史仍保留。下次同步会按所选范围重新上传。' : 'This device’s community usage was deleted. Local history remains; the next sync replays the selected scope.')
        : (zh ? '设备已断开，后台同步已停用；社区已有历史未删除。' : 'Device disconnected and background sync disabled; existing community history was kept.'));
    } catch (reason) { setError(reason?.message || String(reason)); }
    finally { setBusy(''); }
  };

  const connected = Boolean(status?.connected || localControl?.community?.connected);
  const syncCount = Object.values(policies).filter((mode) => mode === 'private').length;
  const daemon = status?.daemon;
  const automatic = Boolean(daemon?.installed && daemon?.loaded);
  const installCommand = `npx ${PACKAGE} daemon install --interval ${interval}`;
  const statusFacts = [
    { label: zh ? '目标' : 'Target', value: status?.apiUrl || 'https://kimi.builders' },
    { label: zh ? '方式' : 'Mode', value: automatic ? (zh ? `自动 · ${interval} 分钟` : `Automatic · ${interval} min`) : (zh ? '手动同步' : 'Manual sync') },
    { label: zh ? '最近成功' : 'Last success', value: dateTime(daemon?.lastSync?.lastSuccessAt, zh) },
  ];

  return <Dialog open={open} onClose={onClose} wide className="dialog--sync" title={zh ? '社区数据同步' : 'Community data sync'} subtitle={zh ? '本地看板负责扫描，Collector 负责上传；社区永远不会反向读取你的磁盘。' : 'The local dashboard scans; Collector uploads. The community never reads back from your disk.'}>
    <div className="sync-dialog-body">
      <section className={`sync-connection ${connected ? 'connected' : 'disconnected'}`}>
        <div className="sync-connection-icon">{connected ? <CircleCheck size={22}/> : <Unplug size={22}/>}</div>
        <div><span>{connected ? (zh ? '已连接 Kimi Builders' : 'Connected to Kimi Builders') : (zh ? '尚未连接社区' : 'Not connected yet')}</span><strong>{connected ? status?.apiUrl : (zh ? '先完成一次安全设备授权' : 'Authorize this device first')}</strong></div>
        <em>{loading ? <LoaderCircle className="spin" size={16}/> : automatic ? (zh ? '自动同步中' : 'Automatic') : connected ? (zh ? '按需同步' : 'On demand') : (zh ? '待配置' : 'Setup')}</em>
      </section>

      {connected ? <div className="sync-facts">{statusFacts.map((fact) => <div key={fact.label}><span>{fact.label}</span><strong>{fact.value}</strong></div>)}</div> : <section className="sync-setup"><AlertTriangle size={18}/><div><b>{zh ? '在这里连接，无需终端命令' : 'Connect here—no terminal required'}</b><p>{zh ? '浏览器登录并批准当前设备；设备凭据只保存在本机 owner-only 配置文件中。' : 'Sign in and approve this device in your browser. Its credential stays in an owner-only local config file.'}</p></div>{authorization ? <div className="sync-device-code"><span>{zh ? '验证码' : 'Code'}</span><strong>{authorization.userCode}</strong><a href={authorization.verificationUriComplete} target="_blank" rel="noreferrer">{zh ? '打开授权页' : 'Open authorization'}<ExternalLink size={12}/></a><LoaderCircle className="spin" size={16}/></div> : <button className="primary-btn" type="button" onClick={startConnection} disabled={busy === 'connect'}>{busy === 'connect' ? <LoaderCircle className="spin" size={15}/> : <Cloud size={15}/>} {zh ? '连接社区账户' : 'Connect community account'}</button>}<details><summary>{zh ? '终端备用方式' : 'CLI fallback'}</summary><CommandRow zh={zh} label={zh ? '连接' : 'Connect'} command={`npx ${PACKAGE} init`}/></details></section>}

      {localControl?.sources?.length ? <section className="sync-scope-card"><header><div><b>{zh ? '按 Agent 控制同步范围' : 'Per-agent sync scope'}</b><p>{zh ? '关闭 = 不扫描；仅本机 = 只在当前设备分析；本机并同步 = 允许发送到你的社区账户。账号公开设置另行决定这些聚合数据是否公开。' : 'Off = no scan; Local only = analyze on this device; Local + sync = may upload to your community account. Account-level visibility settings separately decide whether those aggregates are public.'}</p></div><button className="ghost-btn" type="button" onClick={saveScope} disabled={busy === 'scope'}>{busy === 'scope' ? <LoaderCircle className="spin" size={14}/> : <Check size={14}/>} {zh ? '保存范围' : 'Save scope'}</button></header><SourceModeRows sources={localControl.sources} policies={policies} onChange={setPolicies} onConfigure={configureSource} connected={connected} zh={zh} compact/></section> : null}

      <section className="sync-mode-card">
        <header><div className="sync-mode-icon"><CloudUpload size={19}/></div><div><b>{zh ? '立即同步一次' : 'Sync once now'}</b><p>{zh ? `扫描本机变化并上传 ${syncCount} 个已允许 Agent 的标准化用量；不会上传对话正文、完整路径或供应商凭据。` : `Scan changes and upload normalized usage from ${syncCount} allowed agent${syncCount === 1 ? '' : 's'}—never conversations, full paths, or provider credentials.`}</p></div>{connected ? <button className="primary-btn" type="button" disabled={Boolean(busy) || syncCount === 0} onClick={() => action('sync')}>{busy === 'sync' ? <LoaderCircle className="spin" size={15}/> : <RefreshCw size={15}/>} {busy === 'sync' ? (zh ? '同步中' : 'Syncing') : (zh ? '立即同步' : 'Sync now')}</button> : null}</header>
        <CommandRow zh={zh} label={zh ? '单次' : 'Once'} command={`npx ${PACKAGE} sync`}/>
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
      {connected ? <section className="sync-ownership"><header><div><b>{zh ? '远程数据由你控制' : 'You control remote data'}</b><p>{zh ? '当前设备策略与账号公开设置分开管理。停止或断开不会偷偷删除历史。' : 'This device policy is separate from account-level public settings. Stopping or disconnecting never silently deletes history.'}</p></div><a href={localControl?.community?.dashboardUrl || status?.apiUrl} target="_blank" rel="noreferrer">{zh ? '社区公开与账号设置' : 'Community visibility & account settings'}<ExternalLink size={12}/></a></header><div><button type="button" className={confirmAction === 'disconnect' ? 'danger-confirm' : 'ghost-btn'} onClick={() => destructiveAction('disconnect')} disabled={Boolean(busy)}><LogOut size={14}/>{confirmAction === 'disconnect' ? (zh ? '再次点击确认断开' : 'Click again to disconnect') : (zh ? '断开当前设备' : 'Disconnect device')}</button><button type="button" className={confirmAction === 'delete-device-data' ? 'danger-confirm' : 'ghost-btn'} onClick={() => destructiveAction('delete-device-data')} disabled={Boolean(busy)}><Trash2 size={14}/>{confirmAction === 'delete-device-data' ? (zh ? '再次点击删除云端数据' : 'Click again to delete cloud data') : (zh ? '删除当前设备云端数据' : 'Delete this device’s cloud data')}</button></div></section> : null}
      {notice ? <p className={`sync-notice ${typeof notice === 'object' && notice.tone === 'warning' ? 'warning' : ''}`} role="status" aria-live="polite">{typeof notice === 'object' && notice.tone === 'warning' ? <AlertTriangle size={15}/> : <CircleCheck size={15}/>} {typeof notice === 'object' ? notice.text : notice}</p> : null}
      {error ? <p className="sync-error" role="alert"><AlertTriangle size={15}/>{error}</p> : null}
    </div>
  </Dialog>;
}
