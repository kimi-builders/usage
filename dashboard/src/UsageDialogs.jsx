import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, Download, FileJson, FileSpreadsheet, ImagePlus, Info, LoaderCircle, Share2, ShieldCheck, Trash2, X } from 'lucide-react';
import { toPng } from 'html-to-image';
import { analyze, EMPTY_FILTERS, RANGE_OPTIONS } from './analytics.js';
import { compactNumber, DISPLAY_CURRENCIES, DISPLAY_FX_AS_OF, DISPLAY_FX_SOURCE, DISPLAY_FX_SOURCE_URL, money, percent } from './format.js';
import { UsagePoster } from './UsagePoster.jsx';

export function Dialog({ open, onClose, title, subtitle, children, wide = false, method = false, className = '' }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const focusables = () => [...(dialogRef.current?.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled):not([tabindex="-1"]), select:not(:disabled), [tabindex]:not([tabindex="-1"])') || [])];
    const onKey = (event) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const frame = window.requestAnimationFrame(() => focusables()[0]?.focus());
    document.addEventListener('keydown', onKey);
    document.body.classList.add('dialog-open');
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('dialog-open');
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return <div className="dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section ref={dialogRef} className={`dialog ${wide ? 'dialog--wide' : ''} ${method ? 'dialog--method' : ''} ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}><header><div><h2 id={titleId}>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button className="icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18}/></button></header>{children}</section></div>;
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
        totals: analyze(data, { ...EMPTY_FILTERS, range: 'all' }).totals,
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
  return <Dialog open={open} onClose={onClose} title={zh ? '导出用量数据' : 'Export usage data'} subtitle={zh ? '文件在当前浏览器中生成，不会上传。' : 'Generated in this browser; nothing is uploaded.'}><div className="export-options"><button type="button" className={format === 'csv' ? 'selected' : ''} onClick={() => setFormat('csv')}><FileSpreadsheet size={22}/><span><b>CSV · {zh ? '当前筛选' : 'Current filters'}</b><small>{zh ? `${report.recordsByBucket.length.toLocaleString()} 个 30 分钟聚合组 · 适合表格分析 · UTF-8` : `${report.recordsByBucket.length.toLocaleString()} 30-minute groups · spreadsheet-ready`}</small></span>{format === 'csv' ? <Check size={16}/> : null}</button><button type="button" className={format === 'json' ? 'selected' : ''} onClick={() => setFormat('json')}><FileJson size={22}/><span><b>JSON · {zh ? '全部本地历史' : 'All local history'}</b><small>{zh ? `${data.buckets.length.toLocaleString()} buckets · ${data.sessions.length.toLocaleString()} sessions · 不受当前筛选影响` : `${data.buckets.length.toLocaleString()} buckets · ${data.sessions.length.toLocaleString()} sessions · ignores filters`}</small></span>{format === 'json' ? <Check size={16}/> : null}</button></div><div className="export-summary"><span>{zh ? '当前 Token' : 'Current tokens'} <b>{compactNumber(report.totals.totalTokens, zh ? 'zh' : 'en')}</b></span><span>{zh ? '当前估算' : 'Current estimate'} <b>{money(report.totals.costMicros)}</b></span><span>{zh ? '截断' : 'Truncated'} <b>{zh ? '否' : 'No'}</b></span></div><div className="export-privacy"><ShieldCheck size={15}/><p>{zh ? 'JSON 是私人原始事实导出，可能包含项目 basename、模型和本机环境元数据。分享前请自行检查；不会包含对话正文、完整路径或凭据。' : 'JSON is a private raw-fact export and may contain project basenames, models, and device metadata. Review before sharing; it never contains conversation text, full paths, or credentials.'}</p></div><footer className="dialog-actions"><button type="button" className="ghost-btn" onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button type="button" className="primary-btn" onClick={exportNow}><Download size={15}/>{zh ? '下载文件' : 'Download'}</button></footer></Dialog>;
}

