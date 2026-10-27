import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pluginPackIndexSchema } from '@zana-ai/zcc-domain';
import { materializeMarketplaceSource } from './marketplace-source.js';
import { createMarketplaceStore, marketplaceStorePath, toPublicMarketplaceCatalog } from './marketplace-store.js';

const dirs: string[] = [];
const index = { schemaVersion: 1 as const, name: 'test', displayName: 'Test', plugins: [] };
const packs = { schemaVersion: 1 as const, packs: [{ id: 'essentials', displayName: 'Essentials', description: 'Useful tools', members: [{ pluginId: 'notes' }] }] };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function directory() { const dir = mkdtempSync(join(tmpdir(), 'plugin-pack-catalog-')); dirs.push(dir); return dir; }

describe('optional marketplace packs sidecar', () => {
  it('loads a bounded sidecar beside a local catalogue without changing marketplace.json', async () => {
    const dir = directory();
    writeFileSync(join(dir, 'marketplace.json'), JSON.stringify(index));
    writeFileSync(join(dir, 'packs.json'), JSON.stringify(packs));
    const result = await materializeMarketplaceSource({ kind: 'path', directory: dir }, undefined, { includePacks: true });
    expect(result).toMatchObject({ index, packs, packsError: null });
    expect(JSON.parse(readFileSync(join(dir, 'marketplace.json'), 'utf8'))).toEqual(index);
    const legacy = await materializeMarketplaceSource({ kind: 'path', directory: dir });
    expect(legacy).not.toHaveProperty('packs');
  });

  it('accepts older catalogues with no sidecar', async () => {
    const dir = directory();
    writeFileSync(join(dir, 'marketplace.json'), JSON.stringify(index));
    const result = await materializeMarketplaceSource({ kind: 'path', directory: dir }, undefined, { includePacks: true });
    expect(result).toMatchObject({ index, packs: null, packsError: null });
  });

  it.each(['{bad', JSON.stringify({ schemaVersion: 99, packs: [] }), 'x'.repeat(1_048_577)])('isolates an invalid or oversized sidecar from the ordinary index (%#)', async (contents) => {
    const dir = directory();
    writeFileSync(join(dir, 'marketplace.json'), JSON.stringify(index));
    writeFileSync(join(dir, 'packs.json'), contents);
    const result = await materializeMarketplaceSource({ kind: 'path', directory: dir }, undefined, { includePacks: true });
    expect(result.index).toEqual(index);
    expect(result.packs).toBeNull();
    expect(result.packsError).toMatch(/valid packs.json/);
  });

  it('does not follow sidecar symlinks outside the catalogue root', async () => {
    const dir = directory();
    const outside = directory();
    writeFileSync(join(dir, 'marketplace.json'), JSON.stringify(index));
    writeFileSync(join(outside, 'private.json'), JSON.stringify(packs));
    symlinkSync(join(outside, 'private.json'), join(dir, 'packs.json'));
    const result = await materializeMarketplaceSource({ kind: 'path', directory: dir }, undefined, { includePacks: true });
    expect(result.packs).toBeNull();
    expect(result.index).toEqual(index);
  });

  it('fetches the optional HTTPS sibling and treats 404 as an older catalogue', async () => {
    const fetchJson = vi.fn(async (url: string) => url.endsWith('/packs.json') ? packs : index);
    const source = { kind: 'https' as const, manifestUrl: 'https://example.test/catalog/marketplace.json' };
    const result = await materializeMarketplaceSource(source, fetchJson, { includePacks: true });
    expect(result.packs).toEqual(packs);
    expect(fetchJson.mock.calls.map(([url]) => url)).toEqual(['https://example.test/catalog/marketplace.json', 'https://example.test/catalog/packs.json']);
    const missing = await materializeMarketplaceSource(source, async (url) => {
      if (url.endsWith('/packs.json')) throw new Error('marketplace fetch failed: 404');
      return index;
    }, { includePacks: true });
    expect(missing).toMatchObject({ index, packs: null, packsError: null });
  });

  it('keeps index usable and hides private fetch diagnostics for a failed sidecar request', async () => {
    const result = await materializeMarketplaceSource({ kind: 'https', manifestUrl: 'https://example.test/marketplace.json' }, async (url) => {
      if (url.endsWith('/packs.json')) throw new Error('private credential diagnostic');
      return index;
    }, { includePacks: true });
    expect(result.index).toEqual(index);
    expect(result.packsError).toBe('Unable to read a valid packs.json sidecar');
  });

  it('reads both manifests from the same single Git materialization', async () => {
    const runGit = vi.fn(async (args: string[]) => {
      const root = args.at(-1)!;
      writeFileSync(join(root, 'marketplace.json'), JSON.stringify(index));
      writeFileSync(join(root, 'packs.json'), JSON.stringify(packs));
      return '';
    });
    const result = await materializeMarketplaceSource({ kind: 'git', url: 'https://example.test/catalog.git', ref: 'main' }, undefined, { includePacks: true, runGit });
    expect(result).toMatchObject({ index, packs, packsError: null });
    expect(runGit).toHaveBeenCalledTimes(1);
    expect(() => statSync(runGit.mock.calls[0]?.[0].at(-1)!)).toThrow();
  });
});

describe('marketplace pack cache persistence', () => {
  it('round-trips optional caches and errors while leaving the public catalogue projection unchanged', async () => {
    const dir = directory();
    const file = marketplaceStorePath(dir);
    const store = createMarketplaceStore({ file });
    await store.add('https://example.test/marketplace.json', index, { packs, packsError: null });
    expect(createMarketplaceStore({ file }).list()[0]?.cachedPacks).toEqual(packs);
    expect(toPublicMarketplaceCatalog(store.list()[0]!)).not.toHaveProperty('cachedPacks');
    await store.refresh('https://example.test/marketplace.json', index);
    expect(store.list()[0]?.cachedPacks).toEqual(packs);
    await store.refresh('https://example.test/marketplace.json', index, { packs: null, packsError: 'Bad sidecar' });
    expect(store.list()[0]).toMatchObject({ cachedPacks: null, packsError: 'Bad sidecar' });
    expect(createMarketplaceStore({ file }).list()[0]).toMatchObject({ cachedPacks: null, packsError: 'Bad sidecar' });
  });

  it('retains the last cached sidecar through ordinary fetch errors and add promotion without sidecar options', async () => {
    const dir = directory();
    const store = createMarketplaceStore({ file: marketplaceStorePath(dir) });
    await store.add('https://example.test/marketplace.json', index, { packs });
    await store.recordRefreshError('https://example.test/marketplace.json', 'offline');
    expect(store.list()[0]?.cachedPacks).toEqual(packs);
    await store.add('https://example.test/marketplace.json', index, { official: true });
    expect(store.list()[0]).toMatchObject({ cachedPacks: packs, official: true });
  });

  it('drops malformed stored sidecars without discarding the plugin catalogue', () => {
    const dir = directory();
    const file = marketplaceStorePath(dir);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ version: 3, catalogs: [{ source: 'https://example.test/marketplace.json', cachedIndex: index, cachedPacks: { arbitrary: true }, packsError: 42 }] }));
    const store = createMarketplaceStore({ file });
    expect(store.list()[0]).toMatchObject({ cachedIndex: index, cachedPacks: null, packsError: null });
    expect(pluginPackIndexSchema.safeParse(store.list()[0]?.cachedPacks).success).toBe(false);
  });
});
