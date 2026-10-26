import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';

function writePlugin(root: string, version: string) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'zcc-plugin-tasks', version, type: 'module',
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: { name: `Bundled tasks ${version}`, description: 'Bundled ownership fixture', branding: { icon: 'Puzzle' }, server: `./server-${version}.mjs` }
  }));
  writeFileSync(join(root, `server-${version}.mjs`), `export default zcc => {
    zcc.rpc.method('save', () => zcc.storage.kv.set('saved', 'preserved'));
    zcc.rpc.method('read', async () => ({ version: '${version}', saved: await zcc.storage.kv.get('saved') }));
  };`);
}

function env(bundle: string) {
  return {
    ZCC_BUNDLED_PLUGINS_DIR: bundle,
    ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD: '0',
    ZCC_OFFICIAL_MARKETPLACE_URL: 'off', ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off'
  };
}

test('an app bundle upgrade refreshes installed metadata and preserves disabled state and data', async ({ home }) => {
  test.setTimeout(120_000);
  const firstBundle = join(home, 'bundle-v1'), nextBundle = join(home, 'bundle-v2');
  writePlugin(join(firstBundle, 'tasks'), '1.0.0');
  writePlugin(join(nextBundle, 'tasks'), '2.0.0');
  const initialConfig = { sponsorPromptDismissed: true };
  const first = await launchApp(home, { env: env(firstBundle), initialConfig });
  try {
    const installed = await first.window.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'tasks' }));
    expect(installed, JSON.stringify(installed)).toMatchObject({ ok: true });
    await first.window.evaluate(() => window.cc.pluginApps.callRpc('tasks', 'save'));
    expect(await first.window.evaluate(() => window.cc.pluginApps.setEnabled('tasks', false)))
      .toMatchObject({ ok: true });
  } finally { await closeApp(first.electron); }

  const next = await launchApp(home, { env: env(nextBundle), initialConfig });
  try {
    const win = next.window;
    const installed = () => win.evaluate(async () => (await window.cc.pluginApps.list()).find(row => row.id === 'tasks'));
    await expect.poll(installed).toMatchObject({ name: 'Bundled tasks 2.0.0', enabled: false, status: 'disabled', sourceKind: 'builtin' });
    const registry = JSON.parse(readFileSync(join(home, '.zcc/plugins/installed.json'), 'utf8'));
    expect(registry.plugins.find((row: { id: string }) => row.id === 'tasks'))
      .toMatchObject({ version: '2.0.0', rootDir: join(nextBundle, 'tasks'), serverEntry: './server-2.0.0.mjs', enabled: false });
    await win.getByTestId('nav-extensions').click();
    await win.getByTestId('extensions-nav-installed').click();
    await expect(win.getByTestId('plugin-row-tasks')).toContainText('Bundled tasks 2.0.0');
    const update = await win.evaluate(() => window.cc.pluginApps.applyUpdate('tasks'));
    expect(update).toMatchObject({ ok: false });
    expect(JSON.stringify(update)).toContain('updates with Zana releases');
    expect(await win.evaluate(() => window.cc.pluginApps.setEnabled('tasks', true))).toMatchObject({ ok: true });
    await expect.poll(() => win.evaluate(() => window.cc.pluginApps.callRpc('tasks', 'read')))
      .toEqual({ version: '2.0.0', saved: 'preserved' });
    expect(await win.evaluate(() => window.cc.pluginApps.remove('tasks'))).toMatchObject({ ok: true });
  } finally { await closeApp(next.electron); }

  const last = await launchApp(home, { env: env(nextBundle), initialConfig });
  try {
    expect(await last.window.evaluate(async () => (await window.cc.pluginApps.list()).find(row => row.id === 'tasks'))).toBeUndefined();
  } finally { await closeApp(last.electron); }
});

