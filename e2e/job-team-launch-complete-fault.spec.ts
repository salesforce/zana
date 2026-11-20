/**
 * AC4 through the built app: when the final lifecycle write of a launch throws, every session the
 * launch started is closed by id and the original error reaches the caller.
 *
 * Needs the build-gated fault `ZCC_TEST_FAULT=launch-complete-throw` (apps/desktop/src/test-faults.ts),
 * which exists only in builds made by `pnpm test:e2e` (ZCC_E2E_BUILD=1). Run it with
 * `pnpm test:e2e -- e2e/job-team-launch-complete-fault.spec.ts`; `pnpm test:e2e:only` against a
 * production build cannot exercise it.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import {
  coordinatorResult, createJobTeamContext, jobTeamFailure, launchJobTeamCliOwner, teardownJobTeam, SQUAD_WRITE_PLAN
} from './sdk/job-team-scenario.js';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true, sponsorPromptDismissed: true, tmuxScope: 'off' },
  launchEnv: { ZCC_TEST_FAULT: 'launch-complete-throw' }
});
test.setTimeout(180_000);

test('a launch whose completion write throws closes every started session and surfaces the error', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'launch-complete-fault-', scenario: 'stalled-worker' });
  try {
    writeFileSync(join(ctx.projectDir, '.e2e-plan.md'), SQUAD_WRITE_PLAN);
    writeFileSync(join(ctx.projectDir, '.e2e-proposal.json'), JSON.stringify({
      planPath: '.e2e-plan.md', observeExecutions: true,
      proposals: [{ tool: 'squad_launch', label: 'fault', input: {
        teamId: 'e2e-job-team', goal: 'Execute fixture plan.', planning: 'provided', mode: 'now',
        title: 'Complete fault', sources: ['.e2e-plan.md']
      } }]
    }));
    const projectId = await launchJobTeamCliOwner(ctx, {
      workerQuantity: 2, prompt: 'E2E launch Squad', teamExtra: { defaultPlanning: 'provided' }
    });
    await expect.poll(() => coordinatorResult(ctx, 'propose[fault]'), { timeout: 60_000, intervals: [500] }).not.toBeNull();
    const result = coordinatorResult(ctx, 'propose[fault]')!;
    expect(result.ok).toBe(false);
    // squad_launch wraps the launch failure as a state conflict; the original message is not exposed to the tool caller.
    expect(result.error ?? '').toMatch(/TEAM_LAUNCH_STATE_CONFLICT|injected launch completion fault/);
    // Every Squad session the request started is gone: no worker, no coordinator.
    await expect.poll(() => ctx.window.evaluate(async (id) =>
      (await window.cc.terminals.list(id)).filter((s) => s.cohort && s.cohort.role !== 'owner').map((s) => `${s.cohort?.role}:${s.id}`), projectId),
    { timeout: 30_000, intervals: [250] }).toEqual([]);
    // The run record is not left RUNNING. Observed: a failed completion leaves it BLOCKED (kickoff
    // reassignment finds no worker), which the user can Stop; it must never claim live progress.
    const page = await ctx.window.evaluate((id) => window.cc.executionBoard.listProject(id), projectId);
    for (const execution of page.executions) expect(['FAILED', 'STOPPED', 'CANCELED', 'BLOCKED']).toContain(execution.state);
  } catch (error) { throw jobTeamFailure(ctx, error); }
  finally { await teardownJobTeam(ctx); }
});
