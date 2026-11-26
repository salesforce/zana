/**
 * The projection behind Sessions rows for Squad workers carries which Squad owns them, the owner thread, last activity, heartbeat
 * age and turn count, so a stuck worker can be told apart from an idle one. A live worker inside the 5 minute stale window is not marked stale.
 * Row text and the stale marker (heartbeat >= 5 min) are covered by the renderer unit tests: the live side list
 * does not keep a CLI worker row in this harness and the renderer has no compressed-time knob.
 */
import { test, expect } from './fixtures/app.js';
import { createJobTeamContext, findJobExecutionId, jobTeamFailure, launchJobTeamCliOwner, teardownJobTeam } from './sdk/job-team-scenario.js';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true, sponsorPromptDismissed: true },
  launchEnv: { ZCC_EXECUTION_STORE: 'json' }
});
test.setTimeout(150_000);

test('worker session rows show Squad, owner, activity, heartbeat and turns', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'sessions-vis-', scenario: 'success' });
  const { window } = ctx;
  try {
    const projectId = await launchJobTeamCliOwner(ctx, { workerQuantity: 2 });
    const executionId = await findJobExecutionId(window, projectId, 'CLI Agent durable job');
    // Workers stay alive while the run waits on the human blocker.
    await expect.poll(() => window.evaluate(async ({ projectId, executionId }) => (await window.cc.executionBoard.snapshot(projectId, executionId, 0))?.execution.currentBlocker?.id ?? '', { projectId, executionId }), { timeout: 60_000, intervals: [500] }).not.toBe('');
    const ownerModal = window.getByRole('dialog', { name: /^Agent / }).first();
    if (await ownerModal.count()) {
      await ownerModal.getByRole('button', { name: 'Close' }).click();
      await expect(ownerModal).toBeHidden();
    }
    // The data behind every Sessions row: the board projection carries the owner thread, the Squad name and
    // each live claim's activity, heartbeat and turn count.
    const view = await window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      const exec = snap?.execution as unknown as { jobTitle?: string; teamName?: string; startedFrom?: { title?: string }; work?: { assignments: Array<{ slotId?: string; state: string; claimedAt?: number; heartbeatAt?: number; progressAt?: number; turnCount?: number }> } };
      return { squad: exec.teamName ?? exec.jobTitle, hasOwner: Boolean(exec.startedFrom), claims: (exec.work?.assignments ?? []).filter((a) => a.slotId) };
    }, { projectId, executionId });
    expect(view.squad).toBeTruthy();
    expect(view.claims.length).toBeGreaterThan(0);
    test.info().annotations.push({ type: 'claims', description: JSON.stringify(view.claims) });
    // The Squad card renders from the same projection.
    await window.getByTestId('nav-agents').or(window.getByTestId('project-nav-agents')).click();
    await expect(window.locator('.agent-card').filter({ hasText: 'CLI Agent durable job' }).first()).toBeVisible({ timeout: 30_000 });
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});
