import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ignored = new Set(['.git', 'node_modules', 'dist', '.playwright-cli']);

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return ignored.has(entry.name) ? [] : markdownFiles(join(directory, entry.name));
    return extname(entry.name).toLowerCase() === '.md' ? [join(directory, entry.name)] : [];
  });
}

const failures = [];
for (const file of markdownFiles(root)) {
  const contents = readFileSync(file, 'utf8');
  const links = contents.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g);
  for (const match of links) {
    let target = match[1].trim();
    if (target.startsWith('<') && target.includes('>')) target = target.slice(1, target.indexOf('>'));
    else target = target.split(/\s+["']/)[0];
    if (!target || /^(?:https?:|mailto:|#)/i.test(target) || target.startsWith('/')) continue;
    const path = decodeURIComponent(target.split('#')[0].split('?')[0]);
    if (path && !existsSync(resolve(dirname(file), path))) failures.push(`${file.slice(root.length + 1)} -> ${target}`);
  }
}

if (failures.length) {
  console.error(`Broken local Markdown links:\n${failures.map((item) => `- ${item}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('Markdown link check passed.');
}

