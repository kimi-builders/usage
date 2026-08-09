import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const configDir = process.env.KBU_USAGE_CONFIG_DIR?.trim()
  || join(homedir(), '.kimi-builders', 'usage');
const configFile = join(configDir, 'config.json');

export function getConfigPath() {
  return configFile;
}

export function loadConfig() {
  if (!existsSync(configFile)) return null;
  try {
    const parsed = JSON.parse(readFileSync(configFile, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function createSessionSalt() {
  return randomBytes(32).toString('hex');
}

export function saveConfig(config) {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    chmodSync(configFile, 0o600);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  }
}

