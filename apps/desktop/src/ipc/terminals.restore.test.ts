import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: any[]) => any>();
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() }, app: { getPath: () => '/tmp' } }));
vi.mock('./shared-product-registration.js', () => ({
  productHandle: (channel: string, handler: (...args: any[]) => any) => { handlers.set(channel, handler); },
  safeProductHandle: (channel: string, handler: (...args: any[]) => any) => { handlers.set(channel, handler); }
}));
const projects: any[] = [];
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: () => projects } }));
vi.mock('@zana-ai/zcc-host-daemon/tmux', () => ({ listLocalTmuxSessionIds: vi.fn(), verifyTmux: vi.fn() }));
vi.mock('@zana-ai/zcc-host-daemon/remembered-sessions', () => ({ listRememberedTombstones: vi.fn() }));
vi.mock('@zana-ai/zcc-host-daemon/harness/cli-plan-watch', () => ({ CliPlanWatcher: class { onSessionExit() {} } }));

import { IPC } from '@zana-ai/zcc-desktop-contract';
import { bindIpcCtx } from './ctx.js';
import { registerTerminalsIpc } from './terminals.js';
import { squadWorktreeHasActiveFollowUp, restoreSquadWorktreeFollowUp, releaseSquadWorktreeFollowUp } from '../squad-worktree-lifecycle.js';

const capability = {
  id: 'cap-1',
  request: { projectId: 'p1', profile: 'claude', cols: 80, rows: 24 },
  sessionId: 'sess-h',
  remoteTmuxId: 'cc-sess-h',
  followUpExecutionId: 'exec-h',
  createdAt: 1
};

function bind(launch: ReturnType<typeof vi.fn>) {
  const restoreCapabilities = {
    reserve: vi.fn(() => ({ capability, reservationId: 'res' })),
    consume: vi.fn(),
    release: vi.fn(),
    findExitedSession: vi.fn()
  };
  bindIpcCtx({
    ptys: { on: vi.fn() },
    safeSend: vi.fn(),
    restoreCapabilities,
    restoreSquadWorktreeFollowUpClaim: async (c: typeof capability) => restoreSquadWorktreeFollowUp(c.followUpExecutionId, c.sessionId),
    resolveWorktreeForRequest: async (r: unknown) => ({ ok: true, value: r }),
    restorePrincipal: () => ({ kind: 'interactive-user', id: 'restore:cap-1' }),
    isTeamWorkerRestore: () => false,
    launchAuthorizedTerminal: launch
  } as never);
  registerTerminalsIpc();
  return restoreCapabilities;
}

describe('terminals restore / reconnect handlers', () => {
  beforeEach(() => {
    handlers.clear();
    releaseSquadWorktreeFollowUp('exec-h', 'sess-h');
    projects.length = 0;
  });

  it('restore: failed follow-up launch releases the claim, retry succeeds', async () => {
    const launch = vi.fn()
      .mockResolvedValueOnce({ ok: false, code: 'SPAWN', message: 'nope' })
      .mockResolvedValueOnce({ ok: true, value: { id: 'sess-h' } });
    const caps = bind(launch);
    const restore = handlers.get(IPC.terminals.restore)!;
    expect((await restore({ capabilityId: 'cap-1' })).ok).toBe(false);
    expect(squadWorktreeHasActiveFollowUp('exec-h')).toBe(false);
    expect(caps.release).toHaveBeenCalledWith('cap-1', 'res');
    expect((await restore({ capabilityId: 'cap-1' })).ok).toBe(true);
    expect(caps.consume).toHaveBeenCalledWith('cap-1', 'res');
    expect(launch).toHaveBeenLastCalledWith(
      capability.request,
      { kind: 'interactive-user', id: 'restore:cap-1' },
      { preallocatedSessionId: 'sess-h', retainWorktree: true },
      undefined, undefined, undefined, undefined, undefined, false, undefined, 'exec-h'
    );
  });

  it('restore: thrown launch releases the claim and rethrows', async () => {
    bind(vi.fn().mockRejectedValue(new Error('crash')));
    await expect(handlers.get(IPC.terminals.restore)!({ capabilityId: 'cap-1' })).rejects.toThrow('crash');
    expect(squadWorktreeHasActiveFollowUp('exec-h')).toBe(false);
  });

  it('restore: unknown capability and missing legacy request are denied', async () => {
    const caps = bind(vi.fn());
    caps.reserve.mockReturnValue(undefined as never);
    const restore = handlers.get(IPC.terminals.restore)!;
    expect((await restore({ capabilityId: 'gone' })).code).toBe('DENIED');
    expect((await restore({})).code).toBe('DENIED');
  });

  it('reconnect: failed launch releases claim and reservation; retry succeeds', async () => {
    projects.push({ id: 'p1', remote: true });
    const launch = vi.fn()
      .mockResolvedValueOnce({ ok: false, code: 'SPAWN', message: 'nope' })
      .mockResolvedValueOnce({ ok: true, value: { id: 'sess-h' } });
    const caps = bind(launch);
    const reconnect = handlers.get(IPC.terminals.reconnectRemote)!;
    expect((await reconnect({ capabilityId: 'cap-1' })).ok).toBe(false);
    expect(squadWorktreeHasActiveFollowUp('exec-h')).toBe(false);
    expect(caps.release).toHaveBeenCalledWith('cap-1', 'res');
    expect((await reconnect({ capabilityId: 'cap-1' })).ok).toBe(true);
    expect(launch.mock.calls[1][2]).toEqual({ reconnectTmuxId: 'cc-sess-h', resume: true, retainWorktree: true });
  });

  it('reconnect: refuses non-remote project before claiming', async () => {
    projects.push({ id: 'p1', remote: false });
    const launch = vi.fn();
    bind(launch);
    const result = await handlers.get(IPC.terminals.reconnectRemote)!({ capabilityId: 'cap-1' });
    expect(result.code).toBe('NOT_FOUND');
    expect(launch).not.toHaveBeenCalled();
    expect(squadWorktreeHasActiveFollowUp('exec-h')).toBe(false);
  });
});