function modelPriceRows(report) {
  const rows = new Map();
  for (const bucket of report.buckets) {
    const model = bucket.modelCanonical || bucket.model || 'unknown';
    if (!rows.has(model)) rows.set(model, bucket);
  }
  return [...rows].map(([model, bucket]) => ({ model, bucket })).sort((a, b) => a.model.localeCompare(b.model));
}

export function MethodDialog({ open, onClose, zh, data, report, currency = 'usd' }) {
  const rows = modelPriceRows(report);
  const displayCurrency = DISPLAY_CURRENCIES[currency] || DISPLAY_CURRENCIES.usd;
  const displayNote = currency === 'cny'
    ? (zh ? `当前以 CNY 展示 · 底层单价仍为 USD · 1 USD = ¥${displayCurrency.rate} · 来源 ${DISPLAY_FX_SOURCE}（${DISPLAY_FX_AS_OF}）` : `Displayed in CNY · source prices remain USD · 1 USD = ¥${displayCurrency.rate} · source ${DISPLAY_FX_SOURCE} (${DISPLAY_FX_AS_OF})`)
    : (zh ? '当前以 USD 展示 · 不进行汇率换算' : 'Displayed in USD · no currency conversion');
  return <Dialog open={open} onClose={onClose} method title={zh ? '计算与数据说明' : 'Calculation & data notes'} subtitle={zh ? `本地时区 · 标准 API 价格目录 ${data.pricing.version} · 覆盖 ${percent(report.pricingCoverage)} Token` : `Local timezone · standard API catalog ${data.pricing.version} · ${percent(report.pricingCoverage)} coverage`}><div className="method-copy"><section className="method-grid"><article><b>{zh ? 'Token 与图表' : 'Tokens & charts'}</b><p>{zh ? '总 Token = 输入 + 缓存写 + 缓存读 + 输出 + 推理。趋势先按 30 分钟事实桶汇总，再按当前范围显示为小时、日或自然周；不会把同一 Token 重复计算。' : 'Total tokens are input + cache write + cache read + output + reasoning. Charts roll up 30-minute facts into hours, days, or natural weeks without double counting.'}</p></article><article><b>{zh ? '标准 API 费用' : 'Standard API cost'}</b><p>{zh ? `费用 = Σ(每类 Token × 该时点生效的模型美元单价) ÷ 1,000,000。缓存写、缓存读、输出和推理分别计价；这是 API 等价估算，不代表订阅账单。${displayNote}` : `Cost = Σ(token class × the effective USD model price) ÷ 1,000,000. Cache write/read, output, and reasoning are priced separately. This is not a subscription invoice. ${displayNote}`}</p>{currency === 'cny' ? <a href={DISPLAY_FX_SOURCE_URL} target="_blank" rel="noreferrer">{zh ? '查看 ECB 参考汇率来源' : 'Open ECB reference-rate source'}</a> : null}</article><article><b>{zh ? '时长与活跃' : 'Time & activity'}</b><p>{zh ? '活跃时长来自 Collector 的小时 activity slice，只累计可识别的 Agent 工作；投入时长包含活动间隔，但单次空闲最多计 30 分钟。模型与推理强度无法可靠拆分会话时长。' : 'Active time comes from hourly activity slices. Engaged time includes gaps capped at 30 minutes. Session time cannot be reliably split by model or effort.'}</p></article><article><b>{zh ? '变化百分比' : 'Percentage changes'}</b><p>{zh ? '与紧邻的等长上一周期比较：30D 对比此前 30D。绿色表示增加，红色表示减少；“全部”没有可靠的等长上一周期，因此不显示变化。' : 'Compared with the immediately preceding equal-length window. Green is an increase, red a decrease; All has no comparable prior period.'}</p></article></section><section className="pricing-match"><header><div><b>{zh ? '模型定价匹配' : 'Model pricing matches'}</b><span>{zh ? '原始单价单位：美元 / 百万 Token' : 'Source prices: USD per million tokens'}</span></div><span>{rows.length} {zh ? '个模型' : 'models'}</span></header><div className="pricing-table-wrap"><table><thead><tr><th>{zh ? '日志模型' : 'Log model'}</th><th>{zh ? '匹配' : 'Match'}</th><th>{zh ? '上下文 / 处理' : 'Context / tier'}</th><th>{zh ? '输入' : 'Input'}</th><th>{zh ? '缓存读' : 'Cache'}</th><th>{zh ? '输出' : 'Output'}</th></tr></thead><tbody>{rows.map(({ model, bucket }) => <tr key={model}><td>{model}</td><td className={bucket.pricePattern ? 'priced' : ''}>{bucket.pricePattern || (zh ? '未匹配' : 'Unmatched')}</td><td>{bucket.pricePattern ? `${bucket.priceContextTier || 'default'} / ${bucket.priceProcessingTier || 'standard'}` : '—'}</td><td>{bucket.priceInput == null ? '—' : `$${bucket.priceInput}/M`}</td><td>{bucket.priceCacheRead == null ? '—' : `$${bucket.priceCacheRead}/M`}</td><td>{bucket.priceOutput == null ? '—' : `$${bucket.priceOutput}/M`}</td></tr>)}</tbody></table></div></section><article className="method-privacy"><b>{zh ? '隐私与可信度' : 'Privacy & trust'}</b><p>{zh ? '页面只读取 Collector 已标准化的本地事实，不读取对话正文。数据来自工具日志，可能因日志格式、保留期或解析器版本而不完整；它适合个人洞察，不是可验证的计量凭证。' : 'The page reads only normalized local facts and never conversation text. Tool logs may be incomplete due to format, retention, or parser version; this is personal insight, not verified metering.'}</p></article></div><footer className="dialog-actions"><span>{zh ? `${report.totals.unpricedTokens.toLocaleString()} Token 未定价但仍保留统计` : `${report.totals.unpricedTokens.toLocaleString()} unpriced tokens remain counted`}</span><button type="button" className="primary-btn" onClick={onClose}>{zh ? '知道了' : 'Got it'}</button></footer></Dialog>;
}

