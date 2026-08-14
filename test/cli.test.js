import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/index.js';

test('running without a command is local-only help, never init or sync', async () => {
  const messages = [];
  const original = console.log;
  console.log = (...values) => messages.push(values.join(' '));
  try {
    await run([]);
  } finally {
    console.log = original;
  }
  const output = messages.join('\n');
  assert.match(output, /@kimi-builders\/usage/);
  assert.match(output, /usage init/);
  assert.match(output, /usage sync/);
});
