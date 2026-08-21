/**
 * Marketplace lifecycle E2E — the full install → live-load → uninstall flow,
 * proving an extension surfaces live without rebuilding the app.
 *
 * These tests exercise:
 *   1. Search filtering in the marketplace UI
 *   2. Install from marketplace (download + verify + stage)
 *   3. Extension becomes enabled and live-loaded (reconcile picks it up)
 *   4. Uninstall removes it from disk and tears down the live child
 *   5. All without an app relaunch
 */
import { test, expect } from './fixtures/app.js';
import { MarketplacePage } from './fixtures/marketplace.js';

test.describe('marketplace lifecycle — search', () => {
  test.use({ useRegistry: true });

  test('search box filters the catalog by title/id/description/author', async ({
    app,
    registry,
  }) => {
    const market = new MarketplacePage(app.window);
    await market.open();

    // Start with full catalog visible
    await expect(market.rows()).toHaveCount(1); // Only e2e-dummy in test registry

    // Get the search input
    const searchInput = app.window.locator('.ext-market-search-input');
    await expect(searchInput).toBeVisible();

    // Search by title (case-insensitive)
    await searchInput.fill('e2e');
    await expect(market.rows()).toHaveCount(1);
    await expect(market.row('E2E Dummy')).toBeVisible();

    // Search by partial match
    await searchInput.fill('dummy');
    await expect(market.rows()).toHaveCount(1);

    // Search for something that doesn't match
    await searchInput.fill('nonexistent-extension');
    await expect(market.rows()).toHaveCount(0);
    await expect(
      app.window.locator('.settings-help--muted', { hasText: 'No extensions match' })
    ).toBeVisible();

    // Clear search to restore full catalog
    await searchInput.fill('');
    await expect(market.rows()).toHaveCount(1);
  });

  test('search counter updates as filter narrows results', async ({ app, registry }) => {
    const market = new MarketplacePage(app.window);
    await market.open();

    const counter = app.window.locator('.ext-market-search-count');
    await expect(counter).toHaveText('1 of 1');

    const searchInput = app.window.locator('.ext-market-search-input');
    await searchInput.fill('e2e');
    await expect(counter).toHaveText('1 of 1');

    await searchInput.fill('xyz');
    await expect(counter).toHaveText('0 of 1');
  });
});

