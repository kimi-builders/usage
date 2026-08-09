import { arch as currentArch, platform as currentPlatform } from 'node:os';

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

export function terminalLabel(env = process.env) {
  if (clean(env.WT_SESSION)) return 'Windows Terminal';

  const program = clean(env.TERM_PROGRAM);
  if (program) return TERM_PROGRAM_LABELS.get(program.toLowerCase()) || program;

  const emulator = clean(env.TERMINAL_EMULATOR);
  if (/jetbrains/i.test(emulator)) return 'JetBrains Terminal';
  if (emulator) return emulator;
  return 'Terminal';
}

export function operatingSystemLabel(platform = currentPlatform(), arch = currentArch()) {
  const os = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' }[platform] || 'Unknown OS';
  const cpu = clean(arch);
  return cpu ? `${os} (${cpu})` : os;
}

/* Privacy-safe device identity: no hostname, username, path, or machine UUID. */
export function deviceDisplayName({
  env = process.env,
  platform = currentPlatform(),
  arch = currentArch(),
} = {}) {
  return `${terminalLabel(env)} · ${operatingSystemLabel(platform, arch)}`;
}
