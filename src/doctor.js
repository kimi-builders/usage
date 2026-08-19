import { collectLocalSnapshot, publicDoctorReport } from './local/snapshot.js';
import { c, formatDuration, formatNumber, formatTokens } from './cli-ui.js';

function sourceLine(source, width) {
  const label = source.source.padEnd(width);
  if (source.status === 'ok') {
    return `  ✓ ${label}${c.green(`${formatNumber(source.bucketCount)} buckets`)} · ${c.cyan(`${formatNumber(source.sessionCount)} sessions`)}`;
  }
  if (source.status === 'partial') {
    return `  ~ ${label}${c.yellow(`${formatNumber(source.bucketCount)} buckets · ${formatNumber(source.sessionCount)} sessions`)}（部分读取）`;
  }
  if (source.status === 'failed') return `  ✗ ${label}${c.red(source.error)}`;
  return `  - ${label}${c.gray('未检测到本地数据')}`;
}

export async function runDoctor({ json = false } = {}) {
  const snapshot = await collectLocalSnapshot();
  const report = publicDoctorReport(snapshot);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  console.log(`${c.bold(c.cyan('Kimi Builders Usage'))} · ${c.dim('本地数据体检（未联网）')}\n`);
  console.log(`本地快照: ${c.bold(`v${report.schemaVersion}`)} · ${report.locality.sessionIdentity === 'installation-stable' ? c.green('稳定本机身份') : c.yellow('临时会话身份')}`);
  console.log(c.bold('来源:'));
  const width = Math.max(...report.sources.map((source) => source.source.length), 0) + 4;
  for (const source of report.sources) console.log(sourceLine(source, width));

  console.log(c.bold('\n可用数据:'));
  console.log(`  ${c.bold(c.cyan(formatNumber(report.summary.totalTokens)))} tokens (${formatTokens(report.summary.totalTokens)}) · ${formatNumber(report.summary.requestCount)} requests`);
  console.log(`  ${formatNumber(report.summary.bucketCount)} buckets · ${formatNumber(report.summary.sessionCount)} sessions`);
  console.log(`  活跃 ${c.cyan(formatDuration(report.summary.activeSeconds))} · 投入 ${formatDuration(report.summary.engagedSeconds)}`);
  console.log(`  推理 Token ${c.green(formatNumber(report.summary.reasoningOutputTokens))} · 缓存读取 ${formatNumber(report.summary.cacheReadInputTokens)}`);

  const rejected = report.diagnostics.rejected.length;
  console.log(c.bold('\n隐私与兼容性:'));
  console.log(`  ${c.green('✓')} 本次命令没有发起网络请求`);
  console.log(`  ${c.green('✓')} 体检报告不包含路径、项目名、模型名或会话标识`);
  if (rejected === 0) console.log(`  ${c.green('✓')} 所有解析记录均通过本地协议校验`);
  else console.log(`  ${c.yellow('⚠')} ${rejected} 条异常记录已隔离，不会进入本地看板或同步`);
  if (report.locality.sessionIdentity === 'ephemeral') {
    console.log(`  ${c.dim('·')} 尚未创建本机配置；本次会话标识只在当前进程内稳定`);
  }
  return report;
}
