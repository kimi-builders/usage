import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SOURCE_PATH_ENVIRONMENT_VARIABLES } from '../src/source-environment.js';
import { runtimeEnvironment, renderDaemonFiles } from '../src/daemon.js';
import { getDshSessionsDir } from '../src/dsh-roots.js';
import { resolveMcodeDbPath } from '../src/parsers/mcode.js';
import { QODER_EDITIONS, getQoderProjectsDir, getQoderDbPath } from '../src/qoder-roots.js';

test('source-location contract covers parser environment reads and both Qoder editions', () => {
  const declared = new Set(SOURCE_PATH_ENVIRONMENT_VARIABLES);
  const src = new URL('../src/', import.meta.url);
  const files = [
    ...readdirSync(src).filter(name => name.endsWith('-roots.js')),
    ...readdirSync(new URL('parsers/', src)).filter(name => name.endsWith('.js')).map(name => `parsers/${name}`),
  ];
  for (const file of files) {
    const text = readFileSync(new URL(file, src), 'utf8');
    for (const [, key] of text.matchAll(/\b(?:process\.env|env|environment)\.([A-Z][A-Z0-9_]+)/g)) {
      assert.ok(declared.has(key), `${file}: review ${key} as a non-secret path and add it to the source contract`);
    }
  }
  for (const edition of Object.values(QODER_EDITIONS)) {
    for (const field of ['cliEnv', 'ideHomeEnv', 'testProjectsEnv', 'testDbEnv']) assert.ok(declared.has(edition[field]), edition[field]);
  }
});

test('front-end and daemon resolve the same official DSH, MCode and Qoder directories', () => {
  const home = join(tmpdir(), 'contract', 'home');
  const cases = [
    ['DSH_HOME', '~/custom dsh', env => getDshSessionsDir(env, home), join(home, 'custom dsh', 'sessions')],
    ['MCODE_HOME', join(home, 'custom mcode'), env => resolveMcodeDbPath(env, home), join(home, 'custom mcode', 'v2', 'sqlite', 'runtime-state.sqlite')],
    ['QODER_CONFIG_DIR', '~/qoder cli', env => getQoderProjectsDir('qoder', env, home), join(home, 'qoder cli', 'projects')],
    ['QODERCN_CONFIG_DIR', '~/qoder cn cli', env => getQoderProjectsDir('qoder-cn', env, home), join(home, 'qoder cn cli', 'projects')],
    ['QODER_HOME', '~/qoder ide', env => getQoderDbPath('qoder', env, home), join(home, 'qoder ide', 'cache', 'db', 'local.db')],
    ['QODER_CN_HOME', '~/qoder cn ide', env => getQoderDbPath('qoder-cn', env, home), join(home, 'qoder cn ide', 'cache', 'db', 'local.db')],
  ];
  for (const [key, value, resolve, expected] of cases) {
    const environment = { [key]: value, OPENAI_API_KEY: 'PRIVATE_SECRET' };
    assert.equal(resolve(environment), expected, key);
    assert.equal(resolve(runtimeEnvironment(environment)), expected, `daemon ${key}`);
  }
});

test('daemon retains explicit overrides, empty overrides and platform path defaults', () => {
  const home = join(tmpdir(), 'contract', 'home');
  const environment = {
    DSH_HOME: '/official/dsh', MCODE_HOME: '/official/mcode',
    KBU_USAGE_DSH_SESSIONS: '/override/sessions', KBU_USAGE_MCODE_DB: '/override/mcode.db',
    QODER_CONFIG_DIR: '/official/qoder', QODERCN_CONFIG_DIR: '/official/qoder-cn',
    KBU_USAGE_QODER_PROJECTS: '/override/projects', KBU_USAGE_QODER_CN_PROJECTS: '',
    QODER_HOME: '/official/ide', QODER_CN_HOME: '/official/ide-cn',
    KBU_USAGE_QODER_DB: '/override/qoder.db', KBU_USAGE_QODER_CN_DB: '/override/qoder-cn.db',
  };
  for (const key of Object.keys(environment)) if (environment[key]) environment[key] = join(home, environment[key]);
  const daemon = runtimeEnvironment(environment);
  assert.deepEqual(daemon, environment);
  for (const env of [environment, daemon]) {
    assert.equal(getDshSessionsDir(env, home), join(home, '/override/sessions'));
    assert.equal(resolveMcodeDbPath(env, home), join(home, '/override/mcode.db'));
    assert.equal(getQoderProjectsDir('qoder', env, home), join(home, '/override/projects'));
    assert.equal(getQoderProjectsDir('qoder-cn', env, home), join(home, '/official/qoder-cn/projects'));
    assert.equal(getQoderDbPath('qoder', env, home), join(home, '/override/qoder.db'));
    assert.equal(getQoderDbPath('qoder-cn', env, home), join(home, '/override/qoder-cn.db'));
  }
  const platformPaths = { XDG_CONFIG_HOME: '/xdg/config', APPDATA: '/win/roaming' };
  for (const platform of ['darwin', 'linux', 'win32']) {
    for (const edition of ['qoder', 'qoder-cn']) {
      assert.equal(getQoderDbPath(edition, platformPaths, home, platform), getQoderDbPath(edition, runtimeEnvironment(platformPaths), home, platform));
    }
  }
});

test('every source path survives native descriptor rendering without inheriting secrets', () => {
  const environment = Object.fromEntries(SOURCE_PATH_ENVIRONMENT_VARIABLES.map(key => [key, `/custom/${key}`]));
  environment.OPENAI_API_KEY = 'PRIVATE_SECRET';
  environment.QODER_API_KEY = 'PRIVATE_SECRET';
  for (const platform of ['darwin', 'linux', 'win32']) {
    const files = renderDaemonFiles({ platform, home: '/tmp/contract', configDir: '/tmp/contract/config', environment }).files;
    const descriptor = files.map(file => file.content).join('\n');
    for (const key of SOURCE_PATH_ENVIRONMENT_VARIABLES) assert.ok(descriptor.includes(`/custom/${key}`), `${platform}: ${key}`);
    assert.doesNotMatch(descriptor, /PRIVATE_SECRET|API_KEY/);
  }
});
