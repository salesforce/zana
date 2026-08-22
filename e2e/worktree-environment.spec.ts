/**
 * Workspace picker (BB-style environments) on the real launcher DOM.
 * Proves the isolation checkbox is gone and a git project can pick New worktree.
 */
import { test, expect } from './fixtures/app.js';
import { makeFakeAgentBinary } from './sdk/harness.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';

test.use({ e2e: true });

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
}

test('launcher offers a workspace picker instead of an isolation checkbox', async ({ app }) => {
  const { window } = app;
  const agent = makeFakeAgentBinary({ profile: 'claude', sequence: 'work-then-idle' });
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-wt-e2e-'));
  const projectName = basename(projectDir);
  git(projectDir, ['init', '-b', 'main']);
  git(projectDir, ['config', 'user.name', 'E2E']);
  git(projectDir, ['config', 'user.email', 'e2e@example.com']);
  writeFileSync(join(projectDir, 'README.md'), 'hello\n');
  git(projectDir, ['add', '.']);
  git(projectDir, ['commit', '-m', 'init']);

  try {
    await window.evaluate((bin) => window.cc.config.set({
      claudeBinary: bin,
      defaultHarness: 'claude'
    }), agent.path);
    await window.locator('[data-testid="nav-settings"]').click();
    await window.locator('.settings-section-item').filter({ hasText: 'Code Harness' }).click();
    const claudeSettings = window.locator('#settings-anchor-harness-claude');
    await expect(claudeSettings.locator('.opener-row-status')).toHaveClass(/opener-row-status--ok/);

    await window.locator('[data-testid="nav-projects"]').click();
    await window.evaluate(async (path) => {
      await window.cc.projects.add(path);
    }, projectDir);
    await window.locator('button[aria-label="Reload project list"]').click();
    await window.locator('[data-testid="nav-agents"]').click();

    const newBtn = window.locator('[data-testid="agents-new"]');
    const newEmptyBtn = window.locator('[data-testid="agents-new-empty"]');
    if (await newBtn.count()) await newBtn.click();
    else await newEmptyBtn.click();

    const modal = window.locator('[data-testid="launch-modal"]');
    await expect(modal).toBeVisible();
    await modal.locator('[data-testid="launch-instruction"]').fill('inspect the checkout');

    const targetProject = modal.getByRole('button', { name: 'Target project' });
    await targetProject.click();
    await window
      .getByRole('listbox', { name: 'Target project' })
      .getByRole('option', { name: projectName, exact: true })
      .click();

    await modal.locator('.launch-advanced-toggle').click();
    await expect(modal.getByLabel('Workspace')).toBeVisible({ timeout: 10_000 });
    await expect(modal.getByText('Isolate in a git worktree')).toHaveCount(0);

    await modal.getByLabel('Workspace').click();
    await window.getByRole('option', { name: 'New worktree' }).click();
    await expect(modal.getByText('Used for branch and checkout directory.')).toBeVisible();
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
