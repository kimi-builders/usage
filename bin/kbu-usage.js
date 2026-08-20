#!/usr/bin/env node

import { run } from '../src/index.js';
import { getLocale } from '../src/cli-ui.js';

run(process.argv.slice(2)).catch((error) => {
  const prefix = getLocale() === 'zh' ? '执行失败' : 'Command failed';
  console.error(`${prefix}: ${error.message}`);
  process.exitCode = 1;
});
