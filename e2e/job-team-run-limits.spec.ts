/**
 * Per-Squad run limits through the built app: the Squad editor saves them, and a run started from
 * that Squad carries them (effective limits in the run's snapshot and run detail) and honours
 * `maxConcurrent` when launching workers.
 */
import { test, expect } from './fixtures/app.js';
import { createJobTeamContext, findJobExecutionId, jobTeamFailure, launchSquadFixture, teardownJobTeam } from './sdk/job-team-scenario.js';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true, sponsorPromptDismissed: true, tmuxScope: 'off' },
  launchEnv: { ZCC_WORK_CLAIM_LEASE_MS: '60000', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '60000' }
});
test.setTimeout(180_000);

const PLAN = [
  '# Limits plan',
  '### unit-a: Write a <!-- executable-step -->', '- Work: Create a.txt.', '- Write scope: `a.txt`', '- Verification: Read a.txt.', '',
  '### unit-b: Write b <!-- executable-step -->', '- Work: Create b.txt.', '- Write scope: `b.txt`', '- Verification: Read b.txt.', ''
].join('\n');

test('a run carries its Squad run limits into run detail and launches the roster within maxConcurrent', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'run-limits-', scenario: 'stalled-worker' });
  try {
    const projectId = await launchSquadFixture(ctx, [{ label: 'limits', input: { mode: 'now', title: 'Limits run' } }], {
      plan: PLAN, workerQuantity: 2, teamExtra: { limits: { maxConcurrent: 3, claimStallMs: 300_000 } }
    });
    const executionId = await findJobExecutionId(ctx.window, projectId, 'Limits run');

    const limits = await ctx.window.evaluate(async ({ projectId, executionId }) =>
      (await window.cc.executionBoard.snapshot(projectId, executionId, 0))?.execution.limits, { projectId, executionId });
    expect(limits).toMatchObject({ maxConcurrent: 3, claimStallMs: 300_000 });

    // The limit counts every session in the run (coordinator included): a coordinator plus two workers
    // fits a cap of 3.
    await expect.poll(() => ctx.window.evaluate(async ({ projectId, executionId }) =>
      (await window.cc.terminals.list(projectId)).filter((s) => s.cohort?.executionId === executionId && s.cohort.role === 'worker').length,
    { projectId, executionId }), { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(() => ctx.window.evaluate(async ({ projectId, executionId }) =>
      (await window.cc.terminals.list(projectId)).filter((s) => s.cohort?.executionId === executionId && s.cohort.role === 'worker').length,
    { projectId, executionId }), { timeout: 30_000 }).toBe(2);

    // Run detail shows the effective limits.
    const ownerModal = ctx.window.getByRole('dialog', { name: /^Agent / }).first();
    if (await ownerModal.count()) await ownerModal.getByRole('button', { name: 'Close' }).click();
    await ctx.window.getByTestId('nav-agents').or(ctx.window.getByTestId('project-nav-agents')).click();
    await ctx.window.locator('.agent-card').filter({ hasText: 'Limits run' }).first().click();
    await expect(ctx.window.getByTestId('execution-limits')).toContainText('up to 3 sessions');
    await expect(ctx.window.getByTestId('execution-limits')).toContainText('claim stall 5');
  } catch (error) {
    if (ctx.projectId) ctx.diagnostics.push(`limits diag: ${JSON.stringify(await ctx.window.evaluate(async (projectId) => {
      const board = await window.cc.executionBoard.listProject(projectId);
      const snap = board.executions[0] ? await window.cc.executionBoard.snapshot(projectId, board.executions[0].executionId, 0) : null;
      return { state: snap?.execution.state, events: (snap?.events ?? []).map((e: { summary?: string }) => e.summary), sessions: (await window.cc.terminals.list(projectId)).map((s) => [s.title, s.cohort?.role]) };
    }, ctx.projectId).catch((e) => String(e)))}`);
    throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});

test('a roster larger than maxConcurrent is refused at launch and starts no workers', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'run-limits-over-', scenario: 'stalled-worker' });
  try {
    const projectId = await launchSquadFixture(ctx, [{ label: 'over', input: { mode: 'now', title: 'Over limit run' } }], {
      plan: PLAN, workerQuantity: 2, teamExtra: { limits: { maxConcurrent: 2 } }
    });
    const executionId = await findJobExecutionId(ctx.window, projectId, 'Over limit run');
    await expect.poll(() => ctx.window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return { state: snap?.execution.state, limit: snap?.execution.limits?.maxConcurrent,
        refused: (snap?.events ?? []).some((e: { summary?: string }) => /concurrent launch limit reached/.test(e.summary ?? '')) };
    }, { projectId, executionId }), { timeout: 30_000, intervals: [500] }).toEqual({ state: 'BLOCKED', limit: 2, refused: true });
    expect(await ctx.window.evaluate(async (projectId) =>
      (await window.cc.terminals.list(projectId)).filter((s) => s.cohort?.role === 'worker').length, projectId)).toBe(0);
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});

test('a scheduled run of a saved Squad carries the Squad run limits', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'run-limits-sched-', scenario: 'stalled-worker' });
  try {
    const projectId = await launchSquadFixture(ctx, [], {
      plan: PLAN, workerQuantity: 2, teamExtra: { limits: { maxConcurrent: 3, claimStallMs: 300_000 } }
    });
    const { window } = ctx;
    const created = await window.evaluate((input) => window.cc.scheduler.create({
      projectId: input.projectId, scope: { projectId: input.projectId }, name: 'Scheduled limits squad',
      every: '1d', profile: 'claude', kind: 'team', teamId: 'e2e-job-team', planSource: 'provided',
      prompt: input.prompt, enabled: false, inboxLevel: 'silent'
    }), { projectId, prompt: PLAN });
    expect(created).toMatchObject({ ok: true });
    const scheduleId = (created as { value: { id: string } }).value.id;
    const preview = await window.evaluate((id) => window.cc.scheduler.previewTeamLaunch(id), scheduleId);
    expect(preview.ok, JSON.stringify(preview)).toBe(true);
    const token = (preview as { value: { previewToken: string } }).value.previewToken;
    const ran = await window.evaluate(({ id, token }) => window.cc.scheduler.runReviewedTeamNow(id, token), { id: scheduleId, token });
    expect(ran.ok, JSON.stringify(ran)).toBe(true);

    let executionId = '';
    await expect.poll(async () => {
      executionId = await window.evaluate(async (pid) => (await window.cc.executionBoard.listProject(pid)).executions[0]?.executionId ?? '', projectId);
      return executionId;
    }, { timeout: 60_000, intervals: [500] }).not.toBe('');
    const limits = await window.evaluate(async ({ projectId, executionId }) =>
      (await window.cc.executionBoard.snapshot(projectId, executionId, 0))?.execution.limits, { projectId, executionId });
    expect(limits).toMatchObject({ maxConcurrent: 3, claimStallMs: 300_000 });
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});
