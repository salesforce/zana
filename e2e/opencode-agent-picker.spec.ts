import { test, expect } from './fixtures/app.js';
import type { Locator, Page } from '@playwright/test';
import { makeFakeOpenCodeBinary, makeRefreshableFakeOpenCodeBinary } from './sdk/harness.js';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

async function selectTargetProject(
  window: Page,
  modal: Locator,
  projectName: string
) {
  // CLI Agent mode's composer owns project selection via its "Project" picklist.
  const trigger = modal.getByRole('button', { name: 'Project' });
  await trigger.click();
  await window
    .getByRole('listbox', { name: 'Project' })
    .getByRole('option', { name: projectName, exact: true })
    .click();
  await expect(trigger).toContainText(projectName);
}

// Settings replaces the global rail with its own section nav, so leave it via
// the Back link (when present) before reaching the global Agents rail entry.
async function goToAgents(window: Page) {
  const back = window.locator('.settings-app-back');
  if (await back.count()) await back.click();
  await window.locator('[data-testid="nav-agents"]').click();
}

async function openLegacyAgentLauncher(window: Page) {
  // The global Agents board's "New agent" button opens the launcher.
  await window.locator('[data-testid="agents-board-new-thread"]').first().click();
  const modal = window.locator('[data-testid="launch-modal"]');
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'CLI Agent' }).click();
  return modal;
}

// The native-role picker is a popover chip that only renders for the OpenCode
// family. Its trigger lives in the composer; its menu portals to document.body.
// There is no "Use harness default" sentinel — discovered roles are listed
// directly and the first role is the resting selection.
function roleTrigger(modal: Locator) {
  return modal.locator('[data-testid="native-role-picker-trigger"]');
}

async function openRoleMenu(window: Page, modal: Locator, timeout = 5_000) {
  const trigger = roleTrigger(modal);
  await expect(trigger).toBeVisible({ timeout });
  await trigger.click();
  const menu = window.locator('[data-testid="native-role-picker-menu"]');
  await expect(menu).toBeVisible();
  return menu;
}

async function readRoleLabels(window: Page, modal: Locator, timeout = 5_000) {
  const menu = await openRoleMenu(window, modal, timeout);
  const labels = (await menu.getByRole('option').allTextContents()).map((label) => label.trim());
  await roleTrigger(modal).click(); // toggle the popover closed
  await expect(menu).toBeHidden();
  return labels;
}

async function selectRole(window: Page, modal: Locator, value: string) {
  await openRoleMenu(window, modal);
  await window.locator(`[data-testid="native-role-${value}"]`).click();
}

async function refreshRoles(window: Page, modal: Locator) {
  await openRoleMenu(window, modal);
  await window.locator('[data-testid="native-role-refresh"]').click();
}

// The CLI Agent composer now rests on claude-code (Modern-parity default), so
// the OpenCode harness — and its native-role picker — only appear after the
// user explicitly picks OpenCode in the model/harness popover. Provider tab
// ids are the thread provider id; OpenCode maps to `acp-opencode`.
async function selectHarness(window: Page, modal: Locator, providerId: string) {
  const trigger = modal.locator('[data-testid="model-reasoning-picker-trigger"]');
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
  const tab = window.locator(`[data-testid="model-reasoning-provider-${providerId}"]`);
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await trigger.click(); // switching harness leaves the popover open; close it
}

