import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/app.js';
import { preparePluginRuntime } from '../packages/plugin-build/src/prepare-plugin-runtime.js';

const id = 'slack-bridge-2ff2';
test.use({
  initialConfig: { sponsorPromptDismissed: true },
  launchEnv: async ({ home }, use) => {
    const root = join(home, 'packaged-plugins');
    const sourceRoot = process.env.ZCC_E2E_APP_ROOT ?? fileURLToPath(new URL('../', import.meta.url));
    await preparePluginRuntime(join(sourceRoot, 'plugins', id), join(root, id), '2.3.1');
    const pkg = JSON.parse(readFileSync(join(root, id, 'package.json'), 'utf8'));
    expect(pkg.zcc.server).toBe('./server.mjs');
    expect(pkg.zcc.app).toBe('./app.js');
    expect(pkg.dependencies).toBeUndefined();
    for (const asset of ['src/capability-catalog.json', 'assets/mermaid.min.js', 'skills/slack-bridge-2ff2/SKILL.md']) {
      expect(existsSync(join(root, id, asset)), asset).toBe(true);
    }
    expect(existsSync(join(root, id, 'server.ts'))).toBe(false);
    expect(existsSync(join(root, id, 'node_modules'))).toBe(false);
    await use({ ZCC_BUNDLED_PLUGINS_DIR: root, ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD: '0', NODE_PATH: '' });
  }
});

test('Slack is pre-installed and its compiled Configuration works without a source checkout', async ({ app }) => {
  const win = app.window;
  const row = () => win.evaluate(async id => (await window.cc.pluginApps.list()).find(p => p.id === id), id);
  await expect.poll(row).toMatchObject({ id, enabled: true, status: 'running', sourceKind: 'builtin' });
  const snapshot = () => win.evaluate(id => window.cc.pluginApps.callRpc(id, 'snapshot', {}), id) as Promise<any>;
  expect(await snapshot()).toMatchObject({ connection: 'Disconnected', config: { enabled: false, routes: [] }, reportInboxReady: true });
  expect((await snapshot()).config.inboxEnabled).not.toBe(true);
  expect((await snapshot()).config.richResultsEnabled).not.toBe(true);
  await win.getByTestId('nav-extensions').click();
  await win.getByTestId('extensions-nav-installed').click();
  await win.getByTestId(`plugin-row-${id}`).getByRole('button', { name: 'Zana for Slack plugin details' }).click();
  await win.getByRole('complementary', { name: 'Installed plugin' }).getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(win.getByRole('heading', { name: 'Configuration', exact: true })).toBeVisible();
  await expect(win.getByRole('heading', { name: 'Connect your Slack account' })).toBeVisible();
  await expect(win.getByLabel('Activation code', { exact: true })).toBeVisible();
  // Optional sharing controls appear after account linking; no report access is granted by installation.
  await expect(win.getByLabel('Read report inbox')).toHaveCount(0);
  await win.getByText('Diagnostics · Requests and delivery', { exact: true }).click();
  await expect(win.getByText('No requests received yet.', { exact: true })).toBeVisible();
  await win.evaluate(id => window.cc.pluginApps.callRpc(id, 'setSurface', { surface: 'inboxEnabled', enabled: true }), id);
  expect((await snapshot()).config.inboxEnabled).toBe(true);
  expect(await win.evaluate(id => window.cc.pluginApps.reload(id), id)).toEqual({ ok: true, value: true });
  await expect.poll(row).toMatchObject({ enabled: true, status: 'running' });
  await expect.poll(async () => (await snapshot()).config.inboxEnabled).toBe(true);
  // Reload must preserve the local opt-in while leaving Slack disconnected.
  expect((await snapshot()).config.enabled).toBe(false);
});
