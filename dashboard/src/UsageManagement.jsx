import {
  AlertTriangle, CheckCircle2, CircleDollarSign, Clock3, Database, ExternalLink,
  FileWarning, Monitor, ShieldCheck,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { sourceLabel } from './format.js';
import { ToolGlyph } from './tool-glyphs.js';
import { DataSourceControls, policiesFromSources } from './DataSourceControls.jsx';

function scanTime(value, zh) {
  if (!value) return '—';
  return new Date(value).toLocaleString(zh ? 'zh-CN' : 'en-US', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function UsageManagement({ data, control, onControlAction, onControlRefresh, onRescan, zh }) {
  const [policies, setPolicies] = useState(() => policiesFromSources(control?.sources));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  useEffect(() => { setPolicies(policiesFromSources(control?.sources)); }, [control]);
  const savePolicies = async () => {
    setSaving(true); setSaved(false); setSaveError('');
    try {
      await onControlAction({ action: 'save-sources', sourcePolicies: policies });
      await onControlRefresh();
      await onRescan();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1_800);
    } catch (reason) { setSaveError(reason?.message || String(reason)); }
    finally { setSaving(false); }
  };
  const configureSource = async (sourceId, csvPath) => {
    const next = await onControlAction({ action: 'configure-source', sourceId, csvPath });
    setPolicies((current) => ({ ...policiesFromSources(next.sources), ...current }));
    await onControlRefresh();
    return next;
  };
  const terminal = `${data.device?.terminal?.name || 'Terminal'}${data.device?.terminal?.version ? ` v${String(data.device.terminal.version).replace(/^v/i, '')}` : ''}`;
  const architecture = data.device?.os?.architecture;
  const os = `${data.device?.os?.name || 'OS'}${data.device?.os?.version ? ` ${data.device.os.version}` : ''}${architecture ? ` (${architecture})` : ''}`;
  const collector = data.device?.collector?.version || data.device?.collectorVersion || 'local';
  const sources = data.sources || [];
  const diagnostics = data.diagnostics || {};
  const bucketCount = sources.reduce((sum, item) => sum + (item.bucketCount || 0), 0);
  const sessionCount = sources.reduce((sum, item) => sum + (item.sessionCount || 0), 0);
  const warningCount = sources.reduce((sum, item) => sum + (item.warningCount || 0), 0);
  const issueSources = sources.filter((item) => item.status !== 'ok');
  const rejected = diagnostics.rejected?.length || 0;
  const parsedFacts = (diagnostics.parsedBuckets || bucketCount) + (diagnostics.parsedSessions || sessionCount);
  const acceptedFacts = (diagnostics.acceptedBuckets ?? bucketCount) + (diagnostics.acceptedSessions ?? sessionCount);
  const sourceId = (item) => item.source || item.id;
  const needsAttention = Boolean(issueSources.length || warningCount || rejected);
  const healthLabel = needsAttention
    ? (zh ? '需要留意' : 'Needs attention')
    : (zh ? '健康' : 'Healthy');

  return <section className="management-page-stack" id="sources">
    <DataSourceControls control={control} policies={policies} onChange={setPolicies} onConfigure={configureSource} onSave={savePolicies} saving={saving} saved={saved} zh={zh}/>
    {saveError ? <p className="sync-error" role="alert"><AlertTriangle size={15}/>{saveError}</p> : null}
    <section className="source-summary-grid" aria-label={zh ? '本机数据健康摘要' : 'Local data health summary'}>
      <article><span><Database size={15}/>{zh ? '已接受事实' : 'Accepted facts'}</span><strong>{acceptedFacts.toLocaleString()}</strong><small>{bucketCount.toLocaleString()} buckets · {sessionCount.toLocaleString()} sessions</small></article>
      <article><span><CheckCircle2 size={15}/>{zh ? '数据源健康' : 'Source health'}</span><strong className={needsAttention ? 'warning' : 'positive'}>{healthLabel}</strong><small>{sources.length - issueSources.length} / {sources.length} {zh ? '来源正常' : 'sources healthy'}</small></article>
      <article><span><FileWarning size={15}/>{zh ? '解析证据' : 'Parse evidence'}</span><strong className={warningCount || rejected ? 'warning' : ''}>{warningCount + rejected}</strong><small>{warningCount} {zh ? '条警告' : 'warnings'} · {rejected} {zh ? '条拒绝' : 'rejected'}</small></article>
      <article><span><Clock3 size={15}/>{zh ? '最近扫描' : 'Last scan'}</span><strong>{scanTime(data.generatedAt, zh)}</strong><small>{parsedFacts.toLocaleString()} {zh ? '条已解析事实' : 'parsed facts'}</small></article>
    </section>

    <section className="management-grid">
      <article className="panel device-card">
        <header className="panel-header"><div><h2>{zh ? '本机环境与 Collector' : 'Local environment & Collector'}</h2><p>{zh ? '终端、操作系统、Collector 与 Agent 版本均来自本机事实' : 'Terminal, OS, Collector, and agent versions are local facts'}</p></div><span className="panel-meta">LOCAL ONLY</span></header>
        <div className="device-primary"><Monitor size={19}/><div><b>{terminal}</b><span>{os} · Collector v{String(collector).replace(/^v/i, '')}</span><small>{zh ? '浏览器只收到脱敏诊断；完整用户目录和数据根路径不会进入页面。' : 'The browser receives redacted diagnostics; full home and data-root paths never enter the page.'}</small></div></div>
        <div className="source-list">{sources.map((item) => <article className={item.status === 'ok' && !item.warningCount ? '' : 'source-has-issue'} key={sourceId(item)}><ToolGlyph id={sourceId(item)} size={18}/><div><b>{item.label || sourceLabel(sourceId(item))}</b><span>{item.bucketCount || 0} buckets · {item.sessionCount || 0} sessions{item.warningCount ? ` · ${item.warningCount} ${zh ? '条警告' : 'warnings'}` : ''}</span>{item.error ? <small className="source-error">{item.error}</small> : null}</div><small>{data.agentVersions?.[sourceId(item)] ? `v${String(data.agentVersions[sourceId(item)]).replace(/^v/i, '')}` : '—'}</small><em className={item.status === 'ok' ? 'ok' : item.status}>{item.status === 'ok' ? <CheckCircle2 size={13}/> : <AlertTriangle size={13}/>}<span>{item.status === 'ok' ? 'ok' : item.status}</span></em></article>)}</div>
      </article>

      <article className="panel privacy-card">
        <header className="panel-header"><div><h2>{zh ? '数据边界与所有权' : 'Data boundaries & ownership'}</h2><p>{zh ? '本机分析、供应商查询、社区同步与公开参与彼此独立' : 'Local analysis, provider checks, community sync, and public participation stay separate'}</p></div></header>
        <dl><div><dt><ShieldCheck size={16}/>{zh ? '本机看板通信' : 'Local dashboard traffic'}</dt><dd>127.0.0.1</dd><p>{zh ? '浏览器只访问本机服务；“重新扫描”不会触发社区同步。' : 'The browser talks only to the local service; Rescan never triggers community sync.'}</p></div><div><dt><CircleDollarSign size={16}/>{zh ? '价值口径' : 'Value basis'}</dt><dd>USD</dd><p>{zh ? `${data.pricing.version} · ${data.pricing.entryCount} 条标准 API 价格；这是等价价值，不是实际账单，也不做隐含汇率换算。` : `${data.pricing.version} · ${data.pricing.entryCount} standard API prices; equivalent value, not a bill, with no implicit FX conversion.`}</p></div><div><dt><ShieldCheck size={16}/>{zh ? '社区数据控制' : 'Community data control'}</dt><dd className={data.community.connected ? 'connected' : ''}>{data.community.connected ? (zh ? '已连接' : 'Connected') : (zh ? '未连接' : 'Not connected')}</dd><p>{zh ? '你决定同步哪些 Agent；停止同步不删除历史，删除当前设备数据需要单独确认。公开参与由社区账号设置控制。' : 'You choose which agents sync. Stopping sync keeps history; deleting this device’s cloud data requires separate confirmation. Public participation is an account setting.'}</p></div></dl>
        <a className="community-link" href={data.community.url} target="_blank" rel="noreferrer">{zh ? '打开社区用量中心' : 'Open community usage center'}<ExternalLink size={13}/></a>
      </article>
    </section>

    {(warningCount || rejected || issueSources.length) ? <section className="panel diagnostics-panel" role="status"><header className="panel-header"><div><h2><AlertTriangle size={15}/>{zh ? '需要留意的解析证据' : 'Parsing evidence needing attention'}</h2><p>{zh ? '异常只影响对应来源；其他已接受事实仍会正常分析。重新扫描后可再次检查。' : 'Issues affect only their source; other accepted facts remain usable. Rescan to check again.'}</p></div></header><div className="diagnostic-list">{issueSources.map((source) => <article key={sourceId(source)}><ToolGlyph id={sourceId(source)} size={16}/><div><b>{source.label || sourceLabel(sourceId(source))}</b><p>{source.error || (zh ? '该来源本次扫描未达到健康状态。' : 'This source was not healthy during the latest scan.')}</p></div></article>)}{(diagnostics.rejected || []).slice(0, 6).map((item, index) => <article key={`${item.source}-${item.kind}-${index}`}><FileWarning size={16}/><div><b>{sourceLabel(item.source)} · {item.kind}</b><p>{item.error}</p></div></article>)}</div></section> : null}
  </section>;
}
