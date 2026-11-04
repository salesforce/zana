import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import type { InstalledPluginRow } from '../apps/server/src/plugins/plugin-store.js';

test('bounds failed watchdog recovery and recovers through the Plugins reload action', async ({ home }) => {
  test.setTimeout(100_000);
  const id = 'watchdog-recovery-fixture';
  const rootDir = join(home, id);
  const pluginsDir = join(home, '.zcc/plugins');
  const bundle = join(home, 'empty-bundle');
  for (const dir of [rootDir, pluginsDir, bundle]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ name: `zcc-plugin-${id}`, version: '1.0.0', type: 'module',
    zcc: { name: 'Watchdog recovery fixture', description: 'Watchdog recovery fixture', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
  const server = join(rootDir, 'server.mjs');
  writeFileSync(server, `export default api => {
    api.rpc.method('ping', () => 'ready');
    api.rpc.method('hang', () => { while (true) {} });
  };`);
  const row: InstalledPluginRow = { id, rootDir, name: 'Watchdog recovery fixture', version: '1.0.0',
    description: 'Watchdog recovery fixture', icon: 'Puzzle', enabled: true, status: 'running', statusDetail: null,
    provenance: 'direct', sourceKind: 'path', source: `path:${rootDir}`, serverEntry: './server.mjs', appEntry: null,
    npmResolvedVersion: null, npmIntegrity: null, gitResolvedCommit: null, catalogMarketplace: null, catalogEntryId: null,
    installedAt: Date.now(), updatedAt: Date.now() };
  writeFileSync(join(pluginsDir, 'installed.json'), JSON.stringify({ version: 1, plugins: [row] }));
  const app = await launchApp(home, { initialConfig: { sponsorPromptDismissed: true }, env: {
    ZCC_BUNDLED_PLUGINS_DIR: bundle, ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD: '0',
    ZCC_OFFICIAL_MARKETPLACE_URL: 'off', ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off',
    ZCC_COMMUNITY_MARKETPLACE_SOURCE: 'off', ZCC_SKIP_PLUGIN_NPM: '1'
  } });
  try {
    const win = app.window;
    const status = () => win.evaluate(async id => (await window.cc.pluginApps.list()).find(row => row.id === id)?.status, id);
    await expect.poll(status, { timeout: 30_000 }).toBe('running');
    expect(await win.evaluate(id => window.cc.pluginApps.callRpc(id, 'ping'), id)).toBe('ready');
    // The live generation wedges; every replacement fails during factory initialization.
    const attempts = join(rootDir, 'attempts.txt');
    writeFileSync(attempts, '');
    writeFileSync(server, `import { appendFileSync } from 'node:fs';
      export default () => { appendFileSync(new URL('./attempts.txt', import.meta.url), 'attempt\\n'); throw Error('Recovery fixture factory failed'); };`);
    const hung = win.evaluate(async id => {
      try { await window.cc.pluginApps.callRpc(id, 'hang'); return null; }
      catch (error) { return String(error); }
    }, id);
    expect(await hung).toContain('Plugin event loop stopped responding');
    const count = () => readFileSync(attempts, 'utf8').trim().split('\n').filter(Boolean).length;
    await expect.poll(count, { timeout: 30_000 }).toBe(3);
    await expect.poll(status).toBe('degraded');
    // Past the next possible retry: failed factories must not create an endless restart loop.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      expect(count()).toBe(3);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await win.getByTestId('nav-extensions').click();
    await win.getByTestId('extensions-nav-installed').click();
    await win.getByRole('searchbox', { name: 'Search installed plugins' }).fill('Watchdog recovery fixture');
    const plugin = win.getByTestId(`plugin-row-${id}`);
    await expect(plugin).toBeVisible();
    await plugin.getByRole('button', { name: 'Watchdog recovery fixture plugin details' }).click();
    const inspector = win.getByRole('region', { name: 'Installed plugin', exact: true });
    await expect(inspector.getByTestId('plugin-health')).toBeVisible();
    writeFileSync(server, `export default api => api.rpc.method('ping', () => 'recovered');`);
    await inspector.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect.poll(status, { timeout: 30_000 }).toBe('running');
    await expect(inspector.getByTestId('plugin-health')).toHaveCount(0);
    expect(await win.evaluate(id => window.cc.pluginApps.callRpc(id, 'ping'), id)).toBe('recovered');
  } finally { await closeApp(app.electron); }
});
