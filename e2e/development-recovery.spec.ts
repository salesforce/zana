import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { preparePluginRuntime } from '../packages/plugin-build/src/prepare-plugin-runtime.js';

test('core Development recovery restores a corrupt managed provider offline, preserves state across restart and reports damaged app resources', async ({ home }) => {
  test.setTimeout(180_000);
  const build = process.env.ZCC_E2E_APP_ROOT ?? fileURLToPath(new URL('../', import.meta.url));
  const version = JSON.parse(readFileSync(join(build, 'package.json'), 'utf8')).version;
  const clean = join(home, 'app-runtimes');
  await preparePluginRuntime(join(build, 'plugins/provider-codex'), join(clean, 'provider-codex'), version);
  const tasks = join(clean, 'tasks'); mkdirSync(tasks, { recursive: true });
  writeFileSync(join(tasks, 'package.json'), JSON.stringify({ name: '@zcc-ext/tasks', version: '1.0.0', type: 'module',
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: { name: 'Recovery tasks', description: 'Recovery fixture', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
  writeFileSync(join(tasks, 'server.mjs'), `export default zcc => {
    zcc.settings.define({ name: { type: 'string', label: 'Name' }, token: { type: 'string', label: 'Token', secret: true } });
    zcc.rpc.method('save', () => zcc.storage.kv.set('data', 'preserved'));
    zcc.rpc.method('read', () => zcc.storage.kv.get('data'));
  };\n// ${'large production-boundary payload '.repeat(600)}`);
  const env = { ZCC_BUNDLED_PLUGINS_DIR: clean,
    ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD: '0', ZCC_OFFICIAL_MARKETPLACE_URL: 'off', ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off', ZCC_COMMUNITY_MARKETPLACE_SOURCE: 'off', NODE_PATH: '' };
  // Dependency-free app resources restore without network access or a toolchain.
  const options = { env, initialConfig: { sponsorPromptDismissed: true, pluginDevelopmentEnabled: false } };
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    app = await launchApp(home, options);
    let win = app.window;
    const provider = () => win.evaluate(async () => (await (await fetch('/api/v1/threads/providers')).json()).providers.find((row: { id: string }) => row.id === 'codex'));
    await expect.poll(provider).toMatchObject({ id: 'codex', available: true });
    expect(await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'tasks' }))).toMatchObject({ ok: true });
    await win.evaluate(() => window.cc.pluginApps.callRpc('tasks', 'save'));
    await win.evaluate(() => window.cc.pluginApps.setSettings('tasks', { name: 'preserved', token: 'fixture-secret' }));
    await win.evaluate(() => window.cc.pluginApps.setEnabled('tasks', false));
    await win.getByRole('link', { name: 'Settings', exact: true }).click();
    await win.getByTestId('settings-nav-development').click();
    await win.getByRole('button', { name: 'Restart host daemon', exact: true }).click();
    await expect(win.getByText('Host daemon relaunched. Waiting machines reconnect automatically.')).toBeVisible();
    await expect.poll(() => win.evaluate(async () => (await (await fetch('/api/v1/hosts')).json()).some((row: { isPrimary: boolean; status: string }) => row.isPrimary && row.status === 'connected'))).toBe(true);
    // First restore creates managed copies. Damage only the mutable provider copy.
    await win.evaluate(async () => { await fetch('/api/v1/plugin-apps/hard-reload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); });
    await expect.poll(() => win.evaluate(async () => (await (await fetch('/api/v1/plugin-apps/recovery')).json()).phase)).toBe('complete');
    const installed = JSON.parse(readFileSync(join(home, '.zcc/plugins/installed.json'), 'utf8')).plugins;
    const managedProvider = installed.find((row: { id: string }) => row.id === 'provider-codex');
    expect(managedProvider.rootDir).toContain('generations');
    writeFileSync(join(managedProvider.rootDir, 'dist/host.js'), 'corrupt managed provider artifact');
    await closeApp(app.electron); app = undefined;
    app = await launchApp(home, options);
    win = app.window;
    await expect.poll(provider).toMatchObject({ id: 'codex', available: false });
    await win.route('https://**/*', route => route.abort('internetdisconnected'));
    await win.getByRole('link', { name: 'Settings', exact: true }).click();
    await win.getByTestId('settings-nav-development').click();
    await win.getByRole('button', { name: 'Restore plugins…' }).click();
    await expect(win.getByRole('dialog', { name: 'Restore plugins?' })).toBeVisible();
    await win.getByRole('button', { name: 'Cancel', exact: true }).click();
    await win.getByRole('button', { name: 'Restore plugins…' }).click();
    await win.getByRole('button', { name: 'Restore and reload', exact: true }).click();
    await expect(win.getByRole('button', { name: 'Restoring plugins…', exact: true })).toBeVisible();
    await expect(win.getByText('Recovery complete: 2 restored, 0 failed, 0 skipped.')).toBeVisible({ timeout: 60_000 });
    await expect.poll(provider).toMatchObject({ id: 'codex', available: true, unavailableReason: null });
    expect(existsSync(join(clean, 'provider-codex/dist/host.js'))).toBe(true);
    expect(await win.evaluate(async () => (await window.cc.pluginApps.list()).find(row => row.id === 'tasks'))).toMatchObject({ enabled: false });
    await win.evaluate(() => window.cc.pluginApps.setEnabled('tasks', true));
    expect(await win.evaluate(() => window.cc.pluginApps.callRpc('tasks', 'read'))).toBe('preserved');
    expect(await win.evaluate(() => window.cc.pluginApps.getSettings('tasks'))).toMatchObject({ values: { name: 'preserved', token: 'fixture-secret' } });
    await closeApp(app.electron); app = undefined;
    // Managed restorations survive restarting the app.
    app = await launchApp(home, options);
    await expect.poll(() => app!.window.evaluate(async () => (await (await fetch('/api/v1/threads/providers')).json()).providers.find((row: { id: string }) => row.id === 'codex')))
      .toMatchObject({ available: true });
    expect(await app.window.evaluate(() => window.cc.pluginApps.callRpc('tasks', 'read'))).toBe('preserved');
    expect(await app.window.evaluate(() => window.cc.pluginApps.getSettings('tasks'))).toMatchObject({ values: { name: 'preserved', token: 'fixture-secret' } });
    // Missing app resources require reinstalling Zana and preserve working code.
    rmSync(clean, { recursive: true });
    await app.window.getByRole('link', { name: 'Settings', exact: true }).click();
    await app.window.getByTestId('settings-nav-development').click();
    await app.window.getByRole('button', { name: 'Restore plugins…' }).click();
    await app.window.getByRole('button', { name: 'Restore and reload', exact: true }).click();
    await expect(app.window.getByText('Recovery complete: 0 restored, 2 failed, 0 skipped.')).toBeVisible({ timeout: 30_000 });
    await expect(app.window.getByText(/Reinstall Zana/).first()).toBeVisible();
    expect(await app.window.evaluate(() => window.cc.pluginApps.callRpc('tasks', 'read'))).toBe('preserved');
  } finally {
    if (app) await closeApp(app.electron);
  }
});

test('core recovery fetches Git and pinned npm packages through real Electron child processes with a fresh npm cache', async ({ home }) => {
  test.setTimeout(180_000);
  const write = (root: string, id: string, version = '1.0.0') => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: `zcc-plugin-${id}`, version,
      zcc: { name: id, description: 'Remote recovery fixture', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
    writeFileSync(join(root, 'server.mjs'), `export default zcc => {
      zcc.rpc.method('version', () => '${version}');
      zcc.rpc.method('save', () => zcc.storage.kv.set('saved', 'preserved'));
      zcc.rpc.method('read', () => zcc.storage.kv.get('saved'));
    };`);
  };
  const repo = join(home, 'remote-git'); write(repo, 'remote-git');
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, env: gitEnv, timeout: 10_000, stdio: 'pipe' }).toString().trim();
  git(['init']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'initial']);
  const sha = git(['rev-parse', 'HEAD']);
  execFileSync('git', ['update-ref', '--stdin'], { cwd: repo, env: gitEnv, timeout: 10_000,
    input: Array.from({ length: 180 }, (_, i) => `create refs/tags/long-recovery-fixture-${i} ${sha}\n`).join('') });
  const npmRoot = join(home, 'npm-package'); write(join(npmRoot, 'package'), 'remote-npm');
  execFileSync('tar', ['-czf', join(npmRoot, 'package.tgz'), '-C', npmRoot, 'package'], { timeout: 10_000 });
  const tarball = readFileSync(join(npmRoot, 'package.tgz'));
  let tarDownloads = 0, registryUrl = '';
  const registry = createServer((request, response) => {
    if (request.url === '/package.tgz') { tarDownloads++; response.end(tarball); return; }
    if (request.url?.startsWith('/zcc-plugin-remote-npm')) {
      const pkg = JSON.parse(readFileSync(join(npmRoot, 'package/package.json'), 'utf8'));
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ name: pkg.name, 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {
        ...pkg, dist: { tarball: `${registryUrl}/package.tgz`, integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}` }
      } } }));
      return;
    }
    response.writeHead(404).end('{}');
  });
  await new Promise<void>(resolve => registry.listen(0, '127.0.0.1', resolve));
  registryUrl = `http://127.0.0.1:${(registry.address() as { port: number }).port}`;
  const bundledRoot = join(home, 'no-bundled-plugins'); mkdirSync(bundledRoot);
  const remote = 'https://recovery-fixture.test/git-plugin';
  const env = { ZCC_BUNDLED_PLUGINS_DIR: bundledRoot, ZCC_OFFICIAL_MARKETPLACE_URL: 'off', ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off', ZCC_COMMUNITY_MARKETPLACE_SOURCE: 'off',
    ZCC_SKIP_PLUGIN_NPM: '1', npm_config_registry: registryUrl, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${pathToFileURL(repo).href}.insteadOf`,
    GIT_CONFIG_VALUE_0: remote, GIT_ALLOW_PROTOCOL: 'file' };
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    app = await launchApp(home, { env, initialConfig: { sponsorPromptDismissed: true } });
    const win = app.window;
    expect(await win.evaluate(url => window.cc.extensions.install({ kind: 'git', url }), remote)).toMatchObject({ ok: true });
    expect(await win.evaluate(() => window.cc.extensions.install({ kind: 'npm', spec: 'zcc-plugin-remote-npm@1.0.0' }))).toMatchObject({ ok: true });
    await win.evaluate(() => window.cc.pluginApps.callRpc('remote-git', 'save'));
    await win.evaluate(() => window.cc.pluginApps.setEnabled('remote-npm', false));
    const before = JSON.parse(readFileSync(join(home, '.zcc/plugins/installed.json'), 'utf8')).plugins;
    const npmBefore = tarDownloads;
    write(repo, 'remote-git', '1.1.0'); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'new dist']);
    const oldGit = before.find((row: { id: string }) => row.id === 'remote-git');
    writeFileSync(join(oldGit.rootDir, 'server.mjs'), 'corrupt installed dist');
    await win.getByRole('link', { name: 'Settings', exact: true }).click();
    await win.getByTestId('settings-nav-development').click();
    await win.getByRole('button', { name: 'Restore plugins…' }).click();
    await win.getByRole('button', { name: 'Restore and reload', exact: true }).click();
    await expect(win.getByText('Recovery complete: 2 restored, 0 failed, 0 skipped.')).toBeVisible({ timeout: 90_000 });
    expect(tarDownloads).toBe(npmBefore + 1);
    expect(await win.evaluate(() => window.cc.pluginApps.callRpc('remote-git', 'version'))).toBe('1.1.0');
    expect(await win.evaluate(() => window.cc.pluginApps.callRpc('remote-git', 'read'))).toBe('preserved');
    const after = JSON.parse(readFileSync(join(home, '.zcc/plugins/installed.json'), 'utf8')).plugins;
    expect(after.find((row: { id: string }) => row.id === 'remote-npm')).toMatchObject({ enabled: false, npmResolvedVersion: '1.0.0' });
    expect(after.find((row: { id: string }) => row.id === 'remote-git').rootDir).not.toBe(oldGit.rootDir);
  } finally {
    if (app) await closeApp(app.electron);
    registry.closeAllConnections();
    await new Promise<void>(resolve => registry.close(() => resolve()));
  }
});
