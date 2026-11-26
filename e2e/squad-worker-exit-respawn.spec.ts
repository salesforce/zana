/**
 * Kill-and-respawn exit-wait path through the built app. A single-seat Squad's worker crashes on its first
 * assignment (scenario `worker-exit-1`). The engine reclaims the unit, closes the dead session, waits for its
 * exit (`waitForSessionExit` via `quiesceOldSession`), respawns the seat once and re-dispatches the unit.
 * Visible outcome: a run warning for the first crash, a SECOND, distinct worker session on the same slot
 * (the respawn), and both exited rows nested in the Squad card on the Agents board.
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

test('a crashed single-seat worker is closed, awaited, respawned once, and the unit continues', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'worker-exit-respawn-', scenario: 'worker-exit-1' });
  const { window } = ctx;
  try {
    const projectId = await launchSquadFixture(ctx, [{ label: 'exit-respawn', input: { mode: 'now', title: 'Exit respawn run' } }]);
    const executionId = await findJobExecutionId(window, projectId, 'Exit respawn run');

    const workers = () => window.evaluate(async ({ projectId, executionId }) =>
      (await window.cc.terminals.list(projectId))
        .filter((s) => s.cohort?.executionId === executionId && s.cohort.role === 'worker')
        .map((s) => ({ id: s.id, slotId: s.cohort?.slotId as string, status: s.status })), { projectId, executionId });
    const events = () => window.evaluate(async ({ projectId, executionId }) =>
      ((await window.cc.executionBoard.snapshot(projectId, executionId, 0))?.events ?? [])
        .map((e: { summary?: string }) => e.summary ?? ''), { projectId, executionId });

    // The first crash is recorded as a run warning.
    await expect.poll(async () => (await events()).filter((s) => /exited with code 1/.test(s)).length,
      { timeout: 60_000, intervals: [250] }).toBeGreaterThanOrEqual(1);

    // The respawn: exited sessions are removed, so the proof is the human blocker. It says Zana closed the
    // seat, respawned it and retried the unit once, and names the unit as `id: title`.
    const blockerQuestion = () => window.evaluate(async ({ projectId, executionId }) =>
      (await window.cc.executionBoard.snapshot(projectId, executionId, 0))?.execution.currentBlocker?.question ?? '', { projectId, executionId });
    await expect.poll(blockerQuestion, { timeout: 90_000, intervals: [500] })
      .toMatch(/respawned the seat and retried the unit once on the same seat; it failed again/);
    expect(await blockerQuestion()).toContain('"write: Write output"');

    // The unit continued: it was re-dispatched to the respawned seat, which crashes too, so the run ends
    // up with two crash warnings (one per session) rather than hanging after the first.
    await expect.poll(async () => (await events()).filter((s) => /exited with code 1/.test(s)).length,
      { timeout: 90_000, intervals: [500] }).toBeGreaterThanOrEqual(2);

    // Agents board: both exited rows stay nested in the Squad card.
    await window.getByTestId('nav-agents').or(window.getByTestId('project-nav-agents')).click();
    await expect.poll(() => window.locator('.agent-squad-worker.exited').count(), { timeout: 60_000 }).toBe(2);
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});
