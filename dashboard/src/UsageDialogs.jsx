import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, FileJson, FileSpreadsheet, Info, LoaderCircle, Share2, ShieldCheck, X } from 'lucide-react';
import { toPng } from 'html-to-image';
import { analyze, RANGE_OPTIONS } from './analytics.js';
import { compact, money, percent } from './format.js';
import { UsagePoster } from './UsagePoster.jsx';

function Dialog({ open, onClose, title, subtitle, children, wide = false, method = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('dialog-open');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('dialog-open'); };
  }, [open, onClose]);
  if (!open) return null;
  return <div className="dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`dialog ${wide ? 'dialog--wide' : ''} ${method ? 'dialog--method' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button className="icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18}/></button></header>{children}</section></div>;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function ExportDialog({ open, onClose, report, data, filters, zh }) {
  const [format, setFormat] = useState('csv');
  const exportNow = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      const payload = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        scope: 'all-local-history',
        generatedAt: data.generatedAt,
        device: data.device,
        pricing: data.pricing,
        sources: data.sources,
        totals: analyze(data, { ...filters, range: 'all' }).totals,
        counts: { buckets: data.buckets.length, sessions: data.sessions.length, activityHours: data.activityHours.length },
        buckets: data.buckets,
        sessions: data.sessions,
        activityHours: data.activityHours,
        truncated: false,
      };
      downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `kimi-usage-all-${stamp}.json`);
    } else {
      const keys = ['time','source','model','modelCanonical','reasoningEffort','agentVersion','modelProvider','project','inputTokens','cacheWriteInputTokens','cacheReadInputTokens','outputTokens','reasoningOutputTokens','totalTokens','requestCount','costMicros','status'];
      const lines = [keys.map(csvCell).join(','), ...report.recordsByBucket.map((record) => keys.map((key) => csvCell(record[key])).join(','))];
      downloadBlob(new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }), `kimi-usage-${filters.range}-${stamp}.csv`);
    }
    onClose();
  };
  return <Dialog open={open} onClose={onClose} title={zh ? '导出用量数据' : 'Export usage data'} subtitle={zh ? '文件在当前浏览器中生成，不会上传。' : 'Generated in this browser; nothing is uploaded.'}><div className="export-options"><button type="button" className={format === 'csv' ? 'selected' : ''} onClick={() => setFormat('csv')}><FileSpreadsheet size={22}/><span><b>CSV · {zh ? '当前筛选' : 'Current filters'}</b><small>{zh ? `${report.recordsByBucket.length.toLocaleString()} 个 30 分钟聚合组 · 适合表格分析 · UTF-8` : `${report.recordsByBucket.length.toLocaleString()} 30-minute groups · spreadsheet-ready`}</small></span>{format === 'csv' ? <Check size={16}/> : null}</button><button type="button" className={format === 'json' ? 'selected' : ''} onClick={() => setFormat('json')}><FileJson size={22}/><span><b>JSON · {zh ? '全部本地历史' : 'All local history'}</b><small>{zh ? `${data.buckets.length.toLocaleString()} buckets · ${data.sessions.length.toLocaleString()} sessions · 不受当前筛选影响` : `${data.buckets.length.toLocaleString()} buckets · ${data.sessions.length.toLocaleString()} sessions · ignores filters`}</small></span>{format === 'json' ? <Check size={16}/> : null}</button></div><div className="export-summary"><span>{zh ? '当前 Token' : 'Current tokens'} <b>{compact(report.totals.totalTokens)}</b></span><span>{zh ? '当前估算' : 'Current estimate'} <b>{money(report.totals.costMicros)}</b></span><span>{zh ? '截断' : 'Truncated'} <b>{zh ? '否' : 'No'}</b></span></div><div className="export-privacy"><ShieldCheck size={15}/><p>{zh ? 'JSON 是私人原始事实导出，可能包含项目 basename、模型和本机环境元数据。分享前请自行检查；不会包含对话正文、完整路径或凭据。' : 'JSON is a private raw-fact export and may contain project basenames, models, and device metadata. Review before sharing; it never contains conversation text, full paths, or credentials.'}</p></div><footer className="dialog-actions"><button type="button" className="ghost-btn" onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button type="button" className="primary-btn" onClick={exportNow}><Download size={15}/>{zh ? '下载文件' : 'Download'}</button></footer></Dialog>;
}

function modelPriceRows(report) {
  const rows = new Map();
  for (const bucket of report.buckets) {
    const model = bucket.modelCanonical || bucket.model || 'unknown';
    if (!rows.has(model)) rows.set(model, bucket);
  }
  return [...rows].map(([model, bucket]) => ({ model, bucket })).sort((a, b) => a.model.localeCompare(b.model));
}

