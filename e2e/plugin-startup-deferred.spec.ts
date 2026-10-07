import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, launchApp } from './fixtures/app.js';

test('desktop becomes ready before a stalled plugin activates, then receives its app', async ({ home }) => {
  test.setTimeout(90_000);
  const pluginId = 'deferred-startup';
  const pluginDir = join(home, pluginId);
  const pluginsDir = join(home, '.zcc', 'plugins');
  mkdirSync(pluginDir, { recursive: true });
  mkdirSync(pluginsDir, { recursive: true });
  writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({
    name: `zcc-plugin-${pluginId}`,
    version: '0.1.0',
    type: 'module',
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: { name: 'Deferred startup', description: 'E2E delayed activation fixture', branding: { icon: 'Puzzle' }, app: './app.tsx' }
  }));
  writeFileSync(join(pluginDir, 'app.tsx'), 'export default { __zccPluginApp: true, setup() {} };\n');
  writeFileSync(join(pluginsDir, 'installed.json'), JSON.stringify({
    version: 1,
    plugins: [{
      id: pluginId,
      version: '0.1.0',
      name: 'Deferred startup',
      description: 'E2E delayed activation fixture',
      icon: 'Puzzle',
      enabled: true,
      status: 'running',
      statusDetail: null,
      provenance: 'direct',
      sourceKind: 'path',
      source: `path:${pluginDir}`,
      rootDir: pluginDir,
       serverEntry: null,
       appEntry: './app.tsx',
      npmResolvedVersion: null,
      npmIntegrity: null,
      gitResolvedCommit: null,
      catalogMarketplace: null,
      catalogEntryId: null,
      installedAt: Date.now(),
      updatedAt: Date.now()
    }]
  }));

  const app = await launchApp(home, {
    initialConfig: { sponsorPromptDismissed: true },
    env: { ZCC_E2E_PLUGIN_BUILD_DELAY_MS: '15100' }
  });
  try {
    const before = await app.window.evaluate(async (id) =>
      (await window.cc.pluginApps.list()).find((plugin) => plugin.id === id), pluginId);
    expect(before).toMatchObject({ status: 'degraded', appUrl: null });

    let latest = before;
    try {
      await expect.poll(async () => {
        latest = await app.window.evaluate(async (id) =>
          (await window.cc.pluginApps.list()).find((plugin) => plugin.id === id), pluginId);
        return latest;
      }, { timeout: 45_000 }).toMatchObject({ status: 'running', appUrl: expect.stringMatching(/\/plugins\/deferred-startup\/assets\/app\.js/) });
    } catch (error) {
      throw new Error(`plugin did not activate: ${JSON.stringify(latest)}`, { cause: error });
    }
  } finally {
    await app.electron.close();
  }
});
