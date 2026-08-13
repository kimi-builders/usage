import { existsSync, statSync } from 'node:fs';
import { delimiter, basename, join } from 'node:path';
import { homedir } from 'node:os';

export function defaultWorkbuddyProjectsRoots(home = homedir()) {
  return [join(home, '.workbuddy-ai', 'projects'), join(home, '.workbuddy', 'projects')];
}

export function workbuddyProjectsRoots() {
  const override = process.env.KBU_USAGE_WORKBUDDY_DIRS;
  const candidates = override === undefined
    ? defaultWorkbuddyProjectsRoots()
    : override.split(delimiter).map((value) => value.trim()).filter(Boolean)
      .map((value) => basename(value) === 'projects' ? value : join(value, 'projects'));
  return [...new Set(candidates)].filter((path) => {
    try { return existsSync(path) && statSync(path).isDirectory(); } catch { return false; }
  });
}
