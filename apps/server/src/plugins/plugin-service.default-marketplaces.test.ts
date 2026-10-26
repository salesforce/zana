import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPluginService } from './plugin-service.js';
import { createMarketplaceStore, marketplaceStorePath } from './marketplace-store.js';
import { DEFAULT_COMMUNITY_MARKETPLACE_SOURCE, DEFAULT_INTERNAL_MARKETPLACE_SOURCE } from './default-marketplaces.js';
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
  fetchCatalog.mockReset().mockImplementation(async source => source.kind === 'git' && source.url.includes('git.soma') ? PRIVATE : PUBLIC);
});
afterEach(async () => {
  for (const value of services.splice(0)) await value.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('independent default marketplaces', () => {
  it('seeds both public and internal Git defaults with bounded, non-interactive discovery', async () => {
    const { dataDir } = setup();
    const value = service(dataDir);
    await value.start();
    await vi.waitFor(() => expect(value.listMarketplaces()).toHaveLength(2));
    expect(value.listMarketplaces().map(row => row.name).sort()).toEqual(['internal', 'zana-community']);
    expect(value.listMarketplaces().every(row => row.official && row.lastError === null)).toBe(true);
    for (const url of ['https://github.com/salesforce/zana-marketplace.git', 'https://git.soma.salesforce.com/chatbots/zana-internal-marketplace.git']) {
      expect(fetchCatalog).toHaveBeenCalledWith({ kind: 'git', url, ref: 'HEAD' }, expect.any(Function), { timeoutMs: 8_000, nonInteractive: true });
    }
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
  });

  it.each(['internal', 'public'])('keeps the other catalog usable when the %s repository is inaccessible', async unavailable => {
    fetchCatalog.mockImplementation(async source => {
      const internal = source.url.includes('git.soma');
      if (internal === (unavailable === 'internal')) throw new Error('Git access denied');
      return internal ? PRIVATE : PUBLIC;
    });
    const { dataDir } = setup();
    const value = service(dataDir);
    await expect(value.start()).resolves.toBeUndefined();
    await vi.waitFor(() => expect(value.listMarketplaces()).toHaveLength(1));
    expect(value.listMarketplaces()[0]).toMatchObject({ name: unavailable === 'internal' ? 'zana-community' : 'internal', lastError: null });
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
  });

  it('preserves the internal cache, custom catalogs and installed plugins while promoting the cached public catalog', async () => {
    const { dataDir, store, file } = setup();
    const internal = await store.add(DEFAULT_INTERNAL_MARKETPLACE_SOURCE, PRIVATE, { official: true });
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
    expect(value.listMarketplaces()).toHaveLength(3);
    expect(value.listMarketplaces()).toContainEqual(internal);
    expect(value.listMarketplaces()).toContainEqual(custom);
    expect(value.listMarketplaces().find(row => row.name === 'zana-community')?.official).toBe(true);
    expect(value.get('private-tool')).toMatchObject({ source: installed!.source, enabled: installed!.enabled, version: installed!.version });
    expect(fetchCatalog).not.toHaveBeenCalled();
    for (const source of [DEFAULT_COMMUNITY_MARKETPLACE_SOURCE, DEFAULT_INTERNAL_MARKETPLACE_SOURCE]) {
      await expect(value.removeMarketplace(source)).rejects.toThrow(/cannot be removed/);
    }
    const persisted = readFileSync(file, 'utf8');
    await value.stop();
    await service(dataDir).start();
    expect(readFileSync(file, 'utf8')).toBe(persisted);
    expect(fetchCatalog).not.toHaveBeenCalled();
  });

  it('starts both discoveries in the background and lets the public catalog finish while internal Git is pending', async () => {
    let resolveInternal!: (index: MarketplaceIndex) => void;
    fetchCatalog.mockImplementation(source => source.url.includes('git.soma')
      ? new Promise<MarketplaceIndex>(done => { resolveInternal = done; })
      : Promise.resolve(PUBLIC));
    const { dataDir } = setup();
    const value = service(dataDir);
    await value.start();
    await vi.waitFor(() => expect(value.listMarketplaces().map(row => row.name)).toEqual(['zana-community']));
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
    resolveInternal(PRIVATE);
    await vi.waitFor(() => expect(value.listMarketplaces()).toHaveLength(2));
  });

  it.each([
    { publicSource: 'off', internalSource: '', names: ['internal'] },
    { publicSource: '', internalSource: 'off', names: ['zana-community'] },
    { publicSource: 'off', internalSource: 'off', names: [] },
    { publicSource: 'http://invalid.test', internalSource: '', names: ['internal'] },
    { publicSource: '', internalSource: 'http://invalid.test', names: ['zana-community'] },
    { publicSource: 'path:/custom/public', internalSource: 'off', names: ['zana-community'] },
    { publicSource: 'off', internalSource: 'path:/custom/internal', names: ['internal'] }
  ])('honors independent overrides: public=$publicSource internal=$internalSource', async ({ publicSource, internalSource, names }) => {
    vi.stubEnv('ZCC_COMMUNITY_MARKETPLACE_SOURCE', publicSource);
    vi.stubEnv('ZCC_INTERNAL_MARKETPLACE_SOURCE', internalSource);
    fetchCatalog.mockImplementation(async source => source.kind === 'path' && source.directory.includes('internal') || source.kind === 'git' && source.url.includes('git.soma') ? PRIVATE : PUBLIC);
    const { dataDir } = setup();
    const value = service(dataDir);
    await value.start();
    await vi.waitFor(() => expect(value.listMarketplaces().map(row => row.name).sort()).toEqual(names));
    expect(fetchCatalog).toHaveBeenCalledTimes(names.length);
  });

  it('refetches an existing public row without usable cache and preserves the internal cache', async () => {
    const { dataDir, store, file } = setup();
    const internal = await store.add(DEFAULT_INTERNAL_MARKETPLACE_SOURCE, PRIVATE, { official: true });
    const document = JSON.parse(readFileSync(file, 'utf8'));
    document.catalogs.push({ source: DEFAULT_COMMUNITY_MARKETPLACE_SOURCE, official: true });
    writeFileSync(file, JSON.stringify(document));
    const value = service(dataDir);
    await value.start();
    await vi.waitFor(() => expect(value.listMarketplaces().find(row => row.name === 'zana-community')?.cachedIndex).toEqual(PUBLIC));
    expect(value.listMarketplaces()).toContainEqual(internal);
    expect(fetchCatalog).toHaveBeenCalledOnce();
  });
});
