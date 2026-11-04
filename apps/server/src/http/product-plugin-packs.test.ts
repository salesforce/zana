import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handlePluginPacksApi } from './product-plugin-packs.js';
import type { PluginPackService } from '../plugins/plugin-packs.js';

const identity = { marketplaceSource: 'path:/fixtures/catalog', packId: 'starter' };
const request = { identity, pluginIds: ['notes'], planId: 'a7a7a7a7-1234-4234-9234-a7a7a7a7a7a7' };
let server: Server;
let url: string;
let service: PluginPackService | undefined;
let current: ReturnType<typeof fakeService>;
function fakeService() {
  return {
    list: vi.fn(() => []), listInstalled: vi.fn(() => []),
    plan: vi.fn(async () => ({ ...identity, planId: request.planId })),
    install: vi.fn(async () => ({ members: [] })), forget: vi.fn(async () => true)
  };
}
beforeEach(async () => {
  current = fakeService(); service = current as unknown as PluginPackService;
  server = createServer(async (req, res) => {
    if (!await handlePluginPacksApi(req, res, service, req.url!, req.method!)) {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
function post(action: string, value: unknown) {
  return fetch(`${url}/api/v1/plugin-packs/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value)
  });
}
it('returns catalogue and installed groups independently', async () => {
  expect(await (await fetch(`${url}/api/v1/plugin-packs`)).json()).toEqual([]);
  expect(await (await fetch(`${url}/api/v1/plugin-packs/installed`)).json()).toEqual([]);
  expect(current.list).toHaveBeenCalledOnce(); expect(current.listInstalled).toHaveBeenCalledOnce();
});
it('routes validated review, selected installation and metadata-only forgetting', async () => {
  expect((await post('plan', identity)).status).toBe(200);
  expect(current.plan).toHaveBeenCalledWith(identity);
  expect((await post('install', request)).status).toBe(200);
  expect(current.install).toHaveBeenCalledWith(request);
  expect(await (await post('forget', identity)).json()).toBe(true);
  expect(current.forget).toHaveBeenCalledWith(identity);
});
it.each(['plan', 'install', 'forget'])('rejects invalid %s input before calling the host', async action => {
  expect((await post(action, { ...identity, source: 'https://unreviewed.invalid' })).status).toBe(400);
  expect(current.plan).not.toHaveBeenCalled(); expect(current.install).not.toHaveBeenCalled(); expect(current.forget).not.toHaveBeenCalled();
});
it('refuses oversized requests', async () => {
  expect((await post('plan', { padding: 'x'.repeat(33_000) })).status).toBe(400);
  expect(current.plan).not.toHaveBeenCalled();
});
it.each(['/api/v1/other', '/api/v1/plugin-packs-extra', '/api/v1/plugin-packs/missing'])('leaves unrelated path %s alone', async path => {
  expect((await fetch(`${url}${path}`)).status).toBe(404);
});
it('reports unavailable host without claiming an empty catalogue', async () => {
  service = undefined;
  expect((await fetch(`${url}/api/v1/plugin-packs`)).status).toBe(503);
});
it.each([new Error('Review expired'), 'offline'])('surfaces host failure: %s', async error => {
  current.plan.mockRejectedValueOnce(error);
  const response = await post('plan', identity);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: error instanceof Error ? error.message : 'Plugin pack operation failed' });
});
