import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Filter, Settings2, X } from 'lucide-react';
import { RANGE_OPTIONS } from './analytics.js';
import { sourceLabel } from './format.js';
import { ToolGlyph } from './tool-glyphs.js';

const DIMENSIONS = [
  { key: 'sources', zh: 'Agent', en: 'Agent', icon: true },
  { key: 'models', zh: '模型', en: 'Model' },
  { key: 'projects', zh: '项目', en: 'Project' },
  { key: 'efforts', zh: '推理强度', en: 'Effort', secondary: true },
  { key: 'agentVersions', zh: 'Agent 版本', en: 'Agent version', secondary: true },
  { key: 'devices', zh: '设备', en: 'Device', secondary: true },
];

function optionLabel(dimension, value, zh) {
  if (dimension.key === 'sources') return sourceLabel(value);
  if (!value) return zh ? '未记录 / 未上传' : 'Not recorded / private';
  return value;
}

function RangeSegment({ active, onChange, zh }) {
  const onKeyDown = (event) => {
    const found = RANGE_OPTIONS.findIndex((item) => item.id === active);
    const current = found >= 0 ? found : 0;
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % RANGE_OPTIONS.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + RANGE_OPTIONS.length) % RANGE_OPTIONS.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = RANGE_OPTIONS.length - 1;
    if (next == null) return;
    event.preventDefault();
    onChange(RANGE_OPTIONS[next].id);
    event.currentTarget.parentElement?.querySelectorAll('[role="radio"]')[next]?.focus();
  };
  return <div className="range-segment" role="radiogroup" aria-label={zh ? '时间范围' : 'Date range'}>
    {RANGE_OPTIONS.map((item, index) => <button type="button" role="radio" key={item.id} aria-checked={active === item.id} tabIndex={active === item.id || (!RANGE_OPTIONS.some((option) => option.id === active) && index === 0) ? 0 : -1} className={active === item.id ? 'active' : ''} onKeyDown={onKeyDown} onClick={() => onChange(item.id)}>{zh ? item.zh : item.en}</button>)}
  </div>;
}

function DimensionDropdown({ dimension, values, selected, onApply, open, setOpen, zh }) {
  const ref = useRef(null);
  const [draft, setDraft] = useState(selected);
  useEffect(() => {
    if (open) setDraft(selected);
  }, [open, selected]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(null);
    };
    const onKey = (event) => event.key === 'Escape' && setOpen(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);
  const toggle = (value) => setDraft((current) => current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value]);
  const dirty = [...draft].sort().join('\u0000') !== [...selected].sort().join('\u0000');
  const label = zh ? dimension.zh : dimension.en;
  return <div className="dimension-filter" ref={ref}>
    <button className="dimension-trigger" type="button" onClick={() => setOpen(open ? null : dimension.key)} aria-expanded={open}>
      <span><small>{label}</small>{selected.length ? `· ${selected.length}` : (zh ? '全部' : 'All')}</span><ChevronDown size={12}/>
    </button>
    {open ? <div className="dimension-menu">
      <header><span>{zh ? '不勾选表示不限' : 'No selection means any'}</span><button type="button" onClick={() => setDraft([])}>{zh ? '不限' : 'Any'}</button></header>
      <div className="dimension-options">
        {values.length ? values.map((value) => <label key={`${dimension.key}:${value}`}>
          <input type="checkbox" checked={draft.includes(value)} onChange={() => toggle(value)}/>
          {dimension.icon ? <ToolGlyph id={value} size={13}/> : null}
          <span title={optionLabel(dimension, value, zh)}>{optionLabel(dimension, value, zh)}</span>
        </label>) : <p>{zh ? '当前数据没有可选项' : 'No options in current data'}</p>}
      </div>
      <footer><button type="button" onClick={() => setOpen(null)}>{zh ? '取消' : 'Cancel'}</button><button className="apply" disabled={!dirty} type="button" onClick={() => { onApply(draft); setOpen(null); }}>{zh ? '应用' : 'Apply'}</button></footer>
    </div> : null}
  </div>;
}

