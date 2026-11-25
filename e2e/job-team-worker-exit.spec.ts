/**
 * AC10 through the built app: a Squad worker that exits non-zero is visible. The run records a
 * worker warning, the Inbox gets a SIGNAL row, and the exited card stays on the Agents board past
 * the 60 s linger until the user dismisses it; the dismissal is persisted in app config.
 */
import { test, expect } from './fixtures/app.js';
import {
  createJobTeamContext, findJobExecutionId, jobTeamFailure, launchSquadFixture, teardownJobTeam
} from './sdk/job-team-scenario.js';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true, sponsorPromptDismissed: true, tmuxScope: 'off' },
  launchEnv: { ZCC_WORK_CLAIM_LEASE_MS: '60000', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '60000' }
});
test.setTimeout(240_000);

test('a worker that exits 1 raises a warning and Inbox row, and its card stays until dismissed', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'worker-exit-', scenario: 'worker-exit-1' });
  const { window } = ctx;
  try {
    const projectId = await launchSquadFixture(ctx, [{ label: 'exit', input: { mode: 'now', title: 'Worker exit run' } }]);
    const executionId = await findJobExecutionId(window, projectId, 'Worker exit run');

    // The run records the warning even though no client reads status.
    await expect.poll(() => window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return (snap?.events ?? []).map((e: { summary?: string }) => e.summary ?? '').find((s) => /exited with code 1/.test(s)) ?? '';
    }, { projectId, executionId }), { timeout: 60_000, intervals: [250] }).toContain('exited with code 1');

    // Inbox SIGNAL row.
    await window.getByTestId('nav-inbox').or(window.getByTestId('project-nav-inbox')).click();
    await expect(window.getByRole('button', { name: /exited with code 1/ }).first()).toBeVisible({ timeout: 30_000 });

    // The exited worker card is retained past the 60 s linger.
    await window.getByTestId('nav-agents').or(window.getByTestId('project-nav-agents')).click();
    // While the coordinator lives the exited worker stays visible inside its Squad card, past the 60 s linger.
    const nestedExit = window.locator('.agent-squad-worker.exited');
    // Single seat: Zana respawns it once and retries (#789), and the respawned seat exits too, so the Squad
    // card holds the original and the respawned exited rows; neither disappears past the linger.
    await expect.poll(() => nestedExit.count(), { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(() => nestedExit.count(), { timeout: 60_000 }).toBe(2);
    await window.waitForTimeout(65_000);
    await expect(nestedExit).toHaveCount(2);

    // Workers of a Squad run always nest under the run's host card (the standalone Dismiss control
    // is for workers outside a run; see AgentBoard.workerExit.test.tsx). Stopping the run keeps the
    // exited worker row visible; dismissing the finished run is the acknowledgement that clears it.
    const version = await window.evaluate(async ({ projectId, executionId }) =>
      (await window.cc.executionBoard.snapshot(projectId, executionId, 0))?.execution.stateVersion ?? 0, { projectId, executionId });
    const stopped = await window.evaluate(({ projectId, executionId, version }) =>
      window.cc.executionBoard.stop(projectId, executionId, version), { projectId, executionId, version });
    expect(stopped.ok, JSON.stringify(stopped)).toBe(true);
    // One Stop on the BLOCKED run (it lost its only worker) lands STOPPED; no second Stop is needed.
    await expect.poll(() => window.evaluate(async ({ projectId, executionId }) =>
      (await window.cc.executionBoard.snapshot(projectId, executionId, 0))?.execution.state, { projectId, executionId }),
    { timeout: 30_000 }).toBe('STOPPED');
    // Stopping also exits the orchestrator, so its row joins the crashed worker's.
    await expect.poll(() => nestedExit.count()).toBeGreaterThanOrEqual(1);

    const dismissed = await window.evaluate(({ projectId, executionId }) =>
      window.cc.executionBoard.dismiss(projectId, executionId), { projectId, executionId });
    expect(dismissed.ok, JSON.stringify(dismissed)).toBe(true);
    await expect.poll(() => window.evaluate(async (projectId) =>
      (await window.cc.executionBoard.listProject(projectId)).executions.length, projectId), { timeout: 15_000 }).toBe(0);
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});
