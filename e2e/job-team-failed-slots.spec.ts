/**
 * AC3/AC4/AC5 through the built app: a worker slot that cannot launch is reported when the
 * launch settles. A structured (provided-plan) Squad fails with the slot reason and leaves no
 * live workers; a freeform Squad continues with a visible run warning; a Squad whose every
 * worker slot is unresolved is refused at admission.
 *
 * The failing seat comes from the build-gated test fault `ZCC_TEST_FAULT=worker-spawn-throw`
 * (apps/desktop/src/test-faults.ts): the second seat of each row throws instead of spawning.
 * The fault exists only in `pnpm test:e2e` builds (ZCC_E2E_BUILD=1), so run this spec with
 * `pnpm test:e2e -- e2e/job-team-failed-slots.spec.ts`, not `:only` against a production build.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import {
  coordinatorResult, createJobTeamContext, findJobExecutionId, jobTeamFailure, launchJobTeamCliOwner,
  teardownJobTeam, SQUAD_WRITE_PLAN, type JobTeamContext
} from './sdk/job-team-scenario.js';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true, sponsorPromptDismissed: true, tmuxScope: 'off' },
  launchEnv: {
    ZCC_WORK_CLAIM_LEASE_MS: '60000', ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '60000',
    ZCC_TEST_FAULT: 'worker-spawn-throw'
  }
});
test.setTimeout(180_000);

const GHOST = { personaId: 'ghost-persona-not-on-disk', quantity: 1 };

async function workerSessions(ctx: JobTeamContext): Promise<string[]> {
  return ctx.window.evaluate(async (projectId) =>
    (await window.cc.terminals.list(projectId)).filter((s) => s.cohort?.role === 'worker').map((s) => s.id), ctx.projectId!);
}

async function runLaunch(ctx: JobTeamContext, title: string, planning: 'provided' | 'infer', slots: unknown[]) {
  writeFileSync(join(ctx.projectDir, '.e2e-plan.md'), SQUAD_WRITE_PLAN);
  writeFileSync(join(ctx.projectDir, '.e2e-proposal.json'), JSON.stringify({
    planPath: '.e2e-plan.md', observeExecutions: true,
    proposals: [{ tool: 'squad_launch', label: 'slots', input: {
      teamId: 'e2e-job-team', goal: 'Execute fixture plan.', planning, mode: 'now', title,
      ...(planning === 'provided' ? { sources: ['.e2e-plan.md'] } : {})
    } }]
  }));
  const projectId = await launchJobTeamCliOwner(ctx, {
    workerQuantity: 1, prompt: 'E2E launch Squad', teamExtra: { slots, defaultPlanning: planning }
  });
  await expect.poll(() => coordinatorResult(ctx, 'propose[slots]'), { timeout: 60_000, intervals: [500] }).not.toBeNull();
  return { projectId, result: coordinatorResult<{ executionId?: string }>(ctx, 'propose[slots]')! };
}

test('structured Squad with a worker that fails to spawn fails with the slot reason and leaves no live workers', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'failed-slots-structured-', scenario: 'stalled-worker' });
  try {
    const { projectId } = await runLaunch(ctx, 'Structured failed slot', 'provided', [{ personaId: 'e2e-worker', quantity: 2 }]);
    const executionId = await findJobExecutionId(ctx.window, projectId, 'Structured failed slot');
    // The run is failed when the launch settles; no status read is needed to trigger it.
    await expect.poll(() => ctx.window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return { state: snap?.execution.state, reason: (snap?.execution as { failureReason?: string } | undefined)?.failureReason ?? '' };
    }, { projectId, executionId }), { timeout: 30_000, intervals: [250] }).toMatchObject({
      state: 'FAILED', reason: expect.stringContaining('injected worker spawn fault')
    });
    await expect.poll(() => workerSessions(ctx), { timeout: 30_000 }).toEqual([]);
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});

test('freeform Squad with a worker that fails to spawn keeps running with a launch warning naming the slot', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'failed-slots-freeform-', scenario: 'stalled-worker' });
  try {
    const { projectId } = await runLaunch(ctx, 'Freeform failed slot', 'infer', [{ personaId: 'e2e-worker', quantity: 2 }]);
    const executionId = await findJobExecutionId(ctx.window, projectId, 'Freeform failed slot');
    await expect.poll(() => ctx.window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return (snap?.events ?? []).some((e: { summary?: string }) => (e.summary ?? '').includes('e2e-worker:1'));
    }, { projectId, executionId }), { timeout: 30_000, intervals: [250] }).toBe(true);
    const state = await ctx.window.evaluate(async ({ projectId, executionId }) =>
      (await window.cc.executionBoard.snapshot(projectId, executionId, 0))?.execution.state, { projectId, executionId });
    expect(state).not.toBe('FAILED');
    expect(await workerSessions(ctx)).toHaveLength(1);
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});

test('a Squad whose every worker slot is unresolved is refused at admission and nothing launches', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'failed-slots-refuse-all-', scenario: 'stalled-worker' });
  try {
    const { projectId, result } = await runLaunch(ctx, 'All ghost slots', 'provided', [GHOST]);
    expect(result.ok).toBe(false);
    expect(result.error ?? '').toMatch(/ADMISSION_FAILED/);
    expect((await ctx.window.evaluate((id) => window.cc.executionBoard.listProject(id), projectId)).executions).toHaveLength(0);
    expect(await workerSessions(ctx)).toEqual([]);
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});
