import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';
import type { InstalledPluginRow } from '../apps/server/src/plugins/plugin-store.js';

test('reloads every degraded plugin from one action, reports partial failure, and retries', async ({ home }, testInfo) => {
  test.setTimeout(180_000);
  const pluginsDir = join(home, '.zcc/plugins'); mkdirSync(pluginsDir, { recursive: true });
  const healthyServer = `export default api => { api.rpc.method('ping', () => 'ready'); };`;
  const records: InstalledPluginRow[] = ['bulk-one', 'bulk-two', 'bulk-broken', 'bulk-healthy', 'bulk-disabled'].map(id => {
    const rootDir = join(home, id); mkdirSync(rootDir);
    const enabled = id !== 'bulk-disabled';
    writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ name: `zcc-plugin-${id}`, version: '1.0.0', type: 'module',
      zcc: { name: id, description: 'Bulk reload fixture', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
    writeFileSync(join(rootDir, 'server.mjs'), id === 'bulk-healthy' ? healthyServer : `export default () => { throw Error('Fixture runtime unavailable'); };`);
    return { id, rootDir, name: id, version: '1.0.0', description: 'Bulk reload fixture', icon: 'Puzzle', enabled,
      status: enabled ? 'running' : 'disabled', statusDetail: null, provenance: 'direct', sourceKind: 'path', source: `path:${rootDir}`,
      serverEntry: './server.mjs', appEntry: null, npmResolvedVersion: null, npmIntegrity: null, gitResolvedCommit: null,
      catalogMarketplace: null, catalogEntryId: null, installedAt: Date.now(), updatedAt: Date.now() };
  });
  writeFileSync(join(pluginsDir, 'installed.json'), JSON.stringify({ version: 1, plugins: records }));
  const bundle = join(home, 'empty-bundle'); mkdirSync(bundle);
  const app = await launchApp(home, { initialConfig: { sponsorPromptDismissed: true }, env: {
    ZCC_BUNDLED_PLUGINS_DIR: bundle, ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD: '0',
    ZCC_OFFICIAL_MARKETPLACE_URL: 'off', ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off', ZCC_COMMUNITY_MARKETPLACE_SOURCE: 'off', ZCC_SKIP_PLUGIN_NPM: '1'
  } });
  try {
    const win = app.window;
    const statuses = () => win.evaluate(async () => (await window.cc.pluginApps.list()).map(({ id, status }) => ({ id, status })).sort((a, b) => a.id.localeCompare(b.id)));
    await expect.poll(statuses, { timeout: 40_000 }).toEqual([
      { id: 'bulk-broken', status: 'degraded' }, { id: 'bulk-disabled', status: 'disabled' }, { id: 'bulk-healthy', status: 'running' },
      { id: 'bulk-one', status: 'degraded' }, { id: 'bulk-two', status: 'degraded' }
    ]);
    const untouched = await win.evaluate(async () => (await window.cc.pluginApps.list()).filter(row => ['bulk-healthy', 'bulk-disabled'].includes(row.id)));
    await win.evaluate(() => { history.pushState({}, '', '/extensions/plugins'); dispatchEvent(new PopStateEvent('popstate')); });
    const reload = win.getByRole('button', { name: 'Reload degraded plugins (3)', exact: true });
    await expect(reload).toBeVisible();
    // Search must not limit a host-wide recovery operation.
    await win.getByRole('searchbox', { name: 'Search installed plugins' }).fill('bulk-one');
    for (const id of ['bulk-one', 'bulk-two']) writeFileSync(join(home, id, 'server.mjs'), healthyServer);
    await reload.click();
    await expect(win.getByText('2 plugins reloaded; 1 needs attention.', { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(win.getByText(/bulk-broken:.*Fixture runtime unavailable/)).toBeVisible();
    await expect(win.getByRole('button', { name: 'Reload degraded plugins (1)', exact: true })).toBeVisible();
    expect(await win.evaluate(async () => (await window.cc.pluginApps.list()).filter(row => ['bulk-healthy', 'bulk-disabled'].includes(row.id)))).toEqual(untouched);
    for (const id of ['bulk-one', 'bulk-two']) expect(await win.evaluate(id => window.cc.pluginApps.callRpc(id, 'ping'), id)).toBe('ready');
    await win.setViewportSize({ width: 900, height: 900 });
    expect(await win.locator('.ext-plugin-attention').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await captureElectronScreenshot(app.electron, win, testInfo.outputPath('bulk-reload-partial-failure.png'));
    writeFileSync(join(home, 'bulk-broken/server.mjs'), healthyServer);
    await win.getByRole('button', { name: 'Reload degraded plugins (1)', exact: true }).click();
    await expect(win.getByText('1 plugin reloaded.', { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(win.getByRole('button', { name: /Reload degraded plugins/ })).toHaveCount(0);
    await expect(win.locator('.ext-plugin-attention')).toHaveCount(0);
  } finally { await closeApp(app.electron); }
});
