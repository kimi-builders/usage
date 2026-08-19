import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Award, CalendarClock, Flame, Pencil, ShieldCheck, Sparkles, Target, X } from 'lucide-react';
import { compactNumber, displayDollars } from './format.js';
import { Dialog } from './Dialog.jsx';

export const BUDGET_STORAGE_KEY = 'kbu.budget.v1';
const BUDGET_DISMISSED_KEY = 'kbu.budget.dismissed.v1';
const SPIKE_STORAGE_KEY = 'kbu.spikes.v1';
const MILESTONE_STORAGE_KEY = 'kbu.milestones.v1';

function parseJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function readList(key) {
  const value = parseJson(key, []);
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function writeList(key, values) {
  const bounded = [...new Set(values)].slice(-120);
  localStorage.setItem(key, JSON.stringify(bounded));
  return bounded;
}

export function readBudget() {
  const value = parseJson(BUDGET_STORAGE_KEY, null);
  if (!value || !['tokens', 'cost'].includes(value.metric) || !(Number(value.target) > 0)) return null;
  return { metric: value.metric, target: Number(value.target) };
}

export function storeBudget(value) {
  if (!value) {
    localStorage.removeItem(BUDGET_STORAGE_KEY);
    return null;
  }
  const next = { metric: value.metric, target: Number(value.target), updatedAt: new Date().toISOString() };
  localStorage.setItem(BUDGET_STORAGE_KEY, JSON.stringify(next));
  return next;
}

function compactValue(value, zh) {
  return compactNumber(value, zh ? 'zh' : 'en');
}

function metricValue(value, metric, currency, zh) {
  if (metric === 'cost') return displayDollars(value, currency);
  return `${compactValue(value || 0, zh)} Token`;
}

function calendarDate(value, zh) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }).format(value);
}

function closeButton(label, onClick) {
  return <button className="insight-dismiss" type="button" onClick={onClick} aria-label={label}><X size={15}/></button>;
}

export function BudgetDialog({ open, onClose, value, onSave, zh }) {
  const [metric, setMetric] = useState(value?.metric || 'tokens');
  const [target, setTarget] = useState(value?.target ? String(value.target) : '');
  useEffect(() => {
    if (!open) return;
    setMetric(value?.metric || 'tokens');
    setTarget(value?.target ? String(value.target) : '');
  }, [open, value]);
  const parsed = Number(target);
  const valid = Number.isFinite(parsed) && parsed > 0;
  const save = () => {
    if (!valid) return;
    onSave({ metric, target: parsed });
    onClose();
  };
  const clear = () => {
    onSave(null);
    onClose();
  };
  return <Dialog open={open} onClose={onClose} className="dialog--budget" title={zh ? '设置个人月度目标' : 'Set a personal monthly target'} subtitle={zh ? '这是你自己申报的节奏目标，不是供应商额度或账单。' : 'This is your declared pace target—not a provider quota or bill.'}>
    <div className="budget-dialog-body">
      <div className="budget-metric-tabs" role="radiogroup" aria-label={zh ? '目标指标' : 'Target metric'}>
        <button type="button" role="radio" aria-checked={metric === 'tokens'} className={metric === 'tokens' ? 'active' : ''} onClick={() => setMetric('tokens')}>Token</button>
        <button type="button" role="radio" aria-checked={metric === 'cost'} className={metric === 'cost' ? 'active' : ''} onClick={() => setMetric('cost')}>{zh ? 'API USD 估算' : 'API USD estimate'}</button>
      </div>
      <label className="budget-target-field"><span>{metric === 'tokens' ? (zh ? '月度 Token 目标' : 'Monthly Token target') : (zh ? '月度 API 等价价值目标（USD）' : 'Monthly API-equivalent target (USD)')}</span><input autoFocus type="number" min="0" step={metric === 'tokens' ? '1000000' : '.01'} inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} placeholder={metric === 'tokens' ? '50000000000' : '500.00'}/><small>{metric === 'tokens' ? (zh ? '输入完整 Token 数，例如 50,000,000,000。' : 'Enter the full Token count, e.g. 50,000,000,000.') : (zh ? '采用看板的标准 API 价格估算，不代表实际账单。' : 'Uses the dashboard standard API estimate; it is not an actual bill.')}</small></label>
      <div className="budget-evidence-note"><ShieldCheck size={16}/><p><b>{zh ? '个人目标 · 本机观测' : 'Personal target · locally observed'}</b><span>{zh ? '目标只保存在当前浏览器，并与供应商事实、本机 Token 事实、派生容量估计分别呈现。' : 'The target stays in this browser and remains separate from provider facts, local Token facts, and derived capacity estimates.'}</span></p></div>
    </div>
    <footer className="dialog-actions">{value ? <button type="button" className="ghost-btn budget-clear" onClick={clear}>{zh ? '清除目标' : 'Clear target'}</button> : null}<button type="button" className="ghost-btn" onClick={onClose}>{zh ? '关闭' : 'Close'}</button><button type="button" className="primary-btn" onClick={save} disabled={!valid}>{zh ? '保存目标' : 'Save target'}</button></footer>
  </Dialog>;
}

