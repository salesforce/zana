/**
 * CLI Agent uses the same ModelReasoningPicker + execution-options catalog as
 * Modern Thread. The PTY adapter snapshot (Haiku/Sonnet/Opus/Fable `(latest)`)
 * is only a loading placeholder — once the catalog is ready, More models holds
 * selectedOnly aliases and the mode chip sits left of the harness trigger.
 */
import { test, expect, launchApp } from './fixtures/app.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';

const PTY_ALIAS_IDS = ['haiku', 'sonnet', 'opus', 'fable'] as const;

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

test('CLI Agent mode sits left of harness and uses the Thread catalog, not PTY aliases', async ({ app }) => {
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
  const app = await launchApp(home, { initialConfig: { lastProjectId: remoteId } });
  const { window } = app;
  let releaseRemote!: () => void;
  const remoteGate = new Promise<void>((resolve) => { releaseRemote = resolve; });
  const requests: string[] = [];
  await window.route('**/api/v1/system/execution-options*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    const remote = url.searchParams.get('hostId') === remoteHost;
    if (remote) await remoteGate;
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
    const project = modal.getByRole('button', { name: 'Project', exact: true });
    const model = modal.getByTestId('model-reasoning-picker-trigger');
    await expect(project).not.toContainText('Remote first in store');
    const choose = async (name: string) => {
      await project.click();
      await window.getByRole('listbox', { name: 'Project' }).getByRole('option', { name, exact: false }).click();
      await expect(project).toContainText(name);
    };
    await choose('Local A');
    await expect(model).toContainText('Local Model');
    const localRequestCount = () => requests.filter((query) => !query.includes(remoteHost)).length;
    const count = localRequestCount();
    await choose('Remote first in store');
    await expect.poll(() => requests.some((query) => query.includes(remoteHost))).toBe(true);
    await choose('Local B');
    await expect(model).toContainText('Local Model', { timeout: 2_000 });
    await expect(model.locator('[data-model-loading-placeholder]')).toHaveCount(0);
    await choose('Local A');
    await expect(model).toContainText('Local Model');
    expect(localRequestCount()).toBe(count);
    await modal.getByRole('button', { name: 'Modern', exact: true }).click();
    await expect(modal.getByTestId('model-reasoning-picker-trigger')).toContainText('Local Model');
    expect(localRequestCount()).toBe(count);
  } finally {
    releaseRemote();
    try { await window.unrouteAll({ behavior: 'wait' }); } finally { await app.electron.close(); }
  }
});
