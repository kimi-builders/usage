import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// Shared by scanning and explicit local-login quota lookup. An override is
// exclusive; Windows' native store supplements (not replaces) the XDG store.
export function openCodeDataRoots(environment = process.env, home = homedir(), platform = process.platform) {
  const override = environment.KBU_USAGE_OPENCODE_DIR?.trim();
  const paths = override
    ? override.split(platform === 'win32' ? ';' : ':').map((value) => value.trim()).filter(Boolean)
    : [
      join(environment.XDG_DATA_HOME?.trim() || join(home, '.local', 'share'), 'opencode'),
      ...(platform === 'win32'
        ? [join(environment.LOCALAPPDATA?.trim() || join(home, 'AppData', 'Local'), 'opencode')]
        : []),
    ];
  const seen = new Set();
  return paths.filter((path) => {
    const key = platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
