import { execFile } from 'node:child_process';
import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test, expect, launchApp } from './fixtures/app.js';

const exec = promisify(execFile);
test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { npm_config_registry: 'https://registry.npmjs.org/' } });

test('packaged CLI creates, exercises, reloads, and diagnoses a plugin in built Electron', async ({ app: initialApp, home }) => {
  test.setTimeout(240_000);
  let app = initialApp;
  const id = 'live-authoring-e2e';
  const copiedCli = join(home, 'cli');
  const shippedCli = await app.electron.evaluate(({ app }) => {
    return app.isPackaged ? `${process.resourcesPath}/zcc-cli/bin/zcc` : null;
  });
  if (!shippedCli) cpSync(resolve('packages/cli/dist'), copiedCli, { recursive: true, dereference: true });
  const cli = shippedCli ?? join(copiedCli, 'bin/zcc');
  expect(existsSync(cli)).toBe(true);
  const source = join(home, `zcc-plugin-${id}`);
  const env = {
    ...process.env, HOME: home, ZCC_DATA_DIR: join(home, '.zcc'),
    ZCC_SERVER_URL: new URL(app.window.url()).origin,
    ZCC_SESSION_ID: undefined, ZCC_SESSION_TOKEN: undefined,
    ZCC_SKIP_PLUGIN_NPM: '1', NODE_PATH: '', ESBUILD_BINARY_PATH: '',
    npm_config_registry: 'https://registry.npmjs.org/'
  };
  async function run(args: string[], cwd = source) {
    try {
      const result = await exec(process.execPath, [cli, ...args], { cwd, env, timeout: 150_000, maxBuffer: 2 * 1024 * 1024 });
      return { ...result, code: 0 };
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; code?: number };
      return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? String(error), code: failure.code ?? 1 };
    }
  }
  const scaffold = await run(['plugin', 'new', id, '--app'], home);
  expect(scaffold.code, scaffold.stderr).toBe(0);
  const packagePath = join(source, 'package.json');
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
  const panelEntry = manifest.zcc.app;
  delete manifest.zcc.app;
  writeFileSync(packagePath, JSON.stringify(manifest));
  const installed = await run(['plugin', 'install', '.']);
  expect(installed.code, installed.stderr).toBe(0);
  try {
    await expect(app.window.locator('.nav-item', { hasText: id })).toHaveCount(0);
    // A backend-only install grows a panel through ordinary development reload.
    manifest.zcc.app = panelEntry; manifest.version = '0.2.0';
    writeFileSync(packagePath, JSON.stringify(manifest));
    const addedPanel = await run(['plugin', 'dev', '--once']);
    expect(addedPanel.code, addedPanel.stderr).toBe(0);
    await app.window.locator('.nav-item', { hasText: id }).first().click();
    await expect(app.window.getByRole('heading', { name: id, exact: true })).toBeVisible();
    await expect(app.window.getByText('No todos yet', { exact: true })).toBeVisible();
    await app.window.getByRole('textbox', { name: 'Todo title' }).fill('Saved across reload');
    await app.window.getByRole('button', { name: 'Add', exact: true }).click();
    let todo = app.window.getByRole('checkbox', { name: 'Saved across reload' });
    await todo.click();
    await expect(todo).toBeChecked();
    const listed = await run(['plugin', 'run', id, 'list']);
    expect(listed.code, listed.stderr).toBe(0);
    expect(listed.stdout).toContain('[x] Saved across reload');

    const appPath = join(source, 'app.tsx');
    const updated = readFileSync(appPath, 'utf8').replace(`>${id}</h2>`, '>Reload verified</h2>');
    writeFileSync(appPath, updated);
    const reloaded = await run(['plugin', 'dev', '--once']);
    expect(reloaded.code, reloaded.stderr).toBe(0);
    await expect(app.window.getByRole('heading', { name: 'Reload verified' })).toBeVisible();
    await expect(todo).toBeChecked();

    writeFileSync(appPath, 'export default <broken');
    const broken = await run(['plugin', 'dev', '--once']);
    expect(broken.code).toBe(1);
    expect(broken.stderr).toContain('app failed:');
    expect(broken.stdout).not.toContain('Reloaded');
    await expect(app.window.getByRole('heading', { name: 'Reload verified' })).toBeVisible();
    await expect(todo).toBeChecked();
    writeFileSync(appPath, updated);

    const serverPath = join(source, 'server.ts');
    const server = readFileSync(serverPath, 'utf8');
    writeFileSync(serverPath, 'export default function () { throw new Error("intentional factory failure"); }');
    const factoryFailure = await run(['plugin', 'dev', '--once']);
    expect(factoryFailure.code).toBe(1);
    expect(factoryFailure.stderr).toContain('intentional factory failure');
    writeFileSync(serverPath, server);
    const recovered = await run(['plugin', 'dev', '--once']);
    expect(recovered.code, recovered.stderr).toBe(0);
    await expect(todo).toBeChecked();
    // Stop the isolated app before clearing its toolchain: Windows locks the
    // running esbuild executable. Restart with the persisted plugin and a cold
    // cache, then exercise the server's own rebuild/bootstrap path.
    await app.electron.close();
    const cacheRoot = join(home, '.zcc/plugins');
    for (const cache of readdirSync(cacheRoot).filter((name) => name.startsWith('toolchain-'))) {
      rmSync(join(cacheRoot, cache), { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
    app = await launchApp(home, {
      initialConfig: { sponsorPromptDismissed: true },
      env: { npm_config_registry: 'https://registry.npmjs.org/' }
    });
    env.ZCC_SERVER_URL = new URL(app.window.url()).origin;
    await app.window.locator('.nav-item', { hasText: id }).first().click();
    todo = app.window.getByRole('checkbox', { name: 'Saved across reload' });
    await expect(todo).toBeChecked();
    writeFileSync(appPath, updated.replace('Reload verified', 'Server build verified'));
    const serverRebuild = await run(['plugin', 'reload', id]);
    expect(serverRebuild.code, serverRebuild.stderr).toBe(0);
    if (shippedCli) expect(readdirSync(cacheRoot).filter((name) => name.startsWith('toolchain-'))).not.toEqual([]);
    await expect(app.window.getByRole('heading', { name: 'Server build verified' })).toBeVisible();
    await expect(todo).toBeChecked();
    const snapshot = await app.window.evaluate(async () => (await fetch('/api/v1/plugin-apps')).json());
    const row = snapshot.apps.find((entry: { id: string }) => entry.id === id);
    expect(row.sourceKind).toBe('path');
    expect(row).not.toHaveProperty('source');
    expect(row).not.toHaveProperty('rootDir');
    await app.window.locator('.nav-item').filter({ hasText: /^Plugins$/ }).click();
    await app.window.getByTestId('extensions-nav-installed').click();
    await app.window.getByLabel('Search installed plugins').fill(id);
    await expect(app.window.getByTestId(`plugin-row-${id}`)).toBeVisible();
    delete manifest.zcc.app;
    writeFileSync(packagePath, JSON.stringify(manifest));
    const removedPanel = await run(['plugin', 'dev', '--once']);
    expect(removedPanel.code, removedPanel.stderr).toBe(0);
    await expect(app.window.locator('.nav-item', { hasText: id })).toHaveCount(0);
  } finally {
    await run(['plugin', 'remove', id]);
    if (app !== initialApp) await app.electron.close();
  }
});
