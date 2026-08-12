import {
  existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getConfigDir } from './config.js';
import { COLLECTOR_VERSION } from './client-meta.js';
import { loadSyncStatus, runManagedSync } from './sync-runtime.js';
import { safeLocalPathDisplay } from './safe-display.js';

const LABEL = 'builders.kimi.usage.sync';
const SYSTEMD_NAME = 'kimi-builders-usage-sync';
const WINDOWS_TASK = 'Kimi Builders Usage Sync';
const DEFAULT_INTERVAL_MINUTES = 15;

export const DAEMON_INTERVAL = { default: DEFAULT_INTERVAL_MINUTES, min: 5, max: 1_440 };

export function platformScheduler(platform = process.platform) {
  if (platform === 'darwin') return { id: 'launchd', label: 'macOS · launchd' };
  if (platform === 'linux') return { id: 'systemd', label: 'Linux · systemd user' };
  if (platform === 'win32') return { id: 'task-scheduler', label: 'Windows · Task Scheduler' };
  return { id: 'unsupported', label: platform };
}

function xml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function systemdQuote(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`;
}

function cmdQuote(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function daemonPaths({
  platform = process.platform, home = homedir(), configDir = getConfigDir(),
} = {}) {
  const scheduler = platformScheduler(platform);
  const metadata = join(configDir, 'daemon.json');
  const log = join(configDir, 'sync.log');
  const schedulerLog = join(configDir, 'daemon-scheduler.log');
  const entry = fileURLToPath(new URL('../bin/kbu-usage.js', import.meta.url));
  if (platform === 'darwin') {
    return { scheduler, metadata, log, schedulerLog, entry, descriptor: join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`) };
  }
  if (platform === 'linux') {
    const unitDir = join(home, '.config', 'systemd', 'user');
    return {
      scheduler, metadata, log, schedulerLog, entry, descriptor: join(unitDir, `${SYSTEMD_NAME}.timer`),
      service: join(unitDir, `${SYSTEMD_NAME}.service`),
    };
  }
  if (platform === 'win32') {
    return { scheduler, metadata, log, schedulerLog, entry, descriptor: join(configDir, 'daemon-sync.cmd') };
  }
  return { scheduler, metadata, log, schedulerLog, entry, descriptor: null };
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function writeAtomic(path, content, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content, { mode });
  renameSync(temporary, path);
}

function defaultRunner(command, args) {
  return spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
}

function runChecked(runner, command, args, { allowFailure = false } = {}) {
  const result = runner(command, args) || {};
  if (!allowFailure && Number(result.status ?? 0) !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`${command} 执行失败${detail ? `：${detail}` : ''}`);
  }
  return result;
}

function validateInterval(value) {
  const interval = Number(value ?? DEFAULT_INTERVAL_MINUTES);
  if (!Number.isInteger(interval) || interval < DAEMON_INTERVAL.min || interval > DAEMON_INTERVAL.max) {
    throw new Error(`同步间隔必须是 ${DAEMON_INTERVAL.min}–${DAEMON_INTERVAL.max} 分钟的整数。`);
  }
  return interval;
}

function launchdPlist({ node, entry, intervalSeconds, log, environment = {} }) {
  const envEntries = Object.entries(environment).filter(([, value]) => value);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(entry)}</string><string>daemon</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>${intervalSeconds}</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>${envEntries.length ? `
  <key>EnvironmentVariables</key><dict>${envEntries.map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`).join('')}</dict>` : ''}
</dict></plist>
`;
}

function systemdUnits({ node, entry, intervalMinutes, log, environment = {} }) {
  const env = Object.entries(environment).filter(([, value]) => value)
    .map(([key, value]) => `Environment=${systemdQuote(`${key}=${value}`)}`).join('\n');
  const service = `[Unit]
Description=Kimi Builders local usage synchronization
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=${systemdQuote(node)} ${systemdQuote(entry)} daemon run
${env ? `${env}\n` : ''}StandardOutput=${systemdQuote(`append:${log}`)}
StandardError=${systemdQuote(`append:${log}`)}
`;
  const timer = `[Unit]
Description=Synchronize Kimi Builders usage every ${intervalMinutes} minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=${intervalMinutes}min
Persistent=true
Unit=${SYSTEMD_NAME}.service

[Install]
WantedBy=timers.target
`;
  return { service, timer };
}

