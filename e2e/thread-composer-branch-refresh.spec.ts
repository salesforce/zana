import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures/app.js';

test.use({
  // The fixture builds a plain env object; Windows can inherit `Path` instead
  // of `PATH`. Supply it explicitly so its isolated CLI directory retains Git.
  launchEnv: { ZCC_FAKE_PROVIDER: '1', PATH: process.env.PATH ?? '' },
  isolateBundledCatalog: true,
  initialConfig: { sponsorPromptDismissed: true }
});

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 15_000 }).trim();
}

function initGitProject(projectPath: string): void {
  mkdirSync(projectPath);
  git(projectPath, ['init', '--quiet', '-b', 'fixture-main']);
  writeFileSync(join(projectPath, 'README.md'), 'Branch refresh fixture\n');
  git(projectPath, ['add', 'README.md']);
  git(projectPath, ['-c', 'user.name=Branch E2E', '-c', 'user.email=branch@example.test', 'commit', '--quiet', '-m', 'Initial project']);
}

async function createThreadWithCheckout(
  window: Page,
  projectPath: string,
  worktree: boolean
): Promise<{ threadId: string; cwd: string; isWorktree: boolean }> {
  const threadId = await window.evaluate(async ({ path, worktree }) => {
    const project = await (window as any).cc.projects.add(path);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: project.value.id,
        providerId: 'fake',
        input: 'Check branch refresh',
        ...(worktree ? { environment: { kind: 'worktree' } } : {})
      })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return (body.thread ?? body.value).id as string;
  }, { path: projectPath, worktree });

  await window.evaluate((id) => {
    window.history.pushState({}, '', `/threads/${id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
  await expect(window.getByTestId('thread-command-input')).toBeVisible();

  const thread = await window.evaluate(async (id) => {
    const response = await fetch(`/api/v1/threads/${id}`);
    if (!response.ok) throw new Error('Thread lookup failed');
    const body = await response.json();
    return body.thread as { cwd: string; isWorktree: boolean };
  }, threadId);

  return { threadId, cwd: thread.cwd, isWorktree: thread.isWorktree };
}

async function verifyBranchSwitches(
  context: Locator,
  header: Locator,
  threadCwd: string,
  projectPath: string,
  worktree: boolean
): Promise<void> {
  // Real Git changes outside the app: no mocked status response or navigation
  // can make the renderer pass this assertion without reading the live checkout.
  for (const branch of ['fixture-switched', 'fixture-switched-again']) {
    git(threadCwd, ['switch', '--quiet', '-c', branch]);
    await expect(context).toContainText(`git: ${branch}`, { timeout: 10_000 });
    await expect(header.locator('.thread-context-branch > span').last()).toHaveText(branch, { timeout: 10_000 });
    const popover = context.page().getByRole('dialog', { name: 'Thread context' });
    await expect(popover).toContainText(branch);
    if (worktree) expect(git(projectPath, ['branch', '--show-current'])).toBe('fixture-main');
  }
  git(threadCwd, ['switch', '--quiet', '--detach']);
  await expect(context.page().locator('[data-testid="thread-prompt-context"]').filter({ hasText: 'git:' })).toHaveCount(0, { timeout: 10_000 });
  await expect(header.locator('.thread-context-branch')).toHaveCount(0, { timeout: 10_000 });
  await expect(context.page().getByRole('dialog', { name: 'Thread context' })).not.toContainText('Branch');
  if (worktree) await expect(context).toContainText('worktree');
}

for (const worktree of [false, true]) {
  test(`header, context popover and composer follow external branch switches and detached HEAD in the ${worktree ? 'thread worktree' : 'project checkout'}`, async ({ app }) => {
    const { window, home } = app;
    const projectPath = join(home, `branch-refresh-${worktree ? 'worktree' : 'project'}`);
    initGitProject(projectPath);

    const { threadId, cwd, isWorktree } = await createThreadWithCheckout(window, projectPath, worktree);
    expect(cwd).toBeTruthy();
    expect(isWorktree).toBe(worktree);
    expect(realpathSync(cwd) === realpathSync(projectPath)).toBe(!worktree);

    const initialBranch = git(cwd, ['branch', '--show-current']);
    expect(initialBranch).toBeTruthy();
    const context = window.getByTestId('thread-prompt-context');
    await expect(context).toContainText(`git: ${initialBranch}`);

    const header = window.getByTestId('thread-header-meta');
    await expect(header).toContainText(initialBranch);
    await header.getByRole('button', { name: 'Thread context' }).click();
    await expect(window.getByRole('dialog', { name: 'Thread context' })).toContainText(initialBranch);

    await verifyBranchSwitches(context, header, cwd, projectPath, worktree);
    expect(window.url()).toContain(`/threads/${threadId}`);
  });
}
