import { test, expect } from './fixtures/app.js';

test.use({
  isolateBundledCatalog: true,
  initialConfig: { sponsorPromptDismissed: true }
});

test('modal and palette backdrops dim and block the computer switcher', async ({ app }, testInfo) => {
  const { window } = app;
  const menu = window.locator('.titlebar .instance-menu');
  const summary = menu.locator('summary');
  await expect(summary).toBeVisible();

  for (const kind of ['modal', 'palette'] as const) {
    if (kind === 'modal') {
      await summary.click();
      await menu.getByRole('button', { name: 'Open another computer…', exact: true }).click();
    } else {
      await window.keyboard.press(process.platform === 'darwin' ? 'Meta+/' : 'Control+/');
    }
    const backdrop = window.locator(`.${kind}-backdrop`);
    await expect(backdrop).toBeVisible();
    // Hit-testing checks the actual painted layer over the titlebar, including
    // stacking contexts, rather than comparing the declared z-index values.
    const bounds = (await summary.boundingBox())!;
    const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await expect.poll(() => backdrop.evaluate((node, point) => (
      document.elementFromPoint(point.x, point.y) === node
    ), point)).toBe(true);
    await window.screenshot({ path: testInfo.outputPath(`${kind}-dims-computer-switcher.png`) });
    await window.mouse.click(point.x, point.y);
    await expect(backdrop).toHaveCount(0);
    await expect(menu).not.toHaveAttribute('open');
  }

  // The menu remains usable above the page once the overlay has closed.
  await summary.click();
  await expect(menu.getByRole('button', { name: 'Open another computer…', exact: true })).toBeVisible();
  await window.keyboard.press('Escape');
  await expect(menu).not.toHaveAttribute('open');
});