test('OpenCode agent picker loads effective visible primary agents through real IPC', async ({ app }) => {
  const { window } = app;
  const openCode = makeFakeOpenCodeBinary();
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-opencode-picker-'));
  const projectName = basename(projectDir);
  let projectId: string | null = null;

  try {
    await window.evaluate((bin) => window.cc.config.set({
      harnessOpenCodeEnabled: true,
      defaultHarness: 'opencode',
      opencodeBinary: bin
    }), openCode.path);
    await window.getByRole('link', { name: 'Settings' }).click();
    await window.locator('.settings-section-item').filter({ hasText: 'Code Harness' }).click();
    const openCodeSettings = window.locator('#settings-anchor-harness-opencode');
    await expect(openCodeSettings.locator('.opener-row-status')).toHaveClass(/opener-row-status--ok/);

    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      return (result as { value: { id: string } }).value.id;
    }, projectDir);
    await goToAgents(window);
    const modal = await openLegacyAgentLauncher(window);
    await selectTargetProject(window, modal, projectName);
    await selectHarness(window, modal, 'acp-opencode');

    expect(await readRoleLabels(window, modal, 30_000)).toEqual([
      'build [Accept Edits, Autonomous]',
      'plan [Plan]'
    ]);
    await selectRole(window, modal, 'plan');
    await expect(roleTrigger(modal)).toContainText('plan [Plan]');
    await refreshRoles(window, modal);
    expect(await readRoleLabels(window, modal)).toEqual([
      'build [Accept Edits, Autonomous]',
      'plan [Plan]'
    ]);
  } finally {
    if (projectId) await window.evaluate((id) => window.cc.projects.remove(id), projectId);
    await window.evaluate(() => window.cc.config.set({
      defaultHarness: undefined,
      opencodeBinary: undefined
    }));
    openCode.cleanup();
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('OpenCode picker holds cached agents until explicit Refresh', async ({ app }) => {
  const { window } = app;
  const openCode = makeRefreshableFakeOpenCodeBinary();
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-opencode-refresh-'));
  const projectName = basename(projectDir);
  let projectId: string | null = null;

  try {
    await window.evaluate((bin) => window.cc.config.set({
      harnessOpenCodeEnabled: true,
      defaultHarness: 'opencode',
      opencodeBinary: bin
    }), openCode.path);
    await window.getByRole('link', { name: 'Settings' }).click();
    await window.locator('.settings-section-item').filter({ hasText: 'Code Harness' }).click();
    await expect(window.locator('#settings-anchor-harness-opencode .opener-row-status')).toHaveClass(/opener-row-status--ok/);
    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      return (result as { value: { id: string } }).value.id;
    }, projectDir);
    await goToAgents(window);
    const modal = await openLegacyAgentLauncher(window);
    await selectTargetProject(window, modal, projectName);
    await selectHarness(window, modal, 'acp-opencode');

    expect(await readRoleLabels(window, modal, 30_000)).toEqual([
      'build [Accept Edits, Autonomous]',
      'plan [Plan]'
    ]);
    writeFileSync(openCode.refreshMarker, 'updated');
    expect(await readRoleLabels(window, modal)).toEqual([
      'build [Accept Edits, Autonomous]',
      'plan [Plan]'
    ]);
    await refreshRoles(window, modal);
    expect(await readRoleLabels(window, modal)).toEqual([
      'build [Accept Edits, Autonomous]',
      'review'
    ]);
  } finally {
    if (projectId) await window.evaluate((id) => window.cc.projects.remove(id), projectId);
    await window.evaluate(() => window.cc.config.set({ defaultHarness: undefined, opencodeBinary: undefined }));
    openCode.cleanup();
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test.describe('Quick Agent OpenCode startup warmup', () => {
  const openCode = makeRefreshableFakeOpenCodeBinary();
  test.use({
    initialConfig: {
      harnessOpenCodeEnabled: true,
      defaultHarness: 'opencode',
      opencodeBinary: openCode.path
    }
  });

  test('picker uses startup-prewarmed catalog without a second discovery', async ({ app }) => {
    const { window } = app;
    try {
      await expect.poll(() => existsSync(openCode.catalogCalls)
        ? readFileSync(openCode.catalogCalls, 'utf8').trim().split('\n').filter(Boolean).length
        : 0).toBe(1);
      await goToAgents(window);
      const modal = await openLegacyAgentLauncher(window);
      await selectHarness(window, modal, 'acp-opencode');
      expect(await readRoleLabels(window, modal, 30_000)).toEqual([
        'build [Accept Edits, Autonomous]',
        'plan [Plan]'
      ]);
      expect(readFileSync(openCode.catalogCalls, 'utf8').trim().split('\n')).toHaveLength(1);
    } finally {
      openCode.cleanup();
    }
  });
});

test('real OpenCode CLI agents become selectable through Electron UI', async ({ app }) => {
  test.skip(process.env.ZCC_LIVE_OPENCODE !== '1', 'requires installed OpenCode CLI');
  const { window } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-opencode-live-picker-'));
  const projectName = basename(projectDir);
  copyFileSync(join(process.cwd(), 'opencode.json'), join(projectDir, 'opencode.json'));
  let projectId: string | null = null;

  try {
    await window.evaluate(() => window.cc.config.set({
      harnessOpenCodeEnabled: true,
      defaultHarness: 'opencode',
      opencodeBinary: undefined
    }));
    await window.getByRole('link', { name: 'Settings' }).click();
    await window.locator('.settings-section-item').filter({ hasText: 'Code Harness' }).click();
    const openCodeSettings = window.locator('#settings-anchor-harness-opencode');
    await expect(openCodeSettings.locator('.opener-row-status')).toHaveClass(/opener-row-status--ok/);

    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message);
      return result.value.id;
    }, projectDir);
    await goToAgents(window);
    const modal = await openLegacyAgentLauncher(window);
    await selectTargetProject(window, modal, projectName);
    await selectHarness(window, modal, 'acp-opencode');

    const labels = await readRoleLabels(window, modal, 30_000);
    expect(labels).toEqual(expect.arrayContaining([
      'build [Accept Edits, Autonomous]',
      'plan [Plan]',
      'doc-vault',
      'test-primary'
    ]));
    expect(labels).not.toEqual(expect.arrayContaining(['compaction', 'summary', 'title', 'test-subagent']));
    await selectRole(window, modal, 'plan');
    await expect(roleTrigger(modal)).toContainText('plan [Plan]');
  } finally {
    if (projectId) await window.evaluate((id) => window.cc.projects.remove(id), projectId);
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test.describe('real OpenCode home integration', () => {
  test.use({ e2e: true, launchEnv: { ZCC_E2E_PRESERVE_HOME: '1' } });

  test('actual project agents become selectable through Electron UI', async ({ app, events }) => {
    test.skip(process.env.ZCC_LIVE_OPENCODE !== '1', 'requires installed OpenCode CLI');
    const { window } = app;
    const projectPath = process.cwd();
    const projectName = basename(projectPath);
    let projectId: string | null = null;

    try {
      await window.evaluate(() => window.cc.config.set({
        harnessOpenCodeEnabled: true,
        defaultHarness: 'opencode',
        opencodeBinary: undefined
      }));
      await window.getByRole('link', { name: 'Settings' }).click();
      await window.locator('.settings-section-item').filter({ hasText: 'Code Harness' }).click();
      const openCodeSettings = window.locator('#settings-anchor-harness-opencode');
      await expect(openCodeSettings.locator('.opener-row-status')).toHaveClass(/opener-row-status--ok/);

      projectId = await window.evaluate(async (path) => {
        const result = await window.cc.projects.add(path);
        if (!result.ok) throw new Error(result.message);
        return result.value.id;
      }, projectPath);
      await goToAgents(window);
      const modal = await openLegacyAgentLauncher(window);
      await selectTargetProject(window, modal, projectName);
    await selectHarness(window, modal, 'acp-opencode');

      await expect(roleTrigger(modal)).toBeVisible({ timeout: 30_000 }).catch(async (error) => {
        await events.poll();
        const harnessLogs = events.collect().filter((entry) =>
          entry.kind === 'log' && JSON.stringify(entry.args).includes('OpenCode')
        );
        throw new Error(`${error.message}\nRelevant main logs:\n${JSON.stringify(harnessLogs, null, 2)}`);
      });
      const options = await readRoleLabels(window, modal, 30_000);
      expect(options).toEqual(expect.arrayContaining([
        'build [Accept Edits, Autonomous]',
        'plan [Plan]'
      ]));
      expect(options.some((option) =>
        !option.startsWith('build') && !option.startsWith('plan'))).toBe(true);
      expect(options).not.toEqual(expect.arrayContaining(['compaction', 'summary', 'title', 'test-subagent']));
      await selectRole(window, modal, 'plan');
      await expect(roleTrigger(modal)).toContainText('plan [Plan]');
    } finally {
      if (projectId) await window.evaluate((id) => window.cc.projects.remove(id), projectId);
    }
  });
});
