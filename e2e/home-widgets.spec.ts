import { test, expect, dismissConsentOverlays } from './fixtures/app.js';

test.use({
  e2e: true, isolateBundledCatalog: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  initialConfig: { sponsorPromptDismissed: true }
});

test('Basic Home builds a widget, lets you drop it into an empty cell, and restores the layout', async ({ app }) => {
  const { window: page } = app;
  await dismissConsentOverlays(page);
  const basic = page.getByTestId('basic-ui-mode-basic');
  await basic.click();
  await expect(page.getByRole('heading', { name: 'What shall we work on today?' })).toBeVisible();
  const board = page.getByRole('region', { name: 'My widgets' });
  await board.getByRole('button', { name: 'Add widget' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add widget' });
  await dialog.getByRole('button', { name: 'Build' }).click();
  await dialog.getByRole('textbox', { name: 'What should this widget show?' }).fill('Make a checklist called Launch with: Review, Publish');
  await dialog.getByRole('button', { name: 'Generate preview' }).click();
  await expect(dialog.getByRole('checkbox', { name: 'Review' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Pin to Home' }).click();
  const card = board.getByRole('article', { name: 'Launch' });
  await card.getByRole('checkbox', { name: 'Review' }).check();
  await board.getByRole('button', { name: 'Edit layout' }).click();
  const handle = card.getByRole('button', { name: 'Move Launch on grid' });
  await handle.scrollIntoViewIfNeeded();
  const pointer = (await handle.boundingBox())!;
  await page.mouse.move(pointer.x + 10, pointer.y + 9);
  await page.mouse.down();
  await page.mouse.move(pointer.x + 10, pointer.y + 73, { steps: 8 });
  await expect(board.getByText('Drop here')).toBeVisible();
  await page.mouse.up();
  await expect(card).toHaveCSS('grid-row-start', '2');
  await card.getByRole('button', { name: 'Resize Launch' }).press('ArrowDown');
  await expect(card.getByText(/× 4/)).toBeVisible();
  await page.reload();
  if (await basic.getAttribute('aria-pressed') !== 'true' && !await board.isVisible()) await basic.click();
  await expect(card).toHaveCSS('grid-row-start', '2');
  await expect(card).toHaveCSS('grid-row-end', 'span 4');
  await expect(card.getByRole('checkbox', { name: 'Review' })).toBeChecked();
  await page.getByTestId('basic-ui-mode-advanced').click();
  await expect(board).toBeHidden();
});
