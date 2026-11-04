import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';

test('production fonts are emitted as same-origin files allowed by the loopback CSP', async () => {
  const assets = new URL('../dist/client/assets/', import.meta.url);
  const files = await readdir(assets);
  const stylesheets = files.filter((file) => file.endsWith('.css'));
  const css = (await Promise.all(stylesheets.map((file) => readFile(new URL(file, assets), 'utf8')))).join('\n');

  assert.ok(files.some((file) => file.endsWith('.woff2')), 'expected emitted WOFF2 assets');
  assert.doesNotMatch(css, /data:(?:font|application\/font)/i);
});

test('dot-field texture keeps the exact base grid as a compact local SVG pattern', async () => {
  const source = await readFile(new URL('../public/textures/dot-field-moon.svg', import.meta.url), 'utf8');
  assert.ok(Buffer.byteLength(source) < 2048, 'the repeated grid must not inflate the release artifact');
  assert.match(source, /viewBox="0 0 1152 576"/);
  assert.match(source, /<pattern[^>]*id="dot-field-base"[^>]*patternUnits="userSpaceOnUse"[^>]*width="12"[^>]*height="12"/);
  assert.match(source, /<circle cx="6" cy="6" r="1\.1"\/>/);
  assert.match(source, /<pattern[^>]*fill="#007CFF"[^>]*fill-opacity="0\.16"/);
  assert.match(source, /<rect width="1152" height="576" fill="url\(#dot-field-base\)"\/>/);
  assert.match(source, /<g fill="#007CFF" fill-opacity="0\.9">/);
  assert.equal((source.match(/r="1\.6"/g) || []).length, 6, 'preserve all original moon accents');
  assert.equal(await readFile(new URL('../dist/client/textures/dot-field-moon.svg', import.meta.url), 'utf8'), source);
});

test('Inter ships only Latin/Latin-ext WOFF2 for the three UI weights', async () => {
  const assets = new URL('../dist/client/assets/', import.meta.url);
  const files = await readdir(assets);
  const inter = files.filter((file) => file.startsWith('inter-'));
  const expected = ['latin:400', 'latin:500', 'latin:600', 'latin-ext:400', 'latin-ext:500', 'latin-ext:600'].sort();
  const actual = inter.map((file) => {
    const match = /^inter-(latin(?:-ext)?)-(400|500|600)-normal-[\w-]+\.woff2$/.exec(file);
    assert.ok(match, `unexpected Inter asset: ${file}`);
    return `${match[1]}:${match[2]}`;
  });
  assert.deepEqual(actual.sort(), expected);
  const bytes = (await Promise.all(inter.map((file) => stat(new URL(file, assets)))))
    .reduce((total, file) => total + file.size, 0);
  assert.ok(bytes < 190 * 1024, `Inter assets exceed the font budget: ${bytes} bytes`);

  const css = (await Promise.all(files.filter((file) => file.endsWith('.css'))
    .map((file) => readFile(new URL(file, assets), 'utf8')))).join('\n');
  const faces = [...css.matchAll(/@font-face\s*\{[^}]*\}/g)]
    .map(([face]) => face).filter((face) => /font-family:\s*['"]?Inter[;'"\s]/.test(face));
  assert.equal(faces.length, 6);
  for (const face of faces) {
    assert.match(face, /font-display:\s*swap/);
    assert.match(face, /unicode-range:/);
    assert.doesNotMatch(face, /\.woff(?!2)/);
    assert.match(face, /url\([^)]*inter-latin(?:-ext)?-[^)]*\.woff2\)/);
  }

  // Copied ranges must keep matching the pinned upstream package on upgrades.
  const unicode = JSON.parse(await readFile(new URL('../node_modules/@fontsource/inter/unicode.json', import.meta.url), 'utf8'));
  const source = await readFile(new URL('../src/inter-fonts.css', import.meta.url), 'utf8');
  const sourceFaces = [...source.matchAll(/@font-face\s*\{[^}]*\}/g)].map(([face]) => face);
  assert.equal(sourceFaces.length, 6);
  for (const face of sourceFaces) {
    const subset = /inter-(latin(?:-ext)?)-(?:400|500|600)-normal\.woff2/.exec(face)?.[1];
    assert.ok(subset, 'expected a pinned Latin font file');
    const range = /unicode-range:\s*([^;]+);/.exec(face)?.[1];
    assert.equal(range, unicode[subset], `Unicode coverage drifted for ${subset}`);
  }
});
