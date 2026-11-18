import { test, expect } from './fixtures/app.js';

test('AI Harness settings show a generated priority strip, highest layer first', async ({ app }) => {
  const win = app.window;
  await win.getByRole('link', { name: 'Settings', exact: true }).click();
  await win.getByTestId('settings-nav-harness').click();
  const panel = win.locator('.harness-settings');
  const strip = panel.getByTestId('precedence-harness.target').first();
  await strip.scrollIntoViewIfNeeded();
  await expect(strip).toBeVisible();
  await expect(strip).toContainText('Checked first →');
  await expect(strip).toContainText('→ checked last');
  const text = (await strip.innerText()).replace(/\s+/g, ' ');
  const order = ['Agent', 'Persona', 'Project', 'Global'].map((layer) => text.indexOf(layer));
  expect(order.every((index) => index >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});
