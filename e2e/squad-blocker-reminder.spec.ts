/**
 * #790: a human blocker that waits is surfaced again. The run records one `blocker-reminder` warning and
 * the Inbox gets one row, however many reconcile sweeps follow; the Squad panel blocker row shows the wait.
 * The reminder window is compressed by the build-gated `ZCC_TEST_BLOCKER_NOTICE_MS` knob (compiled out of
 * production builds; see apps/desktop/src/test-faults.ts).
 */
import { test, expect } from './fixtures/app.js';
import {
  createJobTeamContext, findJobExecutionId, jobTeamFailure, launchJobTeamCliOwner, teardownJobTeam
} from './sdk/job-team-scenario.js';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true, sponsorPromptDismissed: true },
  launchEnv: { ZCC_EXECUTION_STORE: 'json', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '1000', ZCC_TEST_BLOCKER_NOTICE_MS: '4000' }
});
test.setTimeout(240_000);
test.skip(process.env.ZCC_E2E_BUILD !== '1', 'needs a `pnpm test:e2e` build with test faults compiled in');

const JOB_TITLE = 'CLI Agent durable job';

test('a waiting human blocker raises one reminder, one Inbox row, and shows its wait', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'blocker-reminder-', scenario: 'success' });
  const { window } = ctx;
  try {
    const projectId = await launchJobTeamCliOwner(ctx, { workerQuantity: 2 });
    const executionId = await findJobExecutionId(window, projectId, JOB_TITLE);
    const read = () => window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      const exec = snap?.execution as unknown as { currentBlocker?: { id: string; waitingSince?: number } | null } | undefined;
      return {
        blockerId: exec?.currentBlocker?.id ?? '',
        waitingSince: exec?.currentBlocker?.waitingSince ?? 0,
        reminders: (snap?.events ?? []).map((e: { summary?: string }) => e.summary ?? '').filter((s) => /has waited .* for your answer/.test(s))
      };
    }, { projectId, executionId });

    await expect.poll(async () => (await read()).blockerId, { timeout: 60_000, intervals: [500] }).not.toBe('');
    expect((await read()).waitingSince).toBeGreaterThan(0);

    await expect.poll(async () => (await read()).reminders.length, { timeout: 60_000, intervals: [500] }).toBe(1);
    // More sweeps run: the reminder is once per blocker, never repeated.
    await window.waitForTimeout(6_000);
    expect((await read()).reminders).toHaveLength(1);

    // Squad panel: the blocker row shows the wait.
    await window.getByTestId('nav-agents').or(window.getByTestId('project-nav-agents')).click();
    const card = window.locator('.agent-card').filter({ hasText: JOB_TITLE }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();
    await expect(window.getByLabel('Squad details').getByTestId('execution-blocker-wait')).toContainText(/Waiting/);

    // Inbox: exactly one reminder row.
    await window.getByTestId('nav-inbox').or(window.getByTestId('project-nav-inbox')).click();
    const rows = window.getByRole('button', { name: /still needs your answer/ });
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    await expect(rows).toHaveCount(1);
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});
