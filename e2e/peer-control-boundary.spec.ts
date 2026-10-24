import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures/app.js';

test('built app publishes its loopback identity and denies browser access to core control', async ({ app, home }) => {
  const endpoint = JSON.parse(readFileSync(join(home, '.zcc', 'peer-app', 'endpoint.json'), 'utf8'));
  expect(endpoint).toMatchObject({ version: 1, instanceId: expect.stringMatching(/^[a-f0-9-]{36}$/), pid: expect.any(Number) });
  expect(endpoint.port).toBe(Number(new URL(app.window.url()).port));
  const result = await app.window.evaluate(async () => {
    const statuses: number[] = [];
    for (const route of ['/api/v1/peer-control', '/api/v1/peer-channel-register']) {
      statuses.push((await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status);
    }
    return { statuses, rendered: (document.querySelector('#root')?.childElementCount ?? 0) > 0 };
  });
  expect(result).toEqual({ statuses: [403, 403], rendered: true });
  // E2E intentionally has no OS key. Lifecycle must not create plaintext authority or bypass enrollment.
  const response = await app.window.evaluate(async proposal => {
    const res = await fetch('/api/v1/peer-links', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'activate', proposal }) });
    return { status: res.status, body: await res.json() };
  }, { pairId: randomUUID(), remoteInstanceId: randomUUID(), targetHostId: randomUUID(),
    pluginId: 'test-plugin', scope: 'opaque-scope', proposalId: randomUUID(), epoch: 1 });
  expect(response).toEqual({ status: 409, body: { error: 'peer link authority unavailable or not authorized' } });
  expect(await app.electron.evaluate(() => process.env.ZCC_PEER_STORAGE_BOOT_KEY ?? null)).toBeNull();
});
