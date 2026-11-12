/**
 * Blocked-wait verification: an open human blocker pauses the idle deadline, and a
 * bounded blocked wait (policy.blockedWaitMs) applies instead.
 *
 *  - The fake coordinator starts the run with a SHORT idle deadline (IDLE_MS).
 *  - A real worker raises the real `navigation-label` blocker; the test lets it stay
 *    open for several multiples of IDLE_MS and asserts the run stays non-terminal (BLOCKED), has no
 *    timeoutReason, and the worker terminal sessions are still alive.
 *  - Answering through the board lets the run complete (also after an app restart).
 *  - Bounded negative: with policy.blockedWaitMs = 60s (the config clamp floor) the run
 *    STOPS with 'unresolved-blocker' only after that bound, preceded by an Inbox warning.
 *    `execution.start` cannot carry blockedWaitMs (strict schema; the config value is
 *    only applied on the squad_launch path), so this case seeds it in the closed JSON
 *    ledger and lets restore() re-arm the watchdog from the persisted record.
 *
 * Note: CLI-owner workers are PTY sessions; the idle-provider reap sweep only exists for
 * MODERN threads, so (b) here proves the sessions are not closed/exited, not the sweep hold.
 */
import { expect, launchApp, test, type AppHandle } from './fixtures/app.js';
import {
  createJobTeamContext, findJobExecutionId, jobTeamFailure, launchJobTeamCliOwner, teardownJobTeam,
  type JobTeamContext
} from './sdk/job-team-scenario.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

const IDLE_MS = 15_000;
const JOB_TITLE = 'CLI Agent durable job';

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true, sponsorPromptDismissed: true },
  launchEnv: { ZCC_EXECUTION_STORE: 'json' }
});
test.setTimeout(240_000);

interface Seen { state: string; timeoutReason: string | null; blockerId: string; stateVersion: number }

async function seen(window: Page, projectId: string, executionId: string): Promise<Seen> {
  return window.evaluate(async ({ projectId, executionId }) => {
    const snap = await window.cc.executionBoard.snapshot(projectId, executionId, 0);
    const exec = snap?.execution as unknown as {
      state: string; timeoutReason?: string; stateVersion: number; currentBlocker?: { id: string } | null;
    } | undefined;
    return {
      state: exec?.state ?? 'missing', timeoutReason: exec?.timeoutReason ?? null,
      blockerId: exec?.currentBlocker?.id ?? '', stateVersion: exec?.stateVersion ?? 0
    };
  }, { projectId, executionId });
}

async function waitBlocker(window: Page, projectId: string, executionId: string): Promise<Seen> {
  await expect.poll(async () => (await seen(window, projectId, executionId)).blockerId,
    { timeout: 60_000, intervals: [500] }).not.toBe('');
  return seen(window, projectId, executionId);
}

async function liveWorkerSessions(window: Page, projectId: string): Promise<number> {
  return window.evaluate(async (id) => (await window.cc.terminals.list(id))
    .filter((s) => s.status !== 'exited' && !s.title.includes('E2E start Job Team')).length, projectId);
}

async function answer(window: Page, projectId: string, executionId: string, blockerId: string) {
  const result = await window.evaluate(async (args) => {
    const snap = await window.cc.executionBoard.snapshot(args.projectId, args.executionId, 0);
    return window.cc.executionBoard.respond(args.projectId, args.executionId, snap?.execution.stateVersion ?? 0,
      args.blockerId, `${args.blockerId}:${crypto.randomUUID()}`, 'About Atlas');
  }, { projectId, executionId, blockerId });
  expect(result?.ok, JSON.stringify(result)).toBe(true);
}

/** Holds the blocker open past several idle deadlines, asserting it never stops. */
async function holdOpen(window: Page, projectId: string, executionId: string, blockerId: string, forMs: number) {
  const until = Date.now() + forMs;
  while (Date.now() < until) {
    const now = await seen(window, projectId, executionId);
    expect(now.state, JSON.stringify(now)).toBe('BLOCKED');
    expect(now.timeoutReason).toBeNull();
    expect(now.blockerId).toBe(blockerId);
    await window.waitForTimeout(2_000);
  }
}

async function start(app: AppHandle): Promise<{ ctx: JobTeamContext; projectId: string; executionId: string }> {
  const ctx = createJobTeamContext(app, { tmpPrefix: 'zana-blocked-wait-', scenario: 'success', deadlineMs: IDLE_MS });
  const projectId = await launchJobTeamCliOwner(ctx, { workerQuantity: 2 });
  const executionId = await findJobExecutionId(ctx.window, projectId, JOB_TITLE);
  return { ctx, projectId, executionId };
}

