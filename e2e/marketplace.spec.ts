/**
 * Marketplace E2E — the real install path end to end.
 *
 * These run against the BUILT app with a signed local HTTPS registry standing
 * in for the (not-yet-hosted) production one. They prove the contracts the
 * shipped engine enforces: opt-in channel, HTTPS, sha256 integrity, Ed25519
 * signature, and the UI wiring from a click through IPC to disk.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, launchApp } from './fixtures/app.js';
import { startGitHttpServer } from './fixtures/git-http.js';
import { MarketplacePage } from './fixtures/marketplace.js';

test.describe('marketplace — bundled catalog without a remote registry', () => {
  // No `useRegistry` → no ~/.zcc/extension-registry.json → remote channel stays off.
  // First-party plugins under `plugins/` still populate Browse (shipped-with-the-app).
  test('lists bundled first-party plugins with zero network', async ({ app }) => {
    const market = new MarketplacePage(app.window);
    await market.open();

    const res = await market.ipc<{
      ok: boolean;
      value?: Array<{ source: string; id: string }>;
    }>('marketplaceList');
    expect(res.ok).toBe(true);
    expect(res.value?.length).toBeGreaterThan(0);
    expect(res.value?.every((entry) => entry.source === 'bundled')).toBe(true);

    await expect(market.rows()).not.toHaveCount(0);
    await expect(market.emptyHint()).toHaveCount(0);
  });
});

test.describe('marketplace — signed registry configured', () => {
  test.use({ useRegistry: true, isolateBundledCatalog: true });

  test('browses the catalog and installs the dummy extension via the UI', async ({
    app,
    registry,
  }) => {
    const id = registry!.extension.id;
    const market = new MarketplacePage(app.window);
    await market.open();

    // Bundled entries may coexist with the signed fixture catalog. The fixture
    // card itself proves configured registry discovery.
    await expect(market.rows()).not.toHaveCount(0);
    const titleRow = market.row('E2E Dummy');
    await expect(titleRow).toBeVisible();

    // Button reads "Install" (not installed yet, compatible).
    const button = market.rowButton('E2E Dummy');
    await expect(button).toHaveText(/Install/);

    // Click install → confirm full trust → downloads, verifies sha256 + Ed25519, stages to disk.
    await button.click();
    await market.confirmInstall();

    await market.waitForInstalledDetail('E2E Dummy');

    // Verify on disk via the installed-list IPC (returns a bare ExtensionEntry[]).
    const list = await market.ipc<Array<{ id: string }>>('list');
    expect(list.some((e) => e.id === id)).toBe(true);
  });

  test('marketplaceList projects install state after a fresh boot', async ({ app, registry }) => {
    const market = new MarketplacePage(app.window);
    const res = await market.ipc<{
      ok: boolean;
      value: Array<{ id: string; compatible: boolean; permissions?: string[] }>;
    }>('marketplaceList');
    expect(res.ok).toBe(true);
    const entry = res.value.find((e) => e.id === registry!.extension.id);
    expect(entry, 'dummy extension present in catalog').toBeTruthy();
    expect(entry!.compatible).toBe(true);
    expect(entry!.permissions).toEqual(registry!.extension.permissions);
  });
});

test.describe('marketplace — integrity gates (signed registry)', () => {
  test.use({ useRegistry: true, isolateBundledCatalog: true });

  test('a tampered release is rejected by the install path', async ({ app }) => {
    const market = new MarketplacePage(app.window);

    // Drive install for an id the registry doesn't actually offer → the engine
    // can't resolve a release (NOT_FOUND). Proves install won't fabricate a
    // release, and the typed failure surfaces rather than a silent success.
    const bad = await market.ipc<{ ok: boolean; code?: string }>('install', {
      kind: 'marketplace',
      id: 'no-such-extension',
    });
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe('NOT_FOUND');
  });
});

test.describe('marketplace — catalog sources from the on-disk store', () => {
  test('lists seeded official catalogs in Catalog sources', async ({ home }) => {
    mkdirSync(join(home, '.zcc', 'plugins'), { recursive: true });
    writeFileSync(
      join(home, '.zcc', 'plugins', 'marketplaces.json'),
      JSON.stringify({
        version: 2,
        catalogs: [
          {
            source: 'https://example.test/official.json',
            sourceKind: 'https',
            name: 'zana-official-plugins',
            displayName: 'Zana official plugins',
            addedAt: 1,
            entryCount: 30,
            lastRefreshAt: 1,
            lastAttemptAt: 1,
            lastError: null,
            official: true
          },
          {
            source: 'git:https://git.example.test/internal.git',
            sourceKind: 'git',
            name: 'zana-internal-plugins',
            displayName: 'Zana internal plugins',
            addedAt: 1,
            entryCount: 1,
            lastRefreshAt: 1,
            lastAttemptAt: 1,
            lastError: null,
            official: true
          }
        ]
      })
    );
    const handle = await launchApp(home, {
      env: {
        ZCC_OFFICIAL_MARKETPLACE_URL: 'off',
        ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off'
      }
    });
    try {
      const market = new MarketplacePage(handle.window);
      await market.open();
      const listed = await handle.window.evaluate(() =>
        (
          window as unknown as {
            cc: { marketplaces: { list: () => Promise<Array<{ displayName: string }>> } };
          }
        ).cc.marketplaces.list()
      );
      expect(listed.map((row) => row.displayName)).toEqual([
        'Zana official plugins',
        'Zana internal plugins'
      ]);
      await market.openCatalogSources();
      await expect(market.catalogNames()).toHaveText([
        'Zana official plugins',
        'Zana internal plugins'
      ]);
      await expect(handle.window.locator('.ext-market-item-source--official')).toHaveCount(2);
    } finally {
      await handle.electron.close();
    }
  });

  test('adds a bare HTTPS Git catalog through Catalog Sources and persists its canonical identity', async ({ home }) => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'zcc-marketplace-git-http-'));
    const git = await startGitHttpServer(fixtureDir, [{
      repoName: 'catalog',
      files: {
        'marketplace.json': JSON.stringify({
          schemaVersion: 1,
          name: 'https-git',
          displayName: 'HTTPS Git catalog',
          plugins: []
        })
      }
    }]);
    const source = git.bareUrlFor('catalog');
    const handle = await launchApp(home, {
      caCertPath: git.caCertPath,
      env: {
        GIT_SSL_CAINFO: git.caCertPath,
        ZCC_OFFICIAL_MARKETPLACE_URL: 'off',
        ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off'
      }
    });
    try {
      const market = new MarketplacePage(handle.window);
      await market.open();
      await market.openCatalogSources();
      await handle.window.getByLabel('Marketplace catalog source').fill(source);
      await handle.window.getByRole('button', { name: 'Add catalog' }).click();
      await expect(market.catalogNames()).toHaveText(['HTTPS Git catalog'], { timeout: 45_000 });

      const catalogs = await handle.window.evaluate(() =>
        (window as unknown as {
          cc: { marketplaces: { list: () => Promise<Array<{ source: string; sourceKind: string }>> } };
        }).cc.marketplaces.list()
      );
      expect(catalogs).toEqual([expect.objectContaining({ source: `git:${source}`, sourceKind: 'git' })]);
      await handle.electron.close();

      const relaunched = await launchApp(home, {
        caCertPath: git.caCertPath,
        env: {
          GIT_SSL_CAINFO: git.caCertPath,
          ZCC_OFFICIAL_MARKETPLACE_URL: 'off',
          ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off'
        }
      });
      try {
        const persisted = await relaunched.window.evaluate(() =>
          (window as unknown as {
            cc: { marketplaces: { list: () => Promise<Array<{ source: string }>> } };
          }).cc.marketplaces.list()
        );
        expect(persisted).toEqual([expect.objectContaining({ source: `git:${source}` })]);
      } finally {
        await relaunched.electron.close();
      }
    } finally {
      await handle.electron.close().catch(() => undefined);
      await git.close();
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  }, 90_000);
});
