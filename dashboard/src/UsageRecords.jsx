import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { compact, percent, sourceLabel, usdMoney } from './format.js';
import { ToolGlyph } from './tool-glyphs.js';

const OPTIONAL_COLUMNS = [
  ['device', '设备', 'Device'], ['project', '项目', 'Project'], ['reasoning', '推理', 'Reasoning'],
  ['effort', '推理强度', 'Effort'], ['agentVersion', 'Agent 版本', 'Agent version'],
  ['provider', '模型供应方', 'Model provider'], ['cacheWrite', '缓存写', 'Cache write'],
];

function costText(row, zh) {
  if (row.status === 'unpriced') return zh ? '未定价' : 'Unpriced';
  return `${usdMoney(row.costMicros)}${row.status === 'partial' ? '*' : ''}`;
}

function hitRate(row) {
  const input = row.inputTokens + row.cacheWriteInputTokens + row.cacheReadInputTokens;
  return input > 0 ? row.cacheReadInputTokens / input : null;
}

function ColumnsMenu({ enabled, setEnabled, zh }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const triggerRef = useRef(null);
  const itemRefs = useRef([]);
  const initialItemRef = useRef(0);
  const menuId = useId();
  const triggerId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => ref.current && !ref.current.contains(event.target) && setOpen(false);
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  useEffect(() => {
    if (open) itemRefs.current[initialItemRef.current]?.focus();
  }, [open]);
  const onMenuKeyDown = (event) => {
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.target.click();
      return;
    }
    const current = itemRefs.current.indexOf(event.target);
    let next = null;
    if (event.key === 'ArrowDown') next = (current + 1) % OPTIONAL_COLUMNS.length;
    if (event.key === 'ArrowUp') next = (current - 1 + OPTIONAL_COLUMNS.length) % OPTIONAL_COLUMNS.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = OPTIONAL_COLUMNS.length - 1;
    if (next == null) return;
    event.preventDefault();
    itemRefs.current[next]?.focus();
  };
  return <div className="columns-menu" ref={ref}><button ref={triggerRef} id={triggerId} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onKeyDown={(event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    initialItemRef.current = event.key === 'ArrowUp' ? OPTIONAL_COLUMNS.length - 1 : 0;
    setOpen(true);
  }} onClick={() => {
    initialItemRef.current = 0;
    setOpen((value) => !value);
  }}>{zh ? '列' : 'Columns'}{enabled.length ? ` · ${enabled.length}` : ''}<ChevronDown size={11}/></button>{open ? <div id={menuId} role="menu" aria-labelledby={triggerId} onKeyDown={onMenuKeyDown}>{OPTIONAL_COLUMNS.map(([id, cn, en], index) => {
    const checked = enabled.includes(id);
    return <label key={id}><input ref={(node) => { itemRefs.current[index] = node; }} type="checkbox" role="menuitemcheckbox" aria-label={zh ? cn : en} aria-checked={checked} tabIndex={index === 0 ? 0 : -1} checked={checked} onChange={() => setEnabled((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}/><span>{zh ? cn : en}</span></label>;
  })}</div> : null}</div>;
}

const GRAINS = [
  { id: 'day', zh: '按日', en: 'By day' },
  { id: 'bucket', zh: '按 30 分钟', en: 'By 30 min' },
];

function GrainTabs({ active, onChange, zh, controlsId }) {
  const onKeyDown = (event) => {
    const current = GRAINS.findIndex((item) => item.id === active);
    let next = null;
    if (event.key === 'ArrowRight') next = (current + 1) % GRAINS.length;
    if (event.key === 'ArrowLeft') next = (current - 1 + GRAINS.length) % GRAINS.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = GRAINS.length - 1;
    if (next == null) return;
    event.preventDefault();
    onChange(GRAINS[next].id);
    event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[next]?.focus();
  };
  return <div className="mini-tabs" role="tablist" aria-label={zh ? '明细聚合粒度' : 'Record aggregation grain'}>{GRAINS.map((item) => <button type="button" role="tab" key={item.id} aria-controls={controlsId} aria-selected={active === item.id} tabIndex={active === item.id ? 0 : -1} className={active === item.id ? 'active' : ''} onKeyDown={onKeyDown} onClick={() => onChange(item.id)}>{zh ? item.zh : item.en}</button>)}</div>;
}

export function RecordsSection({ report, zh, device }) {
  const recordsPanelId = useId();
  const [grain, setGrain] = useState('day');
  const [enabled, setEnabled] = useState([]);
  const [page, setPage] = useState(1);
  const rows = grain === 'day' ? report.recordsByDay : report.recordsByBucket;
  const pageSize = 25;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => setPage(1), [grain, report]);
  const visible = useMemo(() => rows.slice((page - 1) * pageSize, page * pageSize), [rows, page]);
  const timeText = (row) => new Date(row.time).toLocaleString(zh ? 'zh-CN' : 'en-US', grain === 'day'
    ? { year: 'numeric', month: '2-digit', day: '2-digit' }
    : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const optional = (row) => <>
    {enabled.includes('device') ? <span>{zh ? '设备' : 'Device'} <b>{device}</b></span> : null}
    {enabled.includes('project') ? <span>{zh ? '项目' : 'Project'} <b>{row.project || (zh ? '未上传' : 'Not uploaded')}</b></span> : null}
    {enabled.includes('reasoning') ? <span>{zh ? '推理' : 'Reasoning'} <b>{compact(row.reasoningOutputTokens)}</b></span> : null}
    {enabled.includes('effort') ? <span>{zh ? '推理强度' : 'Effort'} <b>{row.reasoningEffort || '—'}</b></span> : null}
    {enabled.includes('agentVersion') ? <span>{zh ? 'Agent 版本' : 'Agent version'} <b>{row.agentVersion || '—'}</b></span> : null}
    {enabled.includes('provider') ? <span>{zh ? '供应方' : 'Provider'} <b>{row.modelProvider || '—'}</b></span> : null}
    {enabled.includes('cacheWrite') ? <span>{zh ? '缓存写' : 'Cache write'} <b>{compact(row.cacheWriteInputTokens)}</b></span> : null}
  </>;
  return <section className="panel records-panel" id="records">
    <header className="panel-header"><div><h2>{zh ? '明细' : 'Records'}</h2><p>{zh ? `按 ${grain === 'day' ? '日' : '30 分钟'}×Agent×模型×推理强度×Agent 版本×项目×设备 聚合 · 共 ${rows.length.toLocaleString('zh-CN')} 组` : `${grain === 'day' ? 'Daily' : '30-minute'} groups · ${rows.length.toLocaleString('en-US')} groups`}</p></div><div className="record-controls"><GrainTabs active={grain} onChange={setGrain} zh={zh} controlsId={recordsPanelId}/><ColumnsMenu enabled={enabled} setEnabled={setEnabled} zh={zh}/></div></header>
    <div id={recordsPanelId} role="tabpanel" aria-label={grain === 'day' ? (zh ? '按日聚合明细' : 'Daily grouped records') : (zh ? '30 分钟聚合明细' : '30-minute grouped records')}>{visible.length ? <>
      <div className="records-scroll"><table><thead><tr><th>{grain === 'day' ? (zh ? '日期' : 'Day') : (zh ? '时间' : 'Time')}</th><th>Agent</th><th>{zh ? '模型' : 'Model'}</th>{enabled.includes('project') ? <th>{zh ? '项目' : 'Project'}</th> : null}{enabled.includes('device') ? <th>{zh ? '设备' : 'Device'}</th> : null}{enabled.includes('effort') ? <th>{zh ? '推理强度' : 'Effort'}</th> : null}{enabled.includes('agentVersion') ? <th>{zh ? 'Agent 版本' : 'Agent ver.'}</th> : null}{enabled.includes('provider') ? <th>{zh ? '供应方' : 'Provider'}</th> : null}<th>{zh ? '输入(含缓存写)' : 'Input+CW'}</th>{enabled.includes('cacheWrite') ? <th>{zh ? '缓存写' : 'Cache W'}</th> : null}<th>{zh ? '缓存读' : 'Cache R'}</th><th>{zh ? '输出' : 'Output'}</th>{enabled.includes('reasoning') ? <th>{zh ? '推理' : 'Reasoning'}</th> : null}<th>{zh ? '总 TOKEN' : 'Total'}</th><th>{zh ? '命中率' : 'Hit%'}</th><th>{zh ? '请求' : 'Reqs'}</th><th>{zh ? 'API 等价 (USD)' : 'API equiv. (USD)'}</th></tr></thead><tbody>{visible.map((row) => <tr key={row.id}><td>{timeText(row)}</td><td><span className="agent-chip"><ToolGlyph id={row.source} size={12}/>{sourceLabel(row.source)}</span></td><td><b>{row.modelCanonical || row.model}</b>{row.modelCanonical && row.modelCanonical !== row.model ? <small>{row.model}</small> : null}</td>{enabled.includes('project') ? <td>{row.project || '•••'}</td> : null}{enabled.includes('device') ? <td>{device}</td> : null}{enabled.includes('effort') ? <td>{row.reasoningEffort || '—'}</td> : null}{enabled.includes('agentVersion') ? <td>{row.agentVersion || '—'}</td> : null}{enabled.includes('provider') ? <td>{row.modelProvider || '—'}</td> : null}<td>{compact(row.inputTokens + row.cacheWriteInputTokens)}</td>{enabled.includes('cacheWrite') ? <td>{compact(row.cacheWriteInputTokens)}</td> : null}<td>{compact(row.cacheReadInputTokens)}</td><td>{compact(row.outputTokens)}</td>{enabled.includes('reasoning') ? <td>{compact(row.reasoningOutputTokens)}</td> : null}<td>{compact(row.totalTokens)}</td><td><span className="hit-chip">{hitRate(row) == null ? '—' : percent(hitRate(row))}</span></td><td>{compact(row.requestCount)}</td><td className={row.status === 'unpriced' ? '' : 'green'}>{costText(row, zh)}</td></tr>)}</tbody></table></div>
      <ul className="record-cards">{visible.map((row) => <li key={row.id}><header><span>{timeText(row)}</span><b><ToolGlyph id={row.source} size={12}/>{sourceLabel(row.source)} · {row.modelCanonical || row.model}</b></header><p>{compact(row.totalTokens)} tokens · {costText(row, zh)} · {zh ? '命中率' : 'hit'} {hitRate(row) == null ? '—' : percent(hitRate(row))} · {compact(row.requestCount)} {zh ? '次请求' : 'req'}</p>{row.modelCanonical && row.modelCanonical !== row.model ? <small>raw model: {row.model}</small> : null}<div>{optional(row)}</div></li>)}</ul>
    </> : <p className="empty records-empty">{zh ? '当前范围暂无数据' : 'No data in this range'}</p>}</div>
    <footer className="pagination"><span>{zh ? `显示 ${(page - 1) * pageSize + (visible.length ? 1 : 0)}–${(page - 1) * pageSize + visible.length}，共 ${rows.length} 组` : `Showing ${(page - 1) * pageSize + (visible.length ? 1 : 0)}–${(page - 1) * pageSize + visible.length} of ${rows.length}`}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} aria-label={zh ? '上一页' : 'Previous page'}><ChevronLeft size={15}/></button><b>{page} / {pages}</b><button type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)} aria-label={zh ? '下一页' : 'Next page'}><ChevronRight size={15}/></button></div></footer>
  </section>;
}
