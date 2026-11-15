import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { upsertHost } from '@zana-ai/zcc-db';
import { startProductServer, type ProductServer } from './product-server.js';
let server: ProductServer, root: string, hostId: string, otherId: string;
let rpc: ReturnType<typeof vi.spyOn>;
const snapshot = () => ({ revision: 'first', variables: [{ name: 'EXAMPLE_API_KEY', overriddenByEnvironment: false, value: 'must-not-leak' }], key: 'must-not-leak' });
const url = (id = hostId) => `${server.url}api/v1/system/machines/${id}/environment`;
const save = (body: unknown, id = hostId, headers = {}) => fetch(url(id), { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-env-api-')));
  server = await startProductServer({ dataDir: root, origins: { serverPort: 0, devAppPort: 5173 } });
  hostId = upsertHost(server.ctx.db, { name: 'Local', hostKeyHash: 'a'.repeat(64), isPrimary: true, homeDir: root }).id;
  otherId = upsertHost(server.ctx.db, { name: 'Remote', hostKeyHash: 'b'.repeat(64), homeDir: '/remote' }).id;
  vi.spyOn(server.ctx.hostHub, 'ensureHostSessionReady').mockReturnValue({ instanceId: 'one' } as never);
  rpc = vi.spyOn(server.ctx.hostHub, 'callHostOnlineRpc').mockResolvedValue(snapshot());
});
afterEach(async () => { await server.close(); vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });
it('returns only names/status and never redirects a write to the primary machine', async () => {
  const get = await fetch(url()); expect(get.status).toBe(200); expect(JSON.stringify(await get.json())).not.toContain('must-not-leak');
  const put = await save({ name: 'EXAMPLE_API_KEY', value: 'fake-key', expectedRevision: 'first' }, otherId);
  expect(put.status).toBe(200); expect(await put.json()).toEqual({ hostId: otherId, revision: 'first', variables: [{ name: 'EXAMPLE_API_KEY', overriddenByEnvironment: false }] });
  expect(rpc).toHaveBeenLastCalledWith({ hostId: otherId, timeoutMs: 10_000, command: { type: 'host.environment.save', name: 'EXAMPLE_API_KEY', value: 'fake-key', expectedRevision: 'first' } });
  expect((await save({ name: 'EXAMPLE_API_KEY', value: null, expectedRevision: 'first' })).status).toBe(200);
});
it('validates membership, method, Origin, content type and reserved/extra input', async () => {
  expect((await fetch(url('unknown'))).status).toBe(403);
  expect((await fetch(url(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(405);
  expect((await save({}, hostId, { Origin: 'https://evil.example' })).status).toBe(403);
  expect((await save({}, hostId, { 'content-type': 'text/plain' })).status).toBe(415);
  for (const body of [{}, { name: 'PATH', value: 'x', expectedRevision: 'first' }, { name: 'KEY', value: 'x', expectedRevision: 'first', cwd: '/escape' }]) expect((await save(body)).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
it.each([['environment_conflict', 409], ['unknown_command', 501], ['unsupported', 501], ['timeout', 503]])('redacts %s failures and never retries a write', async (code, status) => {
  rpc.mockRejectedValue(Object.assign(new Error('secret-value-in-error'), { code }));
  const result = await save({ name: 'KEY', value: 'secret-value-in-error', expectedRevision: 'first' });
  expect(result.status).toBe(status); expect(await result.text()).not.toContain('secret-value-in-error'); expect(rpc).toHaveBeenCalledOnce();
});
it('handles disconnected hosts, invalid output and malformed JSON without leaking values', async () => {
  rpc.mockResolvedValue({ value: 'sensitive' }); expect((await fetch(url())).status).toBe(502);
  const broken = await fetch(url(), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{broken' }); expect(broken.status).toBe(503);
  vi.mocked(server.ctx.hostHub.ensureHostSessionReady).mockImplementation(() => { throw new Error('private'); });
  expect((await save({ name: 'KEY', value: 'x', expectedRevision: 'first' })).status).toBe(503);
});
