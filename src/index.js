import { c, setColorEnabled } from './cli-ui.js';
import { getConfigPath, loadConfig } from './config.js';

function option(args, name) {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} 需要一个值。`);
  return value;
}

function printHelp() {
  console.log(`
${c.bold(c.cyan('@kimi.builders/usage'))} ${c.dim('— 本地优先的 AI Coding Agent 用量分析与额度监控工具')}

${c.bold('▸ 用量分析与看板')}
  npx @kimi.builders/usage stats [--period today|24h|7d|30d|all] [--source agent] [--json]
  npx @kimi.builders/usage top [--period 30d]
  npx @kimi.builders/usage summary [--days 7] [--remote]
  npx @kimi.builders/usage dashboard [--no-open] [--port 43120]
  npx @kimi.builders/usage status

${c.bold('▸ 社区同步与后台服务')}
  npx @kimi.builders/usage init [--api-url URL] [--sync]
  npx @kimi.builders/usage sync [--full]
  npx @kimi.builders/usage daemon install [--interval 15]
  npx @kimi.builders/usage daemon status [--json]
  npx @kimi.builders/usage daemon restart [--interval 15]
  npx @kimi.builders/usage daemon uninstall

${c.bold('▸ 来源检测与诊断')}
  npx @kimi.builders/usage inspect --dry-run
  npx @kimi.builders/usage doctor [--json]
  npx @kimi.builders/usage sources list
  npx @kimi.builders/usage sources set <agent> off|local|private
  npx @kimi.builders/usage sources enable cursor --csv PATH
  npx @kimi.builders/usage sources disable cursor
  npx @kimi.builders/usage reset --local

${c.bold('▸ 通用选项')}
  npx @kimi.builders/usage --help / -h
  npx @kimi.builders/usage --version / -v
  npx @kimi.builders/usage [--lang en|zh] [--no-color|--plain]
