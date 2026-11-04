import { cpSync, mkdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/app.js';

const plugins = ['provider-codex', 'provider-claude-code', 'provider-acp', 'provider-pi'];
const providers = ['codex', 'claude-code', 'acp-cursor', 'acp-opencode', 'acp-omp', 'acp-grok', 'acp-mastracode', 'acp-hermes-agent', 'pi'];

test.use({
  initialConfig: { agentsBoardView: 'board', sponsorPromptDismissed: true },
  launchEnv: async ({ home }, use) => {
    const root = join(home, 'icon-plugins');
    const empty = join(home, 'empty-extensions');
    mkdirSync(empty);
    const buildRoot = process.env.ZCC_E2E_APP_ROOT ?? fileURLToPath(new URL('../', import.meta.url));
    for (const id of plugins) {
      cpSync(join(buildRoot, 'plugins', id), join(root, id), {
        recursive: true, filter: path => !path.split(sep).includes('node_modules')
      });
    }
    await use({ ZCC_BUNDLED_PLUGINS_DIR: root, ZCC_BUNDLED_EXTENSIONS_DIR: empty,
      ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD: '0' });
  }
});

test('board harness icons retain their size after plugin hydration and reload', async ({ app }) => {
  const win = app.window;
  test.setTimeout(120_000);
  const projectId = await win.evaluate(async () => {
    const body = await (await fetch('/api/v1/projects')).json();
    return body.projects[0].id as string;
  });
  // Only the roster is synthetic; use the real shipped provider renderers and
  // plugin lifecycle without starting authenticated provider sessions.
  await win.route(/\/api\/v1\/threads(?:\?.*)?$/, route => route.fulfill({
    json: { threads: providers.map(providerId => ({
      id: `icon-${providerId}`, providerId, projectId, hostId: 'local',
      environmentId: null, title: `Icon probe ${providerId}`, status: 'idle',
      createdAt: Date.now(), cwd: null, branchName: null, isWorktree: false
    })) }
  }));
  let releaseIcons!: () => void;
  const iconsReady = new Promise<void>(resolve => { releaseIcons = resolve; });
  await win.route(/\/plugins\/provider-[^/]+\/assets\/.*\.js(?:\?.*)?$/, async route => {
    await iconsReady;
    await route.continue();
  });
  const sizes = () => win.locator('.agent-card.is-thread .agent-card-icon svg').evaluateAll(icons => icons.map(icon => {
    const { width, height } = icon.getBoundingClientRect();
    // Electron's display scaling can produce fractional CSS pixels.
    return { width: Math.round(width), height: Math.round(height) };
  }));
  const expectedSizes = providers.map(() => ({ width: 14, height: 14 }));
  try {
    await win.reload({ waitUntil: 'domcontentloaded' });
    await win.getByTestId('nav-agents').click();
    await win.getByRole('button', { name: 'Board view', exact: true }).click();
    await expect.poll(sizes).toEqual(expectedSizes);
    await expect(win.locator('.agent-card-icon svg title')).toHaveCount(0);
  } finally {
    releaseIcons();
  }
  await expect(win.locator('.agent-card-icon svg title')).toHaveCount(providers.length);
  await expect.poll(sizes).toEqual(expectedSizes);
  for (const id of plugins) {
    expect(await win.evaluate(id => window.cc.pluginApps.reload(id), id)).toEqual({ ok: true, value: true });
  }
  await expect(win.locator('.agent-card-icon svg title')).toHaveCount(providers.length);
  await expect.poll(sizes).toEqual(expectedSizes);
});
