import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';

test('upgrades remove enabled PostHog before activation and never reinstall it', async ({ home }) => {
  const pluginId = 'posthog-analytics';
  const plugins = join(home, '.zcc/plugins');
  const existing = join(plugins, pluginId);
  const bundle = join(home, 'old-bundle');
  const marker = join(home, 'posthog-started');
  const pkg = {
    name: '@zcc-ext/posthog-analytics', version: '0.1.0', type: 'module',
    zcc: { name: 'PostHog Analytics', description: 'Old analytics fixture', branding: { icon: 'LineChart' }, server: './server.mjs' }
  };
  for (const dir of [existing, join(bundle, pluginId)]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
    writeFileSync(join(dir, 'server.mjs'), `import { writeFileSync } from 'node:fs';
export default () => writeFileSync(${JSON.stringify(marker)}, 'started');\n`);
  }
  writeFileSync(join(existing, 'settings.json'), JSON.stringify({ enabled: true, apiKey: 'phc_old_saved_key' }));
  mkdirSync(join(existing, 'secrets'));
  writeFileSync(join(existing, 'secrets/apiKey.txt'), 'phc_old_saved_key', { mode: 0o600 });
  writeFileSync(join(plugins, 'installed.json'), JSON.stringify({ version: 1, plugins: [{
    id: pluginId, version: '0.1.0', name: 'PostHog Analytics', description: 'Old analytics fixture', icon: 'LineChart',
    rootDir: join(bundle, pluginId), enabled: true, status: 'running', statusDetail: null,
    provenance: 'builtin', sourceKind: 'builtin', source: `builtin:${pluginId}`,
    serverEntry: './server.mjs', appEntry: null, installedAt: 1, updatedAt: 1,
    npmResolvedVersion: null, npmIntegrity: null, gitResolvedCommit: null, catalogMarketplace: null, catalogEntryId: null
  }] }));
  const options = {
    initialConfig: { sponsorPromptDismissed: true },
    env: { ZCC_BUNDLED_PLUGINS_DIR: bundle, ZCC_POSTHOG_API_KEY: 'phc_old_release_key',
      ZCC_OFFICIAL_MARKETPLACE_URL: 'off', ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off', ZCC_COMMUNITY_MARKETPLACE_SOURCE: 'off' }
  };
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    for (let boot = 0; boot < 2; boot++) {
      app = await launchApp(home, options);
      const win = app.window;
      await expect.poll(() => win.evaluate(async () =>
        (await window.cc.pluginApps.list()).map(row => row.id))).not.toContain(pluginId);
      const catalog = await win.evaluate(() => window.cc.extensions.marketplaceList());
      if (!catalog.ok) throw new Error(catalog.message);
      expect(catalog.value.map(row => row.id)).not.toContain(pluginId);
      await win.getByTestId('nav-extensions').click();
      await win.getByTestId('extensions-nav-installed').click();
      await expect(win.getByTestId(`plugin-row-${pluginId}`)).toHaveCount(0);
      expect(existsSync(existing)).toBe(false);
      expect(existsSync(marker)).toBe(false);
      await closeApp(app.electron);
      app = undefined;
    }
  } finally {
    if (app) await closeApp(app.electron);
  }
});
