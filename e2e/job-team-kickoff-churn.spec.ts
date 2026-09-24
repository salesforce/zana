/**
 * Kickoff-churn SELF-HEAL end to end (the "teams must self-heal, never sit wedged"
 * mandate). A worker that repeatedly CLAIMS its unit but never starts a turn
 * (`turnCount` stays 0 — the live signature of a mis-wired / never-engaging remote
 * worker) must NOT be re-dispatched down the same broken path forever. The engine
 * escalates in two tiers, both guarded here at the REAL Electron production
 * boundary (the `reconcileActive` reclaim sweep + the loopback execution MCP the
 * fake cohort speaks — the same wiring a live remote squad uses):
 *
 *   WS1 (reassign): after `KICKOFF_FAILURE_BLOCK_THRESHOLD` turnCount-0 reclaims on
 *     one worker slot, the unit is re-homed onto a DIFFERENT untried worker slot
 *     (a slot-specific delivery failure may not recur on a fresh peer) — the
 *     "coordinator reassigns before it asks a person" half of the mandate.
 *   WS3 (human block): once EVERY worker slot is exhausted, the unit transitions
 *     to BLOCKED with a HUMAN-audience blocker AND an Inbox entry, so the run
 *     surfaces as needing attention instead of looping silently.
 *
 * Why an E2E and not only the unit tests: the churn signal is pure core execution
 * state (harness-agnostic), but the LIVE path — the reconcile setInterval reclaim
 * bumping `kickoffFailures`, `escalateKickoffFailures` reassigning then blocking,
 * and the inbox append reaching main's store — is only proven end to end here. The
 * single-worker reclaim spec (`job-team-stuck-worker-reclaim`) incidentally drives
 * WS3 but asserts neither the block nor the inbox; WS1 reassign is exercised
 * NOWHERE else live. This is deterministic + zero model spend (fake CLI over the
 * loopback MCP) — no real box, so it belongs in the always-on suite.
 *
 * Determinism: the fake worker holds `working` (non-restful) forever, so only the
 * wall-clock backstop (a small `maxClaimWallClockMs`) reclaims it; the reclaim
 * redispatch passes no `deprioritizeSlotId`, so `dispatchReady` always picks the
 * first free slot — the unit sticks to worker-1 for its 3 reclaims (→ WS1 onto the
 * untried worker-2), then returns to worker-1 (→ both slots tried → WS3). The
 * E2E-only host knobs (ZCC_WORK_CLAIM_LEASE_MS / ZCC_EXECUTION_RECONCILE_INTERVAL_MS,
 * honored ONLY under ZCC_E2E_HOME) compress the sweep into a few seconds.
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
  // Shrink the 90s claim lease + 30s reconcile sweep so the wall-clock backstop
  // reclaims the stuck (turnCount-0) claim in a few seconds — the churn escalates
  // through WS1 then WS3 well inside the test budget.
  launchEnv: { ZCC_WORK_CLAIM_LEASE_MS: '2000', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '750' }
});
test.setTimeout(150_000);

test('Job Team self-heals kickoff churn: reassign to a fresh slot (WS1), then block a human + inbox (WS3)', async ({ app }) => {
  // TWO worker slots: the sole unit churns on worker-1, then WS1 re-homes it onto
  // the untried worker-2 before WS3 blocks. A single-worker team can only reach WS3.
  const ctx = createJobTeamContext(app, { tmpPrefix: 'zcc-cli-churn-', scenario: 'kickoff-churn' });
  const { window } = ctx;

  try {
    const projectId = await launchJobTeamCliOwner(ctx, { workerQuantity: 2 });

    // The durable execution appears once the owner calls execution.start.
    const executionId = await findJobExecutionId(window, projectId, 'CLI Agent kickoff churn job');

    // We read the SAME board snapshot the UI reads (production boundary). Both
    // escalation tiers commit a distinct event summary through `mutateRecord`.
    const eventSeen = (needle: string) => async () => window.evaluate(async ({ projectId, executionId, needle }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return (snap?.events ?? []).some((event: { summary?: string }) =>
        typeof event.summary === 'string' && event.summary.includes(needle));
    }, { projectId, executionId, needle });

    // WS1: the unit exhausts worker-1's kickoff budget and is reassigned to the
    // untried worker-2 (self-heal before asking a person).
    await expect.poll(eventSeen('reassigned to fresh slot'), { timeout: 90_000, intervals: [500] }).toBe(true);

    // WS3: worker-2 also exhausts its budget → every slot tried → the run surfaces
    // a HUMAN_BLOCKER instead of looping forever.
    await expect.poll(eventSeen('blocked after repeated kickoff failure'), { timeout: 90_000, intervals: [500] }).toBe(true);

    // WS3 twin: the human block ALSO produces an actionable Inbox entry (a
    // kickoff-blocker row bound to this execution). A block that only woke the
    // parked coordinator with NO inbox message was the exact live gap.
    await expect.poll(async () => window.evaluate(async (executionId) => {
      const page = await window.cc.inbox.history({ limit: 200 });
      return (page?.entries ?? []).some((entry: { executionId?: string; blockerId?: string }) =>
        entry.executionId === executionId && typeof entry.blockerId === 'string' && entry.blockerId.startsWith('kickoff:'));
    }, executionId), { timeout: 30_000, intervals: [500] }).toBe(true);
  } catch (error) {
    throw jobTeamFailure(ctx, error);
  } finally {
    await teardownJobTeam(ctx);
  }
});
