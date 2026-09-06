import { collectLocalSnapshot, publicDoctorReport } from './local/snapshot.js';
import {
  c, formatDuration, formatNumber, formatTokens, getLocale,
} from './cli-ui.js';

function sourceLine(source, width, isZh) {
  const label = source.source.padEnd(width);
  if (source.status === 'ok') {
    return `  ✓ ${label}${c.green(`${formatNumber(source.bucketCount)} buckets`)} · ${c.cyan(`${formatNumber(source.sessionCount)} sessions`)}`;
  }
  if (source.status === 'partial') {
    return `  ~ ${label}${c.yellow(`${formatNumber(source.bucketCount)} buckets · ${formatNumber(source.sessionCount)} sessions`)}${isZh ? '（部分读取）' : ' (partial read)'}`;
  }
  if (source.status === 'failed') return `  ✗ ${label}${c.red(source.error)}`;
  return `  - ${label}${c.gray(isZh ? '未检测到本地数据' : 'No local data detected')}`;
}

export async function runDoctor({ json = false } = {}) {
  const isZh = getLocale() === 'zh';
  const snapshot = await collectLocalSnapshot();
  const report = publicDoctorReport(snapshot);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  console.log(`${c.bold(c.cyan('Kimi Builders Usage'))} · ${c.dim(isZh ? '本地数据体检（未联网）' : 'local data diagnostics (offline)')}\n`);
  console.log(`${isZh ? '本地快照' : 'Local snapshot'}: ${c.bold(`v${report.schemaVersion}`)} · ${report.locality.sessionIdentity === 'installation-stable' ? c.green(isZh ? '稳定本机身份' : 'stable device identity') : c.yellow(isZh ? '临时会话身份' : 'ephemeral session identity')}`);
  console.log(c.bold(isZh ? '来源:' : 'Sources:'));
  const width = Math.max(...report.sources.map((source) => source.source.length), 0) + 4;
  for (const source of report.sources) console.log(sourceLine(source, width, isZh));

  console.log(c.bold(isZh ? '\n可用数据:' : '\nAvailable data:'));
  console.log(`  ${c.bold(c.cyan(formatNumber(report.summary.totalTokens)))} tokens (${formatTokens(report.summary.totalTokens)}) · ${formatNumber(report.summary.requestCount)} requests`);
  console.log(`  ${formatNumber(report.summary.bucketCount)} buckets · ${formatNumber(report.summary.sessionCount)} sessions`);
  console.log(`  ${isZh ? '活跃' : 'Active'} ${c.cyan(formatDuration(report.summary.activeSeconds))} · ${isZh ? '投入' : 'Engaged'} ${formatDuration(report.summary.engagedSeconds)}`);
  console.log(`  ${isZh ? '推理 Token' : 'Reasoning tokens'} ${c.green(formatNumber(report.summary.reasoningOutputTokens))} · ${isZh ? '缓存读取' : 'Cache reads'} ${formatNumber(report.summary.cacheReadInputTokens)}`);

  const rejected = report.diagnostics.rejected.length;
  console.log(c.bold(isZh ? '\n隐私与兼容性:' : '\nPrivacy & compatibility:'));
  console.log(`  ${c.green('✓')} ${isZh ? '本次命令没有发起网络请求' : 'This command made no network requests'}`);
  console.log(`  ${c.green('✓')} ${isZh ? '体检报告不包含路径、项目名、模型名或会话标识' : 'The report contains no paths, project names, model names, or session identifiers'}`);
  if (rejected === 0) console.log(`  ${c.green('✓')} ${isZh ? '所有解析记录均通过本地协议校验' : 'All parsed records passed local protocol validation'}`);
  else console.log(`  ${c.yellow('⚠')} ${isZh ? `${rejected} 条异常记录已隔离，不会进入本地看板或同步` : `${rejected} abnormal records were quarantined and will not reach the dashboard or sync`}`);
  if (report.locality.sessionIdentity === 'ephemeral') {
    console.log(`  ${c.dim('·')} ${isZh ? '尚未创建本机配置；本次会话标识只在当前进程内稳定' : 'No local config exists yet; session identity is stable only within this process'}`);
  }
  return report;
}
