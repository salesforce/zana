import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test('Plugins workbench preserves live management, discovery, and narrow-screen navigation', async ({ home }, testInfo) => {
  test.setTimeout(180_000);
  const pluginsDir = join(home, '.zcc', 'plugins');
  mkdirSync(pluginsDir, { recursive: true });
  const records = ['hub-example', 'hub-broken'].map((id) => {
    const rootDir = join(home, id);
    const broken = id === 'hub-broken';
    mkdirSync(rootDir, { recursive: true });
    writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ name: `zcc-plugin-${id}`, version: '1.0.0', type: 'module', engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
      zcc: { name: broken ? 'Hub broken' : 'Hub example', description: broken ? 'Description survives runtime failures' : 'A realistic plugin for managing work', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
    writeFileSync(join(rootDir, 'server.mjs'), broken ? `export default async api => { throw Error('Fixture runtime unavailable'); };` :
      `export default async api => { api.settings.define({name:{type:'string',label:'Display name'}}); api.rpc.method('ping',()=> 'ready'); };`);
    return { id, version: '1.0.0', name: broken ? 'Hub broken' : 'Hub example', description: broken ? 'Description survives runtime failures' : 'A realistic plugin for managing work',
      icon: 'Puzzle', enabled: true, status: 'running', statusDetail: null, provenance: 'direct', sourceKind: 'path', source: `path:${rootDir}`, rootDir,
      serverEntry: './server.mjs', appEntry: null, npmResolvedVersion: null, npmIntegrity: null, gitResolvedCommit: null, catalogMarketplace: null, catalogEntryId: null, installedAt: Date.now(), updatedAt: Date.now() };
  });
  writeFileSync(join(pluginsDir, 'installed.json'), JSON.stringify({ version: 1, plugins: records }));
  const handle = await launchApp(home, { initialConfig: { sponsorPromptDismissed: true }, env: {
    ZCC_OFFICIAL_MARKETPLACE_URL: 'off', ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off', ZCC_COMMUNITY_MARKETPLACE_SOURCE: 'off', ZCC_SKIP_PLUGIN_NPM: '1'
  } });
  const win = handle.window;
  const navigate = (path: string) => win.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
  try {
    await win.setViewportSize({ width: 1640, height: 1000 });
    await expect.poll(() => win.evaluate(async () => (await window.cc.pluginApps.list()).find(row => row.id === 'hub-example')), { timeout: 40_000 }).toMatchObject({ status: 'running' });
    await navigate('/extensions/plugins');
    const row = win.getByTestId('plugin-row-hub-example');
    await expect(row).toBeVisible();
    await expect(win.getByTestId('plugin-row-hub-broken')).toContainText('Description survives runtime failures');
    await win.getByRole('button', { name: /^Review \d+/ }).click();
    await expect(row).toHaveCount(0);
    await win.getByRole('button', { name: 'Show all', exact: true }).click();
    await row.getByRole('button', { name: 'Hub example plugin details' }).click();
    const inspector = win.getByRole('complementary', { name: 'Installed plugin' });
    await expect(inspector).toBeVisible();
    await expect(row).toBeVisible();
    await inspector.getByRole('tab', { name: 'Settings', exact: true }).click();
    await inspector.getByRole('textbox', { name: 'Display name' }).fill('Saved through the inspector');
    await inspector.getByRole('tab', { name: 'Overview', exact: true }).click();
    await expect.poll(() => win.evaluate(() => window.cc.pluginApps.getSettings('hub-example').then(snap => snap.values.name))).toBe('Saved through the inspector');
    await inspector.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect.poll(() => win.evaluate(() => window.cc.pluginApps.callRpc('hub-example', 'ping'))).toBe('ready');
    await inspector.getByRole('button', { name: 'Close plugin details' }).click();
    await row.getByRole('switch').click();
    await expect(row.getByRole('switch')).not.toBeChecked();
    await expect(row).toContainText('Disabled');
    await row.getByRole('switch').click();
    await expect(row.getByRole('switch')).toBeChecked();
    await expect(row).toContainText('Running');
    await win.locator('.ext-plugin-collection-main').evaluate(el => { el.scrollTop = 0; });
    await captureElectronScreenshot(handle.electron, win, testInfo.outputPath('plugins-installed.png'));
    await row.getByRole('button', { name: 'Hub example plugin details' }).click();
    await expect(inspector).toBeVisible();
    await expect(row).toBeVisible();
    await captureElectronScreenshot(handle.electron, win, testInfo.outputPath('plugins-inspector-wide.png'));
    // The native window has a 900px minimum width; exercise the supported desktop range.
    for (const width of [1100, 900]) {
      await win.setViewportSize({ width, height: 900 });
      await expect(inspector).toBeVisible();
      expect(await win.locator('.extensions-panel').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await inspector.locator('.ext-plugin-inspector-body').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await expect(inspector.getByRole('heading', { name: 'Hub example', exact: true })).toHaveCSS('text-transform', 'none');
      await captureElectronScreenshot(handle.electron, win, testInfo.outputPath(`plugins-inspector-${width}.png`));
    }
    await inspector.getByRole('button', { name: 'Close plugin details' }).click();
    await expect(row).toBeVisible();
    await win.setViewportSize({ width: 1640, height: 1000 });
    await win.getByRole('navigation', { name: 'Plugin collections' }).getByRole('button', { name: 'Browse', exact: true }).click();
    await expect(win.getByRole('heading', { name: 'Available to install' })).toBeVisible();
    await captureElectronScreenshot(handle.electron, win, testInfo.outputPath('plugins-browse.png'));
    const available = await win.evaluate(async () => {
      const result = await window.cc.extensions.marketplaceList();
      return result.ok ? result.value.find(row => row.source === 'bundled' && !row.installed && row.compatible) : undefined;
    });
    expect(available).toBeTruthy();
    const card = win.getByTestId(`plugin-card-${available!.id}`);
    await card.getByRole('button', { name: `${available!.title} plugin details` }).click();
    await expect(win.getByRole('complementary', { name: 'Marketplace plugin' })).toBeVisible();
    await expect(card).toBeVisible();
    await win.getByRole('button', { name: 'Close plugin details' }).click();
    await card.getByRole('button', { name: 'Install', exact: true }).click();
    await win.getByRole('button', { name: 'Install with full trust' }).click();
    await expect(win.getByRole('complementary', { name: 'Installed plugin' })).toBeVisible();
    await win.getByRole('button', { name: 'Close plugin details' }).click();
    await row.getByRole('button', { name: 'Hub example plugin details' }).click();
    await inspector.getByRole('tab', { name: 'Installation' }).click();
    await inspector.getByRole('button', { name: 'Uninstall', exact: true }).click();
    await inspector.getByRole('button', { name: 'Confirm remove' }).click();
    await expect(row).toHaveCount(0);
    await expect(inspector).toHaveCount(0);
    expect(await win.evaluate(async () => (await window.cc.pluginApps.list()).some(row => row.id === 'hub-example'))).toBe(false);
  } finally { await closeApp(handle.electron); }
});