export function UsageFilterBar({ filters, options, onChange, currency, onCurrency, zh }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(() => DIMENSIONS.some((dimension) => dimension.secondary && filters[dimension.key]?.length));
  const [openMenu, setOpenMenu] = useState(null);
  useEffect(() => {
    if (currency && currency !== 'usd') onCurrency?.('usd');
  }, [currency, onCurrency]);
  const activeCount = DIMENSIONS.reduce((sum, dimension) => sum + (filters[dimension.key]?.length || 0), 0);
  const primary = DIMENSIONS.filter((dimension) => !dimension.secondary);
  const secondary = DIMENSIONS.filter((dimension) => dimension.secondary);
  const activeDimensions = DIMENSIONS.filter((dimension) => filters[dimension.key]?.length);
  const activeRange = RANGE_OPTIONS.find((item) => item.id === filters.range) || RANGE_OPTIONS[0];
  const update = (key, value) => onChange({ ...filters, [key]: value });
  return <section className="filter-bar" aria-label={zh ? '用量筛选' : 'Usage filters'}>
    <div className="mobile-filter-summary">
      <strong>{zh ? activeRange.zh : activeRange.en}</strong>
      <div>{activeDimensions.slice(0, 2).map((dimension) => <span key={dimension.key}>{zh ? dimension.zh : dimension.en} · {filters[dimension.key].length}</span>)}{activeDimensions.length > 2 ? <span>+{activeDimensions.length - 2}</span> : null}{!activeDimensions.length ? <small>{zh ? '全部数据' : 'All data'}</small> : null}</div>
      <button className="mobile-filter-toggle" type="button" onClick={() => setMobileOpen((value) => !value)} aria-expanded={mobileOpen} aria-controls="usage-filter-controls"><Filter size={13}/>{mobileOpen ? (zh ? '收起' : 'Close') : (zh ? '展开' : 'Expand')}<ChevronDown className={mobileOpen ? 'open' : ''} size={13}/></button>
    </div>
    <div className={`filter-controls ${mobileOpen ? 'open' : ''}`} id="usage-filter-controls">
      <RangeSegment active={filters.range} onChange={(range) => update('range', range)} zh={zh}/>
      <div className={`dimension-bar ${mobileOpen ? 'open' : ''}`}>
        {primary.map((dimension) => <DimensionDropdown key={dimension.key} dimension={dimension} values={options[dimension.key] || []} selected={filters[dimension.key] || []} onApply={(value) => update(dimension.key, value)} open={openMenu === dimension.key} setOpen={setOpenMenu} zh={zh}/>)}
        <button className="more-filter" type="button" onClick={() => setMoreOpen((value) => !value)} aria-expanded={moreOpen}><Settings2 size={13}/>{moreOpen ? (zh ? '收起筛选' : 'Fewer filters') : `${zh ? '更多筛选' : 'More filters'} +${secondary.length}`}</button>
        {moreOpen ? secondary.map((dimension) => <DimensionDropdown key={dimension.key} dimension={dimension} values={options[dimension.key] || []} selected={filters[dimension.key] || []} onApply={(value) => update(dimension.key, value)} open={openMenu === dimension.key} setOpen={setOpenMenu} zh={zh}/>) : null}
        {activeCount ? <button className="clear-filters" type="button" onClick={() => onChange({ ...filters, ...Object.fromEntries(DIMENSIONS.map((dimension) => [dimension.key, []])) })}>{zh ? '清除筛选' : 'Clear filters'}</button> : null}
      </div>
      {activeCount ? <div className="filter-chips">
        {DIMENSIONS.flatMap((dimension) => (filters[dimension.key] || []).map((value) => <span key={`${dimension.key}:${value}`}><small>{zh ? dimension.zh : dimension.en}</small>{optionLabel(dimension, value, zh)}<button type="button" aria-label={zh ? '移除此筛选' : 'Remove filter'} onClick={() => update(dimension.key, filters[dimension.key].filter((item) => item !== value))}><X size={11}/></button></span>))}
      </div> : null}
    </div>
  </section>;
}
