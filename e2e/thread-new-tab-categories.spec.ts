import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect } from './fixtures/app.js';
import { createPluginStore, pluginStorePath } from '../apps/server/src/plugins/plugin-store.js';

const test = base.extend({
  launchEnv: async ({ home }, use) => {
    const source = join(home, 'launcher-plugin');
    mkdirSync(source);
    writeFileSync(join(source, 'package.json'), JSON.stringify({
      name: '@zcc-ext/launcher-fixture', version: '0.1.0', type: 'module',
      engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
      zcc: { name: 'Example tools', description: 'Launcher category fixture', app: './app.js' }
    }));
    writeFileSync(join(source, 'app.js'), `export default {
      __zccPluginApp: true,
      setup(app) {
        const component = () => globalThis.__ZCC_HOST_REACT__.createElement('p', { 'data-testid': 'launcher-fixture-panel' }, 'Opened from a category');
        for (let i = 1; i <= 7; i++) app.slots.threadPanelAction({ id: 'tool-' + i, title: 'Tool ' + i, icon: 'Database', component });
        app.slots.threadPanelAction({ id: 'report', title: 'Report', category: 'Documents', component });
        app.slots.experimental_newThreadPanelAction({ id: 'draft', title: 'Draft document', category: 'Documents', component });
      }
    };`);
    // Seed an installed renderer-only plugin before boot. Electron still loads
    // its real manifest and serves/imports the app through the product snapshot.
    await createPluginStore({ file: pluginStorePath(join(home, '.zcc')) }).upsert({
      id: 'launcher-fixture', version: '0.1.0', name: 'Example tools', description: 'Launcher category fixture',
      icon: 'Puzzle', enabled: true, status: 'disabled', statusDetail: null,
      provenance: 'direct', sourceKind: 'path', source: source, rootDir: source,
      serverEntry: null, appEntry: './app.js', npmResolvedVersion: null, npmIntegrity: null,
      gitResolvedCommit: null, catalogMarketplace: null, catalogEntryId: null,
      installedAt: Date.now(), updatedAt: Date.now()
    });
    await use({});
  }
});

test('New Tab groups installed plugin tools, searches collapsed categories, and opens a panel', async ({ app }, testInfo) => {
  const { window } = app;
  await window.evaluate(() => {
    window.history.pushState({}, '', '/threads/e2e-launcher-categories');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await window.getByTestId('thread-secondary-show').click();
  await window.getByTestId('thread-secondary-new-tab').click();
  const launcher = window.getByTestId('thread-new-tab-page');
  const example = launcher.getByRole('region', { name: 'Example tools' });
  await expect(example).toBeVisible({ timeout: 30_000 });
  await expect(launcher.getByRole('region', { name: 'Essentials' })).toBeVisible();
  await expect(launcher.getByRole('region', { name: 'Documents' }).getByRole('button', { name: 'Documents 2' })).toBeVisible();
  const toggle = example.getByRole('button', { name: 'Example tools 7' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(example.getByRole('button', { name: 'Tool 7', exact: true })).toBeVisible();
  await toggle.focus();
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(example.getByRole('button', { name: 'Tool 7', exact: true })).toBeHidden();
  const search = launcher.getByRole('searchbox', { name: 'Search tools and files' });
  await search.fill('example 7');
  await expect(example.getByRole('button', { name: 'Tool 7', exact: true })).toBeVisible();
  await expect(example.getByRole('button', { name: 'Tool 1', exact: true })).toHaveCount(0);
  await expect(launcher.getByRole('region', { name: 'Documents' })).toHaveCount(0);
  await search.fill('');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await window.screenshot({ path: testInfo.outputPath('new-tab-categories.png') });
  await search.fill('documents');
  await expect(launcher.getByRole('button', { name: 'Report', exact: true })).toBeVisible();
  await expect(launcher.getByRole('button', { name: 'Draft document', exact: true })).toBeVisible();
  await launcher.getByRole('button', { name: 'Report', exact: true }).click();
  await expect(window.getByTestId('launcher-fixture-panel')).toHaveText('Opened from a category');
  await window.getByTestId('thread-secondary-new-tab').click();
  await expect(window.getByTestId('thread-new-tab-recents')).toContainText('Report');
  await launcher.getByRole('searchbox').fill('no-matching-tool');
  await expect(launcher.getByRole('status')).toHaveText('No matching tools or files');
});
