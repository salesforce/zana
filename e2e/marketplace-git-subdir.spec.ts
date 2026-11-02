import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { startGitDaemon } from './fixtures/git-daemon.js';
import { MarketplacePage } from './fixtures/marketplace.js';

const id = 'subdir-fixture';
const title = 'Subdirectory fixture';
const subdir = 'plugins/fixture with spaces';
const manifest = (version: string) => JSON.stringify({ name: `zcc-plugin-${id}`, version,
  zcc: { name: title, description: 'Marketplace Git subtree regression', branding: { icon: 'Puzzle' }, server: './server.mjs' } });
const server = (version: string) => `export default api => {
  api.rpc.method('version', () => '${version}');
  api.rpc.method('save', () => api.storage.kv.set('saved', 'preserved'));
  api.rpc.method('read', () => api.storage.kv.get('saved'));
};`;

test('marketplace installs the declared Git subtree and preserves successful updates despite Windows cleanup locks', async ({ home }) => {
  test.setTimeout(300_000);
  const git = await startGitDaemon(join(home, 'git'), [{ repoName: 'monorepo', files: {
    'package.json': JSON.stringify({ private: true, workspaces: ['plugins/*'] }),
    [`${subdir}/package.json`]: manifest('1.0.0'), [`${subdir}/server.mjs`]: server('1.0.0')
  } }]);
  const catalog = join(home, 'catalog'), bundled = join(home, 'bundled');
  mkdirSync(catalog); mkdirSync(bundled);
  writeFileSync(join(catalog, 'marketplace.json'), JSON.stringify({ schemaVersion: 1, name: 'subdir-market', displayName: 'Subdir Market',
    plugins: [{ id, displayName: title, description: 'Fixture', author: { name: 'Fixture' }, source: { git: { url: git.urlFor('monorepo'), subdir } } }] }));
  const env = { ZCC_OFFICIAL_MARKETPLACE_URL: 'off', ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off',
    ZCC_BUNDLED_PLUGINS_DIR: bundled, ZCC_SKIP_PLUGIN_NPM: '1',
    PATH: process.env.PATH ?? process.env.Path ?? '' };
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  let locker: ChildProcess | undefined;
  const installed = () => JSON.parse(readFileSync(join(home, '.zcc/plugins/installed.json'), 'utf8')).plugins.find((row: { id: string }) => row.id === id);
  try {
    app = await launchApp(home, { env, initialConfig: { sponsorPromptDismissed: true } });
    const win = app.window, market = new MarketplacePage(win);
    await market.open(); await market.openCatalogSources();
    await win.getByLabel('Marketplace catalog source').fill(`path:${catalog}`);
    await win.getByRole('button', { name: 'Add catalog', exact: true }).click();
    await expect(market.catalogNames()).toHaveText(['Subdir Market']);
    await win.getByRole('dialog', { name: 'Manage marketplaces', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
    await market.rowButton(title).click(); await market.confirmInstall();
    await expect.poll(async () => {
      const errors = await market.row(title).getByRole('alert').allTextContents();
      return errors.length ? `Marketplace install failed: ${errors.join('; ')}` : win.url();
    }, { timeout: 30_000 }).toMatch(/view=installed/);
    expect(installed()).toMatchObject({ sourceKind: 'git', sourceIntent: { subdir, selector: { kind: 'ref', ref: 'HEAD' } } });
    expect(installed().rootDir.replaceAll('\\', '/')).toMatch(/\/git\/plugins\/fixture with spaces$/);
    expect(await win.evaluate(id => window.cc.pluginApps.callRpc(id, 'version'), id)).toBe('1.0.0');
    await win.evaluate(id => window.cc.pluginApps.callRpc(id, 'save'), id);
    const previous = installed().rootDir;
    const generation = dirname(dirname(dirname(previous)));
    if (process.platform === 'win32') {
      // Hold the real UUID parent as cwd beyond all bounded retries.
      locker = spawn(process.execPath, ['-e', "process.stdout.write('ready');setInterval(()=>{},1000)"], { cwd: generation, stdio: ['ignore', 'pipe', 'pipe'] });
      await once(locker.stdout!, 'data');
    }
    writeFileSync(join(git.sourceDir('monorepo'), subdir, 'package.json'), manifest('1.1.0'));
    writeFileSync(join(git.sourceDir('monorepo'), subdir, 'server.mjs'), server('1.1.0'));
    git.publishUpdate('monorepo');
    await win.evaluate(() => window.cc.pluginApps.checkUpdates());
    expect(await win.evaluate(id => window.cc.pluginApps.applyUpdate(id), id)).toMatchObject({ ok: true });
    expect(await win.evaluate(id => window.cc.pluginApps.callRpc(id, 'version'), id)).toBe('1.1.0');
    expect(await win.evaluate(id => window.cc.pluginApps.callRpc(id, 'read'), id)).toBe('preserved');
    expect(existsSync(generation)).toBe(process.platform === 'win32');
    if (locker) { const exited = once(locker, 'close'); locker.kill(); await exited; locker = undefined; }
    await closeApp(app.electron); app = undefined;
    app = await launchApp(home, { env, initialConfig: { sponsorPromptDismissed: true } });
    await expect.poll(() => readdirSync(join(home, '.zcc/plugins/generations')).length).toBe(1);
    expect(await app.window.evaluate(id => window.cc.pluginApps.callRpc(id, 'read'), id)).toBe('preserved');
  } finally {
    if (locker) { const exited = once(locker, 'close'); locker.kill(); await exited; }
    if (app) await closeApp(app.electron);
    await git.close();
  }
});
