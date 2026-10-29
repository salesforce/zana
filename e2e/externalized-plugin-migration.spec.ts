import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect } from './fixtures/app.js';

for (const enabled of [true, false]) {
  test.describe(`independent plugin handoff (enabled=${enabled})`, () => {
    test.use({
      e2e: true,
      initialConfig: { sponsorPromptDismissed: true },
      launchEnv: async ({ home }, use) => {
        const repository = join(home, 'release-repo');
        mkdirSync(repository);
        writeFileSync(join(repository, 'package.json'), JSON.stringify({
          name: '@zcc-ext/salesforce', version: '0.1.0',
          zcc: { name: 'Independent fixture', description: 'Migration boundary fixture', branding: { icon: 'Cloud' }, server: './server.mjs' }
        }));
        writeFileSync(join(repository, 'server.mjs'), `export default zcc => {
          zcc.rpc.method('migration.proof', async () => ({ runtime: 'independent', saved: await zcc.storage.kv.get('migration-proof') }));
        };`);
        const env = { ...process.env, HOME: home };
        for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
        const git = (args: string[]) => execFileSync('git', args, { cwd: repository, env, stdio: 'pipe' });
        git(['init', '-b', 'runtime']);
        git(['config', 'user.name', 'Fixture']);
        git(['config', 'user.email', 'fixture@example.invalid']);
        git(['add', '.']); git(['commit', '-m', 'Compiled fixture']);
        // Exercise the real git child through the production boundary, entirely offline.
        writeFileSync(join(home, '.gitconfig'), `[protocol "file"]\n\tallow = always\n[url "${pathToFileURL(repository).href}"]\n\tinsteadOf = https://github.com/grebmann1/zcc-plugin-salesforce.git\n`);
        const data = join(home, '.zcc/plugins');
        mkdirSync(join(data, 'salesforce'), { recursive: true });
        writeFileSync(join(data, 'salesforce/kv.json'), JSON.stringify({ 'migration-proof': { org: 'dev', scenario: 'kept' } }));
        writeFileSync(join(data, 'salesforce/settings.json'), JSON.stringify({ defaultOrg: 'dev' }));
        // The old app bundle no longer exists: users may skip the transition release.
        writeFileSync(join(data, 'installed.json'), JSON.stringify({ version: 1, plugins: [{
          id: 'salesforce', name: 'Salesforce', description: '', icon: 'Cloud', version: '0.0.1',
          enabled, status: 'disabled', statusDetail: null, provenance: 'builtin', sourceKind: 'builtin',
          source: 'builtin:salesforce', rootDir: join(home, 'removed-app-bundle/salesforce'),
          serverEntry: './server.mjs', appEntry: null, npmResolvedVersion: null, npmIntegrity: null,
          gitResolvedCommit: null, catalogMarketplace: null, catalogEntryId: null,
          installedAt: 12, updatedAt: 13, toolPolicy: 'true'
        }] }));
        await use({ ZCC_OFFICIAL_MARKETPLACE_URL: 'off', ZCC_COMMUNITY_MARKETPLACE_SOURCE: 'off', ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off' });
      }
    });
    test('migrates the registered source while keeping data and user enablement', async ({ app, home }) => {
      const installed = () => JSON.parse(readFileSync(join(home, '.zcc/plugins/installed.json'), 'utf8')).plugins.find((row: { id: string }) => row.id === 'salesforce');
      await expect.poll(() => installed()?.sourceKind, { timeout: 60000 }).toBe('git');
      expect(installed()).toMatchObject({ enabled, installedAt: 12, catalogMarketplace: 'official', source: 'git:https://github.com/grebmann1/zcc-plugin-salesforce.git@runtime' });
      expect(JSON.parse(readFileSync(join(home, '.zcc/plugins/salesforce/settings.json'), 'utf8'))).toEqual({ defaultOrg: 'dev' });
      if (!enabled) expect(await app.window.evaluate(() => window.cc.pluginApps.setEnabled('salesforce', true))).toMatchObject({ ok: true });
      await expect(async () => {
        expect(await app.window.evaluate(() => window.cc.pluginApps.callRpc('salesforce', 'migration.proof', {}))).toEqual({ runtime: 'independent', saved: { org: 'dev', scenario: 'kept' } });
      }).toPass({ timeout: 30000 });
    });
  });
}
