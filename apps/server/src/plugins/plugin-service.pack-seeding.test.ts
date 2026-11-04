import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPluginService } from './plugin-service.js';
import { createMarketplaceStore, marketplaceStorePath } from './marketplace-store.js';

const roots: string[] = [];
const services: ReturnType<typeof createPluginService>[] = [];
const index = { schemaVersion: 1 as const, name: 'fixtures', displayName: 'Fixtures', plugins: [] };
const packs = { schemaVersion: 1 as const, packs: [{ id: 'essentials', displayName: 'Essentials', description: 'Tools', members: [{ pluginId: 'notes' }] }] };
function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'zcc-pack-seeding-'));
  roots.push(dataDir);
  const catalogDir = join(dataDir, 'catalog');
  mkdirSync(catalogDir);
  writeFileSync(join(catalogDir, 'marketplace.json'), JSON.stringify(index));
  writeFileSync(join(catalogDir, 'packs.json'), JSON.stringify(packs));
  const source = `path:${catalogDir}`;
  const store = createMarketplaceStore({ file: marketplaceStorePath(dataDir) });
  const start = async (fetchJson?: (url: string) => Promise<unknown>) => {
    const service = createPluginService({ dataDir, bundledRoot: join(dataDir, 'empty'), fetchJson });
    services.push(service);
    await service.start();
    return service;
  };
  return { dataDir, catalogDir, source, store, start };
}
beforeEach(() => {
  vi.stubEnv('ZCC_OFFICIAL_MARKETPLACE_URL', 'off');
  vi.stubEnv('ZCC_COMMUNITY_MARKETPLACE_SOURCE', 'off');
  vi.stubEnv('ZCC_INTERNAL_MARKETPLACE_SOURCE', 'off');
});
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
it('discovers packs when seeding a default marketplace for the first time', async () => {
  const f = fixture();
  vi.stubEnv('ZCC_INTERNAL_MARKETPLACE_SOURCE', f.source);
  const service = await f.start();
  expect(service.pluginPacks.list()).toMatchObject([{ pack: { id: 'essentials' } }]);
  expect(service.listMarketplaces()[0]).toMatchObject({ official: true, cachedPacks: packs });
});
it('loads sidecars for legacy caches while preserving their ordinary index and added time', async () => {
  const f = fixture();
  const cached = { ...index, displayName: 'Previously reviewed catalogue' };
  const previous = await f.store.add(f.source, cached);
  vi.stubEnv('ZCC_COMMUNITY_MARKETPLACE_SOURCE', f.source);
  const service = await f.start();
  expect(service.listMarketplaces()[0]).toMatchObject({ addedAt: previous.addedAt, cachedIndex: cached, cachedPacks: packs, official: true });
  expect(service.pluginPacks.list()).toHaveLength(1);
});
it('records missing sidecars once and does not refetch ordinary cached catalogues on restart', async () => {
  const f = fixture();
  rmSync(join(f.catalogDir, 'packs.json'));
  await f.store.add(f.source, index);
  vi.stubEnv('ZCC_INTERNAL_MARKETPLACE_SOURCE', f.source);
  const service = await f.start();
  expect(service.listMarketplaces()[0]).toMatchObject({ cachedPacks: null, packsError: null });
  await service.stop();
  rmSync(f.catalogDir, { recursive: true });
  const restarted = await f.start();
  expect(restarted.listMarketplaces()[0]).toMatchObject({ cachedIndex: index, cachedPacks: null, lastError: null });
});
it('keeps an offline legacy cache usable and allows sidecar discovery on a later startup', async () => {
  const f = fixture();
  await f.store.add(f.source, index, { official: true });
  rmSync(join(f.catalogDir, 'marketplace.json'));
  vi.stubEnv('ZCC_COMMUNITY_MARKETPLACE_SOURCE', f.source);
  const service = await f.start();
  expect(service.listMarketplaces()[0]).toMatchObject({ cachedIndex: index, lastError: null });
  expect(service.listMarketplaces()[0]?.cachedPacks).toBeUndefined();
  await service.stop();
  writeFileSync(join(f.catalogDir, 'marketplace.json'), JSON.stringify(index));
  expect((await f.start()).pluginPacks.list()).toHaveLength(1);
});
it('includes sidecar discovery for the official HTTPS feed and upgrades its existing cache', async () => {
  const f = fixture();
  const source = 'https://example.test/marketplace.json';
  await f.store.add(source, index, { official: true });
  vi.stubEnv('ZCC_OFFICIAL_MARKETPLACE_URL', source);
  const fetchJson = vi.fn(async (url: string) => url.endsWith('/packs.json') ? packs : index);
  const service = await f.start(fetchJson);
  expect(service.pluginPacks.list()).toHaveLength(1);
  expect(fetchJson.mock.calls.map(([url]) => url)).toEqual([source, 'https://example.test/packs.json']);
});
