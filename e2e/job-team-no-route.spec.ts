/**
 * Runtime escalation for a step no worker can ever take, at the real Electron boundary. The plan's last step may not run on
 * the workers that ran its two parents, and the Squad has exactly two workers. The engine must (1) park the
 * step behind a coordinator-audience blocker and wake the coordinator, (2) escalate to a human Inbox blocker
 * once the coordinator is gone, and (3) on a human reply end the step as NO_QUALIFIED_ROUTE without ever
 * claiming it on a non-matching worker. Fixtures only (fake CLI over the loopback MCP, isolated E2E home).
 */
import { test, expect } from './fixtures/app.js';
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
