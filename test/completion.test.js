import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateBashCompletion,
  generateFishCompletion,
  generateZshCompletion,
} from '../src/completion.js';

test('generateZshCompletion produces valid zsh completion syntax', () => {
  const script = generateZshCompletion();
  assert.match(script, /#compdef kbu-usage/);
  assert.match(script, /_kbu_usage_completion/);
  assert.match(script, /sync:从各个 Agent 扫描并同步用量数据/);
  assert.match(script, /stats:多维用量统计与趋势分析/);
  assert.match(script, /quota:查询 AI 平台订阅额度/);
  assert.match(script, /export:导出本地用量数据/);
});

test('generateBashCompletion produces valid bash completion syntax', () => {
  const script = generateBashCompletion();
  assert.match(script, /_kbu_usage_bash_completion/);
  assert.match(script, /complete -F _kbu_usage_bash_completion/);
});

test('generateFishCompletion produces valid fish completion syntax', () => {
  const script = generateFishCompletion();
  assert.match(script, /# Fish completion for @kimi.builders\/usage/);
  assert.match(script, /complete -c kbu-usage/);
});
