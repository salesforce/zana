import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createConversationThread, createEnvironment, pinConversationThread, upsertHost } from '@zana-ai/zcc-db';
import { attachProductPluginService } from './product-plugins.js';
import { startProductServer, type ProductServer } from './product-server.js';

let server: ProductServer | null = null;
const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-product-plugins-pinned-'));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  const plugins = server?.ctx.plugins;
  if (plugins) for (const row of plugins.list()) await plugins.remove(row.id).catch(() => undefined);
  await server?.close();
  server = null;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('reports whether a thread is pinned through sdk.threads.get and sdk.threads.list', async () => {
  const dataDir = tempDir(), pluginRoot = tempDir(), bundledRoot = tempDir();
  writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ name: 'pin-reader', version: '0.1.0',
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: { name: 'Pin reader', description: 'Pinned flag regression', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
  writeFileSync(join(pluginRoot, 'server.mjs'), `export default api => {
    api.rpc.method('get', args => api.sdk.threads.get({ threadId: args.threadId }));
    api.rpc.method('list', () => api.sdk.threads.list({ limit: 10 }));
  };`);
  server = await startProductServer({ dataDir, origins: { serverPort: 0, devAppPort: 5173 } });
  const host = upsertHost(server.ctx.db, { name: 'Pin host', hostKeyHash: 'pin-host' });
  const environment = createEnvironment(server.ctx.db, { projectId: 'pin-project', hostId: host.id,
    path: tempDir(), workspaceProvisionType: 'unmanaged', status: 'ready' });
  const create = () => createConversationThread(server!.ctx.db, { projectId: 'pin-project', hostId: host.id,
    environmentId: environment.id, providerId: 'codex' });
  const pinned = create();
  const loose = create();
  pinConversationThread(server.ctx.db, pinned.id);
  const plugins = await attachProductPluginService(server.ctx, { bundledRoot });
  await plugins.install(pluginRoot);

  expect(await plugins.callRpc('pin-reader', 'get', { threadId: pinned.id })).toMatchObject({ id: pinned.id, pinnedAt: expect.any(Number) });
  expect(await plugins.callRpc('pin-reader', 'get', { threadId: loose.id })).toMatchObject({ id: loose.id, pinnedAt: null });
  const listed = await plugins.callRpc('pin-reader', 'list', {}) as Array<{ id: string; pinnedAt: number | null }>;
  expect(listed.find((thread) => thread.id === pinned.id)?.pinnedAt).toEqual(expect.any(Number));
  expect(listed.find((thread) => thread.id === loose.id)?.pinnedAt).toBeNull();
});
