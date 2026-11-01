import { test, expect } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test.use({ initialConfig: { theme: 'light', sponsorPromptDismissed: true } });

test('brand logos load in installed rows, detail pages and offline Browse in both themes', async ({ app }, testInfo) => {
  test.setTimeout(180_000);
  const win = app.window;
  const navigate = (path: string) => win.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
  const expectImage = async (image: ReturnType<typeof win.locator>) => {
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  };
  await navigate('/extensions/plugins');
  const collection = win.locator('.ext-installed-collection');
  const codingAgents = collection.getByRole('button', { name: /^Coding agents/ });
  await codingAgents.click();
  for (const id of ['slack-bridge-2ff2', 'harness-claude', 'harness-codex', 'provider-claude-code', 'provider-codex']) {
    await expectImage(win.getByTestId(`plugin-row-${id}`).locator('img.plugin-brand-icon'));
  }
  const codex = win.getByTestId('plugin-row-provider-codex');
  for (const theme of ['dark', 'light'] as const) {
    await win.evaluate(theme => window.cc.config.set({ theme }), theme);
    await expect(win.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await codex.locator('.ext-installed-icon').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
    await codex.scrollIntoViewIfNeeded();
    await captureElectronScreenshot(app.electron, win, testInfo.outputPath(`plugin-brands-${theme}.png`));
  }
  await codex.getByRole('button', { name: /plugin details/ }).click();
  await expectImage(win.locator('.ext-hub-about-icon-wrap img.plugin-brand-icon'));
  await win.getByRole('button', { name: 'Back to Plugins' }).click();
  await win.evaluate(() => window.cc.pluginApps.setEnabled('harness-codex', false));
  const disabled = win.getByTestId('plugin-row-harness-codex').locator('img.plugin-brand-icon');
  await expectImage(disabled);
  expect(await disabled.evaluate(async (img: HTMLImageElement) => (await fetch(img.src)).status)).toBe(200);
  await win.getByRole('navigation', { name: 'Plugin collections' }).getByRole('button', { name: 'Browse', exact: true }).click();
  await expectImage(win.getByTestId('plugin-card-github').locator('img.plugin-brand-icon'));
  const card = win.getByTestId('plugin-card-provider-codex');
  await expectImage(card.locator('img.plugin-brand-icon'));
  await expect(card.locator('img')).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);
  await win.getByTestId('plugin-card-github').getByRole('button', { name: /plugin details/ }).click();
  await expectImage(win.locator('.ext-catalog-detail-logo img.plugin-brand-icon'));
});