export function UsageInsightAlerts({ budget, spikes, milestones, zh, currency, onEditBudget }) {
  const [dismissedBudgets, setDismissedBudgets] = useState(() => readList(BUDGET_DISMISSED_KEY));
  const [dismissedSpikes, setDismissedSpikes] = useState(() => readList(SPIKE_STORAGE_KEY));
  const [activeCelebrations, setActiveCelebrations] = useState([]);
  const [closedCelebrations, setClosedCelebrations] = useState([]);

  useEffect(() => {
    const seen = readList(MILESTONE_STORAGE_KEY);
    const candidates = (milestones?.celebrations || []).filter((row) => !seen.includes(row.signature));
    if (!candidates.length) return;
    setActiveCelebrations((current) => [...current, ...candidates.filter((row) => !current.some((item) => item.signature === row.signature))]);
  }, [milestones]);

  const budgetVisible = budget?.overPace && !dismissedBudgets.includes(budget.signature);
  const spike = useMemo(() => [...(spikes?.hourly || [])]
    .filter((row) => !dismissedSpikes.includes(row.signature))
    .sort((left, right) => (right.ratio || right.totalTokens) - (left.ratio || left.totalTokens))[0] || null, [spikes, dismissedSpikes]);
  const celebration = activeCelebrations.find((row) => !closedCelebrations.includes(row.signature));

  const dismissBudget = () => setDismissedBudgets((current) => writeList(BUDGET_DISMISSED_KEY, [...current, budget.signature]));
  const dismissSpike = () => setDismissedSpikes((current) => writeList(SPIKE_STORAGE_KEY, [...current, spike.signature]));
  const dismissCelebration = () => {
    writeList(MILESTONE_STORAGE_KEY, [...readList(MILESTONE_STORAGE_KEY), celebration.signature]);
    setClosedCelebrations((current) => [...current, celebration.signature]);
  };
  return <div className="usage-insight-alerts" aria-live="polite">
    {budgetVisible ? <section className="usage-insight-alert warning"><CalendarClock size={19}/><div><b>{budget.exceeded ? (zh ? `本月已超个人目标 · 已于 ${calendarDate(budget.hitDate, zh)} 触顶` : `Monthly target exceeded · reached on ${calendarDate(budget.hitDate, zh)}`) : (zh ? `按当前速度，预计 ${calendarDate(budget.hitDate, zh)} 触顶` : `At this pace, target reached around ${calendarDate(budget.hitDate, zh)}`)}</b><p>{zh ? `本月日均 ${metricValue(budget.dailyAverage, budget.metric, currency, zh)}；目标 ${metricValue(budget.target, budget.metric, currency, zh)}，月底预计约 ${metricValue(budget.projected, budget.metric, currency, zh)}。个人目标 · 本机观测。` : `Daily average this month: ${metricValue(budget.dailyAverage, budget.metric, currency, zh)}. Target: ${metricValue(budget.target, budget.metric, currency, zh)}; projected month end: about ${metricValue(budget.projected, budget.metric, currency, zh)}. Personal target · locally observed.`}</p></div><button type="button" className="insight-action" onClick={onEditBudget}>{zh ? '调整' : 'Adjust'}</button>{closeButton(zh ? '关闭预算预警' : 'Dismiss budget warning', dismissBudget)}</section> : null}
    {spike ? <section className="usage-insight-alert danger"><AlertTriangle size={19}/><div><b>{zh ? `检测到 ${String(spike.hour).padStart(2, '0')}:00 用量激增` : `Usage spike detected at ${String(spike.hour).padStart(2, '0')}:00`}</b><p>{zh ? `今天这一小时 ${compactValue(spike.totalTokens, zh)} Token${spike.ratio ? `，约为平时 P95 峰值的 ${spike.ratio.toFixed(1)} 倍` : '，超过 100万 安全阈值'}${spike.source ? `；主要来自 ${spike.source}${spike.project ? ` / ${spike.project}` : ''}` : ''}。本机观测。` : `This hour used ${compactValue(spike.totalTokens, zh)} Token${spike.ratio ? `, about ${spike.ratio.toFixed(1)}× your usual P95 peak` : ', above the 1M safety floor'}${spike.source ? `; mainly ${spike.source}${spike.project ? ` / ${spike.project}` : ''}` : ''}. Locally observed.`}</p></div>{closeButton(zh ? '关闭激增预警' : 'Dismiss spike warning', dismissSpike)}</section> : null}
    {celebration ? <section className="usage-insight-alert celebration"><Sparkles size={19}/><div><b>{zh ? `新里程碑：终身累计 ${compactValue(celebration.value, zh)} Token` : `New milestone: ${compactValue(celebration.value, zh)} lifetime Token`}</b><p>{zh ? `你在 ${celebration.crossedOn} 跨过了新的本机用量里程碑。数据来自未经筛选的完整本地历史。` : `You crossed a new local-usage milestone on ${celebration.crossedOn}. This uses complete, unfiltered local history.`}</p></div>{closeButton(zh ? '关闭里程碑祝贺' : 'Dismiss milestone celebration', dismissCelebration)}</section> : null}
  </div>;
}

