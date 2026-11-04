/**
 * CLI Agent uses the same ModelReasoningPicker + execution-options catalog as
 * Modern Thread. The PTY adapter snapshot (Haiku/Sonnet/Opus/Fable `(latest)`)
 * is only a loading placeholder — once the catalog is ready, More models holds
 * selectedOnly aliases and the mode chip sits left of the harness trigger.
 */
import { test, expect, launchApp } from './fixtures/app.js';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { makeFakeAgentBinary } from './sdk/harness.js';

const PTY_ALIAS_IDS = ['haiku', 'sonnet', 'opus', 'fable'] as const;
const catalogAgent = makeFakeAgentBinary({ script: [
  'if [ "$1" = "--version" ]; then echo "2.1.284 (Claude Code)"; exit 0; fi',
  'exit 78'
].join('\n') });
symlinkSync(resolve('e2e/fixtures/claude-model-cli.cjs'), join(catalogAgent.dir, 'claude'));
const catalogEnv = { PATH: `${catalogAgent.dir}${delimiter}${process.env.PATH ?? ''}` };

test.afterAll(() => catalogAgent.cleanup());

async function openCliAgentLauncher(window: Page) {
  await window.locator('[data-testid="nav-agents"]').click();
  if (await window.locator('[data-testid="agents-new"]').count()) {
    await window.locator('[data-testid="agents-new"]').click();
  } else if (await window.locator('[data-testid="agents-new-empty"]').count()) {
    await window.locator('[data-testid="agents-new-empty"]').click();
  } else {
    await window.locator('[data-testid="agents-board-new-thread"]').first().click();
  }
  const modal = window.locator('[data-testid="launch-modal"]');
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'CLI Agent' }).click();
  return modal;
}

async function assertChipLeftOf(left: Locator, right: Locator) {
  await expect(left).toBeVisible({ timeout: 15_000 });
  await expect(right).toBeVisible({ timeout: 15_000 });
  const leftBox = await left.boundingBox();
  const rightBox = await right.boundingBox();
  expect(leftBox, 'mode chip bounding box').toBeTruthy();
  expect(rightBox, 'harness chip bounding box').toBeTruthy();
  expect(leftBox!.x).toBeLessThan(rightBox!.x);
}

test('CLI Agent mode sits left of harness and uses the Thread catalog, not PTY aliases', async ({ home }) => {
  const app = await launchApp(home, {
    // PATH is headed by the deterministic SDK fixture, so no live Claude runs.
    allowLiveClaude: true,
    env: catalogEnv,
    initialConfig: { claudeBinary: catalogAgent.path, defaultHarness: 'claude' }
  });
  try {
    const { window } = app;
    const modal = await openCliAgentLauncher(window);
    const mode = modal.getByTestId('composer-mode-picker-trigger');
    const trigger = modal.getByTestId('model-reasoning-picker-trigger');
    await expect(trigger.locator('[data-model-loading-placeholder="trigger-model"]')).toHaveCount(0, {
      timeout: 30_000
    });
    await assertChipLeftOf(mode, trigger);

    await trigger.click();
    const menu = window.getByTestId('model-reasoning-picker-menu');
    await expect(menu).toBeVisible();
    await expect(window.getByTestId('model-reasoning-more-toggle')).toBeVisible({ timeout: 30_000 });
    for (const id of PTY_ALIAS_IDS) {
      await expect(menu.getByTestId(`model-reasoning-model-${id}`)).toHaveCount(0);
    }
    await expect(menu.locator('[data-testid^="model-reasoning-model-claude-"]').first()).toBeVisible();

    await window.getByTestId('model-reasoning-more-toggle').click();
    await expect(window.getByTestId('model-reasoning-more-menu')).toBeVisible();
  } finally {
    await app.electron.close();
  }
});

test('CLI Agent offers Opus 5.5 1M and launches its exact model id', async ({ home }) => {
  const projectPath = join(home, 'opus-project');
  mkdirSync(projectPath, { recursive: true });
  mkdirSync(join(home, '.zcc'), { recursive: true });
  writeFileSync(join(home, '.zcc', 'projects.json'), JSON.stringify([
    { id: 'opus-project', name: 'Opus project', path: projectPath }
  ]));
  const agent = makeFakeAgentBinary({ script: [
    'if [ "$1" = "--version" ]; then echo "2.1.284 (Claude Code)"; exit 0; fi',
    'printf "%s\\n" "$@" > .claude-launch-argv',
    'while [ "$#" -gt 0 ]; do',
    '  if [ "$1" = "--model" ]; then shift; picked_model="$1"; fi',
    '  shift',
    'done',
    '[ "$picked_model" = "claude-opus-5-5[1m]" ] || exit 64',
    'printf "\\033]2;\\342\\240\\211 Opus 5.5 ready\\007"',
    'cat'
  ].join('\n') });
  const app = await launchApp(home, {
    allowLiveClaude: true,
    env: catalogEnv,
    initialConfig: { claudeBinary: agent.path, defaultHarness: 'claude', lastProjectId: 'opus-project' }
  });
  try {
    const { window } = app;
    // The renderer can mount before bundled providers finish registering.
    // Wait for the real catalog rather than treating first paint as readiness.
    await expect(async () => {
      const catalog = await window.evaluate(async () => {
        const response = await fetch('/api/v1/system/execution-options?providerId=claude-code&projectId=opus-project');
        if (!response.ok) throw new Error(`Execution options: ${response.status}`);
        return response.json();
      });
      expect(catalog.modelLoadError, JSON.stringify(catalog)).toBeNull();
      expect(catalog.models).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'claude-opus-5-5[1m]', model: 'claude-opus-5-5[1m]', displayName: 'Opus 5.5 (1M)' }),
        expect.objectContaining({ id: 'claude-opus-5-5', displayName: 'Opus 5.5' })
      ]));
      expect(catalog.models.some((row: { id: string }) => row.id === 'claude-opus-5[1m]')).toBe(false);
    }).toPass({ timeout: 30_000 });

    const modal = await openCliAgentLauncher(window);
    await modal.getByTestId('model-reasoning-picker-trigger').click();
    const model = window.getByTestId('model-reasoning-model-claude-opus-5-5[1m]');
    await expect(model).toContainText('Opus 5.5 (1M)');
    await model.click();
    await modal.getByTestId('legacy-agent-command-input').fill('Check the selected model');
    await modal.getByTestId('legacy-agent-command-send').click();
    await expect(modal).toBeHidden({ timeout: 30_000 });
    await expect.poll(() => {
      try { return readFileSync(join(projectPath, '.claude-launch-argv'), 'utf8'); }
      catch { return ''; }
    }).toContain('--model\nclaude-opus-5-5[1m]\n');
    await expect(window.getByTestId('agent-modal-state')).toHaveAttribute('data-state', 'working');
  } finally {
    try {
      await app.window.evaluate(async () => {
        for (const session of await window.cc.terminals.list('opus-project')) {
          await window.cc.terminals.close(session.id);
        }
      });
      await app.electron.close();
    } finally {
      agent.cleanup();
    }
  }
});

