import {
  AlertTriangle, CheckCircle2, CircleDollarSign, Clock3, Database, ExternalLink,
  FileWarning, Monitor, ShieldCheck,
} from 'lucide-react';
import { sourceLabel } from './format.js';
import { ToolGlyph } from './tool-glyphs.js';

function scanTime(value, zh) {
  if (!value) return '—';
  return new Date(value).toLocaleString(zh ? 'zh-CN' : 'en-US', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function UsageManagement({ data, zh }) {
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
        <header className="panel-header"><div><h2>{zh ? '本地隐私边界' : 'Local privacy boundary'}</h2><p>{zh ? '本地分析、供应商查询与社区同步彼此独立' : 'Local analysis, provider checks, and community sync stay separate'}</p></div></header>
        <dl><div><dt><ShieldCheck size={16}/>{zh ? '看板网络上传' : 'Dashboard upload'}</dt><dd>{data.locality?.networkRequests === 0 ? (zh ? '关闭' : 'Off') : '—'}</dd><p>{zh ? '页面只访问 127.0.0.1；本机分析不会自动发送到社区。' : 'The page only talks to 127.0.0.1; local analytics are never uploaded automatically.'}</p></div><div><dt><CircleDollarSign size={16}/>{zh ? '价值口径' : 'Value basis'}</dt><dd>USD</dd><p>{zh ? `${data.pricing.version} · ${data.pricing.entryCount} 条标准 API 价格；这是等价价值，不是实际账单，也不做隐含汇率换算。` : `${data.pricing.version} · ${data.pricing.entryCount} standard API prices; equivalent value, not a bill, with no implicit FX conversion.`}</p></div><div><dt><ShieldCheck size={16}/>{zh ? '社区同步' : 'Community sync'}</dt><dd className={data.community.connected ? 'connected' : ''}>{data.community.connected ? (zh ? '已配置' : 'Configured') : (zh ? '未配置' : 'Not configured')}</dd><p>{zh ? '只有你主动触发同步时 Collector 才连接社区；权益与支出默认不进入同步。' : 'Collector connects only after an explicit sync; benefits and spend are excluded by default.'}</p></div></dl>
        <a className="community-link" href={data.community.url} target="_blank" rel="noreferrer">{zh ? '打开社区用量中心' : 'Open community usage center'}<ExternalLink size={13}/></a>
      </article>
    </section>

    {(warningCount || rejected || issueSources.length) ? <section className="panel diagnostics-panel" role="status"><header className="panel-header"><div><h2><AlertTriangle size={15}/>{zh ? '需要留意的解析证据' : 'Parsing evidence needing attention'}</h2><p>{zh ? '异常只影响对应来源；其他已接受事实仍会正常分析。重新扫描后可再次检查。' : 'Issues affect only their source; other accepted facts remain usable. Rescan to check again.'}</p></div></header><div className="diagnostic-list">{issueSources.map((source) => <article key={sourceId(source)}><ToolGlyph id={sourceId(source)} size={16}/><div><b>{source.label || sourceLabel(sourceId(source))}</b><p>{source.error || (zh ? '该来源本次扫描未达到健康状态。' : 'This source was not healthy during the latest scan.')}</p></div></article>)}{(diagnostics.rejected || []).slice(0, 6).map((item, index) => <article key={`${item.source}-${item.kind}-${index}`}><FileWarning size={16}/><div><b>{sourceLabel(item.source)} · {item.kind}</b><p>{item.error}</p></div></article>)}</div></section> : null}
  </section>;
}
