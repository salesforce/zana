/**
 * Recovery of a Squad engineer whose turn ended on an API error (#416), at the real
 * Electron boundary. The fake worker runs the REAL UserPromptSubmit / StopFailure hook
 * commands main injected into its --settings. Zana nudges it, then restarts its session
 * in place, then asks the user; the scenarios below prove each rung and the permanent case.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import {
  createJobTeamContext,
  findJobExecutionId,
  jobTeamFailure,
  launchJobTeamCliOwner,
  teardownJobTeam,
  type JobTeamContext
} from './sdk/job-team-scenario.js';

const JOB_TITLE = 'CLI Agent API error job';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true },
  // A long lease and sweep: only the recovery ladder (not lease expiry) may act in this window.
  launchEnv: {
    ZCC_WORK_CLAIM_LEASE_MS: '60000',
    ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '60000',
    ZCC_WORKER_API_ERROR_NUDGE_MS: '2000',
    ZCC_WORKER_API_ERROR_NUDGE_TURN_MS: '8000',
    ZCC_WORKER_API_ERROR_RESTART_DELAY_MS: '2000',
    ZCC_WORKER_API_ERROR_RESTART_TURN_MS: '30000'
  }
});
test.setTimeout(180_000);

interface BoardView {
  state: string;
  blocker: { id: string; question: string } | null;
  unitState: string;
  claimGeneration?: number;
  worktreePath?: string;
  summaries: string[];
}

async function board(window: Page, projectId: string, executionId: string): Promise<BoardView> {
  return window.evaluate(async ({ projectId, executionId }) => {
    const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
    const unit = snap?.execution.work?.assignments.find((entry) => entry.workUnitId === 'api-error-unit');
    return {
      state: snap?.execution.state ?? 'missing',
      blocker: snap?.execution.currentBlocker
        ? { id: snap.execution.currentBlocker.id, question: snap.execution.currentBlocker.question }
        : null,
      unitState: unit?.state ?? 'missing',
      claimGeneration: unit?.claimGeneration,
      worktreePath: snap?.execution.retainedWorktree?.path,
      summaries: (snap?.events ?? []).map((event: { summary?: string }) => event.summary ?? '')
    };
  }, { projectId, executionId });
}

async function workerSessions(window: Page, projectId: string, executionId: string) {
  return window.evaluate(async ({ projectId, executionId }) =>
    (await window.cc.terminals.list(projectId))
      .filter((session) => session.cohort?.executionId === executionId && session.cohort.role === 'worker')
      .map((session) => ({ id: session.id, cwd: session.cwd, status: session.status })),
  { projectId, executionId });
}

/** The common failure wrapper plus the board view and every worktree-local fake log (workers log there). */
async function failure(ctx: JobTeamContext, error: unknown, run?: { projectId: string; executionId: string }): Promise<Error> {
  const extra: string[] = [];
  if (run) extra.push(JSON.stringify(await board(ctx.window, run.projectId, run.executionId).catch((e) => String(e)), null, 1));
  const trees = join(ctx.projectDir, '.worktrees');
  if (existsSync(trees)) {
    for (const name of readdirSync(trees)) {
      const log = join(trees, name, '.fake-coordinator.log');
      if (existsSync(log)) extra.push(`--- ${log}\n${readFileSync(log, 'utf8')}`);
    }
  }
  extra.push(`--- typed.log\n${typedLines(ctx).join('\n')}`);
  const base = jobTeamFailure(ctx, error);
  return new Error(`${base.message}\n${extra.join('\n')}`);
}

const typedLines = (ctx: JobTeamContext) => {
  const file = join(dirname(ctx.agent.path), 'typed.log');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
};
const nudges = (ctx: JobTeamContext) => typedLines(ctx).filter((line) => line.includes('Continue with your current assignment'));

async function start(
  ctx: JobTeamContext,
  options: { teamExtra?: Record<string, unknown> } = {}
): Promise<{ projectId: string; executionId: string }> {
  const projectId = await launchJobTeamCliOwner(ctx, { workerQuantity: 1, ...(options.teamExtra ? { teamExtra: options.teamExtra } : {}) });
  return { projectId, executionId: await findJobExecutionId(ctx.window, projectId, JOB_TITLE) };
}

