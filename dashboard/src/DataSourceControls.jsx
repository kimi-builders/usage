import { useEffect, useState } from 'react';
import { AlertTriangle, Check, CloudUpload, FileSpreadsheet, HardDrive, LoaderCircle, Save, X } from 'lucide-react';
import { sourceLabel } from './format.js';
import { ToolGlyph } from './tool-glyphs.js';

export const SOURCE_MODE_OPTIONS = [
  { id: 'off', icon: X, zh: '关闭', en: 'Off' },
  { id: 'local', icon: HardDrive, zh: '仅本机', en: 'Local only' },
  { id: 'private', icon: CloudUpload, zh: '本机并同步', en: 'Local + sync' },
];

export function policiesFromSources(sources = [], { detectedDefaults = false } = {}) {
  return Object.fromEntries(sources.map((source) => [
    source.id,
    detectedDefaults ? (source.detected ? 'local' : 'off') : source.mode,
  ]));
}

function SourceConfiguration({ source, onConfigure, zh }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setValue(''); setError(''); }, [source.configuration?.configured]);
  if (!source.configurable || !onConfigure) return null;
  const save = async () => {
    setBusy(true); setError('');
    try { await onConfigure(source.id, value); setValue(''); }
    catch {
      setError(zh
        ? '未找到有效的 CSV 文件，请粘贴完整路径后重试。'
        : 'No valid CSV file was found. Paste its full path and try again.');
    }
    finally { setBusy(false); }
  };
  return <div className="source-policy-config">
    <FileSpreadsheet size={14}/><label><span>{zh ? 'Cursor 用量 CSV' : 'Cursor usage CSV'}</span><input value={value} onChange={(event) => setValue(event.target.value)} placeholder={zh ? '/路径/to/cursor-usage.csv' : '/path/to/cursor-usage.csv'} aria-label={zh ? 'Cursor 用量 CSV 路径' : 'Cursor usage CSV path'}/></label><button type="button" className="ghost-btn" onClick={save} disabled={busy || !value.trim()}>{busy ? <LoaderCircle className="spin" size={13}/> : <Check size={13}/>} {source.configuration?.configured ? (zh ? '更换文件' : 'Change file') : (zh ? '验证文件' : 'Verify file')}</button>{error ? <small role="alert">{error}</small> : <p>{source.configuration?.configured ? (zh ? '文件已验证，路径只保存在本机配置中，不会回传到页面或社区。' : 'File verified. Its path stays in local configuration and is not returned to the page or community.') : (zh ? '从 Cursor Dashboard 导出 usage CSV 后，在这里粘贴完整路径。' : 'Export a usage CSV from Cursor Dashboard, then paste its full path here.')}</p>}
  </div>;
}

export function SourceModeRows({ sources = [], policies, onChange, onConfigure, connected, zh, compact = false }) {
  return <div className={`source-policy-list ${compact ? 'compact' : ''}`}>
    {sources.map((source) => <article className={`source-policy-row ${source.detected ? 'detected' : ''}`} key={source.id}>
      <ToolGlyph id={source.id} size={19}/>
      <div className="source-policy-name"><b>{sourceLabel(source.id)}</b><span>{source.detected ? (zh ? `已检测到 · ${source.rootCount} 个数据位置` : `Detected · ${source.rootCount} data location${source.rootCount === 1 ? '' : 's'}`) : (zh ? '当前未检测到数据' : 'No data detected')}</span></div>
      <div className="source-mode-segment" role="radiogroup" aria-label={`${sourceLabel(source.id)} ${zh ? '数据模式' : 'data mode'}`}>
        {SOURCE_MODE_OPTIONS.map(({ id, icon: Icon, zh: cn, en }) => { const unavailable = id !== 'off' && source.configurable && !source.configuration?.configured; return <button type="button" role="radio" aria-checked={policies[source.id] === id} aria-disabled={unavailable} disabled={unavailable} className={policies[source.id] === id ? 'active' : ''} key={id} onClick={() => onChange({ ...policies, [source.id]: id })}><Icon size={12}/><span>{zh ? cn : en}</span></button>; })}
      </div>
      {policies[source.id] === 'private' && !connected ? <small className="source-policy-note"><AlertTriangle size={11}/>{zh ? '连接社区后才会同步' : 'Sync starts after connecting'}</small> : null}
      <SourceConfiguration source={source} onConfigure={onConfigure} zh={zh}/>
    </article>)}
  </div>;
}

export function DataSourceControls({ control, policies, onChange, onConfigure, onSave, saving, saved, zh }) {
  if (!control) return null;
  const scanCount = Object.values(policies).filter((mode) => mode !== 'off').length;
  const syncCount = Object.values(policies).filter((mode) => mode === 'private').length;
  return <section className="panel source-control-panel">
    <header className="panel-header"><div><h2>{zh ? 'Agent 数据范围' : 'Agent data scope'}</h2><p>{zh ? '分别决定哪些 Agent 在本机参与分析、哪些可以发送到你的社区账户。' : 'Choose which agents are analyzed locally and which may be sent to your community account.'}</p></div><span className="panel-meta">{scanCount} LOCAL · {syncCount} SYNC</span></header>
    <div className="source-control-explainer"><div><HardDrive size={15}/><p><b>{zh ? '本机扫描范围' : 'Local scan scope'}</b><span>{zh ? '控制当前设备读取哪些 Agent 的 Token、时间和计数。' : 'Controls which agent token, timing, and count facts this device reads.'}</span></p></div><div><CloudUpload size={15}/><p><b>{zh ? '社区同步范围' : 'Community sync scope'}</b><span>{zh ? '只同步你标为“本机并同步”的来源；修改不会删除已有云端历史。' : 'Only “Local + sync” sources are uploaded. Changing this does not delete existing cloud history.'}</span></p></div></div>
    <SourceModeRows sources={control.sources} policies={policies} onChange={onChange} onConfigure={onConfigure} connected={control.community?.connected} zh={zh}/>
    <footer className="source-control-footer"><p>{zh ? '新支持的 Agent 默认仅在本机启用，不会自动加入同步。已同步来源是否公开，由社区账号的公开设置统一控制。' : 'Newly supported agents default to local only and never join sync automatically. Account-level community settings separately control whether synced aggregates are public.'}</p><button className="primary-btn" type="button" disabled={saving} onClick={onSave}>{saved ? <Check size={14}/> : <Save size={14}/>} {saving ? (zh ? '保存中' : 'Saving') : saved ? (zh ? '已保存' : 'Saved') : (zh ? '保存范围' : 'Save scope')}</button></footer>
  </section>;
}