export function MethodDialog({ open, onClose, zh, data, report }) {
  const rows = modelPriceRows(report);
  return <Dialog open={open} onClose={onClose} method title={zh ? '计算与数据说明' : 'Calculation & data notes'} subtitle={zh ? `本地时区 · 标准 API 价格目录 ${data.pricing.version} · 覆盖 ${percent(report.pricingCoverage)} Token` : `Local timezone · standard API catalog ${data.pricing.version} · ${percent(report.pricingCoverage)} coverage`}><div className="method-copy"><section className="method-grid"><article><b>{zh ? 'Token 与图表' : 'Tokens & charts'}</b><p>{zh ? '总 Token = 输入 + 缓存写 + 缓存读 + 输出 + 推理。趋势先按 30 分钟事实桶汇总，再按当前范围显示为小时、日或自然周；不会把同一 Token 重复计算。' : 'Total tokens are input + cache write + cache read + output + reasoning. Charts roll up 30-minute facts into hours, days, or natural weeks without double counting.'}</p></article><article><b>{zh ? '标准 API 费用' : 'Standard API cost'}</b><p>{zh ? '费用 = Σ(每类 Token × 该时点生效的模型单价) ÷ 1,000,000。缓存写、缓存读、输出和推理分别计价；这是 API 等价估算，不代表订阅账单。' : 'Cost = Σ(token class × model price effective at that time) ÷ 1,000,000. Cache write/read, output, and reasoning are priced separately. This is not a subscription invoice.'}</p></article><article><b>{zh ? '时长与活跃' : 'Time & activity'}</b><p>{zh ? '活跃时长来自 Collector 的小时 activity slice，只累计可识别的 Agent 工作；投入时长包含活动间隔，但单次空闲最多计 30 分钟。模型与推理强度无法可靠拆分会话时长。' : 'Active time comes from hourly activity slices. Engaged time includes gaps capped at 30 minutes. Session time cannot be reliably split by model or effort.'}</p></article><article><b>{zh ? '变化百分比' : 'Percentage changes'}</b><p>{zh ? '与紧邻的等长上一周期比较：30D 对比此前 30D。绿色表示增加，红色表示减少；“全部”没有可靠的等长上一周期，因此不显示变化。' : 'Compared with the immediately preceding equal-length window. Green is an increase, red a decrease; All has no comparable prior period.'}</p></article></section><section className="pricing-match"><header><div><b>{zh ? '模型定价匹配' : 'Model pricing matches'}</b><span>{zh ? '单价单位：美元 / 百万 Token' : 'USD per million tokens'}</span></div><span>{rows.length} {zh ? '个模型' : 'models'}</span></header><div className="pricing-table-wrap"><table><thead><tr><th>{zh ? '日志模型' : 'Log model'}</th><th>{zh ? '匹配' : 'Match'}</th><th>{zh ? '上下文 / 处理' : 'Context / tier'}</th><th>{zh ? '输入' : 'Input'}</th><th>{zh ? '缓存读' : 'Cache'}</th><th>{zh ? '输出' : 'Output'}</th></tr></thead><tbody>{rows.map(({ model, bucket }) => <tr key={model}><td>{model}</td><td className={bucket.pricePattern ? 'priced' : ''}>{bucket.pricePattern || (zh ? '未匹配' : 'Unmatched')}</td><td>{bucket.pricePattern ? `${bucket.priceContextTier || 'default'} / ${bucket.priceProcessingTier || 'standard'}` : '—'}</td><td>{bucket.priceInput == null ? '—' : `$${bucket.priceInput}/M`}</td><td>{bucket.priceCacheRead == null ? '—' : `$${bucket.priceCacheRead}/M`}</td><td>{bucket.priceOutput == null ? '—' : `$${bucket.priceOutput}/M`}</td></tr>)}</tbody></table></div></section><article className="method-privacy"><b>{zh ? '隐私与可信度' : 'Privacy & trust'}</b><p>{zh ? '页面只读取 Collector 已标准化的本地事实，不读取对话正文。数据来自工具日志，可能因日志格式、保留期或解析器版本而不完整；它适合个人洞察，不是可验证的计量凭证。' : 'The page reads only normalized local facts and never conversation text. Tool logs may be incomplete due to format, retention, or parser version; this is personal insight, not verified metering.'}</p></article></div><footer className="dialog-actions"><span>{zh ? `${report.totals.unpricedTokens.toLocaleString()} Token 未定价但仍保留统计` : `${report.totals.unpricedTokens.toLocaleString()} unpriced tokens remain counted`}</span><button type="button" className="primary-btn" onClick={onClose}>{zh ? '知道了' : 'Got it'}</button></footer></Dialog>;
}

