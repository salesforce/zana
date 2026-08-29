import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMarketplaceStore, marketplaceStorePath } from './marketplace-store.js';
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
});
