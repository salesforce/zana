import { test, expect } from './fixtures/app.js';

test('Squad worktree on-completion choice persists through the built Electron editor', async ({ app }) => {
  const window = app.window;

  await window.evaluate(async () => {
    await window.cc.personas.save({ id: 'e2e-wt-orchestrator', name: 'E2E WT Orchestrator', baseProfile: 'claude' });
    await window.cc.personas.save({ id: 'e2e-wt-worker', name: 'E2E WT Worker', baseProfile: 'claude' });
    await window.cc.teams.save({
      id: 'e2e-wt-squad',
      name: 'E2E WT Squad',
      orchestratorPersonaId: 'e2e-wt-orchestrator',
      slots: [
        { personaId: 'e2e-wt-orchestrator', quantity: 1 },
        { personaId: 'e2e-wt-worker', quantity: 1 }
      ]
    });
  });

  await window.getByRole('link', { name: 'Settings', exact: true }).click();
  await window.getByTestId('settings-nav-squads').click();
  await window.getByRole('button', { name: 'Open E2E WT Squad' }).click();

  const onComplete = window.getByLabel('Squad worktree on completion');
  await expect(onComplete).toContainText('Keep worktree (default)');
  await onComplete.click();
  await window.getByRole('listbox', { name: 'Squad worktree on completion' }).getByRole('option', { name: 'Delete worktree and branch' }).click();
  await window.getByRole('button', { name: 'Save', exact: true }).click();

  await expect.poll(() => window.evaluate(async () => {
    const teams = await window.cc.teams.list();
    return teams.find((team) => team.id === 'e2e-wt-squad')?.worktreeOnComplete;
  })).toBe('delete');

  await window.getByRole('button', { name: 'Open E2E WT Squad' }).click();
  await expect(window.getByLabel('Squad worktree on completion')).toContainText('Delete worktree and branch');
});
