import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';

function plugin(root: string, id: string, version: string) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: `zcc-plugin-${id}`, version,
    zcc: { name: `Independent ${id}`, description: 'Independent update fixture', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
  writeFileSync(join(root, 'server.mjs'), `export default zcc => {
    zcc.rpc.method('version', () => '${version}');
    zcc.rpc.method('save', () => zcc.storage.kv.set('saved', 'preserved'));
    zcc.rpc.method('read', () => zcc.storage.kv.get('saved'));
  };`);
}

test('independent Git/npm checks persist and manual UI/CLI updates preserve intent and state in built Electron', async ({ home }) => {
  test.setTimeout(300_000);
  const repo = join(home, 'git-source'); plugin(join(repo, 'plugins/remote-git'), 'remote-git', '1.0.0');
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, env: gitEnv, timeout: 10_000, stdio: 'pipe' }).toString();
  git(['init']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'v1']);
  // The real ls-remote response exceeds the historical 8192-byte pipe boundary.
  const sha = git(['rev-parse', 'HEAD']).trim();
  execFileSync('git', ['update-ref', '--stdin'], { cwd: repo, env: gitEnv,
    input: Array.from({ length: 180 }, (_, i) => `create refs/tags/unrelated-fixture-${i} ${sha}\n`).join('') });
  const remoteUrl = 'https://plugin-fixture.test/remote-git';

  const tarballs = new Map<string, Buffer>();
  const versions: Record<string, unknown> = {};
  let registryUrl = '';
  const registry = createServer((req, res) => {
    const tar = tarballs.get(req.url ?? '');
    if (tar) { res.setHeader('content-type', 'application/octet-stream'); res.end(tar); return; }
    if (req.url?.startsWith('/zcc-plugin-remote-npm')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ name: 'zcc-plugin-remote-npm', 'dist-tags': { latest: Object.keys(versions).at(-1) }, versions })); return;
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise<void>(resolve => registry.listen(0, '127.0.0.1', resolve));
  registryUrl = `http://127.0.0.1:${(registry.address() as { port: number }).port}`;
  const publish = (version: string) => {
    const dir = join(home, `npm-${version}`), pkg = join(dir, 'package'); plugin(pkg, 'remote-npm', version);
    const tarPath = join(dir, 'package.tgz'); execFileSync('tar', ['-czf', tarPath, '-C', dir, 'package']);
    const bytes = readFileSync(tarPath), path = `/tarballs/${version}.tgz`; tarballs.set(path, bytes);
    versions[version] = { ...JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')),
      dist: { tarball: `${registryUrl}${path}`, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` } };
  };
  publish('1.0.0');
  const env = {
    ZCC_OFFICIAL_MARKETPLACE_URL: 'off', ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off',
    ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD: '0', ZCC_SKIP_PLUGIN_NPM: '1', npm_config_registry: registryUrl,
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${pathToFileURL(repo).href}.insteadOf`, GIT_CONFIG_VALUE_0: remoteUrl, GIT_ALLOW_PROTOCOL: 'file'
  };
  let app = await launchApp(home, { env, initialConfig: { sponsorPromptDismissed: true } });
  try {
    let win = app.window;
    expect(await win.evaluate(url => window.cc.extensions.install({ kind: 'git', url, subdir: 'plugins/remote-git' }), remoteUrl)).toMatchObject({ ok: true });
    expect(await win.evaluate(() => window.cc.extensions.install({ kind: 'npm', spec: 'zcc-plugin-remote-npm@^1.0.0' }))).toMatchObject({ ok: true });
    await win.evaluate(() => window.cc.pluginApps.callRpc('remote-git', 'save'));
    await win.evaluate(() => window.cc.pluginApps.setEnabled('remote-npm', false));
    plugin(join(repo, 'plugins/remote-git'), 'remote-git', '1.1.0'); git(['add', '.']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'v2']);
    // Enough npm versions to exercise a complete metadata response above 8192 bytes.
    for (let i = 1; i <= 80; i++) publish(`1.0.${i}`);
    publish('1.1.0');
    const checks = await win.evaluate(() => window.cc.pluginApps.checkUpdates());
    expect(checks.map(row => row.id).sort()).toEqual(['remote-git', 'remote-npm']);
    expect(await win.evaluate(() => window.cc.pluginApps.callRpc('remote-git', 'version'))).toBe('1.0.0');
    const saved = JSON.parse(readFileSync(join(home, '.zcc/plugins/update-checks.json'), 'utf8'));
    expect(saved.checks['remote-git'].candidate.commit).toBe(git(['rev-parse', 'HEAD']).trim());
    await closeApp(app.electron);
    app = await launchApp(home, { env, initialConfig: { sponsorPromptDismissed: true } }); win = app.window;
    await expect.poll(() => win.evaluate(async () => (await window.cc.pluginApps.list()).filter(row => row.id.startsWith('remote-')).map(row => row.availableVersion))).toEqual(['1.1.0', '1.1.0']);
    await win.getByTestId('nav-extensions').click(); await win.getByTestId('extensions-nav-installed').click();
    await win.getByTestId('plugin-row-remote-git').getByRole('button', { name: 'Independent remote-git plugin details' }).click();
    await win.getByRole('complementary', { name: 'Installed plugin' }).getByRole('tab', { name: 'Installation', exact: true }).click();
    await expect(win.getByTestId('plugin-update-status')).toContainText('1.1.0');
    await expect(win.getByText('Automatic checks; manual updates', { exact: true })).toBeVisible();
    expect(await win.evaluate(() => window.cc.pluginApps.applyUpdate('remote-git'))).toMatchObject({ ok: true });
    expect(await win.evaluate(() => window.cc.pluginApps.callRpc('remote-git', 'version'))).toBe('1.1.0');
    expect(await win.evaluate(() => window.cc.pluginApps.callRpc('remote-git', 'read'))).toBe('preserved');
    const cli = resolve('packages/cli/dist/bin/zcc');
    const result = await promisify(execFile)(process.execPath, [cli, 'plugin', 'update', '--all', '--json'], {
      cwd: home, env: { ...process.env, HOME: home, ZCC_DATA_DIR: join(home, '.zcc'), ZCC_SESSION_ID: undefined, ZCC_SESSION_TOKEN: undefined }, timeout: 120_000
    }).catch((error: { stdout?: string; stderr?: string }) => { throw new Error(`Bulk CLI update failed: ${error.stdout} ${error.stderr}`); });
    expect(JSON.parse(result.stdout)).toEqual({ updated: ['remote-npm'], failed: [] });
    const installed = JSON.parse(readFileSync(join(home, '.zcc/plugins/installed.json'), 'utf8')).plugins;
    expect(installed.find((row: { id: string }) => row.id === 'remote-npm')).toMatchObject({ enabled: false, npmResolvedVersion: '1.1.0', sourceIntent: { spec: '^1.0.0', registry: registryUrl } });
    expect(installed.find((row: { id: string }) => row.id === 'remote-git')).toMatchObject({ sourceKind: 'git', sourceIntent: { subdir: 'plugins/remote-git', selector: { ref: 'HEAD' } } });
    await win.evaluate(() => window.cc.pluginApps.setEnabled('remote-npm', true));
    expect(await win.evaluate(() => window.cc.pluginApps.callRpc('remote-npm', 'version'))).toBe('1.1.0');
    registry.closeAllConnections(); await new Promise<void>(resolve => registry.close(() => resolve()));
    await win.evaluate(() => window.cc.pluginApps.checkUpdates());
    await expect.poll(() => win.evaluate(async () => (await window.cc.pluginApps.list()).find(row => row.id === 'remote-npm')?.updateCheck?.outcome)).toBe('unavailable');
    expect(await win.evaluate(() => window.cc.pluginApps.callRpc('remote-npm', 'version'))).toBe('1.1.0');
  } finally {
    await closeApp(app.electron); registry.closeAllConnections(); registry.close();
  }
});
