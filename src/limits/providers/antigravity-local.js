import { spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { basename } from 'node:path';

const LOOPBACK_HOST = '127.0.0.1';
const SERVICE_PREFIX = '/exa.language_server_pb.LanguageServerService/';
const ENDPOINTS = ['RetrieveUserQuotaSummary', 'GetUserStatus', 'GetCommandModelConfigs'];

function commandOutput(run, command, args) {
  try {
    const result = run(command, args, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2_500,
    });
    return result?.status === 0 && typeof result.stdout === 'string' ? result.stdout : '';
  } catch {
    return '';
  }
}

function flagValue(command, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = command.match(new RegExp(`(?:^|\\s)--${escaped}(?:=|\\s+)(?:"([^"]+)"|'([^']+)'|(\\S+))`));
  return match?.[1] || match?.[2] || match?.[3] || '';
}

function runtimeFromCommand(pid, command) {
  const executable = command.match(/^\s*(?:"([^"]+)"|'([^']+)'|(\S+))/)?.slice(1).find(Boolean) || '';
  const executableName = basename(executable.replaceAll('\\', '/')).toLowerCase();
  if (executableName === 'agy' || executableName === 'agy.exe') {
    return { pid, kind: 'cli', label: 'agy 本机服务', csrfToken: '', extensionPort: null };
  }
  const languageServer = /language[_-]?server/i.test(executableName)
    || /(?:^|[/\\])language[_-]?server(?:_[A-Za-z0-9_-]+)?(?:\s|$)/i.test(command);
  if (!languageServer || !/antigravity/i.test(command)) return null;
  const kind = /antigravity[-_ ]ide|app_data_dir(?:=|\s+)antigravity-ide/i.test(command) ? 'ide' : 'app';
  const extensionPort = Number(flagValue(command, 'extension_server_port'));
  return {
    pid,
    kind,
    label: kind === 'ide' ? 'Antigravity IDE 本机服务' : 'Antigravity 本机服务',
    csrfToken: flagValue(command, 'csrf_token') || flagValue(command, 'extension_server_csrf_token'),
    extensionPort: Number.isInteger(extensionPort) && extensionPort > 0 && extensionPort <= 65_535
      ? extensionPort : null,
  };
}

export function parseAntigravityProcessList(output, platform = process.platform) {
  if (platform === 'win32') {
    try {
      const parsed = JSON.parse(output || '[]');
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows.map((row) => runtimeFromCommand(Number(row?.ProcessId), String(row?.CommandLine || '')))
        .filter((row) => Number.isInteger(row?.pid) && row.pid > 0);
    } catch {
      return [];
    }
  }
  return String(output || '').split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    return match ? runtimeFromCommand(Number(match[1]), match[2]) : null;
  }).filter(Boolean);
}

function processList({ run, platform }) {
  if (platform === 'win32') {
    return commandOutput(run, 'powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress',
    ]);
  }
  return commandOutput(run, 'ps', ['-ax', '-o', 'pid=,command=']);
}

export function detectAntigravityLocalRuntime({ run = spawnSync, platform = process.platform } = {}) {
  const runtimes = parseAntigravityProcessList(processList({ run, platform }), platform);
  if (!runtimes.length) return { found: false, label: null };
  const preferred = [...runtimes].sort((a, b) => ['app', 'cli', 'ide'].indexOf(a.kind) - ['app', 'cli', 'ide'].indexOf(b.kind))[0];
  return { found: true, label: preferred.label, kind: preferred.kind };
}

function parseListeningPorts(output, pid, platform) {
  const ports = new Set();
  for (const line of String(output || '').split(/\r?\n/)) {
    if (platform === 'win32') {
      const match = line.match(/^\s*TCP\s+(?:127\.0\.0\.1|\[::1\]):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (match && Number(match[2]) === pid) ports.add(Number(match[1]));
      continue;
    }
    const match = line.match(/(?:127\.0\.0\.1|\[::1\]):(\d+)\s+\(LISTEN\)/);
    if (match) ports.add(Number(match[1]));
  }
  return [...ports].filter((port) => Number.isInteger(port) && port > 0 && port <= 65_535);
}

function listeningPorts(runtime, { run, platform }) {
  const output = platform === 'win32'
    ? commandOutput(run, 'netstat.exe', ['-ano', '-p', 'tcp'])
    : commandOutput(run, 'lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', String(runtime.pid)]);
  const ports = parseListeningPorts(output, runtime.pid, platform);
  if (runtime.extensionPort && !ports.includes(runtime.extensionPort)) ports.push(runtime.extensionPort);
  return ports;
}

