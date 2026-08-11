import { collectLocalSnapshot, publicDoctorReport } from './local/snapshot.js';

function number(value) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function duration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function sourceLine(source, width) {
  const label = source.source.padEnd(width);
  if (source.status === 'ok') {
    return `  ✓ ${label}${number(source.bucketCount)} buckets · ${number(source.sessionCount)} sessions`;
  }
  if (source.status === 'partial') {
    return `  ~ ${label}${number(source.bucketCount)} buckets · ${number(source.sessionCount)} sessions（部分读取）`;
  }
  if (source.status === 'failed') return `  ✗ ${label}${source.error}`;
  return `  - ${label}未检测到本地数据`;
}

export async function runDoctor({ json = false } = {}) {
  const snapshot = await collectLocalSnapshot();
  const report = publicDoctorReport(snapshot);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  console.log('Kimi Builders Usage · 本地数据体检（未联网）\n');
  console.log(`本地快照: v${report.schemaVersion} · ${report.locality.sessionIdentity === 'installation-stable' ? '稳定本机身份' : '临时会话身份'}`);
  console.log('来源:');
  const width = Math.max(...report.sources.map((source) => source.source.length), 0) + 4;
  for (const source of report.sources) console.log(sourceLine(source, width));

  console.log('\n可用数据:');
  console.log(`  ${number(report.summary.totalTokens)} tokens · ${number(report.summary.requestCount)} requests`);
  console.log(`  ${number(report.summary.bucketCount)} buckets · ${number(report.summary.sessionCount)} sessions`);
  console.log(`  活跃 ${duration(report.summary.activeSeconds)} · 投入 ${duration(report.summary.engagedSeconds)}`);
  console.log(`  推理 Token ${number(report.summary.reasoningOutputTokens)} · 缓存读取 ${number(report.summary.cacheReadInputTokens)}`);

  const rejected = report.diagnostics.rejected.length;
  console.log('\n隐私与兼容性:');
  console.log('  ✓ 本次命令没有发起网络请求');
  console.log('  ✓ 体检报告不包含路径、项目名、模型名或会话标识');
  if (rejected === 0) console.log('  ✓ 所有解析记录均通过本地协议校验');
  else console.log(`  ⚠ ${rejected} 条异常记录已隔离，不会进入本地看板或同步`);
  if (report.locality.sessionIdentity === 'ephemeral') {
    console.log('  · 尚未创建本机配置；本次会话标识只在当前进程内稳定');
  }
  return report;
}
