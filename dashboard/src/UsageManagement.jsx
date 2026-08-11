import { CheckCircle2, CircleDollarSign, ExternalLink, Monitor, ShieldCheck } from 'lucide-react';
import { sourceLabel } from './format.js';
import { ToolGlyph } from './tool-glyphs.js';

export function UsageManagement({ data, zh }) {
  const terminal = `${data.device?.terminal?.name || 'Terminal'}${data.device?.terminal?.version ? ` v${String(data.device.terminal.version).replace(/^v/i, '')}` : ''}`;
  const os = `${data.device?.os?.name || 'OS'}${data.device?.os?.version ? ` ${data.device.os.version}` : ''}${data.device?.os?.arch ? ` (${data.device.os.arch})` : ''}`;
  const collector = data.device?.collector?.version || data.device?.collectorVersion || 'local';
  const bucketCount = data.sources.reduce((sum, item) => sum + (item.bucketCount || 0), 0);
  const sessionCount = data.sources.reduce((sum, item) => sum + (item.sessionCount || 0), 0);
  const sourceId = (item) => item.source || item.id;
  return <section className="management-grid" id="sources">
    <article className="panel device-card">
      <header className="panel-header"><div><h2>{zh ? '本机与数据源' : 'Local device & sources'}</h2><p>{zh ? '真实终端、操作系统、Collector 与 Agent 版本' : 'Actual terminal, OS, Collector, and agent versions'}</p></div><span className="panel-meta">LOCAL ONLY</span></header>
      <div className="device-primary"><Monitor size={19}/><div><b>{terminal}</b><span>{os} · Collector v{String(collector).replace(/^v/i, '')}</span><small>{bucketCount.toLocaleString()} buckets · {sessionCount.toLocaleString()} sessions · {zh ? '本地浏览器会话' : 'local browser session'}</small></div></div>
      <div className="source-list">{data.sources.map((item) => <article key={sourceId(item)}><ToolGlyph id={sourceId(item)} size={17}/><div><b>{item.label || sourceLabel(sourceId(item))}</b><span>{item.bucketCount || 0} buckets · {item.sessionCount || 0} sessions</span></div><small>{data.agentVersions?.[sourceId(item)] ? `v${String(data.agentVersions[sourceId(item)]).replace(/^v/i, '')}` : '—'}</small><em className={item.status === 'ok' ? 'ok' : item.status}>{item.status === 'ok' ? <CheckCircle2 size={13}/> : null}{item.status}</em></article>)}</div>
    </article>
    <article className="panel privacy-card">
      <header className="panel-header"><div><h2>{zh ? '本地隐私边界' : 'Local privacy boundary'}</h2><p>{zh ? '本页只读；社区同步与本地分析相互独立' : 'Read-only view; community sync and local analysis are separate'}</p></div></header>
      <dl><div><dt><ShieldCheck size={16}/>{zh ? '看板网络上传' : 'Dashboard upload'}</dt><dd>{zh ? '关闭' : 'Off'}</dd><p>{zh ? '页面只访问 127.0.0.1，不会把分析结果自动发送到社区。' : 'The page only talks to 127.0.0.1 and never uploads analytics automatically.'}</p></div><div><dt><CircleDollarSign size={16}/>{zh ? '价格口径' : 'Pricing basis'}</dt><dd>{data.pricing.version}</dd><p>{zh ? `${data.pricing.entryCount} 条标准 API 价格；估费不代表订阅账单。` : `${data.pricing.entryCount} standard API entries; estimates are not subscription bills.`}</p></div><div><dt><ShieldCheck size={16}/>{zh ? '社区同步' : 'Community sync'}</dt><dd className={data.community.connected ? 'connected' : ''}>{data.community.connected ? (zh ? '已配置' : 'Configured') : (zh ? '未配置' : 'Not configured')}</dd><p>{zh ? '只有你主动在终端执行 sync 时，Collector 才会连接社区。' : 'Collector connects only when you explicitly run sync in the terminal.'}</p></div></dl>
      <a className="community-link" href={data.community.url} target="_blank" rel="noreferrer">{zh ? '打开社区用量中心' : 'Open community usage center'}<ExternalLink size={13}/></a>
    </article>
  </section>;
}
