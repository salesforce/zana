import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import type { IpcCtx } from '../ctx.js';
import { bindIpcCtx } from '../ctx.js';
import { registerExecutionBoardIpc } from '../execution-board.js';

// execution-board.ts transitively imports apps/server's projects `store`,
// which computes its on-disk data dir via electron's `app.getPath('home')`
// at module load — real only inside a running Electron process. Stub just
// enough of `electron` for that import chain to load under plain vitest; the
// respond/resume paths under test never touch `store`/`dialog` directly.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/zcc-execution-board-sentinel-test-home' },
  dialog: { showMessageBox: vi.fn(), showOpenDialog: vi.fn() }
}));

/**
 * `expectedStateVersion === -1` is a deliberate "use the execution's current
 * stateVersion" sentinel (see apps/app/src/lib/inboxBlockerRespond.ts, which
 * doesn't track a live stateVersion). Left unconstrained, ANY caller could
 * pass -1 to skip optimistic concurrency on respond/resume. This test locks
 * in that -1 is now rejected unless the caller also passes an explicit
 * trailing `allowLatestVersion: true`.
 */
describe('execution-board respond/resume: expectedStateVersion -1 sentinel', () => {
  type Handler = (win: BrowserWindow, ...args: unknown[]) => unknown;

  let handlers: Map<string, Handler>;
  let record: {
    id: string; projectId: string; teamId: string; jobTitle: string; state: string; attempt: number;
    stateVersion: number; createdAt: number; updatedAt: number; request: Record<string, unknown>;
    workUnits: unknown[]; blockers: Array<{ id: string; resolved?: boolean; slotId?: string }>;
    deliveries: unknown[]; callerPrincipalId: string;
  };
  let respondToBlocker: ReturnType<typeof vi.fn>;
  let resumeBlocker: ReturnType<typeof vi.fn>;
  const win = { id: 1 } as BrowserWindow;

  beforeEach(() => {
    handlers = new Map();
    record = {
      id: 'eid', projectId: 'pid', teamId: 'team-1', jobTitle: 'Test job', state: 'RUNNING', attempt: 1,
      stateVersion: 7, createdAt: 0, updatedAt: 0, request: {}, workUnits: [],
      blockers: [{ id: 'blocker-1', slotId: 'slot-1' }], deliveries: [], callerPrincipalId: 'caller-1'
    };
    // executionMessageControl's success path re-projects the FULL returned
    // record via executionBoardProjection (not just the version), so the fake
    // service response must be a complete-enough ExecutionRecord — echo the
    // resolved expectedStateVersion onto an otherwise-fixed record shape.
    respondToBlocker = vi.fn(async (_owner: string, _pid: string, _eid: string, expectedStateVersion: number) => ({
      ok: true,
      value: { ...record, stateVersion: expectedStateVersion }
    }));
    resumeBlocker = vi.fn(async (_owner: string, _pid: string, _eid: string, expectedStateVersion: number) => ({
      ok: true,
      value: { ...record, stateVersion: expectedStateVersion }
    }));

    const safeHandleFromWindow: IpcCtx['safeHandleFromWindow'] = ((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }) as IpcCtx['safeHandleFromWindow'];

    bindIpcCtx({
      safeHandle: vi.fn() as unknown as IpcCtx['safeHandle'],
      safeHandleFromWindow,
      ptys: { list: () => [] },
      teams: { list: () => [] },
      personas: { list: () => [] },
      windows: { get: () => undefined },
      executionStore: { getInProject: async () => record },
      executionResumeTokens: {},
      executionSources: {},
      squadExecutionService: { respondToBlocker, resumeBlocker },
      startTeamJobFromUi: vi.fn(),
      getTeamLaunch: vi.fn(),
      createTerminalConfined: vi.fn()
    } as unknown as IpcCtx);

    registerExecutionBoardIpc();
  });

  it('rejects -1 with no trailing flag as INVALID, without touching squadExecutionService', async () => {
    const respond = handlers.get(IPC.executionBoard.respond)!;
    const result = await respond(win, 'pid', 'eid', -1, 'blocker-1', 'req-1', 'hello') as { ok: boolean; code?: string };
    expect(result).toEqual({ ok: false, code: 'INVALID', message: 'expectedStateVersion -1 requires allowLatestVersion' });
    expect(respondToBlocker).not.toHaveBeenCalled();
  });

  it('rejects -1 with allowLatestVersion: false as INVALID', async () => {
    const respond = handlers.get(IPC.executionBoard.respond)!;
    const result = await respond(win, 'pid', 'eid', -1, 'blocker-1', 'req-1', 'hello', false) as { ok: boolean; code?: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INVALID');
    expect(respondToBlocker).not.toHaveBeenCalled();
  });

  it('honors -1 -> record.stateVersion only when allowLatestVersion is explicitly true (respond)', async () => {
    const respond = handlers.get(IPC.executionBoard.respond)!;
    const result = await respond(win, 'pid', 'eid', -1, 'blocker-1', 'req-1', 'hello', true) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(respondToBlocker).toHaveBeenCalledTimes(1);
    // The resolved -1 -> 7 (record.stateVersion), never the raw -1, reaches the service.
    expect(respondToBlocker.mock.calls[0]?.[3]).toBe(7);
  });

  it('honors -1 -> record.stateVersion only when allowLatestVersion is explicitly true (resume)', async () => {
    const resume = handlers.get(IPC.executionBoard.resume)!;
    const result = await resume(win, 'pid', 'eid', -1, 'blocker-1', 'req-1', 'hello', true) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(resumeBlocker).toHaveBeenCalledTimes(1);
    expect(resumeBlocker.mock.calls[0]?.[3]).toBe(7);
  });

  it('a real (non -1) expectedStateVersion is unaffected by the flag', async () => {
    const respond = handlers.get(IPC.executionBoard.respond)!;
    const result = await respond(win, 'pid', 'eid', 3, 'blocker-1', 'req-1', 'hello') as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(respondToBlocker.mock.calls[0]?.[3]).toBe(3);
  });

  it('still supports the legacy 2-arg (slotId, message) compat shape alongside the trailing flag', async () => {
    const respond = handlers.get(IPC.executionBoard.respond)!;
    const result = await respond(win, 'pid', 'eid', -1, 'slot-1', 'hello', true) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(respondToBlocker.mock.calls[0]?.[3]).toBe(7);
    expect(respondToBlocker.mock.calls[0]?.[4]).toBe('blocker-1');
  });
});