export function ShareDialog({ open, onClose, data, filters, initialRange, zh }) {
  const [range, setRange] = useState(initialRange === 'all' ? 'all' : initialRange);
  const [name, setName] = useState(() => localStorage.getItem('kbu.poster.name') || 'Local Builder');
  const [handle, setHandle] = useState(() => localStorage.getItem('kbu.poster.handle') || 'local');
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const posterRef = useRef(null);
  const report = useMemo(() => analyze(data, { ...filters, range }), [data, filters, range]);
  useEffect(() => { if (open) setRange(initialRange); }, [open, initialRange]);
  useEffect(() => {
    if (!open || !posterRef.current) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setBusy(true); setError('');
      try {
        await document.fonts.ready;
        const url = await toPng(posterRef.current, { width: 1080, height: 1440, pixelRatio: 1, cacheBust: true, backgroundColor: '#050607' });
        if (!cancelled) setPreview(url);
      } catch (reason) { if (!cancelled) setError(reason?.message || String(reason)); }
      finally { if (!cancelled) setBusy(false); }
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, range, name, handle, report]);
  const persistIdentity = () => { localStorage.setItem('kbu.poster.name', name.trim() || 'Local Builder'); localStorage.setItem('kbu.poster.handle', handle.trim().replace(/^@/, '') || 'local'); };
  const download = () => { persistIdentity(); if (!preview) return; const anchor = document.createElement('a'); anchor.href = preview; anchor.download = `kimi-builders-usage-${range}.png`; anchor.click(); };
  const share = async () => {
    persistIdentity(); if (!preview || !navigator.share) return download();
    const blob = await (await fetch(preview)).blob(); const file = new File([blob], `kimi-builders-usage-${range}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Kimi Builders Usage' }); else download();
  };
  return <Dialog open={open} onClose={onClose} wide title={zh ? '分享成绩' : 'Share your stats'} subtitle={zh ? '海报在本机生成；身份只保存在当前浏览器。' : 'Generated locally; poster identity stays in this browser.'}><div className="share-layout"><div className="poster-preview">{preview ? <img src={preview} alt={zh ? '用量分享海报预览' : 'Usage poster preview'}/> : <div className="poster-loading"><LoaderCircle className="spin"/><span>{zh ? '生成海报中…' : 'Rendering poster…'}</span></div>}{busy && preview ? <span className="preview-refresh"><LoaderCircle className="spin" size={14}/>{zh ? '正在更新' : 'Updating'}</span> : null}</div><div className="share-controls"><label><span>{zh ? '时间范围' : 'Time range'}</span><div className="share-ranges">{RANGE_OPTIONS.map((item) => <button type="button" key={item.id} className={range === item.id ? 'active' : ''} onClick={() => setRange(item.id)}>{zh ? item.zh : item.en}</button>)}</div></label><label><span>{zh ? '海报名称' : 'Poster name'}</span><input value={name} maxLength={24} onChange={(event) => setName(event.target.value)}/></label><label><span>{zh ? '公开称呼' : 'Public handle'}</span><div className="handle-input"><i>@</i><input value={handle} maxLength={24} onChange={(event) => setHandle(event.target.value.replace(/^@/, ''))}/></div></label><div className="share-facts"><Info size={15}/><p>{zh ? '海报展示 Token、API 等价价值、活跃时长、缓存命中、常用 Agent、主力模型与推理强度，不包含项目名、设备名或对话内容。' : 'The poster includes usage, value, time, cache hit, agents, model, and effort—never project, device, or conversation content.'}</p></div>{error ? <p className="dialog-error">{error}</p> : null}<div className="share-buttons"><button type="button" className="ghost-btn" onClick={download} disabled={!preview}><Download size={15}/>{zh ? '下载 PNG' : 'Download PNG'}</button><button type="button" className="primary-btn" onClick={share} disabled={!preview}><Share2 size={15}/>{zh ? '系统分享' : 'Share'}</button></div></div></div><div className="poster-render-host" aria-hidden="true"><UsagePoster ref={posterRef} report={report} range={range} identity={{ name: name.trim() || 'Local Builder', handle: handle.trim() || 'local' }} communityUrl={data.community.url} generatedAt={data.generatedAt}/></div></Dialog>;
}
