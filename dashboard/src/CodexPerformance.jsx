import { compactNumber } from './format.js';

export function CodexPerformance({ value, zh }) {
  const seconds = number => number == null ? '—' : `${(number / 1_000).toLocaleString(zh ? 'zh-CN' : 'en-US', { maximumFractionDigits: 2 })} s`;
  return <section className="panel codex-performance" aria-label={zh ? 'Codex 实测轮次性能' : 'Measured Codex turn performance'}>
    <header className="panel-header"><div><h2>{zh ? 'Codex 轮次性能' : 'Codex turn performance'}</h2><p>{zh ? '本机观测 · 跟随当前筛选 · 按完成时间计入' : 'Local observations · current filters · grouped by completion time'}</p></div></header>
    <dl className="limit-provider-summary">
      <div><dt>{zh ? '首 Token 延迟中位数' : 'Median time to first token'}</dt><dd>{seconds(value.medianFirstTokenMs)}</dd><small>{zh ? `${compactNumber(value.firstTokenSampleCount, 'zh')} 个计时样本` : `${compactNumber(value.firstTokenSampleCount, 'en')} timed ${value.firstTokenSampleCount === 1 ? 'sample' : 'samples'}`}</small></div>
      <div><dt>{zh ? '整轮输出吞吐量' : 'Whole-turn output throughput'}</dt><dd>{value.outputTokensPerSecond == null ? '—' : `${value.outputTokensPerSecond.toLocaleString(zh ? 'zh-CN' : 'en-US', { maximumFractionDigits: 1 })} Token/s`}</dd></div>
      <div><dt>{zh ? '整轮耗时中位数' : 'Median whole-turn duration'}</dt><dd>{seconds(value.medianDurationMs)}</dd></div>
      <div><dt>{zh ? '有效完成轮次' : 'Valid completed turns'}</dt><dd>{compactNumber(value.sampleCount, zh ? 'zh' : 'en')}</dd></div>
    </dl>
    <p className="limit-notice">{value.sampleCount ? (zh ? '输出包含推理 Token；吞吐量 = 样本输出之和 ÷ 整轮耗时之和。整轮包括工具、等待和推理，不是模型纯生成速度；这些样本不代表所有请求，也不会上传社区。' : 'Output includes reasoning Tokens. Throughput = summed output ÷ summed whole-turn duration, including tools, waiting, and reasoning—not pure model generation speed. Samples do not represent every request and are never uploaded to the community.') : (zh ? '当前筛选下没有完整计时样本。仅接受可核验的请求账本与成功轮次计时；不会用活跃时长或估算值补齐。' : 'No complete timing samples match these filters. Only verifiable request ledgers and successful turn timings qualify; activity duration or estimates are never substituted.')}</p>
  </section>;
}
