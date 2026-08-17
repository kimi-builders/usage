import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeVibe } from '../src/visual-preferences.js';

/* 源码钉测试(20260816):看板与社区站共享的「视觉气质」与筛选分组语言。
   只钉源码结构,不渲染——构建产物与运行时行为由其余套件覆盖。 */

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('vibe poster override zeroes the radius and shadow tokens', async () => {
  const css = await read('../src/styles.css');
  const block = css.match(/:root\[data-vibe="poster"\]\s*\{[^}]*\}/)?.[0] ?? '';
  assert.ok(block, 'expected a :root[data-vibe="poster"] override block');
  assert.match(block, /--radius-btn:\s*0px/);
  assert.match(block, /--radius-panel:\s*0px/);
  assert.match(block, /--shadow-modal:\s*none/);
  // 覆盖块必须跟在软朗默认值之后(CSS 后者优先),且存在亮色组合修正
  assert.ok(css.indexOf('--radius-btn: 8px') < css.indexOf(':root[data-vibe="poster"]'));
  assert.match(css, /:root\[data-theme="light"\]\[data-vibe="poster"\]/);
});

test('vibe bootstraps before first paint and defaults to poster', async () => {
  const main = await read('../src/main.jsx');
  assert.match(main, /dataset\.vibe\s*=\s*normalizeVibe\(localStorage\.getItem\("kbu\.vibe"\)\)/);
  assert.equal(normalizeVibe('poster'), 'poster');
  assert.equal(normalizeVibe('soft'), 'soft');
  assert.equal(normalizeVibe('legacy-value'), 'poster');
  assert.equal(normalizeVibe(null), 'poster');
});

test('topbar and mobile drawer both expose the vibe toggle with persistence', async () => {
  const app = await read('../src/App.jsx');
  // 顶栏 icon-btn 走 aria-label;抽屉按钮走可见文本
  assert.match(app, /aria-label=\{zh \? '切换视觉气质' : 'Switch visual style'\}/);
  assert.match(app, /\{zh \? '切换气质' : 'Style'\}/);
  const toggles = app.match(/setVibe\(vibe === 'poster' \? 'soft' : 'poster'\)/g) ?? [];
  assert.equal(toggles.length, 2, 'expected vibe toggles in both topbar and drawer');
  assert.match(app, /localStorage\.setItem\('kbu\.vibe', vibe\)/);
});

test('active filters render as grouped chips with per-dimension labels', async () => {
  const filters = await read('../src/UsageFilters.jsx');
  assert.match(filters, /className="filter-group"/);
  assert.match(filters, /className="filter-group-label"/);
  assert.match(filters, /className="filter-token"/);
  // Agent 维度值带图标,清除入口随筛选结果行
  assert.match(filters, /dimension\.icon \? <ToolGlyph id=\{value\} size=\{12\}\/>/);
  assert.match(filters, /className="clear-filters"[\s\S]{0,240}清除筛选/);
});

test('grouped chip styles exist and echo the community blue accent', async () => {
  const css = await read('../src/styles.css');
  assert.match(css, /\.filter-group \{[^}]*var\(--blue\) 40%, transparent\)[^}]*var\(--radius-btn\)/);
  assert.match(css, /\.filter-group-label \{ color: var\(--blue\); \}/);
  assert.match(css, /\.filter-token \{[^}]*min-height: 28px/);
});

test('no font slips below the 10px data / 11px control floors', async () => {
  const css = await read('../src/styles.css');
  for (const slot of css.matchAll(/font:\s*[^;]*?(\d+(?:\.\d+)?)px/g)) {
    assert.ok(Number(slot[1]) >= 10, `font shorthand below 10px: ${slot[0]}`);
  }
  for (const slot of css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
    assert.ok(Number(slot[1]) >= 10, `font-size below 10px: ${slot[0]}`);
  }
});

test('elevation radii route through tokens so poster can flatten them', async () => {
  const css = await read('../src/styles.css');
  // 面板/按钮级圆角必须走 var(--radius-*);例外是「功能圆」:50% 圆形、
  // 99/999px 药丸(进度/开关轨道、滚动条拇指),以及 ≤6px 的微型装饰圆
  // (图例点/热力格——若令牌化,soft 下 8px 圆角会把 8px 点变圆,改变语义)。
  const offenders = [...css.matchAll(/border-radius:\s*(?!50%|var\()(?!calc\([^)]*var\()([0-9.]+)px/g)]
    .map((m) => Number(m[1]))
    .filter((px) => px > 6 && px !== 99 && px !== 999);
  assert.deepEqual(offenders, []);
});

test('segmented shells and standalone controls share the 36px outer height', async () => {
  const css = await read('../src/styles.css');
  // 分段/Tab 壳(3px padding + 1px 边框)内按钮 28px,独立控件 min-height 36px,
  // 两者外框同为 36px——range-segment 曾被并入 control-height 组导致外框 44px。
  assert.match(css, /\.range-segment button \{[^}]*min-height: 28px/);
  assert.match(css, /\.mini-tabs button, \.tiny-tabs button \{[^}]*min-height: 28px/);
  const group = css.match(/\.ghost-btn[^{]*\{[^}]*min-height: var\(--control-height\); \}/)?.[0] ?? '';
  assert.ok(group, 'expected the standalone control-height group');
  assert.doesNotMatch(group, /range-segment button|benefit-record-kind button/);
});
