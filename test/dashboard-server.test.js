import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLocalDashboardServer } from '../src/local/dashboard-server.js';

function http(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = request({ hostname: '127.0.0.1', port, path, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

test('local dashboard requires capability cookie and rejects hostile Host/Origin', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kbu-dashboard-server-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<main>local dashboard</main>');
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log("ok")');
  let loads = 0;
  const local = await startLocalDashboardServer({
    launchBrowser: false,
    buildRoot: root,
    dataLoader: async () => ({ loads: ++loads }),
  });
  try {
    assert.equal((await http(local.port, '/')).status, 401);
    assert.equal((await http(local.port, '/', { Host: 'attacker.invalid' })).status, 421);

    const tokenPath = new URL(local.url).pathname + new URL(local.url).search;
    const authorized = await http(local.port, tokenPath);
    assert.equal(authorized.status, 303);
    const cookie = authorized.headers['set-cookie'][0].split(';')[0];

    const hostile = await http(local.port, '/api/snapshot', {
      Cookie: cookie,
      Origin: 'https://attacker.invalid',
    });
    assert.equal(hostile.status, 403);

    const data = await http(local.port, '/api/snapshot', { Cookie: cookie });
    assert.equal(data.status, 200);
    assert.deepEqual(JSON.parse(data.body), { loads: 1 });
    assert.equal(data.headers['cache-control'], 'no-store');
    assert.match(data.headers['content-security-policy'], /frame-ancestors 'none'/);

    const refreshed = await http(local.port, '/api/snapshot?refresh=1', { Cookie: cookie });
    assert.deepEqual(JSON.parse(refreshed.body), { loads: 2 });
  } finally {
    await local.close();
    rmSync(root, { recursive: true, force: true });
  }
});

