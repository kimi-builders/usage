import { loadConfig } from './config.js';
import { createSyncClient } from './client-meta.js';
import { collectLocalSnapshot } from './local/snapshot.js';
import { c, formatNumber, getLocale } from './cli-ui.js';

export async function runInspect() {
  const isZh = getLocale() === 'zh';
  const config = loadConfig();
  const snapshot = await collectLocalSnapshot({ config });
  console.log(`${c.bold(c.cyan('Kimi Builders Usage'))} · ${c.dim(isZh ? 'dry run（未联网）' : 'dry run (offline)')}\n`);
  console.log(c.bold(isZh ? '来源与读取目录:' : 'Sources & read locations:'));
  for (const source of snapshot.sources) {
    if (source.roots.length === 0) {
      console.log(`  ${c.dim(source.source)}: ${c.gray(isZh ? '未检测到' : 'Not detected')}`);
      continue;
    }
    for (const root of source.roots) console.log(`  ${c.bold(source.source)}: ${c.dim(root)}`);
    if (source.status === 'failed') console.log(`    → ${c.red(isZh ? `解析失败：${source.error}` : `Parsing failed: ${source.error}`)}`);
    else console.log(`    → ${c.green(`${source.bucketCount} buckets`)} · ${c.cyan(`${source.sessionCount} sessions`)}`);
    for (const warning of (source.warnings || []).slice(0, 2)) console.log(`      ${c.yellow(`⚠ ${warning}`)}`);
  }
  console.log(c.bold(isZh ? '\n默认上传字段:' : '\nDefault upload fields:'));
  console.log(isZh
    ? '  bucket: source, 原始 model, 可证实的规范模型/供应方/推理强度/请求时 Agent 版本/上下文与处理档位, bucketStart, 5 类 token（缓存写可含 5 分钟/1 小时 TTL 分区）, requestCount, measurement'
    : '  bucket: source, raw model, verifiable canonical model/provider/reasoning effort/request-time Agent version/context and processing tier, bucketStart, 5 token classes (cache writes may include 5-minute/1-hour TTL splits), requestCount, measurement');
  console.log(isZh
    ? '  session: source, 可证实的请求时 Agent 版本, 本机盐化 sessionHash, 投入/活跃时长、消息数、可按范围裁剪的稀疏 UTC 小时事实（兼容旧计数）'
    : '  session: source, verifiable request-time Agent version, locally salted sessionHash, engaged/active duration, message counts, and range-clippable sparse UTC-hour facts (legacy counts supported)');
  const client = createSyncClient('cli');
  const terminal = client.device.terminal;
  const os = client.device.os;
  console.log(`  device: ${terminal.name}${terminal.version ? ` ${terminal.version}` : ''} · ${os.name}${os.version ? ` ${os.version}` : ''}${os.architecture ? ` (${os.architecture})` : ''} · Collector v${client.surfaceVersion}`);
  if (terminal.confidence === 'fallback') {
    console.log(isZh
      ? '    ↳ 当前进程未暴露终端信息；CLI fallback 不会覆盖服务端已有的 Warp/iTerm/Terminal 事实'
      : '    ↳ This process exposes no terminal metadata; the CLI fallback will not overwrite existing Warp/iTerm/Terminal facts on the server');
  }
  const installed = Object.entries(client.agentVersions);
  console.log(`  ${isZh ? '当前 Agent 版本' : 'Current Agent versions'}: ${installed.length > 0 ? installed.map(([source, version]) => `${source} v${version}`).join(' · ') : (isZh ? '未检测到' : 'Not detected')}`);
  console.log(isZh
    ? '  说明: 当前设备/Agent 版本仅用于诊断；不会用来回填缺失的历史请求版本或推理强度'
    : '  Note: current device/Agent versions are diagnostic only; they never backfill missing historical request versions or reasoning effort');
  console.log(`  project: ${c.green(isZh ? '不上传（默认）' : 'not uploaded (default)')}`);
  console.log(`  prompt/response/tool result/full path/provider credential: ${c.green(isZh ? '永不上传' : 'never uploaded')}`);
  console.log(`\n${isZh ? '检测结果' : 'Inspection result'}: ${c.bold(c.cyan(`${snapshot.summary.bucketCount} buckets`))} · ${c.bold(c.cyan(`${snapshot.summary.sessionCount} sessions`))}`);
  if (snapshot.diagnostics.rejected.length > 0) {
    console.log(`${isZh ? '协议校验' : 'Protocol validation'}: ${c.yellow(isZh
      ? `${snapshot.diagnostics.rejected.length} 条异常记录已隔离`
      : `${snapshot.diagnostics.rejected.length} abnormal records quarantined`)}`);
  }
}
