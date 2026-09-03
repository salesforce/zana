import { test, expect } from './fixtures/app.js';
import type { Locator, Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const fixtureBin = join(repoRoot, 'e2e', 'fixtures', 'bin');

// The CLI Agent launch carries the picked native role as
// `harnessRouting.byAdapter.opencode.roleTargetId`. At launch the host runs
// `preflightStructuredRouting`, which calls the OpenCode provider's
// `discoverRoleTargets` — a REAL `opencode agent list` + `opencode debug agent`
// temp-file capture at the Electron production boundary. That preflight is the
// gate this spec exercises: a directly-launchable role spawns; a subagent role
// (offered as an ACP session mode but not directly launchable) is rejected
// BEFORE spawn with a `role target unavailable` error toast.
//
// The polyglot `opencode` fixture (e2e/fixtures/bin/opencode) answers both
// `acp` (populating the picker's ACP mode list) and `agent list`/`debug agent`
// (feeding preflight discovery). FAKE_ACP_MODE_OPTIONS advertises the same
// names as session modes so the picker offers them; `agent list` marks
// `reviewer` primary and `sandbox` a subagent.
test.use({
  launchEnv: {
    PATH: `${fixtureBin}${delimiter}${process.env.PATH ?? ''}`,
    FAKE_ACP_MODEL_CONFIG: '1',
    FAKE_ACP_MODE_CONFIG: '1',
    FAKE_ACP_MODE_OPTIONS: 'build:Build,plan:Plan,reviewer:Reviewer,sandbox:Sandbox'
  }
});

async function selectTargetProject(window: Page, modal: Locator, projectName: string) {
  const trigger = modal.getByRole('button', { name: 'Project' });
  await trigger.click();
  await window
    .getByRole('listbox', { name: 'Project' })
    .getByRole('option', { name: projectName, exact: true })
    .click();
  await expect(trigger).toContainText(projectName);
}

async function goToAgents(window: Page) {
  const back = window.locator('.settings-app-back');
  if (await back.count()) await back.click();
  await window.locator('[data-testid="nav-agents"]').click();
}

async function openLegacyAgentLauncher(window: Page) {
  await window.locator('[data-testid="agents-board-new-thread"]').first().click();
  const modal = window.locator('[data-testid="launch-modal"]');
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'CLI Agent' }).click();
  return modal;
}

// The CLI Agent composer rests on claude-code; OpenCode (and its native-role
// picker) only appear after explicitly picking the acp-opencode provider.
async function selectHarness(window: Page, modal: Locator, providerId: string) {
  const trigger = modal.locator('[data-testid="model-reasoning-picker-trigger"]');
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
  const tab = window.locator(`[data-testid="model-reasoning-provider-${providerId}"]`);
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await trigger.click(); // switching harness leaves the popover open; close it
}

async function selectRole(window: Page, modal: Locator, value: string, timeout = 30_000) {
  const trigger = modal.locator('[data-testid="native-role-picker-trigger"]');
  await expect(trigger).toBeVisible({ timeout });
  await trigger.click();
  await expect(window.locator('[data-testid="native-role-picker-menu"]')).toBeVisible();
  await window.locator(`[data-testid="native-role-${value}"]`).click();
}

async function enableOpenCode(window: Page) {
  await window.evaluate(() => window.cc.config.set({
    harnessOpenCodeEnabled: true,
    defaultHarness: 'opencode',
    opencodeBinary: undefined
  }));
  await window.getByRole('link', { name: 'Settings' }).click();
  await window.locator('.settings-section-item').filter({ hasText: 'Code Harness' }).click();
  const openCodeSettings = window.locator('#settings-anchor-harness-opencode');
  await expect(openCodeSettings.locator('.opener-row-status')).toHaveClass(/opener-row-status--ok/);
}

test('launches a directly-launchable OpenCode role validated by preflight discovery', async ({ app }) => {
  const { window } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-opencode-launch-ok-'));
  const projectName = basename(projectDir);
  let projectId: string | null = null;

  try {
    await enableOpenCode(window);
    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message);
      return result.value.id;
    }, projectDir);

    await goToAgents(window);
    const modal = await openLegacyAgentLauncher(window);
    await selectTargetProject(window, modal, projectName);
    await selectHarness(window, modal, 'acp-opencode');

    // The made-up `reviewer` agent is offered (as an ACP mode) and is a primary
    // in `agent list`, so preflight discovery resolves it and the launch spawns.
    // The composer auto-defaults a catalog `--model`, which the fixture rejects
    // whenever it co-occurs with `--agent` (ProviderModelNotFoundError → exit 64).
    // A successful launch here
    // therefore PROVES the composer dropped the forced model once a native role
    // was picked — the native agent pins its own model.
    await selectRole(window, modal, 'reviewer');
    await expect(modal.locator('[data-testid="native-role-picker-trigger"]')).toContainText('Reviewer');

    await modal.locator('[data-testid="legacy-agent-command-input"]').fill('review the changes');
    const send = modal.locator('[data-testid="legacy-agent-command-send"]');
    await expect(send).toBeEnabled({ timeout: 15_000 });
    await send.click();

    // Success: launcher closes and the spawned session inspector appears working.
    await expect(modal).toBeHidden({ timeout: 30_000 });
    await expect(window.locator('[data-testid="agent-terminal-modal"]')).toBeVisible({ timeout: 30_000 });
    await expect(window.locator('[data-testid="agent-modal-state"]'))
      .toHaveAttribute('data-state', 'working', { timeout: 30_000 });
  } finally {
    if (projectId) await window.evaluate((id) => window.cc.projects.remove(id), projectId);
    await window.evaluate(() => window.cc.config.set({ defaultHarness: undefined, opencodeBinary: undefined }));
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('rejects a non-directly-launchable OpenCode role at the preflight boundary', async ({ app }) => {
  const { window } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-opencode-launch-block-'));
  const projectName = basename(projectDir);
  let projectId: string | null = null;

  try {
    await enableOpenCode(window);
    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message);
      return result.value.id;
    }, projectDir);

    await goToAgents(window);
    const modal = await openLegacyAgentLauncher(window);
    await selectTargetProject(window, modal, projectName);
    await selectHarness(window, modal, 'acp-opencode');

    // `sandbox` is advertised as a mode (so the picker offers it) but is a
    // SUBAGENT in `agent list` — preflight discovery filters it out, so the
    // launch is blocked before spawn.
    await selectRole(window, modal, 'sandbox');
    await expect(modal.locator('[data-testid="native-role-picker-trigger"]')).toContainText('Sandbox');

    await modal.locator('[data-testid="legacy-agent-command-input"]').fill('poke around');
    const send = modal.locator('[data-testid="legacy-agent-command-send"]');
    await expect(send).toBeEnabled({ timeout: 15_000 });
    await send.click();

    // Blocked: an error toast surfaces the preflight reason, and no session opens.
    const toast = window.locator('.toaster .toast.error');
    await expect(toast).toContainText('Structured execution unavailable: role target unavailable', { timeout: 30_000 });
    await expect(modal).toBeVisible();
    await expect(window.locator('[data-testid="agent-terminal-modal"]')).toHaveCount(0);
  } finally {
    if (projectId) await window.evaluate((id) => window.cc.projects.remove(id), projectId);
    await window.evaluate(() => window.cc.config.set({ defaultHarness: undefined, opencodeBinary: undefined }));
    rmSync(projectDir, { recursive: true, force: true });
  }
});
