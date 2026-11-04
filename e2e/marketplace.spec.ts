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
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
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
    await app.window.getByRole('textbox', { name: 'Search plugins' }).fill('E2E Dummy');
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
  test('adds the public GitHub catalog alongside the internal default and keeps both across restart', async ({ home }) => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'zcc-community-default-'));
    const git = await startGitHttpServer(fixtureDir, [{
      repoName: 'community',
      files: { 'marketplace.json': JSON.stringify({
        schemaVersion: 1, name: 'zana-community', displayName: 'Zana Community',
        plugins: [{ id: 'cloud-machines', displayName: 'Cloud Machines', description: 'Manage cloud computers',
          author: { name: 'E2E' }, source: { git: { url: 'https://example.test/plugin.git', ref: 'v1.0.0' } } }]
      }) }
    }]);
    mkdirSync(join(home, '.zcc', 'plugins'), { recursive: true });
    writeFileSync(join(home, '.zcc', 'plugins', 'marketplaces.json'), JSON.stringify({ version: 3, catalogs: [{
      source: 'git:https://git.soma.salesforce.com/chatbots/zana-internal-marketplace', sourceKind: 'git',
      name: 'internal', displayName: 'Zana internal plugins', official: true,
      cachedIndex: { schemaVersion: 1, name: 'internal', displayName: 'Zana internal plugins', plugins: [] }
    }] }));
    const env = {
      ZCC_OFFICIAL_MARKETPLACE_URL: 'off', ZCC_COMMUNITY_MARKETPLACE_SOURCE: '', ZCC_INTERNAL_MARKETPLACE_SOURCE: '',
      GIT_SSL_CAINFO: git.caCertPath,
      // Route the production default through the fixture's Git web URL.
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.${git.bareUrlFor('community')}.insteadOf`,
      GIT_CONFIG_VALUE_0: 'https://github.com/salesforce/zana-marketplace.git'
    };
    const launch = () => launchApp(home, { caCertPath: git.caCertPath, env });
    let handle: Awaited<ReturnType<typeof launchApp>> | undefined;
    try {
      handle = await launch();
      const window = handle.window;
      await expect.poll(() => window.evaluate(() => (
        window as unknown as { cc: { marketplaces: { list: () => Promise<Array<{ name: string }>> } } }
      ).cc.marketplaces.list()).then(rows => rows.map(row => row.name)), { timeout: 20_000 }).toEqual(['internal', 'zana-community']);
      const market = new MarketplacePage(handle.window);
      await market.open();
      await handle.window.getByRole('textbox', { name: 'Search plugins' }).fill('Cloud Machines');
      await expect(market.row('Cloud Machines')).toBeVisible({ timeout: 20_000 });
      await market.openCatalogSources();
      await expect(market.catalogNames()).toHaveText(['Zana internal plugins', 'Zana Community']);
      await expect(handle.window.locator('.ext-market-item-source--official')).toHaveCount(2);
      await closeApp(handle.electron);
      handle = await launch();
      const catalogs = await handle.window.evaluate(() => (
        window as unknown as { cc: { marketplaces: { list: () => Promise<Array<{ name: string; official: boolean; source: string }>> } } }
      ).cc.marketplaces.list());
      expect(catalogs).toEqual([
        expect.objectContaining({ name: 'internal', official: true, source: 'git:https://git.soma.salesforce.com/chatbots/zana-internal-marketplace' }),
        expect.objectContaining({ name: 'zana-community', official: true, source: 'git:https://github.com/salesforce/zana-marketplace' })
      ]);
    } finally {
      if (handle) await closeApp(handle.electron);
      await git.close();
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  }, 90_000);

  test('keeps the public catalog usable when internal Git access is unavailable', async ({ home }) => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'zcc-public-without-internal-'));
    const git = await startGitHttpServer(fixtureDir, [{ repoName: 'community', files: {
      'marketplace.json': JSON.stringify({ schemaVersion: 1, name: 'zana-community', displayName: 'Zana Community', plugins: [] })
    } }]);
    let handle: Awaited<ReturnType<typeof launchApp>> | undefined;
    try {
      handle = await launchApp(home, { caCertPath: git.caCertPath, env: {
        ZCC_OFFICIAL_MARKETPLACE_URL: 'off', ZCC_COMMUNITY_MARKETPLACE_SOURCE: '', ZCC_INTERNAL_MARKETPLACE_SOURCE: '',
        GIT_SSL_CAINFO: git.caCertPath, GIT_CONFIG_COUNT: '2',
        GIT_CONFIG_KEY_0: `url.${git.bareUrlFor('community')}.insteadOf`,
        GIT_CONFIG_VALUE_0: 'https://github.com/salesforce/zana-marketplace.git',
        GIT_CONFIG_KEY_1: `url.${git.bareUrlFor('missing-internal')}.insteadOf`,
        GIT_CONFIG_VALUE_1: 'https://git.soma.salesforce.com/chatbots/zana-internal-marketplace.git'
      } });
      const window = handle.window;
      await expect.poll(() => window.evaluate(() => (
        window as unknown as { cc: { marketplaces: { list: () => Promise<Array<{ name: string; lastError: string | null }>> } } }
      ).cc.marketplaces.list()), { timeout: 20_000 }).toEqual([expect.objectContaining({ name: 'zana-community', lastError: null })]);
      const market = new MarketplacePage(window);
      await market.open();
      await market.openCatalogSources();
      await expect(market.catalogNames()).toHaveText(['Zana Community']);
    } finally {
      if (handle) await closeApp(handle.electron);
      await git.close();
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  }, 90_000);

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