const POSTER_AVATAR_KEY = 'kbu.poster.avatar.v1';
const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

async function squareAvatar(file, zh) {
  if (!file?.type?.startsWith('image/')) throw new Error(zh ? '请选择 PNG、JPG 或 WebP 图片' : 'Choose a PNG, JPG, or WebP image');
  if (file.size > MAX_AVATAR_BYTES) throw new Error(zh ? '图片不能超过 8 MB' : 'The image must be 8 MB or smaller');

  let source;
  let objectUrl = '';
  try {
    if ('createImageBitmap' in window) source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    else {
      objectUrl = URL.createObjectURL(file);
      source = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(zh ? '无法读取这张图片' : 'This image could not be read'));
        image.src = objectUrl;
      });
    }
    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;
    if (!width || !height) throw new Error(zh ? '图片尺寸无效' : 'The image dimensions are invalid');
    const side = Math.min(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 320;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(zh ? '当前浏览器无法处理头像' : 'This browser cannot process the avatar');
    context.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, 320, 320);
    const value = canvas.toDataURL('image/webp', .88);
    if (!value || value === 'data:,') throw new Error(zh ? '头像生成失败' : 'Avatar generation failed');
    return value;
  } finally {
    source?.close?.();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function AvatarEditor({ avatar, name, busy, onSelect, onRemove, zh }) {
  const inputRef = useRef(null);
  const initials = (name.trim() || 'Local Builder').slice(0, 2).toUpperCase();
  return <div className="poster-avatar-editor"><span className="share-field-title">{zh ? '海报头像' : 'Poster avatar'}</span><div><span className={`avatar-editor-preview ${avatar ? 'has-image' : ''}`}>{avatar ? <img src={avatar} alt=""/> : initials}</span><div className="avatar-editor-actions"><div><button type="button" className="ghost-btn" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={14}/> : <ImagePlus size={14}/>} {avatar ? (zh ? '更换头像' : 'Replace') : (zh ? '选择头像' : 'Choose image')}</button>{avatar ? <button type="button" className="avatar-remove" onClick={onRemove} disabled={busy}><Trash2 size={13}/>{zh ? '移除' : 'Remove'}</button> : null}</div><small>{zh ? '自动居中裁成方形，仅保存在当前浏览器。' : 'Center-cropped automatically and stored only in this browser.'}</small></div><input ref={inputRef} className="visually-hidden" tabIndex={-1} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onSelect(file); }} aria-label={zh ? '选择海报头像图片' : 'Choose poster avatar image'}/></div></div>;
}

