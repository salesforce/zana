import { test, expect } from './fixtures/app.js';
import type { Page } from '@playwright/test';
import { makeFakeAgentBinary } from './sdk/harness.js';
import { stubNativeDialogs } from './sdk/native-dialog.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({ e2e: true });

/**
 * The e2e fixture pins `claudeBinary` to a disabled stub so no test discovers a
 * real Claude. The Home default (claude) is therefore unavailable until a fake
 * binary is configured and re-probed; the renderer reuses its boot-time probe,
 * so "Check status" forces the re-probe against the configured stub.
 */
async function useFakeClaude(window: Page, binary: string) {
  await window.evaluate(async (path) => {
    await window.cc.config.set({ claudeBinary: path, defaultHarness: 'claude' });
  }, binary);
  await window.getByRole('link', { name: 'Settings' }).click();
  await window.locator('.settings-section-item').filter({ hasText: 'AI Harness' }).click();
  const settings = window.locator('#settings-anchor-harness-claude');
  await expect(settings).not.toHaveClass(/opener-row--off/);
  const check = window.getByRole('button', { name: /^(Check status|Checking…)$/ });
  await expect(check).toBeEnabled({ timeout: 20_000 });
  await check.click();
  await expect(check).toHaveText('Check status', { timeout: 30_000 });
  const ok = settings.locator('.opener-row-status--ok').first();
  await expect(ok).toBeVisible({ timeout: 20_000 });
  await expect(ok).toHaveAttribute('title', /2\.1\.220/, { timeout: 20_000 });
  await window.locator('.settings-app-back').click();
}

test('launching agent after pasting absolute path works', { timeout: 60_000 }, async ({ app }) => {
  const window = app.window;
  await stubNativeDialogs(app.electron, [0]);
  const agent = makeFakeAgentBinary({ profile: 'claude', sequence: 'work-then-idle' });
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-launch-paste-'));
  const projectName = basename(projectDir);
  let projectId: string | null = null;
  try {
    await useFakeClaude(window, agent.path);

    projectId = await window.evaluate(async (path) => {
      const res = await window.cc.projects.add(path);
      const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
        id: string;
      };
      return proj.id;
    }, projectDir);
    expect(projectId).toBeTruthy();

    await window.locator('[data-testid="nav-agents"]').click();
    await window.locator('[data-testid="agents-board-new-thread"]').first().click();
    const modal = window.locator('[data-testid="launch-modal"]');
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'CLI Agent' }).click();

    const instruction = modal.getByTestId('legacy-agent-command-input');
    await instruction.waitFor({ state: 'visible' });
    await instruction.focus();

    const pasteText = 'Read /tmp/issue.md and then ask me a question about it';
    await instruction.fill(pasteText);
    await expect(instruction).toContainText('issue.md');

    // An absolute path must not leave the typeahead menu open (it would swallow Enter).
    await expect(modal.getByTestId('composer-typeahead-menu')).toHaveCount(0);

    const targetProject = modal.getByRole('button', { name: 'Machine and project' });
    await targetProject.click();
    await window
      .getByRole('listbox', { name: 'Machine and project' })
      .getByRole('option', { name: projectName, exact: false })
      .click();
    await expect(targetProject).toContainText(projectName);

    const send = modal.getByTestId('legacy-agent-command-send');
    await expect(send).toBeEnabled({ timeout: 15_000 });

    // Enter (not the button) is the path under test.
    await instruction.press('Enter');

    await expect(modal).toBeHidden({ timeout: 30_000 });
    const term = window.locator('.xterm-helper-textarea');
    await term.first().waitFor({ state: 'attached', timeout: 15_000 });
  } finally {
    if (projectId && !window.isClosed()) {
      await window
        .evaluate(async (pid) => {
          try {
            await window.cc.projects.remove(pid);
          } catch {
            /* best-effort */
          }
        }, projectId)
        .catch(() => undefined);
    }
    rmSync(projectDir, { recursive: true, force: true });
    agent.cleanup();
  }
});