`);
}

export async function run(args) {
  if (args.includes('--no-color') || args.includes('--plain')) {
    setColorEnabled(false);
  } else if (args.includes('--color')) {
    setColorEnabled(true);
  }

  const langIndex = args.indexOf('--lang');
  if (langIndex >= 0 && args[langIndex + 1]) {
    const { setLocale } = await import('./cli-ui.js');
    setLocale(args[langIndex + 1]);
  }

  const command = args[0];
  if (!command) {
    printHelp();
    return;
  }
  if (command === 'init') {
    const { runInit } = await import('./init.js');
    return runInit({
      apiUrl: option(args, 'api-url') || process.env.KBU_USAGE_API_URL || 'https://kimi.builders',
      manualKey: option(args, 'manual-key'),
      syncAfterConnect: args.includes('--sync'),
    });
  }
  if (command === 'sync') {
    const { runManagedSync } = await import('./sync-runtime.js');
    return runManagedSync({ full: args.includes('--full') });
  }
  if (command === 'daemon') {
    const action = args[1] || 'status';
    const {
      getDaemonStatus, installDaemon, printDaemonStatus, restartDaemon, runDaemonSync,
      uninstallDaemon,
    } = await import('./daemon.js');
    if (action === 'install') {
      const result = installDaemon({ intervalMinutes: Number(option(args, 'interval') || 15) });
      console.log(`后台同步已启用：每 ${result.intervalMinutes} 分钟同步一次。`);
      console.log('设备需要保持唤醒并联网；云端不会主动读取你的本地文件。');
      return result;
    }
    if (action === 'status') return printDaemonStatus(getDaemonStatus(), { json: args.includes('--json') });
    if (action === 'restart') {
      const result = restartDaemon({
        ...(option(args, 'interval') ? { intervalMinutes: Number(option(args, 'interval')) } : {}),
      });
      console.log(`后台同步已重新加载：每 ${result.intervalMinutes} 分钟一次。`);
      return result;
    }
    if (action === 'uninstall') {
      uninstallDaemon();
      console.log('后台同步已停用；本地历史、云端数据和连接配置均未删除。');
      return;
    }
    if (action === 'run') return runDaemonSync();
    throw new Error(`未知 daemon 命令: ${action}`);
  }
  if (command === 'inspect' && (args.includes('--dry-run') || args.length === 1)) {
    const { runInspect } = await import('./inspect.js');
    return runInspect();
  }
  if (command === 'doctor') {
    const { runDoctor } = await import('./doctor.js');
    return runDoctor({ json: args.includes('--json') });
  }
  if (command === 'dashboard') {
    const rawPort = option(args, 'port');
    const port = rawPort === undefined ? 0 : Number(rawPort);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new Error('--port 必须是 0–65535 的整数。');
    }
    const { runDashboard } = await import('./local/dashboard-server.js');
    return runDashboard({ port, launchBrowser: !args.includes('--no-open') });
  }
  if (command === 'stats') {
    const { runStats } = await import('./stats.js');
    return runStats({
      period: option(args, 'period') || (option(args, 'days') ? `${option(args, 'days')}d` : '7d'),
      days: option(args, 'days') ? Number(option(args, 'days')) : undefined,
      source: option(args, 'source') || option(args, 'agent'),
      model: option(args, 'model'),
      project: option(args, 'project'),
      json: args.includes('--json'),
      plain: args.includes('--plain'),
    });
  }
  if (command === 'top') {
    const { runStats } = await import('./stats.js');
    return runStats({
      period: option(args, 'period') || '30d',
      json: args.includes('--json'),
      topOnly: true,
    });
  }
  if (command === 'summary') {
    const daysOpt = option(args, 'days');
    const raw = daysOpt ? Number(daysOpt) : 7;
    if (!Number.isInteger(raw) || raw < 1 || raw > 90) throw new Error('--days 必须是 1–90。');
    const { runSummary } = await import('./summary.js');
    return runSummary(raw, { remote: args.includes('--remote'), json: args.includes('--json') });
  }
  if (command === 'reset' && args.includes('--local')) {
    const { clearState } = await import('./state.js');
    clearState();
    console.log('本地同步 checkpoint 已清除；远端数据未修改。下次 sync 会安全重放。');
    return;
  }
  if (command === 'status') {
    const { getLocale } = await import('./cli-ui.js');
    const isZh = getLocale() === 'zh';
    const config = loadConfig();
    console.log(`\n${c.bold(c.cyan(isZh ? '◆ Kimi Builders Usage 运行状态' : '◆ Kimi Builders Usage Status'))}`);
    console.log(c.dim('─'.repeat(Math.min(68, (process.stdout.columns || 80) - 2))));

    console.log(c.bold(isZh ? '【社区同步服务】' : '[Community Sync Service]'));
    console.log(`  • ${isZh ? '连接状态' : 'Connection'}: ${config?.apiKey ? c.green(isZh ? `已连接 (${config.apiKey.slice(0, 12)}…)` : `Connected (${config.apiKey.slice(0, 12)}…)`) : c.gray(isZh ? '未连接' : 'Not connected')}`);
    console.log(`  • ${isZh ? '目标站点' : 'API URL'}: ${config?.apiUrl || 'https://kimi.builders'}`);
    console.log(`  • ${isZh ? '隐私模式' : 'Privacy'}: ${c.dim(isZh ? '脱敏聚合 (项目名默认隐藏)' : 'Anonymized aggregates (projects hidden by default)')}`);

    const { getDaemonStatus } = await import('./daemon.js');
    const daemon = getDaemonStatus();
    console.log(`  • ${isZh ? '后台同步' : 'Daemon'}: ${daemon.installed ? c.green(isZh ? `运行中 (每 ${daemon.intervalMinutes} 分钟同步)` : `Active (every ${daemon.intervalMinutes}m)`) : c.gray(isZh ? '未安装' : 'Not installed')}`);

    console.log(`\n${c.bold(isZh ? '【本地数据引擎】' : '[Local Data Engine]')}`);
    console.log(`  • ${isZh ? '配置文件' : 'Config'}: ${getConfigPath()}`);
    console.log(`  • ${isZh ? '本地分析' : 'Local Analytics'}: ${c.green(isZh ? '可用 (离线就绪，无需连接社区)' : 'Ready (Offline, no account needed)')}`);

    console.log(`\n${c.bold(isZh ? '【快捷命令】' : '[Quick Commands]')}`);
    console.log(`  • ${isZh ? '打开 Web 看板' : 'Open Web Dashboard'}: ${c.cyan('npx @kimi.builders/usage dashboard')}`);
    console.log(`  • ${isZh ? '执行离线体检' : 'Run Diagnostics'}:     ${c.cyan('npx @kimi.builders/usage doctor')}`);
    console.log(`  • ${isZh ? '管理数据源' : 'Manage Sources'}:        ${c.cyan('npx @kimi.builders/usage sources list')}`);
    console.log(c.dim('─'.repeat(Math.min(68, (process.stdout.columns || 80) - 2))) + '\n');
    return;
  }
  if (command === 'sources') {
    const { runSources } = await import('./sources.js');
    return runSources(args.slice(1));
  }
  if (['help', '--help', '-h'].includes(command)) {
    printHelp();
    return;
  }
  if (['version', '--version', '-v'].includes(command)) {
    const { COLLECTOR_VERSION } = await import('./client-meta.js');
    console.log(COLLECTOR_VERSION);
    return COLLECTOR_VERSION;
  }
  throw new Error(`未知命令: ${command}`);
}
