/**
 * A claimed Squad worker that never takes a turn is visible. The run records one `worker-no-turn`
 * warning and the Inbox gets one SIGNAL row, however many reconcile sweeps follow. The warning
 * window is compressed to seconds by the build-gated `ZCC_TEST_NO_TURN_WARN_MS` knob (compiled
 * out of production builds; see apps/desktop/src/test-faults.ts).
 */
import { test, expect } from './fixtures/app.js';
import { createJobTeamContext, findJobExecutionId, jobTeamFailure, launchSquadFixture, teardownJobTeam } from './sdk/job-team-scenario.js';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true, sponsorPromptDismissed: true, tmuxScope: 'off' },
  launchEnv: { ZCC_WORK_CLAIM_LEASE_MS: '120000', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '1000', ZCC_TEST_NO_TURN_WARN_MS: '3000' }
});
test.setTimeout(180_000);

const PLAN = [
  '# No-turn plan',
  '### unit-a: Write a <!-- executable-step -->', '- Work: Create a.txt.', '- Write scope: `a.txt`', '- Verification: Read a.txt.', ''
].join('\n');

test('a claimed worker with no turn raises one warning and one Inbox row', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'no-turn-', scenario: 'stalled-worker' });
  const { window } = ctx;
  try {
    const projectId = await launchSquadFixture(ctx, [{ label: 'noturn', input: { mode: 'now', title: 'No turn run' } }], { plan: PLAN, workerQuantity: 1 });
    const executionId = await findJobExecutionId(window, projectId, 'No turn run');
    const warnings = () => window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return (snap?.events ?? []).map((e: { summary?: string }) => e.summary ?? '').filter((s) => /has taken no turn for/.test(s));
    }, { projectId, executionId });

    await expect.poll(async () => (await warnings()).length, { timeout: 90_000, intervals: [500] }).toBe(1);
    // Let several more sweeps run: the warning is once per claim, never repeated.
    await window.waitForTimeout(6_000);
    const seen = await warnings();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/Worker \S+ has taken no turn for/);

    await window.getByTestId('nav-inbox').or(window.getByTestId('project-nav-inbox')).click();
    const rows = window.locator('.inbox-row').filter({ hasText: /has taken no turn/ });
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    await expect(rows).toHaveCount(1);
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});
