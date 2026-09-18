import { test, expect } from './fixtures/app.js';
import type { Locator, Page } from '@playwright/test';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const fixtureBin = join(repoRoot, 'e2e', 'fixtures', 'bin');

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

// OpenCode uses the same mode picker and portable projection as Modern:
// Agent/Plan first, then project-specific custom agents.
function roleTrigger(modal: Locator) {
  return modal.locator('[data-testid="composer-mode-picker-trigger"]');
}

async function openRoleMenu(window: Page, modal: Locator, timeout = 5_000) {
  const trigger = roleTrigger(modal);
  await expect(trigger).toBeVisible({ timeout });
  await trigger.click();
  const menu = window.getByRole('listbox', { name: 'Composer mode' });
  await expect(menu).toBeVisible();
  return menu;
}

async function readRoleLabels(window: Page, modal: Locator, timeout = 5_000) {
  const menu = await openRoleMenu(window, modal, timeout);
  await expect.poll(async () => (
    (await menu.getByRole('option').allTextContents())
      .map((label) => label.replace(/^∞/, '').trim())
      .filter((label) => label !== 'Refresh roles')
  ), { timeout }).not.toEqual(['Agent']);
  const labels = (await menu.getByRole('option').allTextContents())
    .map((label) => label.replace(/^∞/, '').trim())
    .filter((label) => label !== 'Refresh roles');
  await roleTrigger(modal).click(); // toggle the popover closed
  await expect(menu).toBeHidden();
  return labels;
}

async function selectRole(window: Page, modal: Locator, value: string) {
  const menu = await openRoleMenu(window, modal);
  await menu.getByRole('option', { name: new RegExp(`^${value}$`, 'i') }).click();
}

async function refreshRoles(window: Page, modal: Locator) {
  const menu = await openRoleMenu(window, modal);
  await menu.getByText('Refresh roles', { exact: true }).click();
  await roleTrigger(modal).click();
  await expect(menu).toBeHidden();
}

// The CLI Agent composer rests on claude-code (Modern-parity default), so the
// OpenCode harness — and its native-role picker — only appear after the user
// explicitly picks OpenCode in the model/harness popover. Provider tab ids are
// the thread provider id; OpenCode maps to `acp-opencode`.
async function selectHarness(window: Page, modal: Locator, providerId: string) {
  const trigger = modal.locator('[data-testid="model-reasoning-picker-trigger"]');
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
  const tab = window.locator(`[data-testid="model-reasoning-provider-${providerId}"]`);
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await trigger.click(); // switching harness leaves the popover open; close it
}

// Deterministic coverage: the CLI picker reads native roles from the ACP
// session-mode list — the SAME source as the Modern composer. The fake ACP
// agent (shimmed as `opencode` on PATH) advertises a `mode` configOption on
// `session/new`; enabling `FAKE_ACP_MODE_CONFIG` makes it offer Build/Plan.
test.describe('OpenCode native-role picker (ACP mode parity)', () => {
  test.use({
    initialConfig: { nativeAgentDiscoveryEnabled: true },
    launchEnv: {
      PATH: `${fixtureBin}${delimiter}${process.env.PATH ?? ''}`,
      FAKE_ACP_MODEL_CONFIG: '1',
      FAKE_ACP_MODE_CONFIG: '1'
    }
  });

  test('lists the session-advertised ACP modes with plain names, matching Modern', async ({ app }) => {
    const { window } = app;
    const projectDir = mkdtempSync(join(tmpdir(), 'zcc-opencode-picker-'));
    writeFileSync(join(projectDir, '.zcc-doc-vault-agent'), 'project-only');
    const projectName = basename(projectDir);
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
      await expect(openCodeSettings.locator('.opener-row-status--ok').first()).toHaveAttribute('title', /1\.18\.10/);

      projectId = await window.evaluate(async (path) => {
        const result = await window.cc.projects.add(path);
        return (result as { value: { id: string } }).value.id;
      }, projectDir);
      await goToAgents(window);
      const modal = await openLegacyAgentLauncher(window);
      await selectTargetProject(window, modal, projectName);
      await selectHarness(window, modal, 'acp-opencode');

      // Plain names, no `[state]` decoration — identical to the Modern list.
      expect(await readRoleLabels(window, modal, 30_000)).toEqual(['Agent', 'Plan', 'Doc-Vault']);
      await expect(roleTrigger(modal)).toContainText('Agent');
      await expect(modal.locator('[data-testid="model-reasoning-picker-trigger"]')).not.toContainText('Model chosen by');
      await selectRole(window, modal, 'doc-vault');
      await expect(modal.locator('[data-testid="model-reasoning-picker-trigger"]')).toContainText('Model chosen by Doc-Vault');
      await selectRole(window, modal, 'plan');
      await expect(roleTrigger(modal)).toContainText('Plan');
      // Refresh re-fetches the provider catalog; the fake advertises the same set.
      await refreshRoles(window, modal);
      expect(await readRoleLabels(window, modal)).toEqual(['Agent', 'Plan', 'Doc-Vault']);
    } finally {
      if (projectId) await window.evaluate((id) => window.cc.projects.remove(id), projectId);
      await window.evaluate(() => window.cc.config.set({
        defaultHarness: undefined,
        opencodeBinary: undefined
      }));
      rmSync(projectDir, { recursive: true, force: true });
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

    // Native roles are the real opencode ACP session modes — plain names,
    // identical to the Modern composer. A mode that maps to a subagent is still
    // offered here even though the legacy CLI picker used to filter it out.
    const labels = await readRoleLabels(window, modal, 30_000);
    expect(labels).toEqual(expect.arrayContaining(['Agent', 'Plan']));
    // No `[state]` decoration — plain names only.
    expect(labels.some((label) => label.includes('['))).toBe(false);
    await selectRole(window, modal, 'plan');
    await expect(roleTrigger(modal)).toContainText('plan');
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
      await expect(openCodeSettings.locator('.opener-row-status').first()).toHaveClass(/opener-row-status--ok/);

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
      expect(options).toEqual(expect.arrayContaining(['Agent', 'Plan']));
      // Plain names, and at least one project-specific mode beyond Agent/Plan.
      expect(options.some((label) => label.includes('['))).toBe(false);
      expect(options.some((label) => label !== 'Agent' && label !== 'Plan')).toBe(true);
      await selectRole(window, modal, 'plan');
      await expect(roleTrigger(modal)).toContainText('Plan');
    } finally {
      if (projectId) await window.evaluate((id) => window.cc.projects.remove(id), projectId);
    }
  });
});
