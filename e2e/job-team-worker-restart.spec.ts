/**
 * AC: Restart on a Squad worker rejoins the Squad. `terminals.restartSquadWorker` (the card's
 * Restart action) is sent only the session id; main resolves slot and run itself. The restarted
 * worker keeps its slot, role and execution id, and a foreign / non-worker session is refused.
 */
import { test, expect } from './fixtures/app.js';
import { createJobTeamContext, findJobExecutionId, jobTeamFailure, launchSquadFixture, teardownJobTeam } from './sdk/job-team-scenario.js';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true, sponsorPromptDismissed: true, tmuxScope: 'off' },
  launchEnv: { ZCC_WORK_CLAIM_LEASE_MS: '60000', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '60000' }
});
test.setTimeout(180_000);

test('Restart on a Squad worker keeps its slot and execution; non-workers are refused', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'worker-restart-', scenario: 'stalled-worker' });
  try {
    const projectId = await launchSquadFixture(ctx, [{ label: 'restart', input: { mode: 'now', title: 'Restart run' } }]);
    const executionId = await findJobExecutionId(ctx.window, projectId, 'Restart run');
    const list = () => ctx.window.evaluate(async (projectId) => (await window.cc.terminals.list(projectId)).map((s) => ({
      id: s.id, pid: s.pid, createdAt: s.createdAt, status: s.status, role: s.cohort?.role, slotId: s.cohort?.slotId, executionId: s.cohort?.executionId
    })), projectId);
    await expect.poll(async () => (await list()).filter((s) => s.role === 'worker').length, { timeout: 60_000 }).toBe(1);
    const before = (await list()).find((s) => s.role === 'worker')!;
    expect(before.executionId).toBe(executionId);

    const result = await ctx.window.evaluate((id) => window.cc.terminals.restartSquadWorker(id), before.id);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });

    // Restart relaunches the worker process. Main may reuse the session id, so the proof of a real
    // restart is that the old process/launch is gone: a different id, or (same id) a new pid and
    // creation time on a running session. The old launch must no longer be listed as live.
    const isOld = (s: Awaited<ReturnType<typeof list>>[number]) =>
      s.id === before.id && s.pid === before.pid && s.createdAt === before.createdAt;
    await expect.poll(async () => {
      const workers = (await list()).filter((s) => s.role === 'worker');
      return { count: workers.length, oldLaunchLive: workers.some(isOld), running: workers.every((s) => s.status === 'running') };
    }, { timeout: 60_000 }).toEqual({ count: 1, oldLaunchLive: false, running: true });
    const after = (await list()).filter((s) => s.role === 'worker');
    expect({ slotId: after[0].slotId, executionId: after[0].executionId }).toEqual({ slotId: before.slotId, executionId });

    // The orchestrator is not a worker, and an unknown id is not a session at all.
    const orchestrator = (await list()).find((s) => s.role === 'orchestrator')!;
    const refusedOrchestrator = await ctx.window.evaluate((id) => window.cc.terminals.restartSquadWorker(id), orchestrator.id);
    expect(refusedOrchestrator.ok).toBe(false);
    const refusedUnknown = await ctx.window.evaluate(() => window.cc.terminals.restartSquadWorker('no-such-session'));
    expect(refusedUnknown.ok).toBe(false);
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});
