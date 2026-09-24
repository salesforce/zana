/**
 * Regression for Part B (the output-activity lease heartbeat): a worker that is
 * NON-restful ('working') but ALIVE and streaming output must NOT be reclaimed. This
 * is the discriminator that makes the feature actually work in the app — the fix must
 * distinguish a healthy long-running worker (keeps emitting output) from a hung one
 * (goes silent), rather than bluntly reclaiming every non-restful worker (freeze, the
 * old bug) or every long turn (the naive backstop-only tradeoff).
 *
 * Sister spec `job-team-stuck-worker-reclaim.spec.ts` proves the SILENT worker IS
 * reclaimed. Together they prove the lease is a real liveness deadline at the Electron
 * production boundary: the host's `PtyManager` `'data'` hook → `renewWorkerLease` keeps
 * a streaming worker's claim fresh, so the `reconcileActive` sweep never reclaims it.
 *
 * Uses the same E2E-only timing knobs as the reclaim spec (2s lease, 750ms reconcile),
 * but sets NO `maxClaimWallClockMs` — the worker streams forever, so if the heartbeat
 * ever stops renewing, the lease would expire within ~2s and the sweep would reclaim it,
 * emitting a `Reclaimed N expired work claim(s)` event. The HARD GATE asserts that event
 * NEVER appears across a window far longer than the lease, AND the execution stays RUNNING
 * with its unit still CLAIMED. A false green (worker never actually started) is ruled out
 * by first waiting for the fake worker to log that it went working and began streaming.
 */
import { test, expect } from './fixtures/app.js';
import {
  createJobTeamContext,
  launchJobTeamCliOwner,
  findJobExecutionId,
  jobTeamFailure,
  teardownJobTeam
} from './sdk/job-team-scenario.js';
import { existsSync, readFileSync } from 'node:fs';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true },
  launchEnv: { ZCC_WORK_CLAIM_LEASE_MS: '2000', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '750' }
});
test.setTimeout(120_000);

test('Job Team does NOT reclaim a live, streaming non-restful worker (output-activity lease heartbeat)', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'zcc-cli-streaming-', scenario: 'streaming-worker' });
  const { window, logPath } = ctx;

  try {
    const projectId = await launchJobTeamCliOwner(ctx, { workerQuantity: 1 });

    const executionId = await findJobExecutionId(window, projectId, 'CLI Agent streaming job');

    // Guard against a false green: confirm the worker actually claimed the unit, went
    // working, and began streaming BEFORE we assert the absence of a reclaim. Without
    // this, "no reclaim event" would trivially hold even if nothing ever ran.
    await expect.poll(() => (existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''),
      { timeout: 30_000, intervals: [500] }).toContain('streaming: went working');

    const reclaimEventSeen = async () => window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return (snap?.events ?? []).some((event: { summary?: string }) =>
        typeof event.summary === 'string' && event.summary.includes('expired work claim'));
    }, { projectId, executionId });

    // HARD GATE: dwell well past the lease (2s) and many reconcile sweeps (750ms), then
    // prove the streaming worker was NEVER reclaimed. If the output heartbeat regressed,
    // the lease would expire within ~2s and the sweep would emit an 'expired work claim'
    // event almost immediately. Sample twice across the window so a late reclaim also fails.
    await window.waitForTimeout(8_000);
    expect(await reclaimEventSeen(), 'streaming worker was reclaimed mid-window').toBe(false);
    await window.waitForTimeout(4_000);
    expect(await reclaimEventSeen(), 'streaming worker was reclaimed').toBe(false);

    // The execution is still active (not terminal) with its unit still CLAIMED — never
    // released back to READY, which is exactly what a reclaim would have done.
    const board = await window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return { state: snap?.execution?.state, assignments: snap?.execution?.work?.assignments ?? [] };
    }, { projectId, executionId });
    expect(['COMPLETED', 'FAILED', 'CANCELED']).not.toContain(board.state);
    expect(board.assignments.some((assignment: { state?: string }) => assignment.state === 'CLAIMED')).toBe(true);
  } catch (error) {
    throw jobTeamFailure(ctx, error);
  } finally {
    await teardownJobTeam(ctx);
  }
});