test('installed plugin rows support search, grouping, status changes and details in built Electron', async ({ app }, testInfo) => {
  const win = app.window;
  const browserWindow = await app.electron.browserWindow(win);
  await browserWindow.evaluate((window) => window.setContentSize(1440, 900));
  await win.locator('.nav-item').filter({ hasText: 'Plugins' }).first().click();
  await win.getByTestId('extensions-nav-installed').click();
  const collection = win.locator('.ext-installed-collection');
  await expect(collection).toBeVisible();
  const cards = collection.locator('.ext-installed-panel').first();
  await expect(cards.locator('.ext-installed-row').first()).toBeVisible();
  const recording = !!process.env.ZCC_E2E_RECORD_VIDEO;
  const pause = async () => { if (recording) await win.waitForTimeout(1200); };
  await pause();
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('plugins-rows.png'));

  const snapshot = await win.evaluate(() => window.cc.pluginApps.list());
  const agents = snapshot.filter((plugin) => plugin.collection === 'coding-agents');
  expect(agents.length).toBeGreaterThan(0);
  const toggleGroup = collection.getByRole('button', { name: /^Coding agents/ });
  await expect(toggleGroup).toHaveAttribute('aria-expanded', 'false');
  await toggleGroup.scrollIntoViewIfNeeded();
  await toggleGroup.click();
  const agentCards = collection.getByRole('list', { name: 'Installed coding agents' });
  await expect(agentCards).toBeVisible();
  // Providers register asynchronously; compare the live catalogue with the UI.
  await expect.poll(async () => {
    const expected = await win.evaluate(async () => (await window.cc.pluginApps.list())
      .filter(plugin => plugin.collection === 'coding-agents').map(plugin => `plugin-row-${plugin.id}`));
    const actual = await agentCards.locator('.ext-installed-row').evaluateAll(rows => rows.map(row => row.getAttribute('data-testid')));
    return { missing: expected.filter(id => !actual.includes(id)), unexpected: actual.filter(id => !expected.includes(id!)) };
  }).toEqual({ missing: [], unexpected: [] });
  await pause();

  const search = win.getByLabel('Search installed plugins');
  await search.fill(agents[0]!.name);
  await expect(win.getByTestId(`plugin-row-${agents[0]!.id}`)).toBeVisible();
  await expect(toggleGroup).toHaveAttribute('aria-expanded', 'true');
  await pause();
  await search.fill('a-plugin-that-is-not-installed');
  await expect(collection.getByRole('status')).toContainText('No plugins match');
  await search.fill('');

  // Toggle an ordinary tool through IPC and verify the server-owned state.
  const ordinary = snapshot.find((plugin) => !plugin.collection && plugin.enabled)!;
  expect(ordinary).toBeTruthy();
  await search.fill(ordinary.name);
  const toolCard = win.getByTestId(`plugin-row-${ordinary.id}`);
  await expect(toolCard).toBeVisible();
  await toolCard.getByRole('switch').click();
  await expect.poll(async () => (await win.evaluate(() => window.cc.pluginApps.list())).find((p) => p.id === ordinary.id)?.enabled).toBe(false);
  const statusFilters = collection.getByRole('group', { name: 'Filter by status' });
  await statusFilters.getByRole('button', { name: 'Disabled', exact: true }).click();
  await expect(toolCard.getByRole('switch')).not.toBeChecked();
  await pause();
  await toolCard.getByRole('switch').click();
  await expect.poll(async () => (await win.evaluate(() => window.cc.pluginApps.list())).find((p) => p.id === ordinary.id)?.enabled).toBe(true);
  await statusFilters.getByRole('button', { name: 'All', exact: true }).click();
  await toolCard.getByRole('button', { name: `${ordinary.name} plugin details` }).click();
  await expect(win.getByRole('region', { name: 'Installed plugin' })).toBeVisible();
  await expect(toolCard).toBeHidden();
  await expect(win.locator('.ext-hub-about-titles')).toContainText(ordinary.name);
  await pause();
  await win.getByRole('button', { name: 'Back to Plugins' }).click();
  await expect(collection).toBeVisible();

  await collection.getByRole('navigation', { name: 'Plugin collections' }).getByRole('button', { name: /^Updates/ }).click();
  await expect(collection.getByRole('status')).toContainText('Check for updates');
  await pause();
  await collection.getByRole('navigation', { name: 'Plugin collections' }).getByRole('button', { name: /^Installed/ }).click();
  await collection.getByRole('button', { name: 'Add plugin' }).click();
  await expect(win.getByRole('menuitem', { name: 'Create a plugin', exact: true })).toBeVisible();
  await expect(win.getByRole('menuitem', { name: 'Install from folder' })).toBeVisible();
  await expect(win.getByRole('menuitem', { name: 'Install from repository' })).toBeVisible();
  await pause();
  await win.keyboard.press('Escape');
  await expect(win.getByRole('menu', { name: 'Add a plugin' })).toBeHidden();
  await expect(collection.getByRole('button', { name: 'Add plugin' })).toBeFocused();
  await captureElectronScreenshot(app.electron, win, testInfo.outputPath('plugins-rows-final.png'));
  await pause();
});

test('installed rows adapt their metadata columns to content width in light and dark themes', async ({ app }) => {
  const win = app.window;
  const browserWindow = await app.electron.browserWindow(win);
  // Exercise widths below the desktop's normal minimum, also used by remote views.
  await browserWindow.evaluate((window) => {
    window.setMinimumSize(600, 600);
    window.setContentSize(1440, 900);
  });
  await win.locator('.nav-item').filter({ hasText: 'Plugins' }).first().click();
  await win.getByTestId('extensions-nav-installed').click();
  const grid = win.locator('.ext-installed-collection .ext-installed-panel').first();
  await expect(grid).toBeVisible();
  const firstRow = grid.locator('.ext-installed-row').first();
  const columns = () => firstRow.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  await expect.poll(columns).toBe(6);
  await expect(firstRow.locator('.ext-plugin-capabilities')).toBeVisible();
  await expect(firstRow.locator('.ext-installed-source')).toBeVisible();
  await browserWindow.evaluate((window) => window.setContentSize(1000, 900));
  await expect.poll(columns).toBe(5);
  await expect(firstRow.locator('.ext-plugin-capabilities')).toBeHidden();
  await expect(firstRow.locator('.ext-installed-source')).toBeVisible();
  await browserWindow.evaluate((window) => window.setContentSize(700, 900));
  await expect.poll(columns).toBe(3);
  await expect(firstRow.locator('.ext-installed-source')).toBeHidden();
  expect(await win.locator('.ext-installed-collection').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await win.evaluate(() => window.cc.config.set({ theme: 'dark' }));
  await expect(win.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(grid.locator('.ext-installed-row').first()).toBeVisible();
});
