import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export function createSyncClient(surface = 'cli') {
  return {
    surface,
    surfaceVersion: String(pkg.version),
    parserVersion: `multi-v${String(pkg.version)}`,
    platform: process.platform,
    syncId: randomUUID(),
  };
}

export function forBatch(client, batchIndex, batchCount) {
  return { ...client, batchIndex, batchCount };
}

