import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

test('production fonts are emitted as same-origin files allowed by the loopback CSP', async () => {
  const assets = new URL('../dist/client/assets/', import.meta.url);
  const files = await readdir(assets);
  const stylesheets = files.filter((file) => file.endsWith('.css'));
  const css = (await Promise.all(stylesheets.map((file) => readFile(new URL(file, assets), 'utf8')))).join('\n');

  assert.ok(files.some((file) => file.endsWith('.woff2')), 'expected emitted WOFF2 assets');
  assert.doesNotMatch(css, /data:(?:font|application\/font)/i);
});
