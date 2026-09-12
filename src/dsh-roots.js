import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function getDshSessionsDir(env = process.env, home = homedir()) {
  const expand = (value) => value === '~' ? home
    : /^~[/\\]/.test(value) ? resolve(home, value.slice(2)) : resolve(value);
  if (env.KBU_USAGE_DSH_SESSIONS?.trim()) return expand(env.KBU_USAGE_DSH_SESSIONS.trim());
  return join(env.DSH_HOME?.trim() ? expand(env.DSH_HOME.trim()) : join(home, '.dsh'), 'sessions');
}
