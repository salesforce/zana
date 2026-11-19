/**
 * Runtime escalation for a step no worker can ever take, at the real Electron boundary. The plan's last step may not run on
 * the workers that ran its two parents, and the Squad has exactly two workers. The engine must (1) park the
 * step behind a coordinator-audience blocker and wake the coordinator, (2) escalate to a human Inbox blocker
 * once the coordinator is gone, and (3) on a human reply end the step as NO_QUALIFIED_ROUTE without ever
 * claiming it on a non-matching worker. Fixtures only (fake CLI over the loopback MCP, isolated E2E home).
 */
import { test, expect } from './fixtures/app.js';
import type { Page } from '@playwright/test';
import {
  createJobTeamContext,
  launchJobTeamCliOwner,
  findJobExecutionId,
  readCoordinatorLog,
  jobTeamFailure,
  teardownJobTeam
} from './sdk/job-team-scenario.js';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true },
  launchEnv: { ZCC_EXECUTION_RECONCILE_INTERVAL_MS: '750' }
});
test.setTimeout(150_000);

test('a step no slot can satisfy blocks the coordinator, then a human; a reply fails it NO_QUALIFIED_ROUTE unrun', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'zcc-cli-no-route-', scenario: 'no-route' });
  const { window } = ctx;

  try {
    const projectId = await launchJobTeamCliOwner(ctx, { workerQuantity: 2 });
    const executionId = await findJobExecutionId(window, projectId, 'CLI Agent no-route job');

    // 1. Coordinator hop: the engine woke the coordinator about the blocked step.
    await expect.poll(() => readCoordinatorLog(ctx), { timeout: 60_000, intervals: [500] }).toContain('no-route wake received');

    // 2. Human hop: an Inbox entry bound to the engine's no-route blocker.
    let blockerId = '';
    await expect.poll(async () => {
      blockerId = await window.evaluate(async (id) => {
        const page = await window.cc.inbox.history({ limit: 200 });
        const entry = (page?.entries ?? []).find((candidate: { executionId?: string; blockerId?: string }) =>
          candidate.executionId === id && typeof candidate.blockerId === 'string' && candidate.blockerId.startsWith('no-route:'));
        return entry?.blockerId ?? '';
      }, executionId);
      return blockerId;
    }, { timeout: 60_000, intervals: [500] }).not.toBe('');

    const before = await window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return snap?.execution.work?.assignments.map(({ workUnitId, state }) => ({ workUnitId, state }));
    }, { projectId, executionId });
    expect(before).toEqual([{ workUnitId: 'a', state: 'COMPLETED' }, { workUnitId: 'c', state: 'COMPLETED' }, { workUnitId: 'review-step', state: 'BLOCKED' }]);

    // 3. A human reply is guidance only: the step fails NO_QUALIFIED_ROUTE and never runs.
    const answered = await window.evaluate(async (args) => {
      const snap = await window.cc.executionBoard.snapshot(args.projectId, args.executionId, 0);
      return window.cc.executionBoard.respond(args.projectId, args.executionId, snap?.execution.stateVersion ?? 0,
        args.blockerId, `${args.blockerId}:${crypto.randomUUID()}`, 'Skip it, nobody here can review');
    }, { projectId, executionId, blockerId });
    expect(answered?.ok, JSON.stringify(answered)).toBe(true);

    await expect.poll(async () => window.evaluate(async ({ projectId, executionId }) => {
      const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
      return snap?.execution.work?.assignments.map(({ workUnitId, state, failureCode }) => failureCode ? { workUnitId, state, failureCode } : { workUnitId, state });
    }, { projectId, executionId }), { timeout: 30_000, intervals: [500] })
      .toEqual([{ workUnitId: 'a', state: 'COMPLETED' }, { workUnitId: 'c', state: 'COMPLETED' }, { workUnitId: 'review-step', state: 'FAILED', failureCode: 'NO_QUALIFIED_ROUTE' }]);

  } catch (error) {
    throw jobTeamFailure(ctx, error);
  } finally {
    await teardownJobTeam(ctx);
  }
});

async function noRouteBlocker(window: Page, executionId: string): Promise<{ blockerId: string; subject: string }> {
  let found = { blockerId: '', subject: '' };
  await expect.poll(async () => {
    found = await window.evaluate(async (id) => {
      const page = await window.cc.inbox.history({ limit: 200 });
      const entry = (page?.entries ?? []).find((candidate: { executionId?: string; blockerId?: string }) =>
        candidate.executionId === id && typeof candidate.blockerId === 'string' && candidate.blockerId.startsWith('no-route:'));
      return { blockerId: entry?.blockerId ?? '', subject: entry?.subject ?? '' };
    }, executionId);
    return found.blockerId;
  }, { timeout: 60_000, intervals: [500] }).not.toBe('');
  return found;
}

