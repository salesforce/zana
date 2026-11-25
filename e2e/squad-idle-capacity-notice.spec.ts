/**
 * Idle-capacity notice through the built app. Two workers, two units that share a write scope: the engine
 * serializes them, so one worker holds unit `unit-a` (stalled) while `unit-b` stays READY with the other seat
 * idle. After the idle window the run records ONE `worker-idle` warning naming the unit as `"id: title"`, and
 * the Inbox shows one row, however many reconcile sweeps follow (dedupe). The window is compressed by the
 * build-gated `ZCC_TEST_IDLE_NOTICE_MS` knob (apps/desktop/src/test-faults.ts), compiled out of production.
 */
import { test, expect } from './fixtures/app.js';
import {
  createJobTeamContext, findJobExecutionId, jobTeamFailure, launchSquadFixture, teardownJobTeam
} from './sdk/job-team-scenario.js';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true, sponsorPromptDismissed: true, tmuxScope: 'off' },
  launchEnv: {
    ZCC_EXECUTION_STORE: 'json', ZCC_WORK_CLAIM_LEASE_MS: '120000',
    ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '1000', ZCC_TEST_IDLE_NOTICE_MS: '4000'
  }
});
test.setTimeout(240_000);
test.skip(process.env.ZCC_E2E_BUILD !== '1', 'needs a `pnpm test:e2e` build with test faults compiled in');

const PLAN = [
  '# Idle capacity plan',
  '### unit-a: Write shared file <!-- executable-step -->', '- Work: Create shared.txt.', '- Write scope: `shared.txt`', '- Verification: Read shared.txt.', '',
  '### unit-b: Append to shared file <!-- executable-step -->', '- Work: Append to shared.txt.', '- Write scope: `shared.txt`', '- Verification: Read shared.txt.', ''
].join('\n');

test('idle seat while a unit waits raises one idle-capacity notice', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'idle-capacity-', scenario: 'stalled-worker' });
  const { window } = ctx;
  try {
    const projectId = await launchSquadFixture(ctx, [{ label: 'idle', input: { mode: 'now', title: 'Idle capacity run' } }], { plan: PLAN, workerQuantity: 2 });
    const executionId = await findJobExecutionId(window, projectId, 'Idle capacity run');
    const idleEvents = () => window.evaluate(async ({ projectId, executionId }) =>
      ((await window.cc.executionBoard.snapshot(projectId, executionId, 0))?.events ?? [])
        .map((e: { summary?: string }) => e.summary ?? '').filter((s) => /is idle while unit/.test(s)), { projectId, executionId });

    await expect.poll(async () => (await idleEvents()).length, { timeout: 90_000, intervals: [500] }).toBe(1);
    expect((await idleEvents())[0]).toMatch(/is idle while unit "unit-b: Append to shared file" has been ready for/);
    // More sweeps run: the notice is once per unit and claim generation.
    await window.waitForTimeout(8_000);
    expect(await idleEvents()).toHaveLength(1);

    await window.getByTestId('nav-inbox').or(window.getByTestId('project-nav-inbox')).click();
    const rows = window.getByRole('button', { name: /is idle while unit/ });
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    await expect(rows).toHaveCount(1);
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});
