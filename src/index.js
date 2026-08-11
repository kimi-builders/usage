import { getConfigPath, loadConfig } from './config.js';

function option(args, name) {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} 需要一个值。`);
  return value;
}

export async function run(args) {
  const command = args[0];
  if (!command) {
    if (loadConfig()?.apiKey) {
      const { runSync } = await import('./sync.js');
      return runSync();
    }
    const { runInit } = await import('./init.js');
    return runInit();
  }
  if (command === 'init') {
    const { runInit } = await import('./init.js');
    return runInit({
      apiUrl: option(args, 'api-url') || process.env.KBU_USAGE_API_URL || 'https://kimi.builders',
      manualKey: option(args, 'manual-key'),
    });
  }
  if (command === 'sync') {
    const { runSync } = await import('./sync.js');
    return runSync();
  }
  if (command === 'inspect' && (args.includes('--dry-run') || args.length === 1)) {
    const { runInspect } = await import('./inspect.js');
    return runInspect();
  }
  if (command === 'doctor') {
    const { runDoctor } = await import('./doctor.js');
    return runDoctor({ json: args.includes('--json') });
  }
  if (command === 'summary') {
    const raw = Number(option(args, 'days') || 7);
    if (!Number.isInteger(raw) || raw < 1 || raw > 90) throw new Error('--days 必须是 1–90。');
    const { runSummary } = await import('./summary.js');
    return runSummary(raw);
  }
  if (command === 'reset' && args.includes('--local')) {
    const { clearState } = await import('./state.js');
    clearState();
    console.log('本地同步 checkpoint 已清除；远端数据未修改。下次 sync 会安全重放。');
    return;
  }
  if (command === 'status') {
    const config = loadConfig();
    console.log(`配置: ${getConfigPath()}`);
    console.log(`状态: ${config?.apiKey ? `已连接 ${config.apiKey.slice(0, 12)}…` : '未连接'}`);
    console.log(`站点: ${config?.apiUrl || 'https://kimi.builders'}`);
    console.log('本地分析: 可用（无需连接社区）');
    return;
  }
  if (command === 'sources') {
    const { runSources } = await import('./sources.js');
    return runSources(args.slice(1));
  }
  if (['help', '--help', '-h'].includes(command)) {
    console.log(`
@kimi-builders/usage

  npx @kimi-builders/usage init [--api-url URL]
  npx @kimi-builders/usage sync
  npx @kimi-builders/usage inspect --dry-run
  npx @kimi-builders/usage doctor [--json]
  npx @kimi-builders/usage summary [--days 7]
  npx @kimi-builders/usage status
  npx @kimi-builders/usage sources list
  npx @kimi-builders/usage sources enable cursor --csv PATH
  npx @kimi-builders/usage sources disable cursor
  npx @kimi-builders/usage reset --local
`);
    return;
  }
  throw new Error(`未知命令: ${command}`);
}
