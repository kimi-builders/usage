import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { compact, money, percent, sourceLabel } from './format.js';
import { ToolGlyph } from './tool-glyphs.js';

const OPTIONAL_COLUMNS = [
  ['device', '设备', 'Device'], ['project', '项目', 'Project'], ['reasoning', '推理', 'Reasoning'],
  ['effort', '推理强度', 'Effort'], ['agentVersion', 'Agent 版本', 'Agent version'],
  ['provider', '模型供应方', 'Model provider'], ['cacheWrite', '缓存写', 'Cache write'],
];

function costText(row, zh, currency) {
  if (row.status === 'unpriced') return zh ? '未定价' : 'Unpriced';
  const value = (row.costMicros / 1e6) * (currency === 'cny' ? 7.2 : 1);
  return `${currency === 'cny' ? '¥' : '$'}${value >= 0.01 ? value.toFixed(2) : value.toFixed(4)}${row.status === 'partial' ? '*' : ''}`;
}

function hitRate(row) {
  const input = row.inputTokens + row.cacheWriteInputTokens + row.cacheReadInputTokens;
  return input > 0 ? row.cacheReadInputTokens / input : null;
}

function ColumnsMenu({ enabled, setEnabled, zh }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => ref.current && !ref.current.contains(event.target) && setOpen(false);
    const onKey = (event) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return <div className="columns-menu" ref={ref}><button type="button" onClick={() => setOpen((value) => !value)}>{zh ? '列' : 'Columns'}{enabled.length ? ` · ${enabled.length}` : ''}<ChevronDown size={11}/></button>{open ? <div>{OPTIONAL_COLUMNS.map(([id, cn, en]) => <label key={id}><input type="checkbox" checked={enabled.includes(id)} onChange={() => setEnabled((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}/><span>{zh ? cn : en}</span></label>)}</div> : null}</div>;
}

export function RecordsSection({ report, zh, currency, device }) {
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
    <header className="panel-header"><div><h2>{zh ? '明细' : 'Records'}</h2><p>{zh ? `按 ${grain === 'day' ? '日' : '30 分钟'}×Agent×模型×推理强度×Agent 版本×项目×设备 聚合 · 共 ${rows.length.toLocaleString('zh-CN')} 组` : `${grain === 'day' ? 'Daily' : '30-minute'} groups · ${rows.length.toLocaleString('en-US')} groups`}</p></div><div className="record-controls"><div className="mini-tabs"><button type="button" className={grain === 'day' ? 'active' : ''} onClick={() => setGrain('day')}>{zh ? '按日' : 'By day'}</button><button type="button" className={grain === 'bucket' ? 'active' : ''} onClick={() => setGrain('bucket')}>{zh ? '按 30 分钟' : 'By 30 min'}</button></div><ColumnsMenu enabled={enabled} setEnabled={setEnabled} zh={zh}/></div></header>
    {visible.length ? <>
      <div className="records-scroll"><table><thead><tr><th>{grain === 'day' ? (zh ? '日期' : 'Day') : (zh ? '时间' : 'Time')}</th><th>Agent</th><th>{zh ? '模型' : 'Model'}</th>{enabled.includes('project') ? <th>{zh ? '项目' : 'Project'}</th> : null}{enabled.includes('device') ? <th>{zh ? '设备' : 'Device'}</th> : null}{enabled.includes('effort') ? <th>{zh ? '推理强度' : 'Effort'}</th> : null}{enabled.includes('agentVersion') ? <th>{zh ? 'Agent 版本' : 'Agent ver.'}</th> : null}{enabled.includes('provider') ? <th>{zh ? '供应方' : 'Provider'}</th> : null}<th>{zh ? '输入(含缓存写)' : 'Input+CW'}</th>{enabled.includes('cacheWrite') ? <th>{zh ? '缓存写' : 'Cache W'}</th> : null}<th>{zh ? '缓存读' : 'Cache R'}</th><th>{zh ? '输出' : 'Output'}</th>{enabled.includes('reasoning') ? <th>{zh ? '推理' : 'Reasoning'}</th> : null}<th>{zh ? '总 TOKEN' : 'Total'}</th><th>{zh ? '命中率' : 'Hit%'}</th><th>{zh ? '请求' : 'Reqs'}</th><th>{zh ? '估费' : 'Cost'}</th></tr></thead><tbody>{visible.map((row) => <tr key={row.id}><td>{timeText(row)}</td><td><span className="agent-chip"><ToolGlyph id={row.source} size={12}/>{sourceLabel(row.source)}</span></td><td><b>{row.modelCanonical || row.model}</b>{row.modelCanonical && row.modelCanonical !== row.model ? <small>{row.model}</small> : null}</td>{enabled.includes('project') ? <td>{row.project || '•••'}</td> : null}{enabled.includes('device') ? <td>{device}</td> : null}{enabled.includes('effort') ? <td>{row.reasoningEffort || '—'}</td> : null}{enabled.includes('agentVersion') ? <td>{row.agentVersion || '—'}</td> : null}{enabled.includes('provider') ? <td>{row.modelProvider || '—'}</td> : null}<td>{compact(row.inputTokens + row.cacheWriteInputTokens)}</td>{enabled.includes('cacheWrite') ? <td>{compact(row.cacheWriteInputTokens)}</td> : null}<td>{compact(row.cacheReadInputTokens)}</td><td>{compact(row.outputTokens)}</td>{enabled.includes('reasoning') ? <td>{compact(row.reasoningOutputTokens)}</td> : null}<td>{compact(row.totalTokens)}</td><td><span className="hit-chip">{hitRate(row) == null ? '—' : percent(hitRate(row))}</span></td><td>{compact(row.requestCount)}</td><td className={row.status === 'unpriced' ? '' : 'green'}>{costText(row, zh, currency)}</td></tr>)}</tbody></table></div>
      <ul className="record-cards">{visible.map((row) => <li key={row.id}><header><span>{timeText(row)}</span><b><ToolGlyph id={row.source} size={12}/>{sourceLabel(row.source)} · {row.modelCanonical || row.model}</b></header><p>{compact(row.totalTokens)} tokens · {costText(row, zh, currency)} · {zh ? '命中率' : 'hit'} {hitRate(row) == null ? '—' : percent(hitRate(row))} · {compact(row.requestCount)} {zh ? '次请求' : 'req'}</p>{row.modelCanonical && row.modelCanonical !== row.model ? <small>raw model: {row.model}</small> : null}<div>{optional(row)}</div></li>)}</ul>
    </> : <p className="empty records-empty">{zh ? '当前范围暂无数据' : 'No data in this range'}</p>}
    <footer className="pagination"><span>{zh ? `显示 ${(page - 1) * pageSize + (visible.length ? 1 : 0)}–${(page - 1) * pageSize + visible.length}，共 ${rows.length} 组` : `Showing ${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + visible.length} of ${rows.length}`}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} aria-label={zh ? '上一页' : 'Previous page'}><ChevronLeft size={15}/></button><b>{page} / {pages}</b><button type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)} aria-label={zh ? '下一页' : 'Next page'}><ChevronRight size={15}/></button></div></footer>
  </section>;
}
