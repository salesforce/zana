/**
 * Production-boundary: host-stamped `squadNotice: 'worktree-lifecycle'` Inbox
 * entries route to Squad details and never offer a reply box, while a worker
 * blocker that merely mentions "shared worktree" (no stamp) keeps its reply box.
 *
 * Seeding: the entries are written to the isolated home's inbox store (the same
 * entries.jsonl the host appends to) with the exact shape produced by
 * apps/desktop/src/squad-worktree-notice.ts; the host-side emission itself is
 * covered by desktop unit tests. The project is registered through the real API
 * so the unstamped entry has a live project to reply into.
 */
import { appendFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ initialConfig: { sponsorPromptDismissed: true } });

test('stamped Squad worktree notices open Squad details without a reply box; worker blockers keep theirs', async ({ app }) => {
  const { window, home } = app;
  const projectPath = join(home, 'squad-notice-project');
  mkdirSync(projectPath);
  const projectId = await window.evaluate(async (path) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error('Project registration failed');
    return project.value.id;
  }, realpathSync(projectPath));

  const inboxDir = join(home, '.zcc', 'inbox');
  mkdirSync(inboxDir, { recursive: true });
  const now = Date.now();
  const entries = [
    {
      id: 'stamped-retained', ts: now, projectId, executionId: 'exec-notice-1', squadNotice: 'worktree-lifecycle',
      subject: 'Squad worktree retained',
      comments: 'Execution failed. The shared worktree remains at `/tmp/wt`. Open Squad details to inspect recovery options and manage the retained worktree.',
      dedupeKey: 'squad-worktree-retained:exec-notice-1:1'
    },
    {
      id: 'stamped-unavailable', ts: now + 1, projectId, executionId: 'exec-notice-2', squadNotice: 'worktree-lifecycle',
      subject: 'Squad worktree unavailable',
      comments: 'Squad run uses project root because shared worktree creation failed: boom',
      dedupeKey: 'squad-worktree-fallback:exec-notice-2'
    },
    {
      id: 'worker-blocker', ts: now + 2, projectId, executionId: 'exec-notice-3',
      subject: 'Worker blocked',
      comments: 'I am blocked: the shared worktree has conflicting edits in src/a.ts. How should I proceed?',
      report: true
    }
  ];
  appendFileSync(join(inboxDir, 'entries.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

  await window.reload();
  await window.getByTestId('nav-inbox').click();
  const detail = window.locator('.inbox-detail');

  for (const subject of ['Squad worktree retained', 'Squad worktree unavailable']) {
    await window.locator('.inbox-row').filter({ hasText: subject }).click();
    await expect(detail.getByRole('button', { name: 'Open Squad details', exact: true })).toBeVisible();
    await expect(detail.getByText('Recovery and worktree actions are available from Squad details.')).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Leave a reply' })).toHaveCount(0);
    await expect(detail.getByRole('textbox')).toHaveCount(0);
  }

  await window.locator('.inbox-row').filter({ hasText: 'Worker blocked' }).click();
  await expect(detail.getByRole('button', { name: 'Open Squad details' })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Leave a reply' })).toBeVisible();
});
