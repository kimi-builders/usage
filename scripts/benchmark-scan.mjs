import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Full parsing in a fresh process, not a warm dashboard snapshot. The OS file
// cache is deliberately not flushed. Reports contain aggregate counts only.
export async function measureScan({ collectLocalSnapshot, config, sources }) {
  const durations = new Map();
  const started = performance.now();
  const snapshot = await collectLocalSnapshot({ config, sourceEntries: sources.map(source => ({ ...source,
    parse: async options => {
      const start = performance.now();
      try { return await source.parse(options); }
      finally { durations.set(source.id, Math.round(performance.now() - start)); }
    },
  })) });
  return {
    elapsedMs: Math.round(performance.now() - started),
    peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    bucketCount: snapshot.data.buckets.length,
    sessionCount: snapshot.data.sessions.length,
    performanceSampleCount: snapshot.data.turnPerformance?.length || 0,
    rejectedCount: snapshot.diagnostics.rejected.length,
    sources: snapshot.sources.map(source => ({
      source: source.source, status: source.status, elapsedMs: durations.get(source.source) ?? 0,
      bucketCount: source.bucketCount, sessionCount: source.sessionCount,
      warningCount: source.warnings?.length || 0,
    })),
  };
}

async function main(args) {
  const usage = 'Usage / 用法: npm run benchmark:scan -- --local [--runs 1..5] [--checkout /absolute/checkout]\n'
    + 'Read-only full local scan; aggregate timings/counts only, no uploads or config writes.\n'
    + '只读扫描本机已启用数据源；仅输出耗时/内存/数量，不上传、不修改配置。每次启动新进程，不清除系统文件缓存。\n'
    + 'Compare the same Node, checkout data, source settings and performanceSampleCount; changing logs make runs non-identical.\n'
    + '对比需使用相同 Node、数据、来源设置和性能样本数；扫描期间新增日志会影响可比性。';
  if (!args.length || args.includes('--help')) { console.log(usage); return; }
  let local = false; let worker = false; let runs = 1;
  let checkout = fileURLToPath(new URL('..', import.meta.url));
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--local') local = true;
    else if (args[i] === '--worker') worker = true;
    else if (args[i] === '--runs') runs = Number(args[++i]);
    else if (args[i] === '--checkout' && args[i + 1]) checkout = resolve(args[++i]);
    else throw new Error(usage);
  }
  if (!local || !Number.isInteger(runs) || runs < 1 || runs > 5) throw new Error(usage);
  if (worker) {
    // This entry point never imports sync or provider services. Block fetch as
    // an extra guard, and fail rather than silently benchmarking network work.
    let networkAttempts = 0;
    globalThis.fetch = () => { networkAttempts++; throw new Error('Network disabled in scan benchmark'); };
    const load = file => import(pathToFileURL(resolve(checkout, file)).href);
    const { collectLocalSnapshot } = await load('src/local/snapshot.js');
    const { loadConfig } = await load('src/config.js');
    const { enabledSources } = await load('src/parsers/index.js');
    const config = loadConfig();
    const report = await measureScan({ collectLocalSnapshot, config, sources: enabledSources(config?.enabledSources) });
    if (networkAttempts) throw new Error('Unexpected network attempt during benchmark');
    console.log(JSON.stringify(report));
    return;
  }
  const reports = [];
  for (let run = 0; run < runs; run++) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--local', '--worker', '--checkout', checkout], {
      encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 10 * 60_000,
    });
    if (result.status !== 0 || result.error) throw new Error('Scan benchmark failed; no raw logs or private paths included. / 扫描基准失败，未输出原始日志或私有路径。');
    reports.push(JSON.parse(result.stdout));
  }
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    mode: 'fresh-process-full-scan; OS file cache uncontrolled', reports }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
