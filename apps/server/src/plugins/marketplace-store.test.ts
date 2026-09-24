import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMarketplaceStore, listPublicMarketplaceCatalogs, marketplaceStorePath, toPublicMarketplaceCatalog } from './marketplace-store.js';
import type { MarketplaceIndex } from './marketplace.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const INDEX: MarketplaceIndex = {
  schemaVersion: 1,
  name: 'official',
  displayName: 'Official',
  plugins: [
    {
      id: 'notes',
      displayName: 'Notes',
      description: 'notes plugin',
      author: { name: 'zana' },
      source: { npm: { package: '@zana/notes', range: '1.0.0' } }
    }
  ]
};

describe('marketplace store', () => {
  it('migrates v1 url-only rows and keeps a last-good catalog after a failed refresh', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-mp-store-'));
    dirs.push(dataDir);
    const file = marketplaceStorePath(dataDir);
    mkdirSync(join(dataDir, 'plugins'), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        catalogs: [{ url: 'https://example.test/mp.json', name: 'old', displayName: 'Old', addedAt: 1 }]
      })
    );
    const store = createMarketplaceStore({ file });
    expect(store.list()[0]?.source).toBe('https://example.test/mp.json');
    expect(store.list()[0]?.sourceKind).toBe('https');

    await store.add('https://example.test/mp.json', INDEX);
    expect(store.list()[0]?.cachedIndex?.plugins).toHaveLength(1);
    const failed = await store.recordRefreshError('https://example.test/mp.json', 'network down');
    expect(failed?.lastError).toBe('network down');
    expect(failed?.cachedIndex?.name).toBe('official');
    expect(failed?.entryCount).toBe(1);
  });

  it('atomically migrates parseable duplicate rows to v3 while preserving malformed source rows', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-mp-migrate-'));
    dirs.push(dataDir);
    const file = marketplaceStorePath(dataDir);
    mkdirSync(join(dataDir, 'plugins'), { recursive: true });
    const stale = { ...INDEX, displayName: 'Stale' };
    const fresh = { ...INDEX, displayName: 'Fresh' };
    const malformed = { source: 'not a marketplace source', untouched: true };
    writeFileSync(file, JSON.stringify({
      version: 2,
      catalogs: [
        {
          source: 'git+https://example.test/team/catalog.git/',
          name: 'stale', displayName: 'Stale', addedAt: 20, official: true,
          lastRefreshAt: 50, lastAttemptAt: 70, lastError: 'old error', cachedIndex: stale
        },
        {
          source: 'git:https://example.test/team/catalog',
          name: 'fresh', displayName: 'Fresh', addedAt: 10,
          lastRefreshAt: 100, lastAttemptAt: 120, lastError: null, cachedIndex: fresh
        },
        {
          source: 'git:https://example.test/team/catalog.git',
          name: 'failure', displayName: 'Failure', addedAt: 30,
          lastAttemptAt: 130, lastError: 'new error'
        },
        malformed
      ]
    }));

    const store = createMarketplaceStore({ file });
    expect(store.list()).toEqual([expect.objectContaining({
      source: 'git:https://example.test/team/catalog',
      official: true,
      addedAt: 10,
      displayName: 'Fresh',
      cachedIndex: fresh,
      lastRefreshAt: 100,
      lastAttemptAt: 130,
      lastError: 'new error'
    })]);

    const persisted = JSON.parse(readFileSync(file, 'utf8'));
    expect(persisted).toEqual(expect.objectContaining({ version: 3 }));
    expect(persisted.catalogs).toContainEqual(malformed);
    expect(persisted.catalogs.filter((row: { source?: string }) => row.source?.startsWith('git:'))).toHaveLength(1);
    const firstWrite = readFileSync(file, 'utf8');
    createMarketplaceStore({ file });
    expect(readFileSync(file, 'utf8')).toBe(firstWrite);
  });

  it('keeps last error only when its attempt is newer than latest good cache', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-mp-error-'));
    dirs.push(dataDir);
    const file = marketplaceStorePath(dataDir);
    mkdirSync(join(dataDir, 'plugins'), { recursive: true });
    writeFileSync(file, JSON.stringify({
      version: 2,
      catalogs: [
        { source: 'https://example.test/catalog.json', addedAt: 1, lastRefreshAt: 20, cachedIndex: INDEX },
        { source: 'https://example.test/catalog.json', addedAt: 2, lastAttemptAt: 20, lastError: 'same attempt' }
      ]
    }));

    expect(createMarketplaceStore({ file }).list()[0]).toMatchObject({ lastError: null, lastAttemptAt: 20 });
  });

  it('serializes concurrent writes through one store instance', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-mp-queue-'));
    dirs.push(dataDir);
    const store = createMarketplaceStore({ file: marketplaceStorePath(dataDir) });

    await Promise.all([
      store.add('https://example.test/one.json', INDEX),
      store.add('https://example.test/two.json', { ...INDEX, name: 'two' }),
      store.add('https://example.test/three.json', { ...INDEX, name: 'three' })
    ]);

    expect(store.list().map((row) => row.name)).toEqual(['official', 'two', 'three']);
  });

  it('refuses to remove an official catalog', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-mp-official-'));
    dirs.push(dataDir);
    const store = createMarketplaceStore({ file: marketplaceStorePath(dataDir) });
    await store.add('https://example.test/official.json', INDEX, { official: true });
    await expect(store.remove('https://example.test/official.json')).rejects.toThrow(/cannot be removed/);
  });

  it('removes a user catalog', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-mp-rm-'));
    dirs.push(dataDir);
    const store = createMarketplaceStore({ file: marketplaceStorePath(dataDir) });
    await store.add('https://example.test/user.json', INDEX);
    await expect(store.remove('https://example.test/user.json')).resolves.toBe(true);
    expect(store.list()).toHaveLength(0);
  });

  it('upserts git source spellings by canonical identity and persists bare canonical source', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-mp-git-upsert-'));
    dirs.push(dataDir);
    const store = createMarketplaceStore({ file: marketplaceStorePath(dataDir) });

    await store.add('git+https://example.test/team/catalog.git/', INDEX);
    await store.add('git:https://example.test/team/catalog', {
      ...INDEX,
      displayName: 'Updated'
    });

    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toMatchObject({
      source: 'git:https://example.test/team/catalog',
      sourceKind: 'git',
      displayName: 'Updated'
    });
  });

  it('keeps distinct git refs as separate catalogs', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-mp-git-refs-'));
    dirs.push(dataDir);
    const store = createMarketplaceStore({ file: marketplaceStorePath(dataDir) });

    await store.add('git:https://example.test/team/catalog.git@v1', INDEX);
    await store.add('git:https://example.test/team/catalog@v2', INDEX);

    expect(store.list().map((row) => row.source)).toEqual([
      'git:https://example.test/team/catalog@v1',
      'git:https://example.test/team/catalog@v2'
    ]);
  });

  it('refreshes and removes canonical-equivalent git sources', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-mp-git-semantic-'));
    dirs.push(dataDir);
    const store = createMarketplaceStore({ file: marketplaceStorePath(dataDir) });
    const canonical = 'git:https://example.test/team/catalog';

    await store.add('git:https://example.test/team/catalog.git/', INDEX);
    const refreshed = await store.refresh('git:https://example.test/team/catalog', {
      ...INDEX,
      name: 'refreshed'
    });
    const failed = await store.recordRefreshError('git:https://example.test/team/catalog.git', 'network down');

    expect(refreshed.source).toBe(canonical);
    expect(store.list()).toHaveLength(1);
    expect(failed).toMatchObject({ source: canonical, name: 'refreshed', lastError: 'network down' });
    await expect(store.remove('git:https://example.test/team/catalog/')).resolves.toBe(true);
    expect(store.list()).toEqual([]);
  });

  it('projects public catalog rows without cachedIndex', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-mp-public-'));
    dirs.push(dataDir);
    const store = createMarketplaceStore({ file: marketplaceStorePath(dataDir) });
    await store.add('https://example.test/official.json', INDEX, { official: true });
    const row = store.list()[0]!;
    expect(row.cachedIndex?.name).toBe('official');
    const published = toPublicMarketplaceCatalog(row);
    expect(published).toEqual({
      source: 'https://example.test/official.json',
      sourceKind: 'https',
      name: 'official',
      displayName: 'Official',
      addedAt: row.addedAt,
      entryCount: 1,
      lastRefreshAt: row.lastRefreshAt,
      lastAttemptAt: row.lastAttemptAt,
      lastError: null,
      official: true
    });
    expect(published).not.toHaveProperty('cachedIndex');
    expect(listPublicMarketplaceCatalogs(dataDir)).toEqual([published]);
  });

  it('lists an empty public catalog when the store file is missing', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-mp-missing-'));
    dirs.push(dataDir);
    expect(listPublicMarketplaceCatalogs(dataDir)).toEqual([]);
  });
});