test('a nudge resumes the engineer without reclaiming its claim', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'zcc-api-error-nudge-', scenario: 'api-error-nudge' });
  try {
    const { projectId, executionId } = await start(ctx);
    await expect.poll(async () => (await board(ctx.window, projectId, executionId)).state, { timeout: 90_000, intervals: [500] }).toBe('COMPLETED');
    const view = await board(ctx.window, projectId, executionId);
    expect(view.blocker).toBeNull();
    expect(view.summaries.filter((summary) => summary.includes('Reclaimed'))).toEqual([]);
    expect(view.summaries.some((summary) => summary.includes('Nudged engineer'))).toBe(true);
    const nudged = view.summaries.findIndex((summary) => summary.includes('Nudged engineer'));
    const resumed = view.summaries.findIndex((summary) => summary.includes('resumed work unit'));
    expect(resumed, 'the nudged turn is recorded as resumed, after the nudge').toBeGreaterThan(nudged);
    expect(view.claimGeneration).toBe(1);
    expect(nudges(ctx)).toHaveLength(1);
  } catch (error) {
    throw jobTeamFailure(ctx, error);
  } finally {
    await teardownJobTeam(ctx);
  }
});

test('a restart re-delivers the unit to the same session, back in the Squad worktree', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'zcc-api-error-restart-', scenario: 'api-error-restart' });
  let run: { projectId: string; executionId: string } | undefined;
  try {
    // Squad worktree isolation needs a real repository with a commit.
    const git = (...args: string[]) => execFileSync('git', args, { cwd: ctx.projectDir });
    writeFileSync(join(ctx.projectDir, 'README.md'), 'API error fixture\n');
    git('init', '-b', 'main');
    git('add', 'README.md');
    git('-c', 'user.name=API Error E2E', '-c', 'user.email=api-error@example.test', 'commit', '-m', 'Fixture setup');

    const { projectId, executionId } = run = await start(ctx, { teamExtra: { worktreeIsolation: true } });
    let before = '';
    await expect.poll(async () => {
      const view = await board(ctx.window, projectId, executionId);
      if (!view.summaries.some((summary) => summary.includes('stopped on a temporary API error'))) return '';
      before = (await workerSessions(ctx.window, projectId, executionId))[0]?.id ?? '';
      return before;
    }, { timeout: 60_000, intervals: [250] }).not.toBe('');

    // The worker sessions disappear once the run completes, so sample them all the way through.
    const observed = new Map<string, string>();
    await expect.poll(async () => {
      for (const session of await workerSessions(ctx.window, projectId, executionId)) observed.set(session.id, session.cwd);
      return (await board(ctx.window, projectId, executionId)).state;
    }, { timeout: 120_000, intervals: [200] }).toBe('COMPLETED');
    const view = await board(ctx.window, projectId, executionId);
    expect(view.blocker).toBeNull();
    const restarted = view.summaries.findIndex((summary) => summary.includes('Restarted engineer'));
    expect(restarted).toBeGreaterThanOrEqual(0);
    // The restarted session's first turn must be counted, else the restart-turn timer would block a working unit.
    expect(view.summaries.findIndex((summary) => summary.includes('resumed work unit'))).toBeGreaterThan(restarted);
    expect(nudges(ctx).length).toBeGreaterThanOrEqual(1);

    expect([...observed.keys()], 'the restart keeps the worker session id').toEqual([before]);
    expect(view.worktreePath, 'the execution retains its Squad worktree').toBeTruthy();
    const worktree = realpathSync(view.worktreePath!);
    expect(worktree).not.toBe(realpathSync(ctx.projectDir));
    expect(realpathSync(observed.get(before)!)).toBe(worktree);

    // The restarted process must attest as the same worker session, not as the session that started tmux.
    const bootSids = [...readFileSync(join(worktree, '.fake-coordinator.log'), 'utf8').matchAll(/WORK:\d+ boot .*resumed=(true|false) sid=(\S+)/g)];
    expect(bootSids.map((match) => match[1])).toEqual(['false', 'true']);
    expect(bootSids.map((match) => match[2])).toEqual([before, before]);
  } catch (error) {
    throw await failure(ctx, error, run);
  } finally {
    await teardownJobTeam(ctx);
  }
});

test('a permanent API error blocks the unit for the user without a nudge', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'zcc-api-error-permanent-', scenario: 'api-error-permanent' });
  try {
    const { projectId, executionId } = await start(ctx);
    await expect.poll(async () => (await board(ctx.window, projectId, executionId)).unitState, { timeout: 60_000, intervals: [500] }).toBe('BLOCKED');
    const view = await board(ctx.window, projectId, executionId);
    expect(view.blocker?.id).toMatch(/^no-progress:/);
    expect(view.blocker?.question).toContain('authentication_failed');
    expect(view.summaries.some((summary) => summary.includes('does not retry'))).toBe(true);
    expect(nudges(ctx)).toEqual([]);
  } catch (error) {
    throw jobTeamFailure(ctx, error);
  } finally {
    await teardownJobTeam(ctx);
  }
});
