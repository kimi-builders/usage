import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const isolatedConfig = mkdtempSync(join(tmpdir(), 'kbu-pricing-'));
process.env.KBU_USAGE_CONFIG_DIR = isolatedConfig;

const {
  EMBEDDED_PRICE_CATALOG,
  getActivePriceCatalog,
  priceCatalogStatus,
  resetPriceCatalog,
  updatePriceCatalog,
  validatePriceCatalog,
} = await import('../src/pricing/catalog.js');
const { matchLocalPrice } = await import('../src/local/pricing.js');

test.after(() => rmSync(isolatedConfig, { recursive: true, force: true }));

function revisedCatalog() {
  const { integrity, ...unsigned } = structuredClone(EMBEDDED_PRICE_CATALOG);
  unsigned.revision += 1;
  unsigned.catalogVersion = 'test-revision-2';
  unsigned.publishedAt = '2026-08-20T00:00:00.000Z';
  return {
    ...unsigned,
    integrity: {
      algorithm: 'sha256',
      digest: createHash('sha256').update(JSON.stringify(unsigned)).digest('hex'),
    },
  };
}

test('catalog validation rejects tampering and unsupported matcher versions', () => {
  const tampered = structuredClone(EMBEDDED_PRICE_CATALOG);
  tampered.entries[0].input = '999';
  assert.throws(() => validatePriceCatalog(tampered), { code: 'price_catalog_integrity_failed' });
  const unsupported = structuredClone(EMBEDDED_PRICE_CATALOG);
  unsupported.matcherVersion = 2;
  assert.throws(() => validatePriceCatalog(unsupported), { code: 'unsupported_price_catalog' });
  const invalidWindow = revisedCatalog();
  invalidWindow.entries[0].effectiveTo = invalidWindow.entries[0].effectiveFrom;
  const { integrity: _integrity, ...unsigned } = invalidWindow;
  invalidWindow.integrity.digest = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
  assert.throws(() => validatePriceCatalog(invalidWindow), /生效窗口无效/);
});

test('catalog update keeps a verified last-known-good cache, supports ETag, and resets offline', async () => {
  resetPriceCatalog();
  const next = revisedCatalog();
  const first = await updatePriceCatalog({
    apiUrl: 'http://127.0.0.1:9999',
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers['If-None-Match'], undefined);
      return new Response(JSON.stringify(next), {
        status: 200,
        headers: { ETag: '"revision-2"', 'Content-Type': 'application/json' },
      });
    },
  });
  assert.equal(first.changed, true);
  assert.equal(first.source, 'downloaded');
  assert.equal(getActivePriceCatalog().catalog.catalogVersion, 'test-revision-2');

  const second = await updatePriceCatalog({
    apiUrl: 'http://127.0.0.1:9999',
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers['If-None-Match'], '"revision-2"');
      return new Response(null, { status: 304 });
    },
  });
  assert.equal(second.notModified, true);
  assert.equal(second.source, 'downloaded');

  await assert.rejects(updatePriceCatalog({
    apiUrl: 'http://127.0.0.1:9999',
    fetchImpl: async () => new Response('{"broken":true}', { status: 200 }),
  }), { code: 'unsupported_price_catalog' });
  assert.equal(priceCatalogStatus().version, 'test-revision-2');

  const reset = resetPriceCatalog();
  assert.equal(reset.source, 'embedded');
  assert.equal(reset.version, EMBEDDED_PRICE_CATALOG.catalogVersion);
});

test('catalog download enforces the body limit even without Content-Length', async () => {
  resetPriceCatalog();
  const oversized = 'x'.repeat((2 * 1024 * 1024) + 1);
  await assert.rejects(updatePriceCatalog({
    apiUrl: 'http://127.0.0.1:9999',
    fetchImpl: async () => new Response(oversized, { status: 200 }),
  }), /超过大小限制/);
  assert.equal(priceCatalogStatus().source, 'embedded');
});

test('matcher contract covers aliases, context tiers, and processing tiers', () => {
  resetPriceCatalog();
  const at = '2026-08-19T12:00:00.000Z';
  assert.equal(matchLocalPrice({ model: 'Claude Opus 4.8', bucketStart: at })?.pattern, 'claude-opus-4-8');
  assert.equal(matchLocalPrice({ model: 'gpt-5.6-sol', contextTier: 'long', bucketStart: at })?.input, 10);
  assert.equal(matchLocalPrice({ model: 'deepseek-v4-pro', processingTier: 'off-peak', bucketStart: at })?.input, 0.66);
  assert.equal(matchLocalPrice({ model: 'deepseek-v4-pro', processingTier: 'peak', bucketStart: at })?.input, 1.32);
});
