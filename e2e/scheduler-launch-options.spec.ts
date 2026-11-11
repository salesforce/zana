import { test, expect } from './fixtures/app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('scheduler creates and edits launch overrides through visible UI', async ({ app }) => {
  const { window } = app;
  const root = mkdtempSync(join(tmpdir(), 'zcc-scheduler-options-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, '-c', 'user.name=E2E', '-c', 'user.email=e2e@example.test', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Test fixture']);
  let projectId = '';
  let projectName = '';
  let scheduleId = '';
  try {
    projectId = await window.evaluate(async path => {
      const result = await window.cc.projects.add(path);
      return (result && 'ok' in result ? result.value : result).id;
    }, root);
    projectName = await window.evaluate(async id => (await window.cc.projects.list()).find(project => project.id === id)?.name ?? '', projectId);
    expect(projectName).toBeTruthy();
    await window.evaluate(async () => {
      await window.cc.personas.save({
        id: 'scheduler-options-orchestrator', name: 'Scheduler Options Orchestrator', description: 'E2E schedule owner',
        baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
      });
      await window.cc.personas.save({
        id: 'scheduler-options-worker', name: 'Scheduler Options Worker', description: 'E2E schedule worker',
        baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
      });
      await window.cc.teams.save({
        id: 'e2e-scheduler-options', name: 'Schedule options squad', description: 'Paused scheduler E2E squad',
        slots: [{ personaId: 'scheduler-options-worker', quantity: 1 }], orchestratorPersonaId: 'scheduler-options-orchestrator'
      });
    });
    await window.locator('.nav-item').filter({ hasText: 'Scheduler' }).first().click();
    await window.locator('button', { hasText: 'New schedule' }).first().click();
    const editor = window.getByTestId('schedule-editor');
    await expect(editor).toBeVisible();
    await editor.locator('#sched-name').fill('E2E launch options');
    await editor.getByRole('button', { name: 'Project', exact: true }).click();
    await window.getByRole('listbox', { name: 'Project' }).getByRole('option', { name: projectName }).click();
    await editor.getByRole('button', { name: 'Run as' }).click();
    await window.getByRole('listbox', { name: 'Run as' }).getByRole('option', { name: 'Squad' }).click();
    await editor.getByRole('button', { name: 'Squad', exact: true }).click();
    await window.getByRole('listbox', { name: 'Squad' }).getByRole('option', { name: 'Schedule options squad' }).click();
    const launchPreview = editor.locator('.squad-launch-preview');
    await expect(launchPreview).toBeVisible();
    await expect(launchPreview).toContainText('Launch preview');
    await expect(editor.getByRole('button', { name: /Review resolved settings/i })).toHaveCount(0);
    const customize = editor.getByRole('button', { name: 'Customize launch' });
    await customize.click();
    await editor.getByLabel('Checkout').selectOption('project-root');
    await editor.getByLabel('Push').selectOption('false');
    await editor.getByLabel('Named checks mode').selectOption('none');
    await expect(launchPreview).toContainText('Worktree isolation');
    await expect(launchPreview).toContainText('Use checkout');
    await expect(launchPreview).toContainText('Push');
    await expect(launchPreview).toContainText('Blocked');
    await expect(launchPreview).toContainText('Named checks');
    await expect(launchPreview).toContainText('No checks');
    await expect(launchPreview).toContainText('Failure policy');
    await expect(launchPreview).toContainText('Fail run');
    await editor.getByRole('button', { name: 'Create schedule' }).click();
    await expect(window.getByTestId('schedule-detail')).toBeVisible();
    scheduleId = await window.evaluate(async () => {
      const tasks = await window.cc.scheduler.list();
      return tasks.find((task) => task.name === 'E2E launch options')?.id ?? '';
    });
    expect(scheduleId).toBeTruthy();
    await customize.click();
    await editor.getByLabel('Push').selectOption('true');
    await expect(launchPreview).toContainText('Allowed');
    await editor.getByRole('button', { name: 'Save changes' }).click();
    await window.getByRole('button', { name: 'Back to schedules' }).click();
    await window.getByRole('button', { name: 'Run E2E launch options' }).click();
    const review = window.getByRole('dialog', { name: 'Review scheduled squad launch' });
    await expect(review).toBeVisible();
    await expect(review.getByText('Push')).toBeVisible();
    await expect(review.getByText('Allowed')).toBeVisible();
    await expect(review.getByText('Named checks')).toBeVisible();
    await expect(review.getByText('No checks')).toBeVisible();
    await review.getByRole('button', { name: 'Cancel' }).click();
  } finally {
    await window.evaluate(async ({ scheduleId, projectId }) => {
      if (scheduleId) await window.cc.scheduler.delete(scheduleId);
      await window.cc.teams.delete('e2e-scheduler-options');
      if (projectId) await window.cc.projects.remove(projectId);
    }, { scheduleId, projectId });
    rmSync(root, { recursive: true, force: true });
  }
});
