import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { attachProductPluginService } from './product-plugins.js';
import { startProductServer, type ProductServer } from './product-server.js';

const state = vi.hoisted(() => ({
  providers: [] as Array<{ id: string; unavailableReason?: string }>,
  created: [] as Array<{ providerId: string }>
}));
vi.mock('../services/threads/thread-provider-catalog.js', async (importActual) => ({
  ...(await importActual<typeof import('../services/threads/thread-provider-catalog.js')>()),
  listThreadProviders: () => state.providers
}));
vi.mock('../services/threads/conversation-create.js', async (importActual) => ({
  ...(await importActual<typeof import('../services/threads/conversation-create.js')>()),
  createConversationFromRequest: async (_ctx: unknown, request: { providerId: string }) => {
    state.created.push(request);
    return { id: 'spawned-1' };
  }
}));

let server: ProductServer | null = null;
const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-product-plugins-spawn-'));
  dirs.push(dir);
  return dir;
};

beforeEach(() => {
  state.providers = [];
  state.created = [];
});

afterEach(async () => {
  const plugins = server?.ctx.plugins;
  if (plugins) for (const row of plugins.list()) await plugins.remove(row.id).catch(() => undefined);
  await server?.close();
  server = null;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function installSpawner() {
  const dataDir = tempDir(), pluginRoot = tempDir(), bundledRoot = tempDir();
  writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ name: 'spawner', version: '0.1.0',
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: { name: 'Spawner', description: 'Spawns threads', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
  writeFileSync(join(pluginRoot, 'server.mjs'), `export default api => {
    api.rpc.method('spawn', args => api.sdk.threads.spawn(args));
  };`);
  server = await startProductServer({ dataDir, origins: { serverPort: 0, devAppPort: 5173 } });
  const plugins = await attachProductPluginService(server.ctx, { bundledRoot });
  await plugins.install(pluginRoot);
  return plugins;
}

it('spawns on the default provider when the plugin names none', async () => {
  const plugins = await installSpawner();
  state.providers = [{ id: 'first', unavailableReason: 'not installed' }, { id: 'second' }];
  await expect(plugins.callRpc('spawner', 'spawn', { projectId: 'p1', prompt: 'hi' })).resolves.toEqual({ id: 'spawned-1' });
  expect(state.created).toEqual([expect.objectContaining({ providerId: 'second' })]);
});

it('keeps an explicit provider and rejects unknown ones', async () => {
  const plugins = await installSpawner();
  state.providers = [{ id: 'first' }, { id: 'second' }];
  await plugins.callRpc('spawner', 'spawn', { projectId: 'p1', prompt: 'hi', providerId: 'second' });
  expect(state.created).toEqual([expect.objectContaining({ providerId: 'second' })]);
  await expect(plugins.callRpc('spawner', 'spawn', { projectId: 'p1', prompt: 'hi', providerId: 'nope' }))
    .rejects.toThrow(/unknown thread provider: nope/);
});

it('fails when no thread provider is registered', async () => {
  const plugins = await installSpawner();
  await expect(plugins.callRpc('spawner', 'spawn', { projectId: 'p1', prompt: 'hi' }))
    .rejects.toThrow(/no thread provider is registered/);
  expect(state.created).toEqual([]);
});