test('the Git install IPC cannot turn a remote bundled identity into a local development override', async ({ home }) => {
  const bundle = join(home, 'bundle'), repo = join(home, 'remote');
  writePlugin(join(bundle, 'tasks'), '1.0.0'); writePlugin(repo, '9.0.0');
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, env: gitEnv, timeout: 10_000, stdio: 'pipe' });
  git(['init']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture']);
  const url = 'https://plugin-fixture.test/innocent-name';
  const app = await launchApp(home, { initialConfig: { sponsorPromptDismissed: true }, env: {
    ...env(bundle), ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD: '1',
    // Exercise the real Git IPC without relying on an external repository.
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${pathToFileURL(repo).href}.insteadOf`, GIT_CONFIG_VALUE_0: url,
    GIT_ALLOW_PROTOCOL: 'file'
  } });
  try {
    const win = app.window;
    expect(await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'tasks' }))).toMatchObject({ ok: true });
    const rejected = await win.evaluate(url => window.cc.extensions.install({ kind: 'git', url }), url);
    expect(rejected, JSON.stringify(rejected)).toMatchObject({ ok: false });
    expect(JSON.stringify(rejected)).toContain('reserved');
    expect(await win.evaluate(() => window.cc.pluginApps.callRpc('tasks', 'read'))).toMatchObject({ version: '1.0.0' });
    await win.getByTestId('nav-extensions').click();
    await win.getByTestId('extensions-nav-installed').click();
    await expect(win.getByTestId('plugin-row-tasks')).toContainText('Bundled tasks 1.0.0');
  } finally { await closeApp(app.electron); }
});

test('an older independent installation remains usable and shows migration guidance in Plugins', async ({ home }) => {
  const bundle = join(home, 'bundle'), existing = join(home, 'old-independent-tasks');
  writePlugin(join(bundle, 'tasks'), '1.0.0'); writePlugin(existing, '3.0.0');
  const dir = join(home, '.zcc/plugins'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'installed.json'), JSON.stringify({ version: 1, plugins: [{
    id: 'tasks', version: '3.0.0', name: 'Bundled tasks 3.0.0', description: 'Legacy independent install', icon: 'Puzzle',
    rootDir: existing, enabled: true, status: 'running', statusDetail: null,
    provenance: 'catalog', sourceKind: 'git', source: 'git:https://example.test/tasks@HEAD',
    serverEntry: './server-3.0.0.mjs', appEntry: null, installedAt: 1, updatedAt: 1,
    npmResolvedVersion: null, npmIntegrity: null, gitResolvedCommit: 'old-commit', catalogMarketplace: 'official', catalogEntryId: 'tasks'
  }] }));
  const app = await launchApp(home, { env: env(bundle), initialConfig: { sponsorPromptDismissed: true } });
  try {
    const win = app.window;
    await win.evaluate(() => window.cc.pluginApps.callRpc('tasks', 'save'));
    await expect.poll(() => win.evaluate(() => window.cc.pluginApps.callRpc('tasks', 'read')))
      .toEqual({ version: '3.0.0', saved: 'preserved' });
    await win.getByTestId('nav-extensions').click();
    await win.getByTestId('extensions-nav-installed').click();
    await win.getByTestId('plugin-row-tasks').getByRole('button', { name: 'Bundled tasks 3.0.0 plugin details' }).click();
    await win.getByRole('complementary', { name: 'Installed plugin' }).getByRole('tab', { name: 'Installation', exact: true }).click();
    await expect(win.getByTestId('plugin-health')).toContainText('remote updates are blocked');
    await expect(win.getByTestId('plugin-health')).toContainText('Back up and migrate');
    await expect(win.getByText('Migration required before updating', { exact: true })).toBeVisible();
    await expect(win.getByTestId('plugin-update-status')).toContainText('Independent updates are blocked');
    const update = await win.evaluate(() => window.cc.pluginApps.applyUpdate('tasks'));
    expect(update).toMatchObject({ ok: false }); expect(JSON.stringify(update)).toContain('remote updates are blocked');
    const migration = await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'tasks' }));
    expect(migration).toMatchObject({ ok: false }); expect(JSON.stringify(migration)).toContain('Migration required');
    await expect.poll(() => win.evaluate(() => window.cc.pluginApps.callRpc('tasks', 'read')))
      .toEqual({ version: '3.0.0', saved: 'preserved' });
  } finally { await closeApp(app.electron); }
});
