import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, FileJson, FileSpreadsheet, Info, LoaderCircle, Share2, X } from 'lucide-react';
import { toPng } from 'html-to-image';
import { analyze, RANGE_OPTIONS } from './analytics.js';
import { compact, dateTime, money } from './format.js';
import { UsagePoster } from './UsagePoster.jsx';

function Dialog({ open, onClose, title, subtitle, children, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`dialog ${wide ? 'dialog--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
      {children}
    </section>
  </div>;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function ExportDialog({ open, onClose, report, filters, zh }) {
  const [format, setFormat] = useState('csv');
  const exportNow = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      const payload = { exportedAt: new Date().toISOString(), filters, summary: report.totals, records: report.records };
      downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `kimi-usage-${filters.range}-${stamp}.json`);
    } else {
      const keys = ['bucketStart','source','model','modelCanonical','reasoningEffort','agentVersion','project','inputTokens','cacheWriteInputTokens','cacheReadInputTokens','outputTokens','reasoningOutputTokens','requestCount','costMicros','status'];
      const lines = [keys.map(csvCell).join(','), ...report.records.map((record) => keys.map((key) => csvCell(record[key])).join(','))];
      downloadBlob(new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }), `kimi-usage-${filters.range}-${stamp}.csv`);
    }
    onClose();
  };
  return <Dialog open={open} onClose={onClose} title={zh ? '导出本地用量' : 'Export local usage'} subtitle={zh ? '当前筛选范围；文件只在浏览器中生成。' : 'Current filters; generated entirely in this browser.'}>
    <div className="export-options">
      <button className={format === 'csv' ? 'selected' : ''} onClick={() => setFormat('csv')}><FileSpreadsheet size={22}/><span><b>CSV</b><small>{zh ? '适合表格分析 · UTF-8' : 'Spreadsheet-ready · UTF-8'}</small></span>{format === 'csv' ? <Check size={16}/> : null}</button>
      <button className={format === 'json' ? 'selected' : ''} onClick={() => setFormat('json')}><FileJson size={22}/><span><b>JSON</b><small>{zh ? '保留完整字段和元数据' : 'Full fields and metadata'}</small></span>{format === 'json' ? <Check size={16}/> : null}</button>
    </div>
    <div className="export-summary"><span>{zh ? '记录' : 'Records'} <b>{report.records.length.toLocaleString('en-US')}</b></span><span>Token <b>{compact(report.totals.totalTokens)}</b></span><span>{zh ? '估算' : 'Estimate'} <b>{money(report.totals.costMicros)}</b></span></div>
    <footer className="dialog-actions"><button className="ghost-btn" onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button className="primary-btn" onClick={exportNow}><Download size={15}/>{zh ? '下载文件' : 'Download'}</button></footer>
  </Dialog>;
}

export function MethodDialog({ open, onClose, zh }) {
  return <Dialog open={open} onClose={onClose} title={zh ? '计算与数据说明' : 'Calculation & data notes'}>
    <div className="method-copy">
      <article><b>Token</b><p>{zh ? '由各 Agent 本地日志中的输入、缓存写、缓存读、输出和推理 Token 汇总。总 Token = 五类 Token 之和。' : 'Summed from input, cache write, cache read, output, and reasoning tokens in local agent logs.'}</p></article>
      <article><b>{zh ? '费用估算' : 'Cost estimate'}</b><p>{zh ? '统一按模型对应的标准 API 单价估算，不代表订阅实际账单。无法可靠匹配价格的 Token 会保留，但不计入费用。' : 'Uses each model’s standard API list price. It is not a subscription invoice; unpriced tokens remain visible.'}</p></article>
      <article><b>{zh ? '活跃时长' : 'Active time'}</b><p>{zh ? '按本地日志中的 activity slice 累计；空闲等待不等同于活跃。所有时间按当前设备时区展示。' : 'Accumulated from local activity slices; idle waits are not treated as active work. Displayed in local time.'}</p></article>
      <article><b>{zh ? '变化百分比' : 'Change percentage'}</b><p>{zh ? '与紧邻的等长上一周期比较。例如 30D 对比之前 30D；绿色表示增加，红色表示减少。全部时间没有可比上一周期。' : 'Compared with the immediately preceding equal-length window. Green is an increase; red is a decrease.'}</p></article>
      <article><b>{zh ? '隐私边界' : 'Privacy boundary'}</b><p>{zh ? '本地看板不上传任何数据，不读取对话正文；项目名按 Collector 的隐私设置处理。只有用户主动执行社区同步时才会连接网络。' : 'The local dashboard uploads nothing and never reads conversation content. Network sync only occurs when explicitly requested.'}</p></article>
    </div>
    <footer className="dialog-actions"><button className="primary-btn" onClick={onClose}>{zh ? '知道了' : 'Got it'}</button></footer>
  </Dialog>;
}

export function ShareDialog({ open, onClose, data, source, model, initialRange, zh }) {
  const [range, setRange] = useState(initialRange === 'all' ? 'all' : initialRange);
  const [name, setName] = useState(() => localStorage.getItem('kbu.poster.name') || 'Local Builder');
  const [handle, setHandle] = useState(() => localStorage.getItem('kbu.poster.handle') || 'local');
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const posterRef = useRef(null);
  const report = useMemo(() => analyze(data, { range, source, model }), [data, range, source, model]);

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
      } catch (reason) {
        if (!cancelled) setError(reason?.message || String(reason));
      } finally { if (!cancelled) setBusy(false); }
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, range, name, handle, report]);

  const persistIdentity = () => {
    localStorage.setItem('kbu.poster.name', name.trim() || 'Local Builder');
    localStorage.setItem('kbu.poster.handle', handle.trim().replace(/^@/, '') || 'local');
  };
  const download = () => {
    persistIdentity();
    if (!preview) return;
    const anchor = document.createElement('a'); anchor.href = preview; anchor.download = `kimi-builders-usage-${range}.png`; anchor.click();
  };
  const share = async () => {
    persistIdentity();
    if (!preview || !navigator.share) return download();
    const blob = await (await fetch(preview)).blob();
    const file = new File([blob], `kimi-builders-usage-${range}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Kimi Builders Usage' });
    else download();
  };
  return <Dialog open={open} onClose={onClose} wide title={zh ? '分享成绩' : 'Share your stats'} subtitle={zh ? '海报在本机生成；显示身份只保存在当前浏览器。' : 'Generated locally; poster identity stays in this browser.'}>
    <div className="share-layout">
      <div className="poster-preview">
        {preview ? <img src={preview} alt={zh ? '用量分享海报预览' : 'Usage poster preview'} /> : <div className="poster-loading"><LoaderCircle className="spin"/><span>{zh ? '生成海报中…' : 'Rendering poster…'}</span></div>}
        {busy && preview ? <span className="preview-refresh"><LoaderCircle className="spin" size={14}/>{zh ? '正在更新' : 'Updating'}</span> : null}
      </div>
      <div className="share-controls">
        <label><span>{zh ? '时间范围' : 'Time range'}</span><div className="share-ranges">{RANGE_OPTIONS.map((item) => <button key={item.id} className={range === item.id ? 'active' : ''} onClick={() => setRange(item.id)}>{zh ? item.zh : item.en}</button>)}</div></label>
        <label><span>{zh ? '海报名称' : 'Poster name'}</span><input value={name} maxLength={24} onChange={(event) => setName(event.target.value)} /></label>
        <label><span>{zh ? '公开称呼' : 'Public handle'}</span><div className="handle-input"><i>@</i><input value={handle} maxLength={24} onChange={(event) => setHandle(event.target.value.replace(/^@/, ''))} /></div></label>
        <div className="share-facts"><Info size={15}/><p>{zh ? '海报展示 Token、API 等价价值、活跃时长、缓存命中、常用 Agent 和主力模型，不包含项目名、设备名或对话内容。' : 'The poster includes usage stats, top agents, and model—never project, device, or conversation content.'}</p></div>
        {error ? <p className="dialog-error">{error}</p> : null}
        <div className="share-buttons"><button className="ghost-btn" onClick={download} disabled={!preview}><Download size={15}/>{zh ? '下载 PNG' : 'Download PNG'}</button><button className="primary-btn" onClick={share} disabled={!preview}><Share2 size={15}/>{zh ? '分享海报' : 'Share poster'}</button></div>
      </div>
    </div>
    <div className="poster-render-host" aria-hidden="true"><UsagePoster ref={posterRef} report={report} range={range} identity={{ name: name.trim() || 'Local Builder', handle: handle.trim() || 'local' }} communityUrl={data.community.url} generatedAt={data.generatedAt}/></div>
  </Dialog>;
}
