import { test, expect } from './fixtures/app.js';
import {
  createJobTeamContext,
  launchJobTeamCliOwner,
  findJobExecutionId,
  jobTeamFailure,
  teardownJobTeam
} from './sdk/job-team-scenario.js';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true },
  // The claim lease stays far longer than this test. Recovery must come from the
  // worker's actual Stop exit, not expiry or the periodic reconcile interval.
  launchEnv: { ZCC_WORK_CLAIM_LEASE_MS: '60000', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '60000' }
});
test.setTimeout(120_000);

test('Job Team releases a fresh claim when the user stops its worker', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'zcc-cli-stopped-', scenario: 'stalled-worker' });
  const { window } = ctx;

  try {
    const projectId = await launchJobTeamCliOwner(ctx, { workerQuantity: 1 });
    const executionId = await findJobExecutionId(window, projectId, 'CLI Agent stalled job');

    const workerId = await expect.poll(async () => window.evaluate(async ({ projectId, executionId }) => {
      const sessions = await window.cc.terminals.list(projectId);
      return sessions.find((session) => session.cohort?.executionId === executionId && session.cohort.role === 'worker')?.id ?? '';
    }, { projectId, executionId }), { timeout: 30_000, intervals: [250] }).not.toBe('').then(async () =>
      window.evaluate(async ({ projectId, executionId }) =>
        (await window.cc.terminals.list(projectId)).find((session) =>
          session.cohort?.executionId === executionId && session.cohort.role === 'worker')!.id,
      { projectId, executionId })
    );

    // This is the same renderer IPC used by the tab Stop/close control.
    await window.evaluate((sessionId) => window.cc.terminals.close(sessionId), workerId);

    await expect.poll(async () => window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return (snap?.events ?? []).some((event: { summary?: string }) =>
        event.summary?.includes('Reclaimed 1 expired work claim'));
    }, { projectId, executionId }), { timeout: 10_000, intervals: [100] }).toBe(true);
  } catch (error) {
    throw jobTeamFailure(ctx, error);
  } finally {
    await teardownJobTeam(ctx);
  }
});
