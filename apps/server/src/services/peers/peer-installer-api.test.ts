import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProductHttpContext } from '../../http/product-context.js';
import { handlePeerInstallerApi } from './peer-installer-api.js';

const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await new Promise(resolve => server.close(resolve)); });
const KEY = `ssh-ed25519 ${'A'.repeat(68)}`;

async function serve(ctx: Partial<ProductHttpContext>) {
  const server = createServer((request, response) => {
    const path = new URL(request.url!, 'http://x').pathname;
    void handlePeerInstallerApi(request, response, ctx as ProductHttpContext, path, request.method!).then(handled => {
      if (!handled) { response.statusCode = 404; response.end('{"unhandled":true}'); }
    }).catch(() => { response.statusCode = 500; response.end('{"error":"handler threw"}'); });
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return async (path: string, method = 'GET', body?: string, extra: Record<string, string> = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra }, ...(body !== undefined ? { body } : {}) });
    return { status: response.status, body: await response.json() as unknown };
  };
}
function services() {
  return {
    peerInstaller: { enroll: vi.fn(async (id: string) => ({ introductionId: id, status: 'enrolled' })), list: vi.fn(async () => [{ introductionId: 'x' }]) },
    peerSshEndpoints: { list: vi.fn(async () => []), register: vi.fn(async (input: unknown) => input), remove: vi.fn(async () => true) }
  };
}

it('ignores unrelated paths and reports unavailable services', async () => {
  const call = await serve({});
  expect((await call('/api/v1/peers/introductions')).body).toEqual({ unhandled: true });
  expect((await call('/api/v1/peers/ssh-endpoints/a/b')).body).toEqual({ unhandled: true });
  expect(await call(`/api/v1/peers/introductions/${randomUUID()}/enroll`, 'POST')).toEqual({ status: 503, body: { error: 'peer installer unavailable' } });
  expect((await call('/api/v1/peers/installations')).status).toBe(503);
  expect((await call('/api/v1/peers/ssh-endpoints')).status).toBe(503);
  expect((await call(`/api/v1/peers/ssh-endpoints/${randomUUID()}`, 'DELETE')).status).toBe(503);
});

it('enroll route validates ids and only exposes allowlisted failure messages', async () => {
  const s = services(), call = await serve(s as never), id = randomUUID();
  expect(await call(`/api/v1/peers/introductions/${id}/enroll`, 'POST')).toEqual({ status: 200, body: { introductionId: id, status: 'enrolled' } });
  expect(s.peerInstaller.enroll).toHaveBeenCalledWith(id, expect.any(AbortSignal));
  expect((await call(`/api/v1/peers/introductions/${id}/enroll`)).status).toBe(405);
  expect((await call('/api/v1/peers/introductions/%E0%A4%A/enroll', 'POST')).status).toBe(400);
  expect((await call('/api/v1/peers/introductions/-bad/enroll', 'POST')).status).toBe(400);
  s.peerInstaller.enroll.mockRejectedValueOnce(new Error('introduction is not approved'));
  expect(await call(`/api/v1/peers/introductions/${id}/enroll`, 'POST')).toEqual({ status: 409, body: { error: 'introduction is not approved' } });
  s.peerInstaller.enroll.mockRejectedValueOnce(new Error('code zcde_secret at http://10.0.0.1'));
  expect(await call(`/api/v1/peers/introductions/${id}/enroll`, 'POST')).toEqual({ status: 409, body: { error: 'peer enrollment failed' } });
  s.peerInstaller.enroll.mockRejectedValueOnce('not an error');
  expect((await call(`/api/v1/peers/introductions/${id}/enroll`, 'POST')).body).toEqual({ error: 'peer enrollment failed' });
});

it('lists installations and manages pinned SSH endpoints explicitly', async () => {
  const s = services(), call = await serve(s as never), peer = randomUUID();
  expect(await call('/api/v1/peers/installations')).toEqual({ status: 200, body: { installations: [{ introductionId: 'x' }] } });
  expect((await call('/api/v1/peers/installations', 'POST', '{}')).status).toBe(405);
  s.peerInstaller.list.mockRejectedValueOnce(new Error('disposed'));
  expect((await call('/api/v1/peers/installations')).status).toBe(503);
  expect(await call('/api/v1/peers/ssh-endpoints')).toEqual({ status: 200, body: { endpoints: [] } });
  s.peerSshEndpoints.list.mockRejectedValueOnce(new Error('disposed'));
  expect((await call('/api/v1/peers/ssh-endpoints')).status).toBe(503);
  const endpoint = { peerInstanceId: peer, host: 'peer.example.test', port: 22, user: 'zcc', hostKey: KEY, remoteAppPort: 4100 };
  expect(await call('/api/v1/peers/ssh-endpoints', 'POST', JSON.stringify(endpoint))).toEqual({ status: 201, body: endpoint });
  expect((await call('/api/v1/peers/ssh-endpoints', 'POST', '{bad')).status).toBe(400);
  expect((await call('/api/v1/peers/ssh-endpoints', 'POST', JSON.stringify({ ...endpoint, extra: 1 }))).status).toBe(400);
  s.peerSshEndpoints.register.mockRejectedValueOnce(new Error('invalid pinned SSH endpoint'));
  expect(await call('/api/v1/peers/ssh-endpoints', 'POST', JSON.stringify(endpoint))).toEqual({ status: 400, body: { error: 'invalid pinned SSH endpoint' } });
  s.peerSshEndpoints.register.mockRejectedValueOnce(new Error('peer ssh endpoint capacity exceeded'));
  expect(await call('/api/v1/peers/ssh-endpoints', 'POST', JSON.stringify(endpoint))).toEqual({ status: 409, body: { error: 'peer ssh endpoint unavailable' } });
  expect((await call('/api/v1/peers/ssh-endpoints', 'PUT', '{}')).status).toBe(405);
  expect(await call(`/api/v1/peers/ssh-endpoints/${peer}`, 'DELETE')).toEqual({ status: 200, body: { removed: true } });
  expect((await call(`/api/v1/peers/ssh-endpoints/${peer}`)).status).toBe(405);
  expect((await call('/api/v1/peers/ssh-endpoints/-bad', 'DELETE')).status).toBe(400);
  s.peerSshEndpoints.remove.mockRejectedValueOnce(new Error('disposed'));
  expect((await call(`/api/v1/peers/ssh-endpoints/${peer}`, 'DELETE')).status).toBe(503);
});