function fraction(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
}

export function hasAntigravityQuotaPayload(payload) {
  const groups = payload?.response?.groups || payload?.groups;
  if (Array.isArray(groups) && groups.some((group) => (group?.buckets || []).some((bucket) => (
    fraction(bucket?.remainingFraction ?? bucket?.remaining?.remainingFraction) != null
  )))) return true;
  const userStatus = payload?.userStatus || payload?.response?.userStatus || payload?.response;
  const configs = userStatus?.cascadeModelConfigData?.clientModelConfigs
    || payload?.clientModelConfigs || payload?.response?.clientModelConfigs;
  return Array.isArray(configs) && configs.some((row) => fraction(row?.quotaInfo?.remainingFraction) != null);
}

export function requestAntigravityLoopback({ port, protocol = 'https:', path, headers = {}, timeoutMs = 2_500 }) {
  return new Promise((resolve, reject) => {
    if (!Number.isInteger(port) || port <= 0 || port > 65_535 || !ENDPOINTS.some((name) => path === `${SERVICE_PREFIX}${name}`)) {
      const error = new Error('Antigravity 本机额度地址无效。');
      error.code = 'blocked_endpoint';
      reject(error);
      return;
    }
    const body = Buffer.from('{}');
    const transport = protocol === 'http:' ? httpRequest : httpsRequest;
    const request = transport({
      hostname: LOOPBACK_HOST,
      port,
      path,
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        'Connect-Protocol-Version': '1',
        ...headers,
      },
      rejectUnauthorized: false,
      timeout: timeoutMs,
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) request.destroy(new Error('Antigravity 本机响应过大。'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
          const error = new Error(`Antigravity 本机额度接口返回 HTTP ${response.statusCode || 0}。`);
          error.code = 'provider_error';
          reject(error);
          return;
        }
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!payload || typeof payload !== 'object') throw new Error('empty');
          resolve(payload);
        } catch {
          const error = new Error('Antigravity 本机额度接口返回了无法识别的数据。');
          error.code = 'invalid_response';
          reject(error);
        }
      });
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('Antigravity 本机额度查询超时。'), { code: 'timeout' })));
    request.on('error', (error) => reject(Object.assign(error, { code: error.code || 'provider_error' })));
    request.end(body);
  });
}

export async function fetchAntigravityLocalQuota({
  run = spawnSync,
  platform = process.platform,
  requester = requestAntigravityLoopback,
} = {}) {
  const runtimes = parseAntigravityProcessList(processList({ run, platform }), platform)
    .sort((a, b) => ['app', 'cli', 'ide'].indexOf(a.kind) - ['app', 'cli', 'ide'].indexOf(b.kind));
  if (!runtimes.length) {
    const error = new Error('未检测到正在运行的 Antigravity 或 agy 本机服务。');
    error.code = 'not_configured';
    throw error;
  }
  for (const runtime of runtimes) {
    const ports = listeningPorts(runtime, { run, platform });
    const headers = runtime.csrfToken ? { 'X-Codeium-Csrf-Token': runtime.csrfToken } : {};
    for (const port of ports) {
      for (const endpoint of ENDPOINTS) {
        const path = `${SERVICE_PREFIX}${endpoint}`;
        const protocols = runtime.extensionPort === port ? ['https:', 'http:'] : ['https:'];
        for (const protocol of protocols) {
          try {
            const payload = await requester({ port, protocol, path, headers });
            if (hasAntigravityQuotaPayload(payload)) return { payload, source: runtime.label };
          } catch { /* try the next verified loopback endpoint */ }
        }
      }
    }
  }
  const error = new Error('已检测到 Antigravity，但本机额度接口尚未就绪。');
  error.code = 'provider_error';
  throw error;
}
