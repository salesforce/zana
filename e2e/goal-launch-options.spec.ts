import { test, expect } from './fixtures/app.js';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

test.use({ e2e: true, initialConfig: { goalsEnabled: true, teamJobLaunchEnabled: true, autoRenameTabs: false } });
test.setTimeout(120_000);

type GoalFile = {
  assignment: { kind: string; teamId?: string };
  status: string;
  launchOptions?: {
    worktree?: boolean;
    onComplete?: string;
    push?: boolean;
    checks?: string[];
    failurePolicyDefault?: string;
    target?: { kind: string };
  };
};

test('Squad Goal launch options persist through the real editor and clear on Agent reassignment', async ({ app }) => {
  const { window } = app;
  const projectDir = join(app.home, 'goal-launch-options-project');
  mkdirSync(projectDir);
  execFileSync('git', ['init', projectDir], { stdio: 'ignore' });
  let projectId: string | undefined;
  let goalId: string | undefined;

  const readGoal = (): GoalFile => JSON.parse(readFileSync(join(projectDir, '.zcc', 'goals', `${goalId}.json`), 'utf8')) as GoalFile;
  const openGoals = () => window.evaluate(() => {
    history.pushState({}, '', '/goals');
    dispatchEvent(new PopStateEvent('popstate'));
  });

  try {
    await window.evaluate(async () => {
      await window.cc.personas.save({
        id: 'goal-options-orchestrator', name: 'Goal Options Orchestrator', description: 'E2E Squad Goal owner',
        baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
      });
      await window.cc.personas.save({
        id: 'goal-options-worker', name: 'Goal Options Worker', description: 'E2E Squad Goal worker',
        baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
      });
      await window.cc.teams.save({
        id: 'goal-options-squad', name: 'Goal Options Squad', description: 'Paused Goal E2E squad',
        slots: [{ personaId: 'goal-options-worker', quantity: 1 }], orchestratorPersonaId: 'goal-options-orchestrator'
      });
    });
    const added = await window.evaluate((path) => window.cc.projects.add(path), projectDir);
    expect(added, JSON.stringify(added)).toMatchObject({ ok: true });
    if (!added.ok) throw new Error(added.message);
    projectId = added.value.id;

    await openGoals();
    await window.getByRole('button', { name: 'New goal' }).first().click();
    const form = window.getByRole('dialog', { name: 'New goal' });
    await form.locator('#goal-title').fill('Persist launch policy');
    await form.locator('#goal-statement').fill('Keep this Goal paused.');

    await form.getByRole('button', { name: 'Run as', exact: true }).click();
    await window.getByRole('listbox', { name: 'Run as' }).getByRole('option', { name: 'Squad' }).click();
    await form.getByRole('button', { name: 'Squad', exact: true }).click();
    await window.getByRole('listbox', { name: 'Squad' }).getByRole('option', { name: 'Goal Options Squad' }).click();
    await form.getByRole('button', { name: 'Project', exact: true }).click();
    await window.getByRole('listbox', { name: 'Project' }).getByRole('option', { name: 'goal-launch-options-project' }).click();

    const launchSettings = () => form.getByRole('region', { name: 'Squad launch settings' });
    await expect(launchSettings()).toBeVisible();
    const launchPreview = launchSettings().locator('.squad-launch-preview');
    await expect(launchPreview).toBeVisible();
    await expect(launchPreview).toContainText('Launch preview');
    await expect(launchSettings().getByRole('button', { name: /Review resolved settings/i })).toHaveCount(0);
    await launchSettings().getByRole('button', { name: 'Customize launch' }).click();
    await launchSettings().getByLabel('Checkout').selectOption('project-root');
    await launchSettings().getByLabel('On complete').selectOption('leave');
    await launchSettings().getByLabel('Push').selectOption('false');
    await launchSettings().getByLabel('Named checks mode').selectOption('none');
    await expect(launchPreview).toContainText('Worktree isolation');
    await expect(launchPreview).toContainText('Use checkout');
    await expect(launchPreview).toContainText('No checks');

    // Draft first: no Goal worker or Squad execution can start during this test.
    await form.locator('input[type="checkbox"]').uncheck();
    await form.getByRole('button', { name: 'Create goal' }).click();
    await expect(form).toBeHidden();

    await expect.poll(async () => window.evaluate(async (id) => (await window.cc.goals.list()).find((goal) => goal.title === 'Persist launch policy')?.id ?? '', projectId)).not.toBe('');
    goalId = await window.evaluate(async () => (await window.cc.goals.list()).find((goal) => goal.title === 'Persist launch policy')!.id);
    expect(readGoal()).toMatchObject({
      assignment: { kind: 'team', teamId: 'goal-options-squad' },
      status: 'draft',
      launchOptions: { target: { kind: 'project-root' }, worktree: false, onComplete: 'leave', push: false, checks: [] }
    });

    // The UI does not expose this fixed policy; a direct owner update proves a later
    // UI edit forwards the full stored object rather than silently losing it.
    const policy = await window.evaluate(({ id }) => window.cc.goals.update(id, {
      launchOptions: { target: { kind: 'project-root' }, worktree: false, onComplete: 'leave', push: false, checks: [], failurePolicyDefault: 'fail-run' }
    }), { id: goalId });
    expect(policy, JSON.stringify(policy)).toMatchObject({ ok: true });

    const row = window.locator('.scheduler-card').filter({ hasText: 'Persist launch policy' });
    await row.getByLabel('Toggle details').click();
    await row.getByRole('button', { name: 'Edit' }).click();
    const edit = window.getByRole('dialog', { name: 'Edit goal' });
    await expect(edit.getByRole('region', { name: 'Squad launch settings' })).toBeVisible();
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit).toBeHidden();
    expect(readGoal().launchOptions).toEqual({
      target: { kind: 'project-root' }, worktree: false, onComplete: 'leave', push: false, checks: [], failurePolicyDefault: 'fail-run'
    });

    await row.getByRole('button', { name: 'Edit' }).click();
    const reassignment = window.getByRole('dialog', { name: 'Edit goal' });
    await reassignment.getByRole('button', { name: 'Run as', exact: true }).click();
    await window.getByRole('listbox', { name: 'Run as' }).getByRole('option', { name: 'Agent' }).click();
    await reassignment.getByRole('button', { name: 'Save changes' }).click();
    await expect(reassignment).toBeHidden();
    expect(readGoal()).toMatchObject({ assignment: { kind: 'profile' }, status: 'draft' });
    expect(readGoal().launchOptions).toBeUndefined();
  } finally {
    if (goalId) await window.evaluate((id) => window.cc.goals.setStatus(id, 'paused'), goalId).catch(() => undefined);
    if (projectId) await window.evaluate((id) => window.cc.projects.remove(id), projectId).catch(() => undefined);
  }
});
