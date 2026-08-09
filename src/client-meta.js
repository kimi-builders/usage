import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { detectAgentVersions } from './agent-info.js';
import { deviceEnvironment } from './device-info.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export function createSyncClient(surface = 'cli', metadata = {}) {
  return {
    surface,
    surfaceVersion: String(pkg.version),
    parserVersion: `multi-v${String(pkg.version)}`,
    platform: process.platform,
    device: metadata.device || deviceEnvironment(),
    agentVersions: metadata.agentVersions || detectAgentVersions(),
    syncId: randomUUID(),
  };
}

export function forBatch(client, batchIndex, batchCount) {
  return { ...client, batchIndex, batchCount };
}
