/**
 * Top-level Extensions view layout — regression for the "cramped middle column"
 * bug. `ListPane` returns null for the 'extensions' nav, so without the
 * `.extensions-panel { grid-column: 2 / -1 }` span the shell grid auto-places
 * the panel in the narrow --col-list track (280px) and leaves column 3 empty.
 *
 * This drives the SIDEBAR Extensions entry (the standalone ExtensionsPanel).
 */
import { test, expect } from './fixtures/app.js';

test('top-level Extensions view fills the content area, not the narrow list column', async ({
  app,
}) => {
  const win = app.window;

  // Sidebar "Extensions" rail entry → the standalone top-level view.
  await win.locator('.nav-item').filter({ hasText: 'Plugins' }).first().click();

  // The panel mounts with the layout-fix modifier class.
  const panel = win.locator('.settings-panel.extensions-panel');
  await panel.waitFor({ state: 'visible', timeout: 15_000 });

  // The hub (its toolbar) is inside it.
  await win.waitForSelector('.ext-hub-shell', { timeout: 15_000 });

  await win.getByTestId('extensions-nav-installed').click();
  await expect(win.getByRole('heading', { name: 'Plugins', level: 3 })).toBeVisible();
  await expect(win.getByLabel('Search installed plugins')).toBeVisible();
  await expect(win.getByRole('button', { name: 'New plugin' })).toBeVisible();

  const docsRow = win.getByTestId('plugin-row-docs');
  await expect(docsRow).toBeVisible({ timeout: 15_000 });
  await expect(docsRow.getByText('Official')).toBeVisible();

  const pluginApps = await win.evaluate(() => window.cc.pluginApps.list());
  for (const plugin of pluginApps) {
    const row = win.getByTestId(`plugin-row-${plugin.id}`);
    await expect(row).toBeVisible();
    await expect(row.getByRole('switch', { name: new RegExp(plugin.name, 'i') })).toBeVisible();
  }

  // The --col-list track is 280px (see .app-shell in global.css). A panel stuck
  // in that track would be ~280px wide; the spanned panel takes the remaining
  // width. Assert it's far wider than the list column — proof it spans cols 2..end.
  const panelBox = await panel.boundingBox();
  const shellWidth = await win.evaluate(() => window.innerWidth);
  expect(panelBox, 'extensions panel has a layout box').toBeTruthy();
  // Well past the 280px list track — should be most of the window minus the nav rail.
  expect(panelBox!.width).toBeGreaterThan(600);
  expect(panelBox!.width).toBeGreaterThan(shellWidth * 0.5);

  // And it must not leave a dead gutter: the panel's right edge reaches (near)
  // the window's right edge rather than stopping at the old col-2 boundary.
  expect(panelBox!.x + panelBox!.width).toBeGreaterThan(shellWidth - 40);

  // Installed must fill the inner the way Browse does — not shrink-to-fit a
  // narrow column with empty space on either side of the plugin list.
  const innerBox = await win.locator('.extensions-panel .settings-inner').boundingBox();
  const listBox = await win.locator('.ext-installed-panel').boundingBox();
  expect(innerBox, 'settings inner has a layout box').toBeTruthy();
  expect(listBox, 'installed list has a layout box').toBeTruthy();
  expect(innerBox!.width).toBeGreaterThan(panelBox!.width * 0.9);
  expect(listBox!.width).toBeGreaterThan(innerBox!.width * 0.85);
});

test('Plugins New plugin seeds the home composer with the shared prefix', async ({ app }) => {
  const win = app.window;
  await win.locator('.nav-item').filter({ hasText: 'Plugins' }).first().click();
  await win.waitForSelector('.ext-hub-shell', { timeout: 15_000 });
  await win.getByTestId('extensions-nav-installed').click();
  await expect(win.getByRole('button', { name: 'New plugin' })).toBeVisible();
  await win.getByRole('button', { name: 'New plugin' }).click();
  const composer = win.locator('.home-agent-composer, .thread-command-composer, .new-thread-view').first();
  await expect(composer).toBeVisible({ timeout: 15_000 });
  await expect(composer.locator('.ProseMirror, [contenteditable="true"]').first()).toContainText(
    'Create a new zcc plugin that',
    { timeout: 15_000 }
  );
});
