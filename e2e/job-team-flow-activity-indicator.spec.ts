/**
 * Production-boundary regression for the Flow-view activity indicator: a live
 * worker that holds a CLAIMED unit with a fresh claim lease must RENDER as
 * "streaming" in the Agents → Flow graph — the node pulses (universal working
 * treatment), draws a self-loop arc, and shows a "live" badge — even when it
 * hands off to nobody (a single-worker DAG draws zero handoff edges, the
 * original "no arrows, looks dead" gap this indicator closes).
 *
 * This exercises the full main→renderer seam that unit tests can't: the durable
 * work unit's claim timestamps (`claimedAt`/`heartbeatAt`/`leaseExpiresAt`) →
 * `projectExecutionProjection` assignment fields → `executionBoard.listProject`
 * IPC → `buildSquadFlow` resolving the node's CLAIMED slot into `node.claim` →
 * `nodeActivity` → the `squad-flow-node--streaming` / `.squad-flow-live` /
 * `path.squad-flow-self-loop` DOM in the built Electron renderer.
 *
 * Reuses the `streaming-worker` fake (worker claims its unit, goes ✻ working,
 * and emits output forever). A COMFORTABLE lease (30s) is used deliberately —
 * unlike the sister no-reclaim spec (2s, to force quick reclaim detection),
 * here we want `leaseExpiresAt > now` to hold stably across the render
 * assertions so the "streaming" truth doesn't flicker. Lease renewal itself is
 * covered by `job-team-streaming-worker-no-reclaim.spec.ts`; this spec proves
 * the RENDER.
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
  launchEnv: { ZCC_WORK_CLAIM_LEASE_MS: '30000', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '750' }
});
test.setTimeout(120_000);

test('Flow view renders the streaming activity indicator for a live claimed worker', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'zcc-cli-flow-activity-', scenario: 'streaming-worker' });
  const { window, logPath } = ctx;

  try {
    const projectId = await launchJobTeamCliOwner(ctx, { workerQuantity: 1 });

    // Wait for the durable execution to surface and its worker to actually claim
    // the unit, go working, and begin streaming — the state that must render as
    // "streaming". Guards against a false green where the treatment is asserted
    // before any claim exists.
    const executionId = await findJobExecutionId(window, projectId, 'CLI Agent streaming job');
    await expect.poll(() => (existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''),
      { timeout: 30_000, intervals: [500] }).toContain('streaming: went working');

    // The assignment carries a live lease the renderer can read (leaseExpiresAt in
    // the future). This is the exact signal the Flow view derives "streaming" from.
    await expect.poll(async () => window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      const claimed = (snap?.execution?.work?.assignments ?? []).find((a: { state?: string }) => a.state === 'CLAIMED') as
        | { leaseExpiresAt?: number }
        | undefined;
      return claimed?.leaseExpiresAt !== undefined && claimed.leaseExpiresAt > Date.now();
    }, { projectId, executionId }), { timeout: 15_000, intervals: [500] }).toBe(true);

    // Open the Agents → Flow view and assert the streaming treatment renders on
    // the live worker node at the real Electron production boundary. The CLI
    // Agent launch left the UI on the new agent's report dialog (which owns the
    // full-screen modal-backdrop), and a "Support Zana" promo can also be up.
    // Close the report dialog FIRST — its backdrop otherwise intercepts every
    // click, including the sponsor Dismiss — then dismiss the sponsor, then nav.
    const agentDialog = window.getByRole('dialog', { name: /E2E start Job Team/ });
    if (await agentDialog.isVisible().catch(() => false)) {
      await agentDialog.getByRole('button', { name: 'Close' }).click();
      await expect(agentDialog).toBeHidden({ timeout: 10_000 });
    }
    const dismissSponsor = window.getByRole('button', { name: 'Dismiss' });
    if (await dismissSponsor.isVisible().catch(() => false)) await dismissSponsor.click();
    await expect(window.locator('.modal-backdrop')).toHaveCount(0, { timeout: 15_000 });
    await window.locator('[data-testid="nav-agents"]').click();
    await expect(window.locator('.agents-board')).toBeVisible({ timeout: 15_000 });
    await window.getByRole('button', { name: 'Flow view' }).click();

    // Working tier: the working node carries the --working class (static border
    // accent — NO pulse; pulse is the kanban board's card language, not the graph's).
    await expect(window.locator('.squad-flow-node--working').first())
      .toBeVisible({ timeout: 20_000 });
    // Streaming subset: fresh-lease node gets the stronger --streaming treatment,
    // a "live" badge, and a self-loop arc (so a lone worker with no handoff edge
    // still shows a directed "working on its own unit" arrow).
    await expect(window.locator('.squad-flow-node--streaming').first())
      .toBeVisible({ timeout: 20_000 });
    await expect(window.locator('.squad-flow-live').first())
      .toBeVisible({ timeout: 20_000 });
    await expect(window.locator('svg.squad-flow-edges path.squad-flow-self-loop').first())
      .toBeVisible({ timeout: 20_000 });
  } catch (error) {
    throw jobTeamFailure(ctx, error);
  } finally {
    await teardownJobTeam(ctx);
  }
});
