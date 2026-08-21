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
  await win.locator('.nav-item').filter({ hasText: 'Extensions' }).first().click();

  // The panel mounts with the layout-fix modifier class.
  const panel = win.locator('.settings-panel.extensions-panel');
  await panel.waitFor({ state: 'visible', timeout: 15_000 });

  // The hub (its tabs + toolbar) is inside it.
  await win.waitForSelector('.ext-hub-shell', { timeout: 15_000 });

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
});