test('open blocker beyond the idle timeout keeps the run and workers alive, then completes after the answer', async ({ app }) => {
  const { ctx, projectId, executionId } = await start(app);
  const { window } = ctx;
  try {
    const blocker = await waitBlocker(window, projectId, executionId);
    expect(blocker.state).toBe('BLOCKED');
    const workersBefore = await liveWorkerSessions(window, projectId);
    expect(workersBefore).toBeGreaterThan(0);

    await holdOpen(window, projectId, executionId, blocker.blockerId, IDLE_MS * 3);
    // (b) worker sessions not closed/exited while the blocker is open.
    expect(await liveWorkerSessions(window, projectId)).toBe(workersBefore);

    await answer(window, projectId, executionId, blocker.blockerId);
    await expect.poll(async () => (await seen(window, projectId, executionId)).state,
      { timeout: 90_000, intervals: [1_000] }).toBe('COMPLETED');
    await expect.poll(() => existsSync(join(ctx.projectDir, 'result.txt')), { timeout: 15_000 }).toBe(true);
    expect(readFileSync(join(ctx.projectDir, 'result.txt'), 'utf8')).toContain('LABEL: About Atlas');
  } catch (error) {
    throw jobTeamFailure(ctx, error);
  } finally {
    await teardownJobTeam(ctx);
  }
});

test('restored-after-restart: blocker stays open past the idle timeout, answer continues the run', async ({ app, home }) => {
  const { ctx, projectId, executionId } = await start(app);
  let relaunched: AppHandle | null = null;
  try {
    const blocker = await waitBlocker(ctx.window, projectId, executionId);
    await app.electron.close();
    relaunched = await launchApp(home, { e2e: true, env: { ZCC_EXECUTION_STORE: 'json' } });
    const { window } = relaunched;
    const after = await waitBlocker(window, projectId, executionId);
    expect(after.blockerId).toBe(blocker.blockerId);

    await holdOpen(window, projectId, executionId, blocker.blockerId, IDLE_MS * 3);
    await answer(window, projectId, executionId, blocker.blockerId);
    // Workers died with the old app; the answer must at minimum resolve the blocker and keep
    // the run alive (non-STOPPED), never time it out.
    await expect.poll(async () => {
      const now = await seen(window, projectId, executionId);
      expect(now.state).not.toBe('STOPPED');
      expect(now.timeoutReason).toBeNull();
      return now.blockerId === '' || now.state === 'COMPLETED';
    }, { timeout: 60_000, intervals: [1_000] }).toBe(true);
    const final = await seen(window, projectId, executionId);
    test.info().annotations.push({ type: 'restart-final-state', description: final.state });
  } catch (error) {
    throw jobTeamFailure(ctx, error);
  } finally {
    await relaunched?.electron.close().catch(() => undefined);
    ctx.agent.cleanup();
  }
});

test('bounded negative: run stops with unresolved-blocker only after blockedWaitMs, after an Inbox warning', async ({ app, home }) => {
  const { ctx, projectId, executionId } = await start(app);
  let relaunched: AppHandle | null = null;
  try {
    await waitBlocker(ctx.window, projectId, executionId);
    await app.electron.close();
    const filePath = join(app.home, 'electron-user-data', 'squad-executions.json');
    const file = JSON.parse(readFileSync(filePath, 'utf8')) as { records: Array<Record<string, any>> };
    const record = file.records.find((candidate) => candidate.id === executionId)!;
    record.request.policy = { ...(record.request.policy ?? {}), blockedWaitMs: 60_000 };
    const open = (record.blockers as Array<Record<string, any>>).filter((b) => !b.resolved && b.audience !== 'coordinator');
    expect(open.length).toBeGreaterThan(0);
    // Re-anchor the wait at "now" so the whole 60s bound is measured after relaunch.
    const anchor = Date.now();
    for (const b of open) b.createdAt = anchor;
    record.stateVersion = Number(record.stateVersion ?? 0) + 1;
    writeFileSync(filePath, JSON.stringify(file));

    relaunched = await launchApp(home, { e2e: true, env: { ZCC_EXECUTION_STORE: 'json' } });
    const { window } = relaunched;
    // Well inside the bound (and past the idle deadline): still running.
    await window.waitForTimeout(IDLE_MS + 5_000);
    const early = await seen(window, projectId, executionId);
    expect(early.state, JSON.stringify(early)).toBe('BLOCKED');
    expect(early.timeoutReason).toBeNull();

    await expect.poll(async () => (await seen(window, projectId, executionId)).state,
      { timeout: 90_000, intervals: [1_000] }).toBe('STOPPED');
    const stoppedAt = Date.now();
    const final = await seen(window, projectId, executionId);
    expect(final.timeoutReason).toBe('unresolved-blocker');
    expect(stoppedAt - anchor).toBeGreaterThanOrEqual(55_000);

    const inbox = JSON.stringify(await window.evaluate(() => window.cc.inbox.history({ limit: 100 })));
    expect(inbox).toContain('will be stopped in about');
  } catch (error) {
    throw jobTeamFailure(ctx, error);
  } finally {
    await relaunched?.electron.close().catch(() => undefined);
    ctx.agent.cleanup();
  }
});
