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
  const trigger = modal.getByRole('button', { name: 'Target project' });
  await trigger.click();
  await window
    .getByRole('listbox', { name: 'Target project' })
    .getByRole('option', { name: projectName, exact: true })
    .click();
  await expect(trigger).toContainText(projectName);
}

async function openLegacyAgentLauncher(window: Page) {
  const newButton = window.locator('[data-testid="agents-new"]');
  if (await newButton.count()) await newButton.click();
  else await window.locator('[data-testid="agents-new-empty"]').click();
  const modal = window.locator('[data-testid="launch-modal"]');
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'CLI Agent' }).click();
  return modal;
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
    await window.locator('[data-testid="nav-settings"]').click();
    await window.locator('.settings-section-item').filter({ hasText: 'Code Harness' }).click();
    const openCodeSettings = window.locator('#settings-anchor-harness-opencode');
    await expect(openCodeSettings.locator('.opener-row-status')).toHaveClass(/opener-row-status--ok/);

    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      return (result as { value: { id: string } }).value.id;
    }, projectDir);
    await window.locator('[data-testid="nav-projects"]').click();
    await window.locator('button[aria-label="Reload project list"]').click();
    await window.locator('[data-testid="nav-agents"]').click();
    const modal = await openLegacyAgentLauncher(window);
    await selectTargetProject(window, modal, projectName);
    const harness = modal.getByLabel('Launch harness').locator('[data-testid="launch-profile-opencode"]');
    await expect(harness).toBeEnabled();
    await harness.click();
    await modal.getByRole('button', { name: 'Customize launch' }).click();

    const picker = modal.locator('#launch-role-target');
    await expect(picker).toBeEnabled();
    await expect(picker.locator('option')).toHaveText(['Use harness default', 'build [Accept Edits, Autonomous]', 'plan [Plan]']);
    await picker.selectOption('plan');
    await expect(picker).toHaveValue('plan');
    await modal.getByRole('button', { name: 'Refresh agents' }).click();
    await expect(picker).toBeEnabled();
    await expect(picker.locator('option')).toHaveText(['Use harness default', 'build [Accept Edits, Autonomous]', 'plan [Plan]']);
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
    await window.locator('[data-testid="nav-settings"]').click();
    await window.locator('.settings-section-item').filter({ hasText: 'Code Harness' }).click();
    await expect(window.locator('#settings-anchor-harness-opencode .opener-row-status')).toHaveClass(/opener-row-status--ok/);
    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      return (result as { value: { id: string } }).value.id;
    }, projectDir);
    await window.locator('[data-testid="nav-projects"]').click();
    await window.locator('button[aria-label="Reload project list"]').click();
    await window.locator('[data-testid="nav-agents"]').click();
    const modal = await openLegacyAgentLauncher(window);
    await selectTargetProject(window, modal, projectName);
    await modal.getByLabel('Launch harness').locator('[data-testid="launch-profile-opencode"]').click();
    await modal.getByRole('button', { name: 'Customize launch' }).click();

    const picker = modal.locator('#launch-role-target');
    await expect(picker.locator('option')).toHaveText(['Use harness default', 'build [Accept Edits, Autonomous]', 'plan [Plan]']);
    writeFileSync(openCode.refreshMarker, 'updated');
    await expect(picker.locator('option')).toHaveText(['Use harness default', 'build [Accept Edits, Autonomous]', 'plan [Plan]']);
    await modal.getByRole('button', { name: 'Refresh agents' }).click();
    await expect(picker.locator('option')).toHaveText(['Use harness default', 'build [Accept Edits, Autonomous]', 'review']);
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
      await window.locator('[data-testid="nav-agents"]').click();
      const modal = await openLegacyAgentLauncher(window);
      await modal.getByLabel('Launch harness').locator('[data-testid="launch-profile-opencode"]').click();
      await modal.getByRole('button', { name: 'Customize launch' }).click();
      const picker = modal.locator('#launch-role-target');
      await expect(picker).toBeEnabled();
      await expect(picker.locator('option')).toHaveText([
        'Use harness default',
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
    await window.locator('[data-testid="nav-settings"]').click();
    await window.locator('.settings-section-item').filter({ hasText: 'Code Harness' }).click();
    const openCodeSettings = window.locator('#settings-anchor-harness-opencode');
    await expect(openCodeSettings.locator('.opener-row-status')).toHaveClass(/opener-row-status--ok/);

    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message);
      return result.value.id;
    }, projectDir);
    await window.locator('[data-testid="nav-projects"]').click();
    await window.locator('button[aria-label="Reload project list"]').click();
    await window.locator('[data-testid="nav-agents"]').click();
    const modal = await openLegacyAgentLauncher(window);
    await selectTargetProject(window, modal, projectName);
    const harness = modal.getByLabel('Launch harness').locator('[data-testid="launch-profile-opencode"]');
    await expect(harness).toBeEnabled();
    await harness.click();
    await modal.getByRole('button', { name: 'Customize launch' }).click();

    const picker = modal.locator('#launch-role-target');
    await expect(picker).toBeEnabled({ timeout: 30_000 });
    await expect(picker.locator('option')).toContainText(['build [Accept Edits, Autonomous]', 'plan [Plan]', 'doc-vault', 'test-primary']);
    await expect(picker.locator('option')).not.toContainText(['compaction', 'summary', 'title', 'test-subagent']);
    await picker.selectOption('plan');
    await expect(picker).toHaveValue('plan');
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
      await window.locator('[data-testid="nav-settings"]').click();
      await window.locator('.settings-section-item').filter({ hasText: 'Code Harness' }).click();
      const openCodeSettings = window.locator('#settings-anchor-harness-opencode');
      await expect(openCodeSettings.locator('.opener-row-status')).toHaveClass(/opener-row-status--ok/);

      projectId = await window.evaluate(async (path) => {
        const result = await window.cc.projects.add(path);
        if (!result.ok) throw new Error(result.message);
        return result.value.id;
      }, projectPath);
      await window.locator('[data-testid="nav-projects"]').click();
      await window.locator('button[aria-label="Reload project list"]').click();
      await window.locator('[data-testid="nav-agents"]').click();
      const modal = await openLegacyAgentLauncher(window);
      await selectTargetProject(window, modal, projectName);
      const harness = modal.getByLabel('Launch harness').locator('[data-testid="launch-profile-opencode"]');
      await expect(harness).toBeEnabled();
      await harness.click();
      await modal.getByRole('button', { name: 'Customize launch' }).click();

      const picker = modal.locator('#launch-role-target');
      await expect(picker).toBeEnabled({ timeout: 30_000 }).catch(async (error) => {
        await events.poll();
        const harnessLogs = events.collect().filter((entry) =>
          entry.kind === 'log' && JSON.stringify(entry.args).includes('OpenCode')
        );
        throw new Error(`${error.message}\nRelevant main logs:\n${JSON.stringify(harnessLogs, null, 2)}`);
      });
      const options = await picker.locator('option').allTextContents();
      expect(options).toEqual(expect.arrayContaining([
        'build [Accept Edits, Autonomous]',
        'plan [Plan]',
        'doc-vault'
      ]));
      expect(options.some((option) => option.startsWith('test-primary'))).toBe(true);
      expect(options).not.toEqual(expect.arrayContaining(['compaction', 'summary', 'title', 'test-subagent']));
      await picker.selectOption('plan');
      await expect(picker).toHaveValue('plan');
    } finally {
      if (projectId) await window.evaluate((id) => window.cc.projects.remove(id), projectId);
    }
  });
});
