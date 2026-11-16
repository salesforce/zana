import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test('Plugin detail pages preserve management, settings areas, list state, and narrow-screen navigation', async ({ home }, testInfo) => {
  test.setTimeout(180_000);
  const pluginsDir = join(home, '.zcc', 'plugins');
  mkdirSync(pluginsDir, { recursive: true });
  const records = ['hub-example', 'hub-broken'].map((id) => {
    const rootDir = join(home, id);
    const broken = id === 'hub-broken';
    mkdirSync(rootDir, { recursive: true });
    writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ name: `zcc-plugin-${id}`, version: '1.0.0', type: 'module', engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
      zcc: { name: broken ? 'Hub broken' : 'Hub example', description: broken ? 'Description survives runtime failures' : 'A realistic plugin for managing work', branding: { icon: 'Puzzle' }, server: './server.mjs', ...(!broken ? { app: './app.js' } : {}) } }));
    writeFileSync(join(rootDir, 'server.mjs'), broken ? `export default async api => { throw Error('Fixture runtime unavailable'); };` :
      `export default async api => {
        api.settings.define({name:{type:'string',label:'Display name'},budget:{type:'number',label:'Retry budget'},
          ...Object.fromEntries(Array.from({length:10},(_,i)=>['client'+i,{type:'string',label:'Service '+i+' OAuth client ID',
            description:'Preconfigured for internal single sign-on. Override only for a custom registration. Callback: http://localhost:3000/callback/service-'+i}]))});
        api.rpc.method('ping',()=> 'ready');
      };`);
    if (!broken) writeFileSync(join(rootDir, 'app.js'), `export default {__zccPluginApp:true,setup(app){
      app.slots.settingsSection({id:'connections',title:'Connections & tools',component:()=> 'Connected accounts and tools'});
    }};`);
    return { id, version: '1.0.0', name: broken ? 'Hub broken' : 'Hub example', description: broken ? 'Description survives runtime failures' : 'A realistic plugin for managing work',
      icon: 'Puzzle', enabled: true, status: 'running', statusDetail: null, provenance: 'direct', sourceKind: 'path', source: `path:${rootDir}`, rootDir,
      serverEntry: './server.mjs', appEntry: broken ? null : './app.js', npmResolvedVersion: null, npmIntegrity: null, gitResolvedCommit: null, catalogMarketplace: null, catalogEntryId: null, installedAt: Date.now(), updatedAt: Date.now() };
  });
  writeFileSync(join(pluginsDir, 'installed.json'), JSON.stringify({ version: 1, plugins: records }));
  const handle = await launchApp(home, { initialConfig: { theme: 'light', sponsorPromptDismissed: true }, env: {
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
    const page = win.getByRole('region', { name: 'Installed plugin' });
    await expect(page).toBeVisible();
    await expect(row).toBeHidden();
    await page.getByRole('link', { name: 'Settings →' }).click();
    await expect(win).toHaveURL(/\/settings\/plugins\/hub-example$/);
    const settings = win.locator('.settings-panel--plugin');
    const areas = settings.getByRole('navigation', { name: 'Plugin settings areas' });
    await expect(win.getByTestId('settings-plugin-hub-example')).toHaveAttribute('aria-current', 'page');
    await expect(win.getByTestId('settings-plugin-hub-broken')).toHaveCount(0);
    await expect(settings.getByText('Connected accounts and tools')).toBeVisible();
    await expect(settings.getByRole('textbox', { name: 'Display name' })).toBeHidden();
    await areas.getByRole('button', { name: 'Configuration', exact: true }).click();
    await expect(settings.getByText('Connected accounts and tools')).toBeHidden();
    const fieldRow = settings.locator('[data-plugin-setting-key="client0"]');
    expect((await fieldRow.locator('.plugin-setting-desc').boundingBox())!.height).toBeLessThan(100);
    await settings.getByRole('spinbutton', { name: 'Retry budget' }).fill('7');
    await settings.getByRole('textbox', { name: 'Display name' }).fill('Saved through the page');
    await settings.getByRole('link', { name: 'Plugin details' }).click();
    await expect(page).toBeVisible();
    await expect.poll(() => win.evaluate(() => window.cc.pluginApps.getSettings('hub-example').then(snap => snap.values.name))).toBe('Saved through the page');
    await expect.poll(() => win.evaluate(() => window.cc.pluginApps.getSettings('hub-example').then(snap => snap.values.budget))).toBe(7);
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect.poll(() => win.evaluate(() => window.cc.pluginApps.callRpc('hub-example', 'ping'))).toBe('ready');
    await page.getByRole('button', { name: 'Back to Plugins' }).click();
    await row.getByRole('switch').click();
    await expect(row.getByRole('switch')).not.toBeChecked();
    await expect(row).toContainText('Disabled');
    await row.getByRole('switch').click();
    await expect(row.getByRole('switch')).toBeChecked();
    await expect(row).toContainText('Running');
    await win.locator('.ext-plugin-collection-main').evaluate(el => { el.scrollTop = 0; });
    await captureElectronScreenshot(handle.electron, win, testInfo.outputPath('plugins-installed.png'));
    await row.getByRole('button', { name: 'Hub example plugin details' }).click();
    await expect(page).toBeVisible();
    await expect(row).toBeHidden();
    const pageBox = (await page.boundingBox())!;
    const hubBox = (await win.locator('.ext-hub-shell').boundingBox())!;
    expect(pageBox.width).toBeGreaterThan(hubBox.width * .9);
    await navigate('/extensions/plugins/hub-example?view=installed&setting=client9#plugin-configure');
    await expect(win).toHaveURL(/\/settings\/plugins\/hub-example\?setting=client9&area=configuration#plugin-configure$/);
    await expect(settings.locator('[data-plugin-setting-key="client9"]')).toHaveClass(/settings-search-flash/);
    await expect(settings.getByRole('textbox', { name: 'Service 9 OAuth client ID' })).toBeFocused();
    await captureElectronScreenshot(handle.electron, win, testInfo.outputPath('plugin-settings-wide.png'));
    for (const width of [1100, 900]) {
      await win.setViewportSize({ width, height: 900 });
      await expect(settings).toBeVisible();
      expect(await settings.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await captureElectronScreenshot(handle.electron, win, testInfo.outputPath(`plugin-settings-${width}.png`));
    }
    await navigate('/extensions/plugins/hub-example?view=installed&setup=connect#plugin-configure');
    await expect(win).toHaveURL(/setup=connect&area=plugin#plugin-configure$/);
    await expect(settings.getByText('Connected accounts and tools')).toBeVisible();
    // The browser transport and phone drawer use the same selected-plugin page.
    const reservation = createServer();
    await new Promise<void>(done => reservation.listen(0, '127.0.0.1', done));
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>(done => reservation.close(() => done()));
    const serverUrl = `http://127.0.0.1:${port}`;
    const gateway = await startMobileGateway({ upstream: new URL(win.url()).origin, publicUrl: serverUrl, port });
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const pair = await context.request.post(`${serverUrl}/_mobile/pair`, { data: { code: gateway.pair().code, label: 'Plugin settings test' } });
      const credential = await pair.json();
      expect((await context.request.post(`${serverUrl}/_mobile/session`, { headers: { authorization: `Bearer ${credential.credential}` } })).ok()).toBe(true);
      const phone = await context.newPage();
      await phone.goto(`${serverUrl}/settings/plugins/hub-example?area=configuration`);
      const phoneSettings = phone.locator('.settings-panel--plugin');
      await expect(phoneSettings.getByRole('spinbutton', { name: 'Retry budget' })).toHaveValue('7');
      await phoneSettings.getByRole('spinbutton', { name: 'Retry budget' }).fill('8');
      await phoneSettings.getByRole('heading', { name: 'Hub example', exact: true }).click();
      await expect.poll(() => phone.evaluate(() => fetch('/api/v1/plugin-apps/hub-example/settings').then(response => response.json()).then(snap => snap.values.budget))).toBe(8);
      expect(await phoneSettings.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await phone.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
      const drawer = phone.getByRole('dialog', { name: 'Navigation', exact: true });
      await drawer.getByTestId('settings-plugin-hub-example').click();
      await expect(drawer).toBeHidden();
      await expect(phoneSettings.getByText('Connected accounts and tools')).toBeVisible();
      await phone.screenshot({ path: testInfo.outputPath('plugin-settings-phone.png') });
    } finally { await browser.close(); await gateway.close(); }
    await settings.getByRole('link', { name: 'Plugin details' }).click();
    await page.getByRole('button', { name: 'Back to Plugins' }).click();
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
    const grid = win.getByTestId('plugin-browse-grid').first();
    const market = win.locator('.ext-market');
    await expect(card.locator('.ext-browse-card-footer .ext-browse-provenance')).toHaveText('Official');
    await expect(card.locator('.ext-browse-card-footer').getByRole('button', { name: 'Install', exact: true })).not.toHaveClass(/primary/);
    if (available!.category) await expect(card.locator('.ext-browse-card-body .ext-browse-card-category')).toHaveText(available!.category!);
    for (const width of [1640, 1100, 900]) {
      await win.setViewportSize({ width, height: 1000 });
      // Chromium can report subpixel rounding just above the CSS max-width.
      await expect.poll(async () => (await market.boundingBox())!.width).toBeLessThan(1201);
      const metrics = await card.evaluate(el => {
        const footer = el.querySelector('.ext-browse-card-footer')!;
        const action = footer.querySelector('.ext-market-item-action')!;
        const description = el.querySelector('.ext-market-item-desc');
        const opener = el.querySelector('.ext-browse-card-open')!;
        return {
          width: el.getBoundingClientRect().width,
          footerBorder: getComputedStyle(footer).borderTopWidth,
          rightGap: footer.getBoundingClientRect().right - action.getBoundingClientRect().right,
          descriptionAligned: !description || Math.abs(description.getBoundingClientRect().left - opener.getBoundingClientRect().left) < 1,
          overflow: el.scrollWidth > el.clientWidth
        };
      });
      expect(Number.parseFloat(metrics.footerBorder)).toBeGreaterThan(0);
      expect(Math.abs(metrics.rightGap)).toBeLessThan(1);
      expect(metrics.descriptionAligned).toBe(true);
      expect(metrics.overflow).toBe(false);
      expect(await market.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      if (width === 1640) {
        expect(metrics.width).toBeLessThan(430);
        expect(await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(3);
      }
      await captureElectronScreenshot(handle.electron, win, testInfo.outputPath(`plugins-compact-${width}.png`));
    }
    await win.evaluate(() => window.cc.config.set({ theme: 'dark' }));
    await expect(win.locator('html')).toHaveAttribute('data-theme', 'dark');
    // The theme attribute changes before the card's background transition finishes.
    await expect(card).toHaveCSS('background-color', 'rgb(30, 30, 30)');
    await expect(card.locator('.ext-browse-card-footer')).toBeVisible();
    await captureElectronScreenshot(handle.electron, win, testInfo.outputPath('plugins-compact-dark.png'));
    await win.evaluate(() => window.cc.config.set({ theme: 'light' }));
    await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await win.setViewportSize({ width: 1640, height: 1000 });
    // Filtering down to one result retains card proportions rather than stretching it.
    await win.getByLabel('Search plugins', { exact: true }).fill(available!.title);
    await expect(card).toBeVisible();
    expect((await card.boundingBox())!.width).toBeLessThan(430);
    await win.getByLabel('Search plugins', { exact: true }).fill('');
    await card.getByRole('button', { name: `${available!.title} plugin details` }).click();
    await expect(win.getByRole('region', { name: 'Marketplace plugin' })).toBeVisible();
    await expect(card).toBeHidden();
    await win.getByRole('button', { name: 'Back to Plugins' }).click();
    await card.getByRole('button', { name: 'Install', exact: true }).click();
    await win.getByRole('button', { name: 'Install with full trust' }).click();
    await expect(win.getByRole('region', { name: 'Installed plugin' })).toBeVisible();
    await win.getByRole('button', { name: 'Back to Plugins' }).click();
    await row.getByRole('button', { name: 'Hub example plugin details' }).click();
    await page.getByRole('tab', { name: 'Installation' }).click();
    await page.getByRole('button', { name: 'Uninstall', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm remove' }).click();
    await expect(row).toHaveCount(0);
    await expect(page).toHaveCount(0);
    expect(await win.evaluate(async () => (await window.cc.pluginApps.list()).some(row => row.id === 'hub-example'))).toBe(false);
    await navigate('/settings/plugins/hub-example');
    await expect(settings.getByText('This plugin is no longer installed.')).toBeVisible();
    await expect(win.getByTestId('settings-plugin-hub-example')).toHaveCount(0);
  } finally { await closeApp(handle.electron); }
});