export function UsageInsightSummary({ budget, milestones, spikes, zh, currency, onEditBudget }) {
  const targetLabel = budget?.metric === 'cost' ? (zh ? '费用估算' : 'Cost estimate') : 'Token';
  return <section className="usage-insight-summary" aria-label={zh ? '个人目标与里程碑' : 'Personal target and milestones'}>
    <article className={`budget-summary-card ${budget?.overPace ? 'is-warning' : ''}`}>
      <header><span><Target size={15}/>{zh ? '本月目标' : 'Monthly target'}</span><em><ShieldCheck size={11}/>{zh ? '个人目标 · 本机观测' : 'Personal · locally observed'}</em></header>
      {budget?.configured ? <><div className="budget-summary-value"><strong>{metricValue(budget.current, budget.metric, currency, zh)}</strong><span>/ {metricValue(budget.target, budget.metric, currency, zh)}</span></div><div className="insight-progress" role="progressbar" aria-label={zh ? '月度目标进度' : 'Monthly target progress'} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(Math.min(1, budget.progress) * 100)}><i style={{ width: `${Math.min(100, budget.progress * 100)}%` }}/></div><footer><span>{Math.round(budget.progress * 100)}% · {targetLabel}</span><span>{budget.mayProject ? (zh ? `月底约 ${metricValue(budget.projected, budget.metric, currency, zh)}` : `Month end ≈ ${metricValue(budget.projected, budget.metric, currency, zh)}`) : (zh ? '月初不足 3 天，暂不外推' : 'Projection starts after 3 elapsed days')}</span><button type="button" onClick={onEditBudget}><Pencil size={12}/>{zh ? '调整' : 'Edit'}</button></footer></> : <div className="budget-empty"><div><b>{zh ? '给跨 Agent 消耗设一个自己的月度节奏' : 'Set your own monthly pace across agents'}</b><p>{zh ? '目标只存浏览器，不会被当成供应商额度或实际账单。' : 'Saved only in this browser; never treated as provider quota or billing.'}</p></div><button type="button" className="ghost-btn" onClick={onEditBudget}>{zh ? '设定目标' : 'Set target'}</button></div>}
    </article>
    <article className="milestone-summary-card">
      <header><span><Award size={15}/>{zh ? '构建里程碑' : 'Builder milestones'}</span><em><ShieldCheck size={11}/>{zh ? '本机观测 · 全量历史' : 'Locally observed · all history'}</em></header>
      <div className="milestone-summary-main"><div className="streak-value"><Flame size={21}/><strong>{milestones.streak}</strong><span>{zh ? '天连续构建' : 'day build streak'}</span></div><div className="milestone-next"><p><b>{compactValue(milestones.lifetimeTokens, zh)}</b><span>{milestones.nextMilestone ? ` / ${compactValue(milestones.nextMilestone, zh)}` : (zh ? ' · 已完成全部里程碑' : ' · all milestones reached')}</span></p><div className="insight-progress" role="progressbar" aria-label={zh ? '下一 Token 里程碑进度' : 'Next Token milestone progress'} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(milestones.progress * 100)}><i style={{ width: `${milestones.progress * 100}%` }}/></div><small>{milestones.peakDay ? (zh ? `单日最高 ${compactValue(milestones.peakDay.totalTokens, zh)} · ${milestones.peakDay.key}` : `Peak day ${compactValue(milestones.peakDay.totalTokens, zh)} · ${milestones.peakDay.key}`) : (zh ? '等待第一天本机用量' : 'Waiting for the first local usage day')}</small></div></div>
      <footer><span>{zh ? '已达成' : 'Achieved'}</span>{milestones.achieved.length ? milestones.achieved.map((value) => <b key={value}>{compactValue(value, zh)}</b>) : <small>{zh ? '下一个：10亿' : 'Next: 1B'}</small>}{spikes?.status === 'building' ? <em>{zh ? `小时激增基线 ${spikes.sampleDays}/7 天` : `Hourly spike baseline ${spikes.sampleDays}/7 days`}</em> : null}</footer>
    </article>
  </section>;
}
