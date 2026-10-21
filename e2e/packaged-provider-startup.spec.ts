import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/app.js';
import { preparePluginRuntime } from '../packages/plugin-build/src/prepare-plugin-runtime.js';

const PROVIDERS = ['provider-codex', 'provider-claude-code', 'provider-acp', 'provider-pi'];

function artifactState(root: string) {
  return Object.fromEntries(PROVIDERS.flatMap(id => {
    const dir = join(root, id);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (!pkg.zcc.host) return [];
    // Keep the exact condition that failed in releases: source is present,
    // compiled output is valid, and build dependencies are not installed.
    expect(existsSync(join(dir, pkg.zcc.host))).toBe(true);
    expect(existsSync(join(dir, 'node_modules'))).toBe(false);
    return ['host.js', 'host.meta.json'].map(name => {
      const path = join(dir, 'dist', name);
      return [`${id}/${name}`, {
        digest: createHash('sha256').update(readFileSync(path)).digest('hex'),
        modified: statSync(path).mtimeMs
      }];
    });
  }));
}

for (const runtimeOnly of [false, true]) {
test.describe(runtimeOnly ? 'compiled runtime' : 'retained source compatibility', () => {
test.use({
  initialConfig: { sponsorPromptDismissed: true },
  launchEnv: async ({ home }, use) => {
    const executable = process.env.ZCC_E2E_EXECUTABLE_PATH;
    const root = executable
      ? join(process.platform === 'darwin'
        ? resolve(dirname(executable), '..', 'Resources')
        : join(dirname(executable), 'resources'), 'plugins')
      : join(home, 'packaged-plugins');
    if (!executable) {
      const buildRoot = process.env.ZCC_E2E_APP_ROOT ?? fileURLToPath(new URL('../', import.meta.url));
      for (const id of PROVIDERS) {
        if (runtimeOnly) {
          await preparePluginRuntime(join(buildRoot, 'plugins', id), join(root, id), '2.3.1');
          expect(existsSync(join(root, id, 'src'))).toBe(false);
          continue;
        }
        cpSync(join(buildRoot, 'plugins', id), join(root, id), {
          recursive: true,
          filter: path => !path.split(sep).includes('node_modules')
        });
      }
    }
    writeFileSync(join(home, 'provider-artifacts.json'), JSON.stringify({ root, before: artifactState(root) }));
    await use({
      ZCC_BUNDLED_PLUGINS_DIR: root,
      ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD: '0',
      NODE_PATH: ''
    });
  }
});

test('shipped providers register and reload without a compiler', async ({ app, home }) => {
  const win = app.window;
  const states = () => win.evaluate(async ids => {
    const plugins = await window.cc.pluginApps.list();
    return ids.map(id => {
      const plugin = plugins.find(row => row.id === id);
      return { id, status: plugin?.status, detail: plugin?.statusDetail ?? null };
    });
  }, PROVIDERS);
  const running = PROVIDERS.map(id => ({ id, status: 'running', detail: null }));
  await expect.poll(states).toEqual(running);
  if (process.env.ZCC_E2E_EXECUTABLE_PATH) {
    const degraded = await win.evaluate(async () => (await window.cc.pluginApps.list())
      .filter(row => row.status === 'degraded')
      .map(row => ({ id: row.id, detail: row.statusDetail })));
    expect(degraded).toEqual([]);
  }

  const registered = () => win.evaluate(async () => {
    const response = await fetch('/api/v1/threads/providers');
    if (!response.ok) throw new Error(`Provider catalog failed: ${response.status}`);
    const body = await response.json();
    return body.providers.map((row: { id: string }) => row.id);
  });
  const expected = expect.arrayContaining(['codex', 'claude-code', 'acp-cursor', 'acp-opencode', 'pi']);
  await expect.poll(registered).toEqual(expected);

  await win.getByTestId('nav-extensions').click();
  await win.getByTestId('extensions-nav-installed').click();
  await win.getByRole('button', { name: /^Coding agents/ }).click();
  for (const id of PROVIDERS) {
    const row = win.getByTestId(`plugin-row-${id}`);
    await expect(row).toBeVisible();
    await expect(row).not.toContainText('Degraded');
    await expect(row).not.toContainText('Build failed');
    const reloaded = await win.evaluate(id => window.cc.pluginApps.reload(id), id);
    expect(reloaded).toEqual({ ok: true, value: true });
  }
  await expect.poll(states).toEqual(running);
  await expect.poll(registered).toEqual(expected);
  const { root, before } = JSON.parse(readFileSync(join(home, 'provider-artifacts.json'), 'utf8'));
  expect(artifactState(root)).toEqual(before);
});

});
}

test.describe('unavailable provider recovery', () => {
  test.use({
    launchEnv: async ({ home }, use) => {
      const executable = process.env.ZCC_E2E_EXECUTABLE_PATH;
      const sourceRoot = executable
        ? join(process.platform === 'darwin' ? resolve(dirname(executable), '..', 'Resources') : join(dirname(executable), 'resources'), 'plugins')
        : join(process.env.ZCC_E2E_APP_ROOT ?? fileURLToPath(new URL('../', import.meta.url)), 'plugins');
      const root = join(home, 'broken-plugins');
      cpSync(join(sourceRoot, 'provider-codex'), join(root, 'provider-codex'), {
        recursive: true, filter: path => !path.split(sep).includes('node_modules')
      });
      const artifact = join(root, 'provider-codex/dist/host.js');
      writeFileSync(join(home, 'good-host.js'), readFileSync(artifact));
      writeFileSync(artifact, 'corrupted release artifact');
      await use({ ZCC_BUNDLED_PLUGINS_DIR: root, ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD: '0', NODE_PATH: '' });
    }
  });
  test('shows the failed provider and recovery guidance, then reloads a repaired artifact', async ({ app, home }) => {
    const win = app.window;
    const provider = () => win.evaluate(async () => {
      const body = await (await fetch('/api/v1/threads/providers')).json();
      return body.providers.find((row: { id: string }) => row.id === 'codex');
    });
    await expect.poll(provider).toMatchObject({ id: 'codex', available: false, unavailableReason: expect.stringContaining('digest') });
    await win.getByTestId('nav-extensions').click();
    await win.getByTestId('extensions-nav-installed').click();
    await win.getByRole('button', { name: /^Coding agents/ }).click();
    await expect(win.getByTestId('plugin-row-provider-codex')).toBeVisible();
    await expect(win.getByTestId('plugin-row-provider-codex')).toContainText('Degraded');
    const options = await win.evaluate(async () => (await fetch('/api/v1/system/execution-options?providerId=codex')).json());
    expect(options.models).toEqual([]);
    expect(options.modelLoadError).toMatchObject({ code: 'provider_unavailable', detail: expect.stringContaining('Open Plugins') });
    writeFileSync(join(home, 'broken-plugins/provider-codex/dist/host.js'), readFileSync(join(home, 'good-host.js')));
    expect(await win.evaluate(() => window.cc.pluginApps.reload('provider-codex'))).toEqual({ ok: true, value: true });
    await expect.poll(provider).toMatchObject({ id: 'codex', available: true, unavailableReason: null });
    await expect(win.getByTestId('plugin-row-provider-codex')).not.toContainText('Degraded');
  });
});