export function ShareDialog({ open, onClose, data, filters, initialRange, zh }) {
  const [range, setRange] = useState(initialRange === 'all' ? 'all' : initialRange);
  const [name, setName] = useState(() => localStorage.getItem('kbu.poster.name') || 'Local Builder');
  const [handle, setHandle] = useState(() => localStorage.getItem('kbu.poster.handle') || 'local');
  const [avatar, setAvatar] = useState(() => localStorage.getItem(POSTER_AVATAR_KEY) || '');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState('');
  const posterRef = useRef(null);
  const revisionRef = useRef(0);
  const rangeRefs = useRef([]);
  const rangeLegendId = useId();
  const report = useMemo(() => analyze(data, { ...filters, range }), [data, filters, range]);
  useEffect(() => { if (open) setRange(initialRange); }, [open, initialRange]);
  useEffect(() => {
    if (!open || !posterRef.current) return undefined;
    const revision = revisionRef.current + 1;
    revisionRef.current = revision;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setBusy(true); setError(''); setShareError('');
      try {
        await document.fonts.ready;
        const url = await toPng(posterRef.current, { width: 1080, height: 1440, pixelRatio: 1, cacheBust: true, backgroundColor: '#050607' });
        if (!cancelled && revision === revisionRef.current) setPreview({ url, revision, report, range, name, handle, avatar, zh });
      } catch (reason) {
        if (!cancelled && revision === revisionRef.current) setError(reason?.message || String(reason));
      } finally {
        if (!cancelled && revision === revisionRef.current) setBusy(false);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (revisionRef.current === revision) revisionRef.current += 1;
    };
  }, [open, range, name, handle, avatar, report, zh]);
  const previewCurrent = Boolean(open && preview
    && preview.revision === revisionRef.current
    && preview.report === report
    && preview.range === range
    && preview.name === name
    && preview.handle === handle
    && preview.avatar === avatar
    && preview.zh === zh);
  const canUsePreview = previewCurrent && !busy && !avatarBusy && !sharing && !error;
  const selectAvatar = async (file) => {
    setAvatarBusy(true); setAvatarError('');
    try {
      const value = await squareAvatar(file, zh);
      localStorage.setItem(POSTER_AVATAR_KEY, value);
      setAvatar(value);
    } catch (reason) {
      setAvatarError(reason?.message || String(reason));
    } finally { setAvatarBusy(false); }
  };
  const removeAvatar = () => { localStorage.removeItem(POSTER_AVATAR_KEY); setAvatar(''); setAvatarError(''); };
  const persistIdentity = () => { localStorage.setItem('kbu.poster.name', name.trim() || 'Local Builder'); localStorage.setItem('kbu.poster.handle', handle.trim().replace(/^@/, '') || 'local'); };
  const savePreview = (snapshot) => {
    const anchor = document.createElement('a');
    anchor.href = snapshot.url;
    anchor.download = `kimi-builders-usage-${snapshot.range}.png`;
    anchor.click();
  };
  const download = () => {
    if (!canUsePreview || !preview) return;
    setShareError('');
    persistIdentity();
    savePreview(preview);
  };
  const share = async () => {
    if (!canUsePreview || !preview) return;
    const snapshot = preview;
    setShareError('');
    persistIdentity();
    if (!navigator.share) { savePreview(snapshot); return; }
    setSharing(true);
    try {
      const blob = await (await fetch(snapshot.url)).blob();
      if (snapshot.revision !== revisionRef.current) return;
      const file = new File([blob], `kimi-builders-usage-${snapshot.range}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Kimi Builders Usage' });
      else savePreview(snapshot);
    } catch (reason) {
      if (reason?.name !== 'AbortError' && snapshot.revision === revisionRef.current) setShareError(reason?.message || String(reason));
    } finally {
      setSharing(false);
    }
  };
  const onRangeKeyDown = (event, index) => {
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % RANGE_OPTIONS.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + RANGE_OPTIONS.length) % RANGE_OPTIONS.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = RANGE_OPTIONS.length - 1;
    if (next == null) return;
    event.preventDefault();
    setRange(RANGE_OPTIONS[next].id);
    rangeRefs.current[next]?.focus();
  };
  const previewUrl = preview?.url || '';
  return <Dialog open={open} onClose={onClose} wide title={zh ? '分享用量' : 'Share usage'} subtitle={zh ? '海报完全在本机生成；没有二维码或失效的本地访问链接。' : 'Generated entirely on-device, with no QR code or unreachable local link.'}>
    <div className="share-layout">
      <div className="poster-preview">
        {previewUrl ? <img src={previewUrl} alt={zh ? '用量分享海报预览' : 'Usage poster preview'}/> : <div className="poster-loading"><LoaderCircle className="spin"/><span>{zh ? '生成海报中…' : 'Rendering poster…'}</span></div>}
        {previewUrl && (busy || (!previewCurrent && !error)) ? <span className="preview-refresh"><LoaderCircle className="spin" size={14}/>{zh ? '正在更新' : 'Updating'}</span> : null}
      </div>
      <div className="share-controls">
        <fieldset style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}>
          <legend id={rangeLegendId} className="share-field-title">{zh ? '时间范围' : 'Time range'}</legend>
          <div className="share-ranges" role="radiogroup" aria-labelledby={rangeLegendId}>{RANGE_OPTIONS.map((item, index) => <button ref={(node) => { rangeRefs.current[index] = node; }} type="button" role="radio" aria-checked={range === item.id} tabIndex={range === item.id ? 0 : -1} key={item.id} className={range === item.id ? 'active' : ''} onKeyDown={(event) => onRangeKeyDown(event, index)} onClick={() => setRange(item.id)}>{zh ? item.zh : item.en}</button>)}</div>
        </fieldset>
        <AvatarEditor avatar={avatar} name={name} busy={avatarBusy} onSelect={selectAvatar} onRemove={removeAvatar} zh={zh}/>
        <label><span>{zh ? '海报名称' : 'Poster name'}</span><input value={name} maxLength={24} onChange={(event) => setName(event.target.value)}/></label>
        <label><span>{zh ? '公开称呼' : 'Public handle'}</span><div className="handle-input"><i>@</i><input value={handle} maxLength={24} onChange={(event) => setHandle(event.target.value.replace(/^@/, ''))}/></div></label>
        <div className="share-facts"><Info size={15}/><p>{zh ? '海报展示 Token 流向、标准 API 等价价值、活跃节奏、缓存效率、常用 Agent、主力模型与推理强度；头像与海报都只在本机处理，不包含项目、设备、路径或对话内容。' : 'The poster includes token flow, API-equivalent value, activity, cache efficiency, agents, model, and effort. The avatar and poster stay on-device; projects, devices, paths, and conversations are excluded.'}</p></div>
        {avatarError ? <p className="dialog-error" role="alert">{avatarError}</p> : null}
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        {shareError ? <p className="dialog-error" role="alert">{shareError}</p> : null}
        <div className="share-buttons">
          <button type="button" className="ghost-btn" onClick={download} disabled={!canUsePreview}><Download size={15}/>{zh ? '下载 PNG' : 'Download PNG'}</button>
          <button type="button" className="primary-btn" onClick={share} disabled={!canUsePreview}>{sharing ? <LoaderCircle className="spin" size={15}/> : <Share2 size={15}/>} {zh ? '系统分享' : 'Share'}</button>
        </div>
      </div>
    </div>
    <div className="poster-render-host" aria-hidden="true"><UsagePoster ref={posterRef} report={report} range={range} identity={{ name: name.trim() || 'Local Builder', handle: handle.trim() || 'local', avatar }} generatedAt={data.generatedAt} zh={zh}/></div>
  </Dialog>;
}
