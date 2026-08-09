import { execFileSync } from 'node:child_process';
import { arch as currentArch, platform as currentPlatform, release as currentRelease } from 'node:os';

const TERM_PROGRAM_LABELS = new Map([
  ['apple_terminal', 'Terminal'],
  ['iterm.app', 'iTerm2'],
  ['vscode', 'VS Code Terminal'],
  ['hyper', 'Hyper'],
  ['warpterminal', 'Warp'],
  ['wezterm', 'WezTerm'],
]);

function clean(value) {
  return typeof value === 'string'
    ? value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40)
    : '';
}

export function terminalInfo(env = process.env) {
  const version = clean(env.TERM_PROGRAM_VERSION);
  if (clean(env.WT_SESSION)) return { name: 'Windows Terminal', version, confidence: 'detected' };

  const program = clean(env.TERM_PROGRAM);
  if (program) {
    return {
      name: TERM_PROGRAM_LABELS.get(program.toLowerCase()) || program,
      version,
      confidence: 'detected',
    };
  }

  const emulator = clean(env.TERMINAL_EMULATOR);
  if (/jetbrains/i.test(emulator)) {
    return { name: 'JetBrains Terminal', version, confidence: 'detected' };
  }
  if (emulator) return { name: emulator, version, confidence: 'detected' };
  // Background services and sandboxed runners commonly lack terminal env
  // variables. Keep an explicit low-confidence fallback so the server never
  // replaces a previously detected Warp/iTerm/Terminal fact with "CLI".
  return { name: 'CLI', version, confidence: 'fallback' };
}

export function terminalLabel(env = process.env) {
  return terminalInfo(env).name;
}

function macOSVersion() {
  try {
    return clean(execFileSync('sw_vers', ['-productVersion'], {
      encoding: 'utf8',
      timeout: 1_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }));
  } catch {
    return '';
  }
}

export function operatingSystemInfo({
  platform = currentPlatform(),
  arch = currentArch(),
  release = currentRelease(),
  version,
} = {}) {
  const name = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' }[platform] || 'Unknown OS';
  return {
    name,
    version: clean(version ?? (platform === 'darwin' ? macOSVersion() : release)),
    architecture: clean(arch),
  };
}

export function operatingSystemLabel(platform = currentPlatform(), arch = currentArch()) {
  const os = operatingSystemInfo({ platform, arch });
  return os.architecture ? `${os.name} (${os.architecture})` : os.name;
}

export function deviceEnvironment(options = {}) {
  return {
    terminal: terminalInfo(options.env),
    os: operatingSystemInfo(options),
  };
}

/* Privacy-safe device identity: no hostname, username, path, or machine UUID. */
export function deviceDisplayName({
  env = process.env,
  platform = currentPlatform(),
  arch = currentArch(),
} = {}) {
  const environment = deviceEnvironment({ env, platform, arch });
  return `${environment.terminal.name} · ${environment.os.name}`;
}