it('manages the owner route-origin allowlist with validated bodies and allowlisted errors', async () => {
  const origins = { list: vi.fn(async () => ['https://peer.example']), add: vi.fn(async (origin: string) => origin.toLowerCase()), remove: vi.fn(async () => true) };
  const call = await serve({ peerRouteAllowlist: origins } as never), path = '/api/v1/peers/route-origins';
  expect(await call(path)).toEqual({ status: 200, body: { origins: ['https://peer.example'] } });
  expect(await call(path, 'POST', '{"origin":"https://Peer.Example"}')).toEqual({ status: 201, body: { origin: 'https://peer.example' } });
  expect(await call(path, 'DELETE', '{"origin":"https://peer.example"}')).toEqual({ status: 200, body: { removed: true } });
  expect(origins.remove).toHaveBeenCalledWith('https://peer.example');
  expect((await call(path, 'PUT', '{}')).status).toBe(405);
  expect(await call(path, 'POST', '{bad')).toEqual({ status: 400, body: { error: 'invalid JSON' } });
  expect(await call(path, 'POST', JSON.stringify({ origin: 'x'.repeat(4096) }))).toEqual({ status: 400, body: { error: 'invalid JSON' } });
  expect(await call(path, 'POST', '{"origin":""}')).toEqual({ status: 400, body: { error: 'invalid peer route origin' } });
  expect(await call(path, 'POST', '{"origin":"https://a.example","extra":1}')).toEqual({ status: 400, body: { error: 'invalid peer route origin' } });
  origins.add.mockRejectedValueOnce(new Error('invalid peer route origin'));
  expect(await call(path, 'POST', '{"origin":"http://peer.example"}')).toEqual({ status: 400, body: { error: 'invalid peer route origin' } });
  origins.add.mockRejectedValueOnce(new Error('peer route origin capacity exceeded'));
  expect(await call(path, 'POST', '{"origin":"https://b.example"}')).toEqual({ status: 409, body: { error: 'peer route origin capacity exceeded' } });
  origins.remove.mockRejectedValueOnce(new Error('disk detail /secret'));
  expect(await call(path, 'DELETE', '{"origin":"https://b.example"}')).toEqual({ status: 503, body: { error: 'peer route origins unavailable' } });
  origins.add.mockRejectedValueOnce('not an error');
  expect((await call(path, 'POST', '{"origin":"https://b.example"}')).status).toBe(503);
  origins.list.mockRejectedValueOnce(new Error('disposed'));
  expect(await call(path)).toEqual({ status: 503, body: { error: 'peer route origins unavailable' } });
  const missing = await serve({});
  expect(await missing(path)).toEqual({ status: 503, body: { error: 'peer route origins unavailable' } });
  expect((await missing(path, 'PATCH')).status).toBe(405);
});

it('refuses mobile-proxied mutations but still serves reads', async () => {
  const s = services(), call = await serve(s as never), mobile = { 'x-zcc-app-surface': 'mobile' };
  expect((await call(`/api/v1/peers/introductions/${randomUUID()}/enroll`, 'POST', undefined, mobile)).status).toBe(403);
  expect((await call(`/api/v1/peers/ssh-endpoints/${randomUUID()}`, 'DELETE', undefined, mobile)).status).toBe(403);
  expect((await call('/api/v1/peers/ssh-endpoints', 'POST', '{}', mobile)).status).toBe(403);
  expect((await call('/api/v1/peers/route-origins', 'POST', '{}', mobile)).status).toBe(403);
  expect(s.peerInstaller.enroll).not.toHaveBeenCalled();
  expect(s.peerSshEndpoints.remove).not.toHaveBeenCalled();
  expect((await call('/api/v1/peers/installations', 'GET', undefined, mobile)).status).toBe(200);
});
