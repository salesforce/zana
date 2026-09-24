/**
 * Regression for the live Team/Squad FREEZE (run df216947): a worker claims its
 * unit, resolves NON-restful ('working'), and never completes/blocks/idles. With
 * no worker heartbeat, its 90s lease expires — but the restful reclaim gate can
 * never fire for a non-restful worker, so the claim is stranded forever. The one
 * state-agnostic escape is the wall-clock backstop, which was DEAD in production
 * (`maxClaimWallClockMs` unset on every run). The fix injects a server-side
 * default ceiling for durable worker-DAG runs so a stuck claim is force-reclaimed.
 *
 * This drives the REAL Electron production boundary the deterministic Job Team
 * fakes never reach: the `reconcileActive` setInterval, the host's live
 * `getAgentState` resolving a stalled worker PTY as non-restful, and the persisted
 * `execution.start` policy. It compresses the two production timing constants to
 * seconds via the E2E-only host knobs (ZCC_WORK_CLAIM_LEASE_MS /
 * ZCC_EXECUTION_RECONCILE_INTERVAL_MS, honored ONLY under ZCC_E2E_HOME) so the
 * reclaim is observable in bounded wall time.
 *
 * Coverage split (the fix has two halves, each guarded by the right test):
 *   - This E2E guards the backstop WIRING end-to-end: a small explicit
 *     `maxClaimWallClockMs` (the production default is ~20min — untestable in fast
 *     wall time) makes the wall-clock branch — not the restful gate — the sole
 *     reclaimer, so a removed/regressed backstop leaves the run frozen and fails it.
 *   - The server-side DEFAULT injection (`withDurableClaimWallClockBackstop`, which
 *     revived the dead backstop by defaulting the ceiling for durable worker-DAG
 *     runs) is guarded by the execution-service unit test's `start` wiring case.
 *
 * Hard gate: the stall unit's `claimGeneration` climbs past its first claim,
 * proving the backstop reclaimed the stuck non-restful claim AND re-dispatched it
 * (a frozen run would sit at claimGeneration 1 forever). We deliberately do NOT
 * assert COMPLETED — the stalled worker never finishes; healthy end-to-end
 * completion is covered by the other Job Team specs and worker-heartbeat is a
 * deferred follow-up.
 */
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
  // E2E-only durable-execution timing knobs (see host.ts e2eTimingOverrideMs):
  // shrink the 90s claim lease and 30s reconcile sweep so the wall-clock backstop
  // reclaims the stuck claim in a few seconds instead of minutes.
  launchEnv: { ZCC_WORK_CLAIM_LEASE_MS: '2000', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '750' }
});
test.setTimeout(120_000);

test('Job Team reclaims a stuck non-restful worker via the wall-clock backstop (run df216947)', async ({ app }) => {
  // One worker: the sole unit lands on it, and it stalls there.
  const ctx = createJobTeamContext(app, { tmpPrefix: 'zcc-cli-stalled-', scenario: 'stalled-worker' });
  const { window } = ctx;

  try {
    const projectId = await launchJobTeamCliOwner(ctx, { workerQuantity: 1 });

    // The durable execution appears once the owner calls execution.start.
    const executionId = await findJobExecutionId(window, projectId, 'CLI Agent stalled job');

    // HARD GATE: the wall-clock backstop reclaims the stuck non-restful claim,
    // which appends a `Reclaimed N expired work claim(s)` event. A frozen run (the
    // bug — before the server-side default ceiling revived the dead backstop) never
    // emits it: a lease-expired non-restful worker was never reclaimed. We observe
    // the event through the same board snapshot the UI reads (production boundary).
    const reclaimEventSeen = async () => window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return (snap?.events ?? []).some((event: { summary?: string }) =>
        typeof event.summary === 'string' && event.summary.includes('expired work claim'));
    }, { projectId, executionId });

    await expect.poll(reclaimEventSeen, { timeout: 60_000, intervals: [500] }).toBe(true);
  } catch (error) {
    throw jobTeamFailure(ctx, error);
  } finally {
    await teardownJobTeam(ctx);
  }
});
