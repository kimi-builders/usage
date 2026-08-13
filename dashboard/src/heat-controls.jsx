import { ChevronLeft, ChevronRight } from 'lucide-react';

/* Shared heatmap mode vocabulary: 聚合 (window aggregate) vs 单周 (one natural
   week, pageable). Used by the usage-center activity heatmap and the benefit
   usage-rhythm panel. Mode persists per surface via the given storage key. */

export function storedHeatMode(storageKey) {
  const value = localStorage.getItem(storageKey);
  return value === 'week' ? 'week' : 'aggregate';
}

export function storeHeatMode(storageKey, mode) {
  localStorage.setItem(storageKey, mode === 'week' ? 'week' : 'aggregate');
}

export function HeatModeTabs({ mode, onChange, zh, label }) {
  return <div className="heat-mode-tabs" role="radiogroup" aria-label={label}>
    <button type="button" role="radio" aria-checked={mode === 'aggregate'} className={mode === 'aggregate' ? 'active' : ''} onClick={() => onChange('aggregate')}>{zh ? '聚合' : 'Aggregate'}</button>
    <button type="button" role="radio" aria-checked={mode === 'week'} className={mode === 'week' ? 'active' : ''} onClick={() => onChange('week')}>{zh ? '单周' : 'Week'}</button>
  </div>;
}

export function WeekPager({ label, canPrev, canNext, onPrev, onNext, onCurrent, showCurrent, zh, ariaLabel }) {
  return <div className="heat-week-pager" role="group" aria-label={ariaLabel}>
    <button type="button" onClick={onPrev} disabled={!canPrev} aria-label={zh ? '上一周' : 'Previous week'}><ChevronLeft size={14}/></button>
    <b>{label}</b>
    <button type="button" onClick={onNext} disabled={!canNext} aria-label={zh ? '下一周' : 'Next week'}><ChevronRight size={14}/></button>
    {showCurrent ? <button type="button" className="heat-week-current" onClick={onCurrent}>{zh ? '回到本周' : 'This week'}</button> : null}
  </div>;
}