function windowsScript({ node, entry, log, environment = {} }) {
  const env = Object.entries(environment).filter(([, value]) => value)
    .map(([key, value]) => `set "${key}=${String(value).replaceAll('%', '%%')}"`).join('\r\n');
  return `@echo off\r\n${env ? `${env}\r\n` : ''}${cmdQuote(node)} ${cmdQuote(entry)} daemon run >> ${cmdQuote(log)} 2>&1\r\n`;
}

function runtimeEnvironment() {
  return {
    PATH: process.env.PATH,
    KBU_USAGE_CONFIG_DIR: process.env.KBU_USAGE_CONFIG_DIR?.trim(),
    KBU_USAGE_STATE_DIR: process.env.KBU_USAGE_STATE_DIR?.trim(),
  };
}

export function renderDaemonFiles({
  platform = process.platform, home = homedir(), configDir = getConfigDir(),
  intervalMinutes = DEFAULT_INTERVAL_MINUTES, node = process.execPath,
} = {}) {
  const interval = validateInterval(intervalMinutes);
  const paths = daemonPaths({ platform, home, configDir });
  const common = { node, entry: paths.entry, log: paths.schedulerLog, environment: runtimeEnvironment() };
  if (platform === 'darwin') {
    return { paths, files: [{ path: paths.descriptor, content: launchdPlist({ ...common, intervalSeconds: interval * 60 }) }] };
  }
  if (platform === 'linux') {
    const units = systemdUnits({ ...common, intervalMinutes: interval });
    return { paths, files: [{ path: paths.service, content: units.service }, { path: paths.descriptor, content: units.timer }] };
  }
  if (platform === 'win32') {
    return { paths, files: [{ path: paths.descriptor, content: windowsScript(common) }] };
  }
  throw new Error(`当前系统 ${platform} 暂不支持后台同步；仍可运行单次 sync。`);
}