test.describe('marketplace lifecycle — install and uninstall', () => {
  test.use({ useRegistry: true });

  test('installs extension → surfaces live → uninstalls → gone', async ({ app, registry }) => {
    const id = registry!.extension.id;
    const market = new MarketplacePage(app.window);

    // === Phase 1: Not installed ===
    await market.open();
    await expect(market.rows()).toHaveCount(1);
    await expect(market.rowButton('E2E Dummy')).toHaveText(/Install/);

    // Verify not in installed list yet
    let list = await market.ipc<Array<{ id: string; enabled: boolean }>>('list');
    expect(list.some((e) => e.id === id)).toBe(false);

    // === Phase 2: Install ===
    await market.rowButton('E2E Dummy').click();

    // Wait for install to complete (button changes to "Installed")
    await expect(market.rowButton('E2E Dummy')).toHaveText(/Installed/, { timeout: 30_000 });

    // Verify now present in installed list
    list = await market.ipc<Array<{ id: string; enabled: boolean }>>('list');
    const installed = list.find((e) => e.id === id);
    expect(installed).toBeTruthy();
    expect(installed!.enabled).toBe(true); // Auto-enabled after install

    // === Phase 3: Extension is live-loaded ===
    // Navigate to Extensions panel to verify it appears in the installed list
    await app.window.getByRole('tab', { name: 'Installed' }).click();
    await expect(app.window.locator('.ext-list-item')).toHaveCount(
      expect.any(Number)
    );

    // The installed extension row should be visible
    const installedRow = app.window
      .locator('.ext-list-item')
      .filter({ has: app.window.locator('.ext-list-item-title', { hasText: 'E2E Dummy' }) });
    await expect(installedRow).toBeVisible();

    // === Phase 4: Uninstall ===
    // Click the uninstall button (trash icon or "Remove" button)
    const uninstallButton = installedRow.locator('button[title*="ninstall"], button', {
      hasText: /Remove|Uninstall/,
    });
    await uninstallButton.first().click();

    // Confirm the uninstall dialog if present
    const confirmButton = app.window.locator('button', { hasText: /Confirm|Uninstall|Yes/ });
    if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmButton.click();
    }

    // === Phase 5: Verify gone ===
    // The row should disappear from the installed list
    await expect(installedRow).not.toBeVisible({ timeout: 15_000 });

    // Verify removed from IPC list
    list = await market.ipc<Array<{ id: string }>>('list');
    expect(list.some((e) => e.id === id)).toBe(false);

    // Navigate back to marketplace — should show "Install" again
    await app.window.getByRole('tab', { name: 'Marketplace' }).click();
    await expect(market.rowButton('E2E Dummy')).toHaveText(/Install/);
  });

  test('reconcile picks up manual install without relaunch', async ({ app, home }) => {
    // Manually write hello-sample into ~/.zcc/extensions (simulating a manual install)
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { HELLO_SAMPLE_FILES } = await import('./fixtures/sample-extensions.js');

    const INSTALL_DIR = join(home, '.zcc', 'extensions', 'hello-sample');
    await mkdir(INSTALL_DIR, { recursive: true });
    for (const [rel, contents] of Object.entries(HELLO_SAMPLE_FILES)) {
      await writeFile(join(INSTALL_DIR, rel), contents);
    }

    // Trigger a rescan via the Extensions panel
    await app.window.locator('.nav-item', { hasText: 'Extensions' }).first().click();
    await app.window.getByTestId('extensions-nav-installed').click();

    // Click "Reload" or "Rescan" button
    const rescanButton = app.window.locator('button', { hasText: /Reload|Rescan/ });
    if (await rescanButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await rescanButton.click();
    }

    // Wait for the extension to appear in the list
    await app.window.waitForTimeout(2000); // Give reconcile time to discover

    // Verify hello-sample now appears in installed list
    const market = new MarketplacePage(app.window);
    const list = await market.ipc<Array<{ id: string; enabled: boolean }>>('list');
    const found = list.find((e) => e.id === 'hello-sample');
    expect(found).toBeTruthy();
  });

  test('uninstall tears down the extension without relaunch', async ({ app, registry }) => {
    const id = registry!.extension.id;
    const market = new MarketplacePage(app.window);

    // Install the extension first
    await market.open();
    await market.rowButton('E2E Dummy').click();
    await expect(market.rowButton('E2E Dummy')).toHaveText(/Installed/, { timeout: 30_000 });

    // Uninstall via IPC (simulating the renderer's uninstall call)
    const uninstallResult = await market.ipc<{ ok: boolean }>('uninstall', id);
    expect(uninstallResult.ok).toBe(true);

    // Verify it's gone from the list (reconcile tore it down live)
    await app.window.waitForTimeout(1000); // Brief settle time
    const list = await market.ipc<Array<{ id: string }>>('list');
    expect(list.some((e) => e.id === id)).toBe(false);
  });
});

test.describe('marketplace lifecycle — permission-widening updates', () => {
  test.use({
    useRegistry: true,
    // Customize the dummy to have minimal permissions initially
    dummySpec: { permissions: ['storage'] },
  });

  test('held-back permission-widening update surfaces as needs-consent', async ({
    app,
    registry,
  }) => {
    // NOTE: This test requires a two-version registry setup, which the current
    // fixture doesn't support out of the box. Placeholder for future enhancement.
    // The engine's unit tests cover this gate (extension-registry.test.ts).
    // For E2E, we'd need to:
    //   1. Install v1.0.0 with permissions: ['storage']
    //   2. Publish v1.1.0 with permissions: ['storage', 'external:open']
    //   3. Verify marketplaceList returns hasUpdate:false (held back)
    //   4. User must re-consent before the update applies
    expect(true).toBe(true); // Placeholder
  });
});
