import { tokenTotal } from './analytics.js';
import { compactNumber, displayMoney, percent, sourceLabel } from './format.js';
import { ToolGlyph } from './tool-glyphs.js';

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function coverage(buckets, predicate, totalTokens) {
  if (totalTokens <= 0) return 0;
  return clamp(buckets.reduce((sum, bucket) => (
    predicate(bucket) ? sum + tokenTotal(bucket) : sum
  ), 0) / totalTokens);
}

function grouped(buckets, dimensions) {
  const rows = new Map();
  for (const bucket of buckets) {
    const values = dimensions.map((dimension) => dimension(bucket));
    if (values.some((value) => !value)) continue;
    const key = values.join('\u0001');
    const current = rows.get(key) || { key, values, totalTokens: 0 };
    current.totalTokens += tokenTotal(bucket);
    rows.set(key, current);
  }
  const result = [...rows.values()].sort((left, right) => right.totalTokens - left.totalTokens);
  const attributable = result.reduce((sum, row) => sum + row.totalTokens, 0);
  return result.map((row) => ({
    ...row,
    share: attributable > 0 ? row.totalTokens / attributable : 0,
  }));
}

function tone(value) {
  if (value >= .8) return 'good';
  if (value > 0) return 'attention';
  return 'neutral';
}

function CoverageBadge({ label, value }) {
  return <span className="coverage-badge" data-tone={tone(value)}><em>{label}</em><b>{percent(value)}</b></span>;
}

function EfficiencyCard({ label, value, note, accent = false }) {
  return <article className="efficiency-card" data-accent={accent ? 'true' : undefined}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

export function UsageAttributionSummary({ report, zh, currency }) {
  const buckets = report.buckets || [];
  const totalTokens = report.totals.totalTokens || 0;
  if (totalTokens <= 0) return null;

  const sourceOf = (bucket) => bucket.source || '';
  const modelOf = (bucket) => bucket.modelCanonical || bucket.model || '';
  const projectOf = (bucket) => bucket.project || '';
  const agents = grouped(buckets, [sourceOf]);
  const models = grouped(buckets, [modelOf]);
  const projects = grouped(buckets, [projectOf]);
  const agentModels = grouped(buckets, [sourceOf, modelOf]);
  const agentProjects = grouped(buckets, [sourceOf, projectOf]);
  const modelProjects = grouped(buckets, [modelOf, projectOf]);

  const agentCoverage = coverage(buckets, (bucket) => Boolean(sourceOf(bucket)), totalTokens);
  const modelCoverage = coverage(buckets, (bucket) => Boolean(modelOf(bucket)), totalTokens);
  const projectCoverage = coverage(buckets, (bucket) => Boolean(projectOf(bucket)), totalTokens);
  const exactCoverage = clamp(1 - ((report.totals.assumedTokens || 0) / totalTokens));
  const tokensPerRequest = report.totals.requestCount > 0 ? totalTokens / report.totals.requestCount : 0;
  const tokensPerMinute = report.activeSeconds > 0 ? totalTokens / (report.activeSeconds / 60) : 0;
  const costPerMillionMicros = totalTokens > 0 ? report.totals.costMicros * 1_000_000 / totalTokens : 0;
  const inputSide = report.totals.inputTokens + report.totals.cacheWriteInputTokens + report.totals.cacheReadInputTokens;
  const cacheShare = inputSide > 0 ? report.totals.cacheReadInputTokens / inputSide : null;

  const topRows = [
    agents[0] ? { id: 'agent', label: 'Agent', value: sourceLabel(agents[0].values[0]), share: agents[0].share, icon: agents[0].values[0] } : null,
    models[0] ? { id: 'model', label: zh ? '模型' : 'Model', value: models[0].values[0], share: models[0].share } : null,
    projects[0] ? { id: 'project', label: zh ? '项目' : 'Project', value: projects[0].values[0], share: projects[0].share } : null,
  ].filter(Boolean);

  const pairRows = [
    agentModels[0] ? {
      id: 'agent-model',
      label: zh ? 'Agent × 模型' : 'Agent × model',
      value: `${sourceLabel(agentModels[0].values[0])} × ${agentModels[0].values[1]}`,
      share: agentModels[0].share,
    } : null,
    agentProjects[0] ? {
      id: 'agent-project',
      label: zh ? 'Agent × 项目' : 'Agent × project',
      value: `${sourceLabel(agentProjects[0].values[0])} × ${agentProjects[0].values[1]}`,
      share: agentProjects[0].share,
    } : null,
    modelProjects[0] ? {
      id: 'model-project',
      label: zh ? '模型 × 项目' : 'Model × project',
      value: `${modelProjects[0].values[0]} × ${modelProjects[0].values[1]}`,
      share: modelProjects[0].share,
    } : null,
  ].filter(Boolean);

  return <section className="panel attribution-panel" aria-labelledby="attribution-title">
    <header className="panel-header attribution-header">
      <div><h2 id="attribution-title">{zh ? '归因与效率' : 'Attribution and efficiency'}</h2><p>{zh ? '来源：当前筛选范围 · 同一批本地事实联合计算，不由独立分布反推' : 'Source: current filters · calculated jointly from the same local facts'}</p></div>
      <div className="coverage-badges">
        <CoverageBadge label={zh ? 'Agent 覆盖' : 'Agent coverage'} value={agentCoverage}/>
        <CoverageBadge label={zh ? '模型覆盖' : 'Model coverage'} value={modelCoverage}/>
        <CoverageBadge label={zh ? '项目覆盖' : 'Project coverage'} value={projectCoverage}/>
        <CoverageBadge label={zh ? '精确计量' : 'Exact measurement'} value={exactCoverage}/>
      </div>
    </header>
    <div className="attribution-layout">
      <div className="attribution-contributors">
        <span className="attribution-kicker">{zh ? '最大贡献者 · 可归因数据内占比' : 'TOP CONTRIBUTORS · SHARE OF ATTRIBUTABLE DATA'}</span>
        <dl>{topRows.map((row) => <div key={row.id}><dt>{row.label}</dt><dd>{row.icon ? <ToolGlyph id={row.icon} context="chart"/> : null}<span title={row.value}>{row.value}</span></dd><dd>{percent(row.share)}</dd></div>)}</dl>
        {pairRows.length ? <div className="attribution-pairs">{pairRows.map((row) => <p key={row.id}><span>{row.label}</span><b title={row.value}>{row.value}</b><em>{percent(row.share)}</em></p>)}</div> : null}
      </div>
      <div className="efficiency-grid">
        <EfficiencyCard label={zh ? '每请求 Token' : 'Tokens per request'} value={compactNumber(tokensPerRequest, zh ? 'zh' : 'en')} note={zh ? '总 Token ÷ 请求数' : 'total tokens ÷ requests'} accent/>
        <EfficiencyCard label={zh ? '每百万 Token 估费' : 'Cost per 1M tokens'} value={displayMoney(costPerMillionMicros, currency)} note={zh ? '标准 API 等价估算' : 'standard API-equivalent estimate'}/>
        <EfficiencyCard label={zh ? '每活跃分钟 Token' : 'Tokens per active minute'} value={compactNumber(tokensPerMinute, zh ? 'zh' : 'en')} note={zh ? '本地吞吐效率参考' : 'local throughput reference'}/>
        <EfficiencyCard label={zh ? '缓存读取占比' : 'Cache read share'} value={cacheShare == null ? '—' : percent(cacheShare)} note={zh ? '输入侧口径' : 'input-side basis'}/>
      </div>
    </div>
  </section>;
}
