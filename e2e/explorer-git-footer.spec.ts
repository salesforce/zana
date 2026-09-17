/**
 * Explorer git footer: shows the current branch and opens the existing
 * worktree/branch switcher. Switching re-roots the tree — it does not
 * `git checkout` in the live working copy.
 */
import { test, expect } from './fixtures/app.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

test.use({
  e2e: true,
  initialConfig: { sponsorPromptDismissed: true }
});

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
}

test('Explorer git footer shows the branch and switches worktrees', async ({ app }) => {
  const { window } = app;
  const dir = mkdtempSync(join(tmpdir(), 'zcc-explorer-git-'));
  const projectName = basename(dir);
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.name', 'E2E']);
  git(dir, ['config', 'user.email', 'e2e@example.com']);
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'init']);
  const featureDir = join(dirname(dir), `${projectName}-feature`);
  git(dir, ['worktree', 'add', '-b', 'feature', featureDir]);
  writeFileSync(join(featureDir, 'only-on-feature.txt'), 'feature\n');

  const projectId = await window.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
      id: string;
    };
    return proj.id;
  }, dir);
  expect(projectId).toBeTruthy();

  try {
    const workspaces = window.locator('[data-testid="sidebar-projects-heading"]');
    if ((await workspaces.getAttribute('aria-expanded')) === 'false') {
      await workspaces.click();
    }
    const row = window.locator('.project-item').filter({ hasText: projectName }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    const rail = window.locator('.project-scoped-nav.project-focused-nav');
    await expect(rail).toBeVisible({ timeout: 15_000 });
    await rail.getByTestId('project-nav-explorer').click();
    await expect(window.locator('.explorer-view')).toBeVisible({ timeout: 15_000 });
    await expect(window.locator('.explorer-tree-header .explorer-worktree-btn')).toHaveCount(0);
    await expect(window.locator('.explorer-tree-title')).toContainText(projectName);

    const footer = window.getByTestId('explorer-git-footer');
    await expect(footer).toBeVisible({ timeout: 15_000 });
    await expect(footer).toContainText('main');

    await footer.click();
    const menu = window.getByTestId('explorer-worktree-menu');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('Worktrees');
    await expect(menu).toContainText('Branches');
    await menu.getByRole('option', { name: /feature/ }).first().click();

    await expect(footer).toContainText('feature', { timeout: 10_000 });
    await expect(window.locator('.tree-name', { hasText: 'only-on-feature.txt' })).toBeVisible({
      timeout: 10_000
    });
  } finally {
    await window.evaluate(async (pid) => {
      try {
        await window.cc.projects.remove(pid);
      } catch {
        /* best-effort cleanup */
      }
    }, projectId);
    spawnSync('git', ['worktree', 'remove', '--force', featureDir], { cwd: dir });
    rmSync(dir, { recursive: true, force: true });
    rmSync(featureDir, { recursive: true, force: true });
  }
});