test('local project switches reuse models while remote discovery remains pending', async ({ home }) => {
  const remoteId = 'composer-remote-project';
  const remoteHost = 'composer-remote-host';
  const localProjects = [
    { id: 'composer-local-a', name: 'Local A', path: join(home, 'local-a') },
    { id: 'composer-local-b', name: 'Local B', path: join(home, 'local-b') }
  ];
  mkdirSync(join(home, '.zcc'), { recursive: true });
  for (const project of localProjects) mkdirSync(project.path, { recursive: true });
  writeFileSync(join(home, '.zcc', 'projects.json'), JSON.stringify([
    { id: remoteId, name: 'Remote first in store', path: '/remote', hostId: remoteHost },
    ...localProjects
  ]));
  const app = await launchApp(home, { initialConfig: { lastProjectId: remoteId, defaultHarness: 'claude' } });
  const { window } = app;
  let releaseRemote!: () => void;
  const remoteGate = new Promise<void>((resolve) => { releaseRemote = resolve; });
  const requests: string[] = [];
  await window.route('**/api/v1/system/execution-options*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    const remote = url.searchParams.get('hostId') === remoteHost;
    if (remote || url.searchParams.get('projectId') === 'composer-local-b') await remoteGate;
    await route.fulfill({ json: {
      providers: [{ id: 'claude-code', displayName: 'Claude', available: true,
        composerActions: [], capabilities: { permissionModes: ['full'] } }],
      models: [{ id: remote ? 'remote-model' : 'local-model', model: remote ? 'remote-model' : 'local-model',
        displayName: remote ? 'Remote Model' : 'Local Model', isDefault: true,
        supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }],
        defaultReasoningEffort: 'medium' }],
      selectedOnlyModels: [], modelLoadError: null, permissionCeiling: 'full'
    } });
  });
  try {
    await window.reload();
    await window.getByRole('button', { name: 'Open Remote first in store', exact: true }).click();
    await window.evaluate(() => {
      window.history.pushState({}, '', '/agents');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    const modal = await openCliAgentLauncher(window);
    const project = modal.getByRole('button', { name: 'Machine and project', exact: true });
    const model = modal.getByTestId('model-reasoning-picker-trigger');
    await expect(project).not.toContainText('Remote first in store');
    const choose = async (name: string) => {
      await project.click();
      await window.getByRole('listbox', { name: 'Machine and project' }).getByRole('option', { name, exact: false }).click();
      await expect(project).toContainText(name);
    };
    // Warm model rows can render before this project's own discovery finishes.
    // Measure cache reuse only after its selected provider response has arrived.
    const localCatalogReady = window.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/system/execution-options'
        && url.searchParams.get('projectId') === 'composer-local-a'
        && url.searchParams.get('providerId') === 'claude-code';
    });
    await choose('Local A');
    await localCatalogReady;
    await expect(model).toContainText('Local Model');
    const localRequestCount = () => requests.filter((query) => query.includes('composer-local-a')).length;
    const count = localRequestCount();
    await choose('Remote first in store');
    await expect.poll(() => requests.some((query) => query.includes(remoteHost))).toBe(true);
    await choose('Local B');
    await expect(model).toContainText('Local Model', { timeout: 2_000 });
    await expect(model.locator('[data-model-loading-placeholder]')).toHaveCount(0);
    await choose('Local A');
    await expect(model).toContainText('Local Model');
    expect(localRequestCount(), JSON.stringify(requests)).toBe(count);
    await modal.getByRole('button', { name: 'Modern', exact: true }).click();
    await expect(modal.getByTestId('model-reasoning-picker-trigger')).toContainText('Local Model');
    expect(localRequestCount(), JSON.stringify(requests)).toBe(count);
  } finally {
    releaseRemote();
    try { await window.unrouteAll({ behavior: 'wait' }); } finally { await app.electron.close(); }
  }
});
