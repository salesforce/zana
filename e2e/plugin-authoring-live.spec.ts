import { execFile } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test, expect } from './fixtures/app.js';

const exec = promisify(execFile);
test.use({ initialConfig: { sponsorPromptDismissed: true } });

test('packaged CLI creates, exercises, reloads, and diagnoses a plugin in built Electron', async ({ app, home }) => {
  test.setTimeout(120_000);
  const id = 'live-authoring-e2e';
  const copiedCli = join(home, 'cli');
  cpSync(resolve('packages/cli/dist'), copiedCli, { recursive: true, dereference: true });
  const cli = join(copiedCli, 'bin/zcc');
  const source = join(home, `zcc-plugin-${id}`);
  const env = {
    ...process.env, HOME: home, ZCC_DATA_DIR: join(home, '.zcc'),
    ZCC_SERVER_URL: new URL(app.window.url()).origin,
    ZCC_SESSION_ID: undefined, ZCC_SESSION_TOKEN: undefined,
    ZCC_SKIP_PLUGIN_NPM: '1', NODE_PATH: '', ESBUILD_BINARY_PATH: ''
  };
  async function run(args: string[], cwd = source) {
    try {
      const result = await exec(process.execPath, [cli, ...args], { cwd, env, timeout: 45_000, maxBuffer: 1024 * 1024 });
      return { ...result, code: 0 };
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; code?: number };
      return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? String(error), code: failure.code ?? 1 };
    }
  }
  const scaffold = await run(['plugin', 'new', id, '--app'], home);
  expect(scaffold.code, scaffold.stderr).toBe(0);
  const installed = await run(['plugin', 'install', '.']);
  expect(installed.code, installed.stderr).toBe(0);
  try {
    await app.window.locator('.nav-item', { hasText: id }).first().click();
    await expect(app.window.getByRole('heading', { name: id, exact: true })).toBeVisible();
    await expect(app.window.getByText('No todos yet', { exact: true })).toBeVisible();
    await app.window.getByRole('textbox', { name: 'Todo title' }).fill('Saved across reload');
    await app.window.getByRole('button', { name: 'Add', exact: true }).click();
    const todo = app.window.getByRole('checkbox', { name: 'Saved across reload' });
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
  } finally {
    await run(['plugin', 'remove', id]);
  }
});
