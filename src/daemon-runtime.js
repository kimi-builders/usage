import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A pinned, dependency-free Collector snapshot. Never run @latest unattended
// and never depend on an npm/npx cache path surviving the next cache cleanup.
export function installDaemonRuntime(configDir, packageRoot = fileURLToPath(new URL('..', import.meta.url))) {
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  if (Object.keys(manifest.dependencies || {}).length) throw new Error('Managed daemon runtime requires a dependency-free Collector.');
  const files = ['package.json'];
  const walk = (relative) => {
    for (const entry of readdirSync(join(packageRoot, relative), { withFileTypes: true })) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error('Managed runtime cannot contain symbolic links or special files.');
    }
  };
  walk('bin'); walk('src');
  const contents = files.sort().map((path) => [path, readFileSync(join(packageRoot, path))]);
  const hash = createHash('sha256');
  for (const [path, content] of contents) hash.update(path).update('\0').update(content).update('\0');
  const parent = join(configDir, 'runtime');
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const version = String(manifest.version || 'unknown').replace(/[^\w.-]/g, '_');
  const destination = join(parent, `${version}-${hash.digest('hex').slice(0, 16)}`);
  const entry = join(destination, 'bin', 'kbu-usage.js');
  if (!existsSync(entry)) {
    const staging = mkdtempSync(join(parent, '.install-'));
    try {
      for (const [path, content] of contents) {
        mkdirSync(dirname(join(staging, path)), { recursive: true, mode: 0o700 });
        writeFileSync(join(staging, path), content, { mode: 0o600 });
      }
      renameSync(staging, destination);
    } finally {
      // Only the unique staging directory created by this invocation is removed.
      rmSync(staging, { recursive: true, force: true });
    }
  }
  return entry;
}
