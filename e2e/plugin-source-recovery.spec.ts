import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';

function writePlugin(root: string, version: string, id = 'salesforce') {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: `zcc-plugin-${id}`, version: '1.0.0',
    zcc: { name: 'Recovery fixture', description: 'Compiled plugin upgrade fixture', branding: { icon: 'Cloud' }, server: './server.mjs' } }));
  writeFileSync(join(root, 'server.mjs'), `export default zcc => {
    zcc.settings.define({ name: { type: 'string', label: 'Name' }, token: { type: 'string', label: 'Token', secret: true } });
    zcc.rpc.method('version', () => '${version}');
    zcc.rpc.method('read', () => zcc.storage.kv.get('saved'));
  };\n// ${'realistic compiled plugin payload '.repeat(600)}`);
}
function seed(home: string, previous: string, kind: 'builtin' | 'path', enabled = true) {
  const state = join(home, '.zcc/plugins/salesforce'); mkdirSync(state, { recursive: true });
  writeFileSync(join(state, 'kv.json'), JSON.stringify({ saved: 'preserved' }));
  writeFileSync(join(state, 'settings.json'), JSON.stringify({ name: 'preserved' }));
  writeFileSync(join(home, '.zcc/plugins/installed.json'), JSON.stringify({ version: 1, plugins: [{
    id: 'salesforce', name: 'Recovery fixture', description: '', icon: 'Cloud', version: '1.0.0', enabled,
    status: 'disabled', statusDetail: null, provenance: kind === 'builtin' ? 'builtin' : 'direct', sourceKind: kind,
    source: kind === 'builtin' ? 'builtin:salesforce' : `path:${previous}`, rootDir: previous,
    serverEntry: './server.mjs', appEntry: null, npmResolvedVersion: null, npmIntegrity: null, gitResolvedCommit: null,
    catalogMarketplace: null, catalogEntryId: null, installedAt: 12, updatedAt: 13, toolPolicy: 'false'
  }] }));
}
function environment(home: string, repo: string) {
  const bundled = join(home, 'empty-bundle'); mkdirSync(bundled, { recursive: true });
  return { ZCC_BUNDLED_PLUGINS_DIR: bundled, ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD: '0',
    ZCC_OFFICIAL_MARKETPLACE_URL: 'off', ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off', ZCC_COMMUNITY_MARKETPLACE_SOURCE: 'off',
    ZCC_SKIP_PLUGIN_NPM: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${pathToFileURL(repo).href}.insteadOf`,
    GIT_CONFIG_VALUE_0: 'https://github.com/grebmann1/zcc-plugin-salesforce.git', GIT_ALLOW_PROTOCOL: 'file', NODE_PATH: '' };
}
function repository(repo: string) {
  writePlugin(repo, 'independent');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const git = (args: string[], input?: string) => execFileSync('git', args, { cwd: repo, env, timeout: 10_000, input, stdio: 'pipe' }).toString().trim();
  git(['init', '-b', 'runtime']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'runtime']);
  const sha = git(['rev-parse', 'HEAD']);
  git(['update-ref', '--stdin'], Array.from({ length: 180 }, (_, i) => `create refs/tags/long-upgrade-fixture-${i} ${sha}\n`).join(''));
}
const installed = (home: string) => JSON.parse(readFileSync(join(home, '.zcc/plugins/installed.json'), 'utf8')).plugins.find((p: { id: string }) => p.id === 'salesforce');
const options = (env: Record<string, string>) => ({ env, initialConfig: { sponsorPromptDismissed: true, pluginDevelopmentEnabled: false } });

test('bundled plugin survives an offline upgrade and migrates with saved state through real Electron Git children', async ({ home }) => {
  test.setTimeout(180_000);
  const previous = join(home, 'old-app/plugins/salesforce'), repo = join(home, 'official-repo');
  writePlugin(previous, 'bundled'); seed(home, previous, 'builtin');
  const env = environment(home, repo); // Repository is unavailable for the first two boots.
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    app = await launchApp(home, options(env));
    await expect.poll(() => app!.window.evaluate(() => window.cc.pluginApps.callRpc('salesforce', 'version').catch(() => undefined))).toBe('bundled');
    await app.window.evaluate(() => window.cc.pluginApps.setSettings('salesforce', { name: 'preserved', token: 'fixture-secret' }));
    const cached = installed(home).rootDir; expect(cached).not.toBe(previous);
    await closeApp(app.electron); app = undefined;
    rmSync(join(home, 'old-app'), { recursive: true }); // App updater removes the old resources.
    app = await launchApp(home, options(env));
    await expect.poll(() => app!.window.evaluate(() => window.cc.pluginApps.callRpc('salesforce', 'version').catch(() => undefined))).toBe('bundled');
    expect(installed(home).rootDir).toBe(cached);
    await app.window.evaluate(() => window.cc.pluginApps.setEnabled('salesforce', false));
    await closeApp(app.electron); app = undefined;
    repository(repo);
    app = await launchApp(home, options(env));
    await expect.poll(() => installed(home).sourceKind).toBe('git');
    expect(installed(home)).toMatchObject({ enabled: false, installedAt: 12 });
    await app.window.evaluate(() => window.cc.pluginApps.setEnabled('salesforce', true));
    expect(await app.window.evaluate(() => window.cc.pluginApps.callRpc('salesforce', 'version').catch(() => undefined))).toBe('independent');
    expect(await app.window.evaluate(() => window.cc.pluginApps.callRpc('salesforce', 'read'))).toBe('preserved');
    expect(await app.window.evaluate(() => window.cc.pluginApps.getSettings('salesforce'))).toMatchObject({ values: { name: 'preserved', token: 'fixture-secret' } });
    await closeApp(app.electron); app = undefined;
    renameSync(repo, `${repo}-offline`);
    app = await launchApp(home, options(env));
    await expect.poll(() => app!.window.evaluate(() => window.cc.pluginApps.callRpc('salesforce', 'version').catch(() => undefined))).toBe('independent');
    expect(await app.window.evaluate(() => window.cc.pluginApps.callRpc('salesforce', 'read'))).toBe('preserved');
  } finally { if (app) await closeApp(app.electron); }
});

test('Plugins repairs moved folders through a main-owned picker and offers the official successor', async ({ home }) => {
  test.setTimeout(180_000);
  const missing = join(home, 'old-plugin'), moved = join(home, 'moved-plugin'), wrong = join(home, 'wrong-plugin'), repo = join(home, 'official-repo');
  writePlugin(moved, 'moved'); writePlugin(wrong, 'wrong', 'wrong'); seed(home, missing, 'path'); repository(repo);
  const env = environment(home, repo);
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    app = await launchApp(home, options(env));
    const win = app.window;
    await win.getByTestId('nav-extensions').click();
    await win.getByTestId('extensions-nav-installed').click();
    await win.getByTestId('plugin-row-salesforce').click();
    await expect(win.getByRole('button', { name: 'Locate moved plugin…' })).toBeVisible();
    await app.electron.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, wrong);
    await win.getByRole('button', { name: 'Locate moved plugin…' }).click();
    await expect(win.getByRole('alert').filter({ hasText: 'not plugin salesforce' })).toBeVisible();
    expect(installed(home).source).toBe(`path:${missing}`);
    await app.electron.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, moved);
    await win.getByRole('button', { name: 'Locate moved plugin…' }).click();
    await expect.poll(() => win.evaluate(() => window.cc.pluginApps.callRpc('salesforce', 'version').catch(() => undefined))).toBe('moved');
    expect(installed(home).source).toBe(`path:${realpathSync(moved)}`); expect(existsSync(join(moved, 'package.json'))).toBe(true);
    await closeApp(app.electron); app = undefined;
    // A retained runtime keeps running while the moved source can be repaired.
    rmSync(moved, { recursive: true });
    app = await launchApp(home, options(env));
    await app.window.getByTestId('nav-extensions').click(); await app.window.getByTestId('extensions-nav-installed').click();
    await app.window.getByTestId('plugin-row-salesforce').click();
    await app.window.getByRole('button', { name: 'Switch to official distribution…' }).click();
    expect(installed(home).sourceKind).toBe('path');
    await app.window.getByRole('button', { name: 'Switch distribution', exact: true }).click();
    await expect.poll(() => app!.window.evaluate(() => window.cc.pluginApps.callRpc('salesforce', 'version').catch(() => undefined))).toBe('independent');
    expect(await app.window.evaluate(() => window.cc.pluginApps.callRpc('salesforce', 'read'))).toBe('preserved');
  } finally { if (app) await closeApp(app.electron); }
});


test('a direct offline upgrade uses the shipped compiled fallback when the old app resources are already gone', async ({ home }) => {
  test.setTimeout(90_000);
  const missing = join(home, 'removed-old-app/plugins/salesforce'), repo = join(home, 'unavailable-official-repo');
  seed(home, missing, 'builtin');
  const env = environment(home, repo);
  writePlugin(join(env.ZCC_BUNDLED_PLUGINS_DIR, 'migration-runtimes/salesforce'), 'compiled-fallback');
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    app = await launchApp(home, options(env));
    await expect.poll(() => app!.window.evaluate(() => window.cc.pluginApps.callRpc('salesforce', 'version').catch(() => undefined))).toBe('compiled-fallback');
    expect(installed(home)).toMatchObject({ sourceKind: 'builtin', installedAt: 12 });
    expect(installed(home).rootDir).toContain('generations');
    expect(await app.window.evaluate(() => window.cc.pluginApps.callRpc('salesforce', 'read'))).toBe('preserved');
    await closeApp(app.electron); app = undefined;
    rmSync(env.ZCC_BUNDLED_PLUGINS_DIR, { recursive: true }); mkdirSync(env.ZCC_BUNDLED_PLUGINS_DIR);
    app = await launchApp(home, options(env));
    await expect.poll(() => app!.window.evaluate(() => window.cc.pluginApps.callRpc('salesforce', 'version').catch(() => undefined))).toBe('compiled-fallback');
  } finally { if (app) await closeApp(app.electron); }
});
