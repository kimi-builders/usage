import { createSessionSalt, loadConfig } from './config.js';
import { createSyncClient } from './client-meta.js';
import { enabledSources } from './parsers/index.js';

export async function runInspect() {
  const config = loadConfig();
  const sessionSalt = config?.sessionSalt || createSessionSalt();
  console.log('Kimi Builders Usage · dry run（未联网）\n');
  console.log('来源与读取目录:');
  let bucketTotal = 0;
  let sessionTotal = 0;
  for (const source of enabledSources(config?.enabledSources)) {
    const roots = (await source.roots({ sourceOptions: config?.sourceOptions })) || [];
    if (roots.length === 0) {
      console.log(`  ${source.id}: 未检测到`);
      continue;
    }
    for (const root of roots) console.log(`  ${source.id}: ${root}`);
    try {
      const parsed = await source.parse({ sessionSalt, sourceOptions: config?.sourceOptions });
      const buckets = parsed?.buckets ?? [];
      const sessions = parsed?.sessions ?? [];
      bucketTotal += buckets.length;
      sessionTotal += sessions.length;
      console.log(`    → ${buckets.length} buckets · ${sessions.length} sessions`);
      for (const warning of (parsed?.warnings || []).slice(0, 2)) console.log(`      ⚠ ${warning}`);
    } catch (error) {
      console.log(`    → 解析失败：${error?.message || error}`);
    }
  }
  console.log('\n默认上传字段:');
  console.log('  bucket: source, 原始 model, 可证实的规范模型/供应方/推理强度/请求时 Agent 版本, bucketStart, 5 类 token, requestCount, measurement');
  console.log('  session: source, 可证实的请求时 Agent 版本, 本机盐化 sessionHash, 投入/活跃时长、消息数、稀疏小时活动（兼容 24 小时计数）');
  const client = createSyncClient('cli');
  const terminal = client.device.terminal;
  const os = client.device.os;
  console.log(`  device: ${terminal.name}${terminal.version ? ` ${terminal.version}` : ''} · ${os.name}${os.version ? ` ${os.version}` : ''}${os.architecture ? ` (${os.architecture})` : ''} · Collector v${client.surfaceVersion}`);
  const installed = Object.entries(client.agentVersions);
  console.log(`  当前 Agent 版本: ${installed.length > 0 ? installed.map(([source, version]) => `${source} v${version}`).join(' · ') : '未检测到'}`);
  console.log('  说明: 当前设备/Agent 版本仅用于诊断；不会用来回填缺失的历史请求版本或推理强度');
  console.log('  project: 不上传（默认）');
  console.log('  prompt/response/tool result/full path/provider credential: 永不上传');
  console.log(`\n检测结果: ${bucketTotal} buckets · ${sessionTotal} sessions`);
}