const snapshotOf = (window: Page, projectId: string, executionId: string) => window.evaluate(async (args) => {
  const snap = await window.cc.executionBoard.snapshot(args.projectId, args.executionId, 0);
  return { state: snap?.execution.state, work: snap?.execution.work?.assignments.map(({ workUnitId, state }) => ({ workUnitId, state })) };
}, { projectId, executionId });

test('Stop and fix the plan on the no-route blocker stops the run, keeps the work, and leaves a plan-fix card', async ({ app }) => {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'zcc-cli-no-route-stop-', scenario: 'no-route' });
  const { window } = ctx;

  try {
    const projectId = await launchJobTeamCliOwner(ctx, { workerQuantity: 2 });
    const executionId = await findJobExecutionId(window, projectId, 'CLI Agent no-route job');
    await expect.poll(() => readCoordinatorLog(ctx), { timeout: 60_000, intervals: [500] }).toContain('no-route wake received');
    const { blockerId, subject } = await noRouteBlocker(window, executionId);

    // Main authorizes: a forged blocker id (ordinary-looking, or merely no-route-prefixed) cannot stop the run.
    for (const forged of ['ordinary-blocker-1', 'no-route:forged', ' ', 'x'.repeat(300)]) {
      const refused = await window.evaluate(async (args) => window.cc.executionBoard.stopAndFixPlan(args.projectId, args.executionId, args.forged),
        { projectId, executionId, forged });
      expect(refused.ok, `forged ${forged.slice(0, 20)}`).toBe(false);
    }
    const untouched = await snapshotOf(window, projectId, executionId);
    expect(untouched.state).not.toBe('STOPPED');
    expect(untouched.work).toEqual([{ workUnitId: 'a', state: 'COMPLETED' }, { workUnitId: 'c', state: 'COMPLETED' }, { workUnitId: 'review-step', state: 'BLOCKED' }]);

    // The Inbox card for the no-route blocker offers the button (only no-route blockers do).
    const ownerModal = window.getByRole('dialog', { name: /^Agent / }).first();
    if (await ownerModal.count()) await ownerModal.getByRole('button', { name: 'Close' }).click();
    await window.getByTestId('nav-inbox').or(window.getByTestId('project-nav-inbox')).click();
    await window.getByRole('button', { name: 'Reload project list' }).click();
    await expect(window.locator('.project-item').filter({ hasText: ctx.projectName }).first()).toBeVisible({ timeout: 15_000 });
    await window.locator('.inbox-row').filter({ hasText: subject }).first().click();
    const detail = window.locator('.inbox-detail');
    // The owner is gone, so the reply box starts collapsed; opening it shows the reply and the stop action.
    await detail.getByRole('button', { name: 'Leave a reply' }).click();
    const stop = detail.getByTestId('inbox-stop-and-fix-plan');
    await expect(stop).toBeVisible({ timeout: 15_000 });
    await expect(stop).toHaveText('Stop and fix the plan');
    await stop.click();

    // The run stops, work already done is kept, and an Inbox card names the step.
    await expect.poll(async () => (await snapshotOf(window, projectId, executionId)).state, { timeout: 30_000, intervals: [500] }).toBe('STOPPED');
    const stopped = await snapshotOf(window, projectId, executionId);
    expect(stopped.work?.filter((unit) => unit.workUnitId !== 'review-step')).toEqual([{ workUnitId: 'a', state: 'COMPLETED' }, { workUnitId: 'c', state: 'COMPLETED' }]);
    await expect.poll(async () => window.evaluate(async (id) => {
      const page = await window.cc.inbox.history({ limit: 200 });
      const card = (page?.entries ?? []).find((candidate: { executionId?: string; subject?: string }) =>
        candidate.executionId === id && candidate.subject === 'Fix the plan, then launch again');
      return card ? String((card as { comments?: string }).comments ?? '') : '';
    }, executionId), { timeout: 30_000, intervals: [500] }).toContain('Step review-step');
    await expect(window.locator('.inbox-row').filter({ hasText: 'Fix the plan, then launch again' }).first()).toBeVisible({ timeout: 15_000 });

    // Asking again (resolved blocker / ended run) is a plain error, not a crash, and does not add a second card.
    const again = await window.evaluate(async (args) => window.cc.executionBoard.stopAndFixPlan(args.projectId, args.executionId, args.blockerId),
      { projectId, executionId, blockerId });
    expect(again.ok).toBe(false);
    expect(JSON.stringify(again)).toMatch(/no longer waiting|already ended/);
    const cards = await window.evaluate(async (id) => ((await window.cc.inbox.history({ limit: 200 }))?.entries ?? [])
      .filter((candidate: { executionId?: string; subject?: string }) => candidate.executionId === id && candidate.subject === 'Fix the plan, then launch again').length, executionId);
    expect(cards).toBe(1);
  } catch (error) {
    throw jobTeamFailure(ctx, error);
  } finally {
    await teardownJobTeam(ctx);
  }
});
