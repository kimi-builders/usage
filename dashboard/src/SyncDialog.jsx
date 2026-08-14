import { useEffect, useState } from 'react';
import {
  AlertTriangle, Check, CircleCheck, CloudUpload, Copy, LoaderCircle, Monitor,
  RefreshCw, ShieldCheck, TimerReset, Unplug,
} from 'lucide-react';
import { Dialog } from './UsageDialogs.jsx';

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

export function SyncDialog({ open, onClose, zh }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [interval, setInterval] = useState(15);

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
  }, [open]);

  const action = async (name) => {
    setBusy(name); setError(''); setNotice('');
    try {
      const response = await fetch('/api/sync', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: name, intervalMinutes: interval }),
      });
      if (!response.ok) throw new Error((await response.text()).replace(/^Local dashboard error:\s*/, '') || `Sync action failed (${response.status})`);
      const next = await response.json(); setStatus(next);
      setNotice(name === 'sync'
        ? (zh ? '同步完成，社区看板已收到本次变化。' : 'Sync complete. The community dashboard received these changes.')
        : name === 'uninstall'
          ? (zh ? '后台同步已停用；数据和连接配置均已保留。' : 'Background sync disabled; data and connection settings were kept.')
          : (zh ? `后台同步已启用：每 ${interval} 分钟一次。` : `Background sync enabled every ${interval} minutes.`));
    } catch (reason) { setError(reason?.message || String(reason)); }
    finally { setBusy(''); }
  };

  const connected = Boolean(status?.connected);
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

      {connected ? <div className="sync-facts">{statusFacts.map((fact) => <div key={fact.label}><span>{fact.label}</span><strong>{fact.value}</strong></div>)}</div> : <section className="sync-setup"><AlertTriangle size={18}/><div><b>{zh ? '只需连接一次' : 'Connect once'}</b><p>{zh ? '命令会打开浏览器完成授权，凭据仅保存在本机配置目录。' : 'The command opens a browser for authorization; credentials stay in the local config directory.'}</p></div><CommandRow zh={zh} label={zh ? '连接' : 'Connect'} command={`npx ${PACKAGE} init`}/></section>}

      <section className="sync-mode-card">
        <header><div className="sync-mode-icon"><CloudUpload size={19}/></div><div><b>{zh ? '立即同步一次' : 'Sync once now'}</b><p>{zh ? '扫描本机变化并上传标准化用量；不会上传对话正文、完整路径或供应商凭据。' : 'Scan local changes and upload normalized usage—never conversations, full paths, or provider credentials.'}</p></div>{connected ? <button className="primary-btn" type="button" disabled={Boolean(busy)} onClick={() => action('sync')}>{busy === 'sync' ? <LoaderCircle className="spin" size={15}/> : <RefreshCw size={15}/>} {busy === 'sync' ? (zh ? '同步中' : 'Syncing') : (zh ? '立即同步' : 'Sync now')}</button> : null}</header>
        <CommandRow zh={zh} label={zh ? '单次' : 'Once'} command={`npx ${PACKAGE} sync`}/>
      </section>

      <section className="sync-mode-card">
        <header><div className="sync-mode-icon purple"><TimerReset size={19}/></div><div><b>{zh ? '后台持续同步' : 'Continuous background sync'}</b><p>{zh ? `使用 ${daemon?.scheduler?.label || 'system scheduler'}，无需保持看板页面打开；仅在设备唤醒且联网时运行。` : `Uses ${daemon?.scheduler?.label || 'the system scheduler'}; the dashboard can stay closed. Runs while the device is awake and online.`}</p></div>{daemon?.supported && connected ? (automatic ? <button className="ghost-btn danger-soft" type="button" disabled={Boolean(busy)} onClick={() => action('uninstall')}>{busy === 'uninstall' ? <LoaderCircle className="spin" size={15}/> : <Unplug size={15}/>} {zh ? '停用' : 'Disable'}</button> : <button className="primary-btn" type="button" disabled={Boolean(busy)} onClick={() => action('install')}>{busy === 'install' ? <LoaderCircle className="spin" size={15}/> : <Monitor size={15}/>} {zh ? '启用自动同步' : 'Enable automatic sync'}</button>) : null}</header>
        <div className="sync-interval"><span>{zh ? '同步间隔' : 'Sync interval'}</span><div>{INTERVALS.map((minutes) => <button type="button" key={minutes} className={interval === minutes ? 'active' : ''} onClick={() => setInterval(minutes)}>{minutes < 60 ? `${minutes}m` : '1h'}</button>)}</div>{automatic && daemon?.intervalMinutes !== interval ? <button type="button" className="sync-apply" disabled={Boolean(busy)} onClick={() => action('restart')}>{busy === 'restart' ? <LoaderCircle className="spin" size={13}/> : <RefreshCw size={13}/>} {zh ? '应用' : 'Apply'}</button> : null}</div>
        <div className="sync-command-stack">
          <CommandRow zh={zh} label={zh ? '安装' : 'Install'} command={installCommand}/>
          <CommandRow zh={zh} label={zh ? '状态' : 'Status'} command={`npx ${PACKAGE} daemon status`}/>
          <CommandRow zh={zh} label={zh ? '重载' : 'Restart'} command={`npx ${PACKAGE} daemon restart`}/>
          <CommandRow zh={zh} label={zh ? '卸载' : 'Remove'} command={`npx ${PACKAGE} daemon uninstall`}/>
        </div>
      </section>

      <section className="sync-boundary"><ShieldCheck size={18}/><div><b>{zh ? '“重新扫描”不等于“同步数据”' : '“Rescan” is not “Sync”'}</b><p>{zh ? '重新扫描只刷新当前本地页面，零上传；立即同步或后台同步才会把增量发送到已连接的社区账户。云端没有命令可以主动拉取本机日志。' : 'Rescan only refreshes this local page with zero upload. Sync now or background sync sends increments to the connected community account. The cloud cannot pull local logs.'}</p><small>{zh ? '运行日志' : 'Run log'} · {daemon?.logPath || (zh ? '首次同步后生成' : 'created after first sync')}</small></div></section>
      {notice ? <p className="sync-notice" role="status" aria-live="polite"><CircleCheck size={15}/>{notice}</p> : null}
      {error ? <p className="sync-error" role="alert"><AlertTriangle size={15}/>{error}</p> : null}
    </div>
  </Dialog>;
}