function writeMetadata(paths, intervalMinutes, platform, node) {
  const now = new Date().toISOString();
  const prior = readJson(paths.metadata);
  const metadata = {
    schemaVersion: 1, platform, scheduler: paths.scheduler.id,
    intervalMinutes, collectorVersion: COLLECTOR_VERSION,
    installedAt: prior?.installedAt || now, updatedAt: now, entry: paths.entry, node,
  };
  writeAtomic(paths.metadata, `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

function schedulerLoaded({ platform, paths, runner, home = homedir() }) {
  if (!paths.descriptor || !existsSync(paths.descriptor)) return false;
  if (platform === 'darwin') {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    return Number(runChecked(runner, 'launchctl', ['print', `gui/${uid}/${LABEL}`], { allowFailure: true }).status ?? 1) === 0;
  }
  if (platform === 'linux') {
    return Number(runChecked(runner, 'systemctl', ['--user', 'is-enabled', `${SYSTEMD_NAME}.timer`], { allowFailure: true }).status ?? 1) === 0;
  }
  if (platform === 'win32') {
    return Number(runChecked(runner, 'schtasks.exe', ['/Query', '/TN', WINDOWS_TASK], { allowFailure: true }).status ?? 1) === 0;
  }
  return false;
}

export function getDaemonStatus({
  platform = process.platform, home = homedir(), configDir = getConfigDir(), runner = defaultRunner,
} = {}) {
  const paths = daemonPaths({ platform, home, configDir });
  const metadata = readJson(paths.metadata);
  const installed = Boolean(paths.descriptor && existsSync(paths.descriptor));
  const loaded = installed ? schedulerLoaded({ platform, paths, runner, home }) : false;
  const runtimeAvailable = Boolean(
    (!metadata?.entry || existsSync(metadata.entry)) && (!metadata?.node || existsSync(metadata.node)),
  );
  return {
    supported: paths.scheduler.id !== 'unsupported', installed, loaded,
    scheduler: paths.scheduler, intervalMinutes: metadata?.intervalMinutes || null,
    installedVersion: metadata?.collectorVersion || null,
    updateRequired: Boolean(
      (metadata?.collectorVersion && metadata.collectorVersion !== COLLECTOR_VERSION) || !runtimeAvailable,
    ),
    runtimeAvailable,
    logPath: safeLocalPathDisplay(paths.log, { home }),
    schedulerLogPath: safeLocalPathDisplay(paths.schedulerLog, { home }),
    logAvailable: existsSync(paths.log),
    schedulerLogAvailable: existsSync(paths.schedulerLog),
    lastSync: loadSyncStatus({ configDir }),
  };
}

export function installDaemon({
  intervalMinutes = DEFAULT_INTERVAL_MINUTES, platform = process.platform, home = homedir(),
  configDir = getConfigDir(), runner = defaultRunner, node = process.execPath,
} = {}) {
  const interval = validateInterval(intervalMinutes);
  const { paths, files } = renderDaemonFiles({ platform, home, configDir, intervalMinutes: interval, node });
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  for (const file of files) writeAtomic(file.path, file.content, platform === 'win32' ? 0o700 : 0o600);
  const metadata = writeMetadata(paths, interval, platform, node);
  if (platform === 'darwin') {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const domain = `gui/${uid}`;
    runChecked(runner, 'launchctl', ['bootout', domain, paths.descriptor], { allowFailure: true });
    runChecked(runner, 'launchctl', ['bootstrap', domain, paths.descriptor]);
    runChecked(runner, 'launchctl', ['enable', `${domain}/${LABEL}`], { allowFailure: true });
    runChecked(runner, 'launchctl', ['kickstart', `${domain}/${LABEL}`], { allowFailure: true });
  } else if (platform === 'linux') {
    runChecked(runner, 'systemctl', ['--user', 'daemon-reload']);
    runChecked(runner, 'systemctl', ['--user', 'enable', '--now', `${SYSTEMD_NAME}.timer`]);
    runChecked(runner, 'systemctl', ['--user', 'start', `${SYSTEMD_NAME}.service`], { allowFailure: true });
  } else if (platform === 'win32') {
    runChecked(runner, 'schtasks.exe', [
      '/Create', '/TN', WINDOWS_TASK, '/TR', paths.descriptor,
      '/SC', 'MINUTE', '/MO', String(interval), '/F',
    ]);
    runChecked(runner, 'schtasks.exe', ['/Run', '/TN', WINDOWS_TASK], { allowFailure: true });
  }
  const { entry: _entry, node: _node, ...publicMetadata } = metadata;
  return { ...publicMetadata, status: getDaemonStatus({ platform, home, configDir, runner }) };
}

export function uninstallDaemon({
  platform = process.platform, home = homedir(), configDir = getConfigDir(), runner = defaultRunner,
} = {}) {
  const paths = daemonPaths({ platform, home, configDir });
  if (platform === 'darwin') {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    runChecked(runner, 'launchctl', ['bootout', `gui/${uid}`, paths.descriptor], { allowFailure: true });
  } else if (platform === 'linux') {
    runChecked(runner, 'systemctl', ['--user', 'disable', '--now', `${SYSTEMD_NAME}.timer`], { allowFailure: true });
  } else if (platform === 'win32') {
    runChecked(runner, 'schtasks.exe', ['/Delete', '/TN', WINDOWS_TASK, '/F'], { allowFailure: true });
  }
  for (const path of [paths.descriptor, paths.service, paths.metadata]) {
    if (!path) continue;
    try { unlinkSync(path); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  if (platform === 'linux') runChecked(runner, 'systemctl', ['--user', 'daemon-reload'], { allowFailure: true });
  return getDaemonStatus({ platform, home, configDir, runner });
}

export function restartDaemon(options = {}) {
  const current = getDaemonStatus(options);
  if (!current.installed) throw new Error('后台同步尚未安装，请先运行 daemon install。');
  return installDaemon({ ...options, intervalMinutes: options.intervalMinutes || current.intervalMinutes || DEFAULT_INTERVAL_MINUTES });
}

export async function runDaemonSync(options = {}) {
  return runManagedSync({ ...options, trigger: 'daemon', quiet: true, surface: 'daemon' });
}

export function printDaemonStatus(status, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  console.log(`后台同步: ${status.installed ? (status.loaded ? '已启用' : '已安装但未加载') : '未安装'}`);
  console.log(`调度器: ${status.scheduler.label}`);
  if (status.intervalMinutes) console.log(`间隔: 每 ${status.intervalMinutes} 分钟（设备唤醒且联网时）`);
  if (status.lastSync?.lastSuccessAt) console.log(`最近成功: ${status.lastSync.lastSuccessAt}`);
  if (status.lastSync?.lastError) console.log(`最近错误: ${status.lastSync.lastError}`);
  console.log(`日志: ${status.logPath}`);
  if (status.updateRequired) console.log('提示: Collector 已升级，请运行 daemon restart 更新后台服务路径。');
}
