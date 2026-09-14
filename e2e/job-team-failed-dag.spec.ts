import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({ e2e: true, initialConfig: { teamJobLaunchEnabled: true, autoRenameTabs: false } });
test.setTimeout(120_000);

test('failed DAG continues independent work, skips descendants, and settles in Job Details', async ({ app }) => {
  const { window } = app;
  const agent = makeJobTeamCoordinatorBinary({ scenario: 'failed-dag' });
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-job-team-failed-dag-'));
  const projectName = basename(projectDir);
  let projectId: string | null = null;

  try {
    await window.evaluate((bin) => window.cc.config.set({
      teamJobLaunchEnabled: true,
      sponsorPromptDismissed: true,
      claudeBinary: bin,
      defaultHarness: 'claude'
    }), agent.path);
    await window.evaluate(() => window.cc.personas.save({
      id: 'e2e-failure-orchestrator', name: 'E2E Failure Orchestrator', description: 'Failed DAG coordinator',
      baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
    }));
    await window.evaluate(() => window.cc.personas.save({
      id: 'e2e-failure-worker', name: 'E2E Failure Worker', description: 'Failed DAG worker',
      baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
    }));
    await window.evaluate(() => window.cc.teams.save({
      id: 'e2e-failure-team', name: 'E2E Failure Team', description: 'Failed DAG team',
      slots: [{ personaId: 'e2e-failure-worker', quantity: 2 }], orchestratorPersonaId: 'e2e-failure-orchestrator'
    }));
    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      return (result && 'ok' in result ? result.value : result).id;
    }, projectDir);

    await window.getByTestId('nav-agents').click();
    await window.getByTestId('agents-board-new-thread').first().click();
    const modal = window.getByTestId('launch-modal');
    await modal.locator('.launch-segmented').getByRole('button', { name: 'Team', exact: true }).click();
    await modal.getByTestId('team-command-input').fill('verify deterministic failed DAG settlement');
    await modal.getByLabel('Team', { exact: true }).click();
    await window.getByRole('listbox', { name: 'Team' }).getByRole('option', { name: 'E2E Failure Team' }).click();
    await modal.getByRole('button', { name: 'Project', exact: true }).click();
    await window.getByRole('listbox', { name: 'Project' }).getByRole('option', { name: projectName, exact: true }).click();
    await modal.getByLabel('Team planning').click();
    await window.getByRole('option', { name: 'Plan provided in goal', exact: true }).click();
    await modal.getByTestId('team-command-send').click();
    await expect(modal).toBeHidden();

    const jobTitle = 'verify deterministic failed DAG settlement';
    await expect.poll(async () => window.evaluate(async ({ projectId }) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      return page.executions.find((execution) => execution.teamId === 'e2e-failure-team')?.executionId ?? '';
    }, { projectId: projectId! }), { timeout: 15_000, intervals: [500] }).not.toBe('');
    const executionId = await window.evaluate(async ({ projectId }) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      return page.executions.find((execution) => execution.teamId === 'e2e-failure-team')!.executionId;
    }, { projectId: projectId! });

    await expect.poll(async () => window.evaluate(async ({ projectId, executionId }) => {
      const snapshot = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return snapshot && {
        state: snapshot.execution.state,
        counts: snapshot.execution.work?.counts,
        assignments: snapshot.execution.work?.assignments.map(({ workUnitId, state, failureCode }) => ({ workUnitId, state, failureCode }))
      };
    }, { projectId: projectId!, executionId }), { timeout: 60_000, intervals: [500] }).toEqual({
      state: 'FAILED',
      counts: { PENDING: 0, READY: 0, CLAIMED: 0, BLOCKED: 0, COMPLETED: 1, FAILED: 1, SKIPPED: 1 },
      assignments: [
        { workUnitId: 'fail-root', state: 'FAILED', failureCode: 'VALIDATION_FAILED' },
        { workUnitId: 'dependent', state: 'SKIPPED', failureCode: undefined },
        { workUnitId: 'independent', state: 'COMPLETED', failureCode: undefined }
      ]
    });

    const card = window.locator('.agent-card').filter({ hasText: 'E2E Failure Team' }).first();
    await expect(card).toBeVisible();
    await card.click();
    const details = window.getByLabel('Team details');
    await expect(details.getByText(/FAILED · attempt/)).toBeVisible();
    await expect(details.getByText(/Fail Root.*FAILED/)).toBeVisible();
    await expect(details.getByText(/Dependent.*SKIPPED/)).toBeVisible();
    await expect(details.getByText(/Independent.*COMPLETED/)).toBeVisible();
    await expect(details.getByRole('button', { name: 'Retry work' })).toHaveCount(0);
  } finally {
    if (projectId) {
      await window.evaluate(async (id) => {
        for (const session of await window.cc.terminals.list(id)) {
          try { await window.cc.terminals.close(session.id); } catch { /* best-effort */ }
        }
        try { await window.cc.projects.remove(id); } catch { /* best-effort */ }
      }, projectId);
    }
    rmSync(projectDir, { recursive: true, force: true });
    agent.cleanup();
  }
});
