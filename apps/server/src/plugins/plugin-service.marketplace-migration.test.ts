import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPluginService } from './plugin-service.js';
import { createMarketplaceStore, marketplaceStorePath } from './marketplace-store.js';
import { DEFAULT_COMMUNITY_MARKETPLACE_SOURCE, LEGACY_INTERNAL_MARKETPLACE_SOURCE } from './default-marketplaces.js';
import type { MarketplaceIndex } from './marketplace.js';

const fetchCatalog = vi.hoisted(() => vi.fn());
vi.mock('./marketplace-source.js', async importOriginal => ({
  ...await importOriginal<typeof import('./marketplace-source.js')>(),
  materializeMarketplaceIndex: fetchCatalog
}));

const PUBLIC: MarketplaceIndex = { schemaVersion: 1, name: 'zana-community', displayName: 'Zana Community', plugins: [] };
const PRIVATE: MarketplaceIndex = { ...PUBLIC, name: 'internal', displayName: 'Internal' };
const services: ReturnType<typeof createPluginService>[] = [];
const dirs: string[] = [];
function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'zcc-marketplace-migration-'));
  dirs.push(dataDir);
  const file = marketplaceStorePath(dataDir);
  return { dataDir, file, store: createMarketplaceStore({ file }) };
}
function service(dataDir: string) {
  const value = createPluginService({ dataDir, bundledRoot: join(dataDir, 'bundled') });
  services.push(value);
  return value;
}
beforeEach(() => {
  vi.stubEnv('ZCC_OFFICIAL_MARKETPLACE_URL', 'off');
  vi.stubEnv('ZCC_COMMUNITY_MARKETPLACE_SOURCE', '');
  vi.stubEnv('ZCC_INTERNAL_MARKETPLACE_SOURCE', '');
  fetchCatalog.mockReset().mockResolvedValue(PUBLIC);
});
afterEach(async () => {
  for (const value of services.splice(0)) await value.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('public default marketplace migration', () => {
  it('seeds the public GitHub catalog with bounded, non-interactive discovery', async () => {
    const { dataDir } = setup();
    const value = service(dataDir);
    await value.start();
    await vi.waitFor(() => expect(value.listMarketplaces()).toHaveLength(1));
    expect(value.listMarketplaces()[0]).toMatchObject({ name: 'zana-community', official: true, lastError: null });
    expect(fetchCatalog).toHaveBeenCalledExactlyOnceWith(
      { kind: 'git', url: 'https://github.com/salesforce/zana-marketplace.git', ref: 'HEAD' },
      expect.any(Function), { timeoutMs: 8_000, nonInteractive: true }
    );
  });

  it('uses a cached public catalog to retire the old default, preserving custom catalogs and installed plugins', async () => {
    const { dataDir, store, file } = setup();
    await store.add(LEGACY_INTERNAL_MARKETPLACE_SOURCE, PRIVATE, { official: true });
    await store.add(DEFAULT_COMMUNITY_MARKETPLACE_SOURCE, PUBLIC);
    const custom = await store.add('https://example.test/custom.json', PRIVATE, { official: true });
    const pluginDir = join(dataDir, 'private-tool');
    mkdirSync(pluginDir);
    writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({ name: 'zcc-plugin-private-tool', version: '1.0.0',
      engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' }, zcc: { name: 'Private Tool', description: 'Test tool', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
    writeFileSync(join(pluginDir, 'server.mjs'), 'export default function () {}');
    const value = service(dataDir);
    await value.install(`path:${pluginDir}`);
    const installed = value.get('private-tool');
    await value.start();
    await vi.waitFor(() => expect(value.listMarketplaces()).toHaveLength(2));
    expect(value.listMarketplaces()).toContainEqual(custom);
    expect(value.listMarketplaces().find(row => row.name === 'zana-community')?.official).toBe(true);
    expect(value.get('private-tool')).toMatchObject({ source: installed!.source, enabled: installed!.enabled, version: installed!.version });
    expect(fetchCatalog).not.toHaveBeenCalled();
    await expect(value.removeMarketplace(DEFAULT_COMMUNITY_MARKETPLACE_SOURCE)).rejects.toThrow(/cannot be removed/);
    const persisted = readFileSync(file, 'utf8');
    await value.stop();
    await service(dataDir).start();
    expect(readFileSync(file, 'utf8')).toBe(persisted);
  });

  it('keeps the previous catalog until a valid replacement has loaded', async () => {
    const { dataDir, store } = setup();
    const previous = await store.add(LEGACY_INTERNAL_MARKETPLACE_SOURCE, PRIVATE, { official: true });
    let resolve!: (index: MarketplaceIndex) => void;
    fetchCatalog.mockImplementation(() => new Promise<MarketplaceIndex>(done => { resolve = done; }));
    const value = service(dataDir);
    await value.start();
    expect(value.listMarketplaces()).toEqual([previous]);
    resolve(PUBLIC);
    await vi.waitFor(() => expect(value.listMarketplaces().map(row => row.name)).toEqual(['zana-community']));
  });

  it('retains the previous cache without recording a discovery error when the public source is unreachable', async () => {
    const { dataDir, store } = setup();
    const previous = await store.add(LEGACY_INTERNAL_MARKETPLACE_SOURCE, PRIVATE, { official: true });
    fetchCatalog.mockRejectedValue(new Error('offline'));
    const value = service(dataDir);
    await expect(value.start()).resolves.toBeUndefined();
    await vi.waitFor(() => expect(fetchCatalog).toHaveBeenCalledOnce());
    expect(value.listMarketplaces()).toEqual([previous]);
  });

  it('preserves manually added internal catalogs and honors disabled, invalid and custom overrides', async () => {
    const { dataDir, store } = setup();
    const manual = await store.add(LEGACY_INTERNAL_MARKETPLACE_SOURCE, PRIVATE);
    const value = service(dataDir);
    await value.start();
    await vi.waitFor(() => expect(value.listMarketplaces()).toHaveLength(2));
    expect(value.listMarketplaces()).toContainEqual(manual);
    for (const override of ['off', 'http://invalid.test', 'path:/custom/catalog']) {
      const next = setup();
      const previous = await next.store.add(LEGACY_INTERNAL_MARKETPLACE_SOURCE, PRIVATE, { official: true });
      vi.stubEnv('ZCC_COMMUNITY_MARKETPLACE_SOURCE', override);
      const custom = service(next.dataDir);
      await custom.start();
      expect(custom.listMarketplaces()).toContainEqual(previous);
      expect(custom.listMarketplaces()).toHaveLength(override.startsWith('path:') ? 2 : 1);
    }
  });

  it('refetches an existing public row that has no usable cache', async () => {
    const { dataDir, file } = setup();
    mkdirSync(join(dataDir, 'plugins'), { recursive: true });
    writeFileSync(file, JSON.stringify({ version: 3, catalogs: [{ source: DEFAULT_COMMUNITY_MARKETPLACE_SOURCE, official: true }] }));
    const value = service(dataDir);
    await value.start();
    await vi.waitFor(() => expect(value.listMarketplaces()[0]?.cachedIndex).toEqual(PUBLIC));
    expect(fetchCatalog).toHaveBeenCalledOnce();
  });
});
