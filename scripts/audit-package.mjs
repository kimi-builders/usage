import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const cache = mkdtempSync(join(tmpdir(), 'kbu-package-audit-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function fail(message) {
  throw new Error(`Package audit failed: ${message}`);
}

try {
  const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare'];
  for (const name of lifecycle) if (manifest.scripts?.[name]) fail(`unexpected lifecycle script ${name}`);
  if (Object.keys(manifest.dependencies || {}).length) fail('Collector package must not gain runtime dependencies silently');

  const raw = execFileSync(npm, [
    'pack', '--dry-run', '--json', '--ignore-scripts', '--cache', cache,
  ], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const parsed = JSON.parse(raw);
  // npm <=11 returns an array, while npm >=12 keys the report by package name.
  // Accept both shapes so the audited artifact stays identical across the
  // supported release runners instead of coupling the gate to one npm major.
  const report = Array.isArray(parsed)
    ? parsed[0]
    : parsed?.[manifest.name] ?? Object.values(parsed || {})[0];
  if (!report) fail('npm pack returned no report');

  const required = new Set([
    'package.json', 'README.md', 'LICENSE', 'NOTICE', 'bin/kbu-usage.js',
    'dashboard/dist/client/index.html',
  ]);
  const allowedRoots = ['bin/', 'dashboard/dist/client/', 'docs/', 'src/'];
  const allowedFiles = new Set([
    ...required, 'README.en.md', 'CONTRIBUTING.md', 'NETWORK.md', 'PRIVACY.md',
    'PUBLISHING.md', 'SECURITY.md', 'SUPPORT.md', 'THREAT_MODEL.md',
  ]);
  const sensitive = /(^|\/)(?:\.env(?:\..*)?|auth\.json|credentials\.json|subscription-history\.json|config\.json|state\.json|[^/]+\.(?:pem|key|p12))$/i;
  for (const file of report.files || []) {
    if (!allowedFiles.has(file.path) && !allowedRoots.some((prefix) => file.path.startsWith(prefix))) {
      fail(`unexpected published path ${file.path}`);
    }
    if (sensitive.test(file.path)) fail(`sensitive-looking file ${file.path}`);
    if (file.path.endsWith('.map')) fail(`source map must not be published: ${file.path}`);
    if (file.size > 600 * 1024) fail(`single file exceeds 600 KiB: ${file.path}`);
    required.delete(file.path);
  }
  if (required.size) fail(`missing required files: ${[...required].join(', ')}`);
  if (report.size > 2 * 1024 * 1024) fail(`tarball exceeds 2 MiB (${report.size} bytes)`);
  if (report.unpackedSize > 3 * 1024 * 1024) fail(`unpacked package exceeds 3 MiB (${report.unpackedSize} bytes)`);
  if (report.entryCount > 250) fail(`package contains too many files (${report.entryCount})`);

  const executable = report.files.find((file) => file.path === 'bin/kbu-usage.js');
  if (!executable || (executable.mode & 0o111) === 0) fail('CLI entry is not executable');
  console.log(`Package audit passed: ${report.entryCount} files, ${report.size} byte tarball, ${report.unpackedSize} bytes unpacked.`);
} finally {
  rmSync(cache, { recursive: true, force: true });
}
