/**
 * Regression for the recurring remote-worker DISPATCH wedge (live run
 * 1aa3cf47): a durable run's first worker-assignment batch fails to deliver, so
 * the unit is released back to READY with nothing in flight (0 CLAIMED). Because
 * `cascadeDispatch` only fires on work edges and `PlanReadinessWatchdog`
 * self-removes once a plan exists, there is NO edge left to re-attempt the
 * dispatch — the coordinator sits PARKED and the run is wedged forever.
 *
 * In production the trigger was a stale/`unknown` slot-health reading gating an
 * already-spawned worker; the fix has two halves:
 *   - routing-policy makes slot health ADVISORY (only a fresh, positive
 *     `unavailable` blocks) so a stale TTL can no longer wedge a dispatch —
 *     guarded by the routing-policy unit test.
 *   - `SquadExecutionService.redispatchStalled()` — a periodic recovery sweep
 *     (run alongside `reconcileActive` on the reconcile interval) re-cascades any
 *     durable run left with READY units and nothing CLAIMED. THIS spec guards
 *     that sweep end-to-end at the real Electron production boundary.
 *
 * The deterministic Job Team fakes never reproduce the wedge (fast DAG, single
 * dispatch, local workers, delivery never fails), which is exactly why the class
 * of bug shipped. We inject a TRANSIENT first-dispatch failure via the E2E-only
 * host seam `ZCC_E2E_STALL_FIRST_DISPATCH` (honored ONLY under ZCC_E2E_HOME;
 * undefined and byte-unchanged in production) and compress the reconcile sweep to
 * sub-second so the recovery is observable in bounded wall time.
 *
 * Hard gate: the run reaches COMPLETED (its worker writes `result.txt`) DESPITE
 * the forced first-dispatch failure. Without `redispatchStalled`, the released
 * unit never re-dispatches, the coordinator never gets its result, and the spec
 * times out — so a removed/regressed recovery sweep fails this test.
 */
import { test, expect } from './fixtures/app.js';
import {
  answerJobBlockerThroughUi,
  createJobTeamContext,
  launchJobTeamCliOwner,
  findJobExecutionId,
  jobTeamFailure,
  readCoordinatorLog,
  teardownJobTeam
} from './sdk/job-team-scenario.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true },
  // Force the first worker-assignment batch to release undelivered (the wedge),
  // and set the reconcile/redispatch sweep to a few seconds — long enough that
  // the transient 0-CLAIMED wedge is reliably observable by the waypoint poll,
  // short enough that recovery + completion land well inside the test timeout.
  launchEnv: { ZCC_E2E_STALL_FIRST_DISPATCH: '1', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '3000' }
});
test.setTimeout(120_000);

test('Job Team recovers a wedged run (0 CLAIMED after a failed first dispatch) via redispatchStalled', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'zcc-cli-wedge-' });
  const { window, projectDir } = ctx;

  try {
    const projectId = await launchJobTeamCliOwner(ctx, { workerQuantity: 2 });

    // The durable execution appears once the owner calls execution.start.
    const executionId = await findJobExecutionId(window, projectId, 'CLI Agent durable job');

    // Waypoint: the forced first dispatch releases the unit back to READY with
    // nothing CLAIMED — the exact wedge shape redispatchStalled must escape.
    await expect.poll(async () => window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      const counts = snap?.execution?.work?.counts;
      return !!counts && counts.READY > 0 && counts.CLAIMED === 0;
    }, { projectId, executionId }), { timeout: 30_000, intervals: [250] }).toBe(true);

    try {
      await answerJobBlockerThroughUi({ window, projectId, executionId, jobTitle: 'CLI Agent durable job' });
    } catch (error) {
      const snapshot = await window.evaluate(async ({ projectId, executionId }) =>
        window.cc.executionBoard.snapshot(projectId, executionId, 0), { projectId, executionId });
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(snapshot)}\n${readCoordinatorLog(ctx)}`);
    }
    // HARD GATE: the run completes despite the wedge — the recovery sweep
    // re-dispatched the released unit, the worker ran it, and wrote its result.
    await expect.poll(() => existsSync(join(projectDir, 'result.txt')), { timeout: 30_000 }).toBe(true);
    expect(readFileSync(join(projectDir, 'result.txt'), 'utf8')).toContain('LABEL: About Atlas');
  } catch (error) {
    throw jobTeamFailure(ctx, error);
  } finally {
    await teardownJobTeam(ctx);
  }
});
