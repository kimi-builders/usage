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
const bilingualPairs = [
  ['README.md', 'README.en.md'],
  ['CONTRIBUTING.md', 'CONTRIBUTING.en.md'],
  ['SUPPORT.md', 'SUPPORT.en.md'],
  ['NETWORK.md', 'NETWORK.zh.md'],
  ['PRIVACY.md', 'PRIVACY.zh.md'],
  ['PUBLISHING.md', 'PUBLISHING.zh.md'],
  ['SECURITY.md', 'SECURITY.zh.md'],
  ['THREAT_MODEL.md', 'THREAT_MODEL.zh.md'],
];

for (const [first, second] of bilingualPairs) {
  if (!existsSync(join(root, first))) failures.push(`missing bilingual document: ${first}`);
  if (!existsSync(join(root, second))) failures.push(`missing bilingual document: ${second}`);
}

for (const name of readdirSync(join(root, 'docs'))) {
  if (extname(name).toLowerCase() !== '.md' || name.endsWith('.en.md')) continue;
  const englishName = name.replace(/\.md$/i, '.en.md');
  if (!existsSync(join(root, 'docs', englishName))) {
    failures.push(`missing bilingual document: docs/${englishName}`);
  }
}

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
