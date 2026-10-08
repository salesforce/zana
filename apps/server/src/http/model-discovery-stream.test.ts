import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { handleProductHttp } from './product-api.js';
import type { ProductHttpContext } from './product-context.js';
import { registerThreadProvider } from '../services/threads/thread-provider-catalog.js';
import { HostUnavailableError } from './host-hub.js';

const handles: Array<{ unregister(): void }> = [];
afterEach(() => handles.splice(0).forEach(handle => handle.unregister()));

function fixture() {
  const ids = Array.from({ length: 7 }, (_, i) => `parallel-${i}`);
  for (const id of ids) handles.push(registerThreadProvider('test', {
    id, displayName: id,
    capabilities: { permissionModes: ['full'], supportsServiceTier: false,
      supportsThreadArchive: false, supportsThreadRename: false, fork: 'none' }
  }));
  const read = vi.fn(async (_input: { providerId: string }) => ({ models: [], selectedOnlyModels: [], modelLoadError: null }));
  const rpc = vi.fn(async () => ({ providers: [] }));
  const ctx = {
    origins: { serverPort: 8780, devAppPort: 5173 },
    hostHub: { resolveHostId: () => 'local', callHostOnlineRpc: rpc },
    pluginHostArtifacts: { get: () => ({ path: '/tmp/test.js', digest: 'a'.repeat(64), generation: 'g1', byteLength: 12 }) },
    modelCatalogs: { read, invalidate: vi.fn() },
    config: { getConfig: () => ({}) },
    toProjects: () => []
  } as unknown as ProductHttpContext;
  const chunks: string[] = [];
  const response = {
    destroyed: false,
    getHeader: () => undefined,
    writeHead: vi.fn(), flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => { chunks.push(chunk); }),
    end: vi.fn((chunk?: string) => { if (chunk) chunks.push(chunk); })
  };
  const request = (params: URLSearchParams) => handleProductHttp({
    url: `/api/v1/system/execution-options?${params}`, method: 'GET', headers: { host: '127.0.0.1:8780' }
  } as IncomingMessage, response as unknown as ServerResponse, ctx);
  const query = new URLSearchParams({ stream: '1', refresh: '1' });
  ids.forEach(id => query.append('providerId', id));
  return { ids, ctx, read, rpc, chunks, response, request, query };
}

it('starts all providers together, probes once, and streams fast successes and failures before a slow provider', async () => {
  const f = fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.read.mockImplementation(async ({ providerId }) => {
    if (providerId === f.ids[0]) await gate;
    if (providerId === f.ids[1]) throw new Error('discovery failed');
    return { models: [], selectedOnlyModels: [], modelLoadError: null };
  });
  const done = f.request(f.query);
  try {
    await vi.waitFor(() => expect(f.chunks).toHaveLength(6));
    expect(f.read).toHaveBeenCalledTimes(7);
    expect(f.rpc).toHaveBeenCalledOnce();
    expect(f.response.end).not.toHaveBeenCalled();
    expect(f.ctx.modelCatalogs.invalidate).toHaveBeenCalledTimes(7);
    const rows = f.chunks.map(chunk => JSON.parse(chunk));
    expect(rows.find(row => row.providerId === f.ids[1]).options.modelLoadError.code).toBe('failed');
    expect(rows.find(row => row.providerId === f.ids[6]).options.modelLoadError).toBeNull();
  } finally { release(); await done; }
  expect(f.chunks).toHaveLength(7);
  expect(f.response.end).toHaveBeenCalledOnce();
});

it('deduplicates providers and stops writing after the client disconnects', async () => {
  const f = fixture();
  f.query.append('providerId', f.ids[0]);
  f.response.destroyed = true;
  await f.request(f.query);
  expect(f.read).toHaveBeenCalledTimes(7);
  expect(f.chunks).toHaveLength(0);
});

it('preserves the JSON API for roster reads and individual provider retries', async () => {
  const f = fixture();
  await f.request(new URLSearchParams());
  expect(JSON.parse(f.chunks[0]).providers).toHaveLength(7);
  expect(f.read).not.toHaveBeenCalled();
  f.chunks.length = 0;
  await f.request(new URLSearchParams({ providerId: f.ids[0] }));
  expect(JSON.parse(f.chunks[0]).modelLoadError).toBeNull();
  expect(f.read).toHaveBeenCalledOnce();
  expect(f.ctx.modelCatalogs.invalidate).not.toHaveBeenCalled();
});

it('isolates an unregistered provider while returning every registered provider normally', async () => {
  const f = fixture();
  f.query.append('providerId', 'removed-plugin');
  await f.request(f.query);
  expect(f.response.writeHead.mock.calls[0][0]).toBe(200);
  const rows = f.chunks.map(chunk => JSON.parse(chunk));
  expect(rows).toHaveLength(8);
  expect(rows.find(row => row.providerId === 'removed-plugin').options).toMatchObject({
    models: [], selectedOnlyModels: [],
    modelLoadError: { providerId: 'removed-plugin', code: 'provider_unavailable' }
  });
  expect(rows.filter(row => row.options.modelLoadError === null)).toHaveLength(7);
  expect(f.read).toHaveBeenCalledTimes(7);
  expect(f.ctx.modelCatalogs.invalidate).toHaveBeenCalledTimes(7);
});

it('handles a plugin unregistering during the installation probe without discovering it on the host', async () => {
  const f = fixture();
  f.rpc.mockImplementationOnce(async () => {
    handles[0].unregister();
    return { providers: [] };
  });
  await f.request(f.query);
  const rows = f.chunks.map(chunk => JSON.parse(chunk));
  expect(rows.find(row => row.providerId === f.ids[0]).options.modelLoadError.code).toBe('provider_unavailable');
  expect(rows.filter(row => row.options.modelLoadError === null)).toHaveLength(6);
  expect(f.read).toHaveBeenCalledTimes(6);
  expect(f.read.mock.calls.some(([input]) => input.providerId === f.ids[0])).toBe(false);
});

it('skips a registered provider whose plugin could not load without dropping its diagnostic', async () => {
  const f = fixture();
  handles.push(registerThreadProvider('broken-plugin', {
    id: f.ids[0], displayName: 'Broken', visibility: 'installed',
    capabilities: { permissionModes: ['full'], supportsServiceTier: false, fork: 'none' }
  }, null, 'host artifact failed to build'));
  await f.request(f.query);
  const rows = f.chunks.map(chunk => JSON.parse(chunk));
  expect(rows.find(row => row.providerId === f.ids[0]).options.modelLoadError).toMatchObject({
    code: 'provider_unavailable', detail: expect.stringContaining('host artifact failed to build')
  });
  expect(f.read).toHaveBeenCalledTimes(6);
});

it.each(['empty', 'empty-id', 'too-many', 'project', 'offline'])('rejects invalid or unavailable discovery before streaming: %s', async (kind) => {
  const f = fixture();
  let status = 400;
  if (kind === 'empty') f.query.delete('providerId');
  if (kind === 'empty-id') f.query.append('providerId', '');
  if (kind === 'too-many') for (let i = 0; i < 17; i++) f.query.append('providerId', `extra-${i}`);
  if (kind === 'project') { f.query.set('projectId', 'unregistered'); status = 404; }
  if (kind === 'offline') { f.rpc.mockRejectedValue(new HostUnavailableError()); status = 503; }
  await f.request(f.query);
  expect(f.response.writeHead.mock.calls[0][0]).toBe(status);
  expect(f.read).not.toHaveBeenCalled();
  expect(f.response.flushHeaders).not.toHaveBeenCalled();
});
