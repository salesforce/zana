import { test, expect, launchApp } from './fixtures/app.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test('Settings presents grouped preferences and keeps search, persistence, and return navigation working', async ({ app }, testInfo) => {
  const win = app.window;
  await win.getByRole('link', { name: 'Inbox', exact: false }).first().click();
  await win.getByRole('link', { name: 'Settings', exact: true }).click();
  await win.getByTestId('settings-nav-global').click();
  const panel = win.locator('.settings-panel--preferences');
  await expect(panel.getByRole('heading', { name: 'Preferences', exact: true })).toBeVisible();
  await expect(win.getByTestId('settings-nav-global')).toHaveAttribute('aria-current', 'page');

  const appearance = panel.getByRole('region', { name: 'Appearance', exact: true });
  const heading = appearance.getByRole('heading');
  const body = appearance.locator('.settings-section-body');
  const headingBox = (await heading.boundingBox())!;
  const bodyBox = (await body.boundingBox())!;
  expect(headingBox.y + headingBox.height).toBeLessThan(bodyBox.y);
  expect(await heading.evaluate((el) => getComputedStyle(el).textTransform)).toBe('none');

  const inner = panel.locator('.settings-inner');
  const innerBox = (await inner.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  expect(innerBox.width).toBeLessThanOrEqual(800);
  const contentRatio = await panel.evaluate((el) => el.clientWidth / el.getBoundingClientRect().width);
  const contentRight = panelBox.x + panelBox.width * contentRatio;
  expect(Math.abs((innerBox.x - panelBox.x) - (contentRight - innerBox.x - innerBox.width))).toBeLessThan(3);

  const theme = appearance.getByRole('button', { name: 'Theme', exact: true });
  const themeLabel = appearance.locator('.settings-label').filter({ hasText: /^Theme$/ });
  expect((await theme.boundingBox())!.x).toBeGreaterThan((await themeLabel.boundingBox())!.x + 100);
  for (const mode of ['Light', 'Dark']) {
    await theme.click();
    await win.getByRole('listbox', { name: 'Theme' }).getByRole('option', { name: mode, exact: true }).click();
    await expect(win.locator('html')).toHaveAttribute('data-theme', mode.toLowerCase());
    await expect.poll(() => win.evaluate(() => window.cc.config.get())).toMatchObject({ theme: mode.toLowerCase() });
    await win.screenshot({ path: testInfo.outputPath(`settings-${mode.toLowerCase()}.png`), animations: 'disabled' });
  }

  const search = win.getByRole('textbox', { name: 'Search settings' });
  await search.fill('dark');
  await win.getByTestId('settings-nav-global-appearance').click();
  await expect(heading).toBeInViewport();
  await search.fill('zz-no-settings-match');
  await expect(win.getByRole('status').filter({ hasText: 'No matching settings' })).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(win.getByTestId('settings-nav-terminal')).toBeVisible();

  const diagnostics = panel.getByRole('switch', { name: 'Show diagnostic events' });
  await diagnostics.focus();
  await diagnostics.press('Space');
  await expect(diagnostics).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => win.evaluate(() => window.cc.config.get())).toMatchObject({ showDiagnosticEvents: true });
  await win.getByTestId('settings-nav-terminal').click();
  await win.getByTestId('settings-nav-global').click();
  await expect(panel.getByRole('switch', { name: 'Show diagnostic events' })).toHaveAttribute('aria-checked', 'true');

  await win.setViewportSize({ width: 800, height: 740 });
  // A resized rail can leave a narrower content area than the outer window.
  await expect.poll(() => panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await panel.evaluate((el) => el.clientWidth)).toBeLessThanOrEqual(600);
  expect((await theme.boundingBox())!.y).toBeGreaterThan((await themeLabel.boundingBox())!.y);
  await panel.evaluate((el) => { el.scrollTop = 0; });
  await win.screenshot({ path: testInfo.outputPath('settings-narrow.png'), animations: 'disabled' });
  await win.getByRole('link', { name: 'Back to app' }).click();
  await expect(win).toHaveURL(/\/inbox$/);
});

test('Inbox keeps readable titles, report markers, and keyboard selection in both themes', async ({ home }, testInfo) => {
  const dir = join(home, '.zcc', 'inbox');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'entries.jsonl'), ['Design review ready', 'Accessibility checks complete'].map((subject, index) => JSON.stringify({
    id: `ui-review-${index}`,
    ts: Date.now() - index * 60_000,
    projectId: 'ui-demo',
    subject,
    comments: 'The updated settings are ready to review, including light and dark themes.',
    report: true
  })).join('\n') + '\n');
  const app = await launchApp(home);
  try {
    const win = app.window;
    await win.getByRole('link', { name: 'Inbox', exact: false }).first().click();
    const row = win.locator('.inbox-row').filter({ hasText: 'Design review ready' });
    await expect(row).toBeVisible();
    await expect(row.locator('.inbox-row-report-badge')).toHaveText('Report');
    await win.keyboard.press('Tab');
    await row.focus();
    expect(await row.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    await row.press('Enter');
    await expect(row).toHaveClass(/active/);
    await expect(win.locator('.inbox-detail')).toContainText('The updated settings are ready to review');
    for (const theme of ['light', 'dark'] as const) {
      await win.evaluate((value) => window.cc.config.set({ theme: value }), theme);
      await expect(win.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await row.locator('.inbox-row-title').evaluate((el) => getComputedStyle(el).fontSize)).toBe('13px');
      expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await win.screenshot({ path: testInfo.outputPath(`inbox-${theme}.png`), animations: 'disabled' });
    }
  } finally {
    await app.electron.close();
  }
});
