import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server; let module;
test.before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)), logLevel: 'silent',
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true },
  });
  module = await server.ssrLoadModule('/src/SyncDialog.jsx');
});
test.after(async () => { await server?.close(); });

const sources = ['kimi-code', 'claude-code', 'codex', 'opencode', 'gemini-cli', 'antigravity',
  'copilot-cli', 'roo-code', 'pi-coding-agent', 'zcode', 'workbuddy', 'grok', 'trae-cli', 'mcode',
  'qoder', 'qoder-cn', 'dsh', 'cursor'].map(id => ({ id, mode: id === 'cursor' ? 'off' : 'private', detected: true, rootCount: 1 }));

for (const zh of [true, false]) {
  test(`sync dialog keeps actions before all 18 sources with collapsed saved scope (${zh ? 'zh' : 'en'})`, () => {
    const html = renderToStaticMarkup(createElement(module.SyncDialog, {
      open: true, zh, onClose() {}, control: { sources, community: { connected: true } },
    }));
    assert.ok(html.indexOf('sync-mode-card') < html.indexOf('source-policy-list'));
    assert.equal((html.match(/class="source-policy-row /g) || []).length, 18);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /hidden=""/);
    assert.ok(html.includes(zh ? '已保存：17 个 Agent 允许同步' : 'Saved: 17 agents allowed to sync'));
    assert.ok(html.includes(zh ? '立即同步' : 'Sync now'));
  });
}

test('unconnected setup keeps source choices expanded and does not offer upload before authorization', () => {
  const html = renderToStaticMarkup(createElement(module.SyncDialog, {
    open: true, zh: false, onClose() {}, control: { sources, community: { connected: false } },
  }));
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /Connect community account/);
  assert.doesNotMatch(html, />Sync now<|> Sync now</);
});
