import { loadConfig } from './config.js';
import { createSyncClient } from './client-meta.js';
import { collectLocalSnapshot } from './local/snapshot.js';

export async function runInspect() {
  const config = loadConfig();
  const snapshot = await collectLocalSnapshot({ config });
  console.log('Kimi Builders Usage · dry run（未联网）\n');
  console.log('来源与读取目录:');
  for (const source of snapshot.sources) {
    if (source.roots.length === 0) {
      console.log(`  ${source.source}: 未检测到`);
      continue;
    }
    for (const root of source.roots) console.log(`  ${source.source}: ${root}`);
    if (source.status === 'failed') console.log(`    → 解析失败：${source.error}`);
    else console.log(`    → ${source.bucketCount} buckets · ${source.sessionCount} sessions`);
    for (const warning of (source.warnings || []).slice(0, 2)) console.log(`      ⚠ ${warning}`);
  }
  console.log('\n默认上传字段:');
  console.log('  bucket: source, 原始 model, 可证实的规范模型/供应方/推理强度/请求时 Agent 版本/上下文与处理档位, bucketStart, 5 类 token（缓存写可含 5 分钟/1 小时 TTL 分区）, requestCount, measurement');
  console.log('  session: source, 可证实的请求时 Agent 版本, 本机盐化 sessionHash, 投入/活跃时长、消息数、可按范围裁剪的稀疏 UTC 小时事实（兼容旧计数）');
  const client = createSyncClient('cli');
  const terminal = client.device.terminal;
  const os = client.device.os;
  console.log(`  device: ${terminal.name}${terminal.version ? ` ${terminal.version}` : ''} · ${os.name}${os.version ? ` ${os.version}` : ''}${os.architecture ? ` (${os.architecture})` : ''} · Collector v${client.surfaceVersion}`);
  if (terminal.confidence === 'fallback') {
    console.log('    ↳ 当前进程未暴露终端信息；CLI fallback 不会覆盖服务端已有的 Warp/iTerm/Terminal 事实');
  }
  const installed = Object.entries(client.agentVersions);
  console.log(`  当前 Agent 版本: ${installed.length > 0 ? installed.map(([source, version]) => `${source} v${version}`).join(' · ') : '未检测到'}`);
  console.log('  说明: 当前设备/Agent 版本仅用于诊断；不会用来回填缺失的历史请求版本或推理强度');
  console.log('  project: 不上传（默认）');
  console.log('  prompt/response/tool result/full path/provider credential: 永不上传');
  console.log(`\n检测结果: ${snapshot.summary.bucketCount} buckets · ${snapshot.summary.sessionCount} sessions`);
  if (snapshot.diagnostics.rejected.length > 0) {
    console.log(`协议校验: ${snapshot.diagnostics.rejected.length} 条异常记录已隔离`);
  }
}
