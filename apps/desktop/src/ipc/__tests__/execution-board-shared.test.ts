import { beforeEach, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { SHARED_PRODUCT_METHODS } from '@zana-ai/zcc-contracts/shared-product';
const state = vi.hoisted(() => ({ shared: new Map<string, Function>(), windows: new Map<string, Function>(), projects: [{ id: 'registered', path: '/registered' }] }));
vi.mock('electron', () => ({ dialog: {} }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: () => state.projects } }));
vi.mock('../shared-product-registry.js', () => ({ registerSharedProduct: (channel: string, fn: Function) => { state.shared.set(channel, fn); } }));
import { bindIpcCtx } from '../ctx.js';
import { registerExecutionBoardIpc } from '../execution-board.js';
const get = vi.fn(), stop = vi.fn(), start = vi.fn(), list = vi.fn(), clear = vi.fn(), recoverTimedOut = vi.fn();
const execution = { id: 'execution', projectId: 'registered', teamId: 'team-1', request: {}, jobTitle: 'Job', state: 'RUNNING', attempt: 1, stateVersion: 4, createdAt: 1, updatedAt: 2, workUnits: [] };
beforeEach(() => {
  state.shared.clear(); state.windows.clear(); vi.clearAllMocks();
   get.mockImplementation(async (projectId: string, id: string) => projectId === 'registered' && id === 'execution' ? { id, projectId, callerPrincipalId: 'stored-owner' } : undefined);
   stop.mockResolvedValue({ ok: false, code: 'CONFLICT', message: 'Version changed' });
   recoverTimedOut.mockResolvedValue({ ok: false, code: 'CONFLICT', message: 'Already recovered' });
   start.mockResolvedValue({ ok: true }); list.mockResolvedValue({ records: [], hasMore: false });
   bindIpcCtx({ safeHandle: vi.fn(), safeHandleFromWindow: (channel: string, fn: Function) => state.windows.set(channel, fn), ptys: { list: () => [] }, teams: { list: () => [] }, personas: { list: () => [] }, windows: new Map([[7, { projectId: 'different' }]]), executionStore: { getInProject: get }, executionResumeTokens: { clear }, executionSources: {}, squadExecutionService: { stop, listProject: list, recoverTimedOut }, startTeamJobFromUi: start } as any);
  registerExecutionBoardIpc();
});
it('denies every shared execution operation for an unregistered project before reading execution state', async () => {
  for (const [method, channel] of SHARED_PRODUCT_METHODS) {
    if (!method.startsWith('executionBoard.')) continue;
    await state.shared.get(channel)!('foreign-project', 'execution', 1, 'work', 'slot');
  }
  expect(await state.shared.get(IPC.teams.startJob)!({ projectId: 'foreign-project' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  expect(get).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
});
  it('uses the execution store owner and project binding for a shared control', async () => {
  expect(await state.shared.get(IPC.executionBoard.stop)!('registered', 'execution', 3)).toMatchObject({ code: 'CONFLICT' });
  expect(stop).toHaveBeenCalledExactlyOnceWith('stored-owner', 'registered', 'execution', 3);
  expect(await state.shared.get(IPC.executionBoard.stop)!('registered', 'foreign-execution', 3)).toMatchObject({ code: 'NOT_FOUND' });
  expect(await state.shared.get(IPC.executionBoard.stop)!('registered', 'execution', '3')).toMatchObject({ code: 'INVALID' });
  expect(stop).toHaveBeenCalledOnce();
    expect(await state.shared.get(IPC.executionBoard.listProject)!('registered')).toEqual({ executions: [], hasMore: false });
  });
  it('authorizes local timeout recovery and forwards only validated recovery inputs', async () => {
    const recover = state.windows.get(IPC.executionBoard.recoverTimedOut)!;

    expect(await recover({ id: 8 }, 'registered', 'execution', 3, 'request-1')).toMatchObject({ code: 'CONFLICT' });
    expect(recoverTimedOut).toHaveBeenCalledExactlyOnceWith('interactive:local', 'registered', 'execution', 3, 'request-1');

    expect(await recover({ id: 8 }, 'registered', 'execution', 3, '   ')).toMatchObject({ code: 'INVALID' });
    expect(await recover({ id: 8 }, 'registered', 'execution', 3.5, 'request-2')).toMatchObject({ code: 'INVALID' });
    expect(recoverTimedOut).toHaveBeenCalledOnce();
  });
  it('projects successful timeout recovery and returns unavailable when service throws', async () => {
    const recover = state.windows.get(IPC.executionBoard.recoverTimedOut)!;
    recoverTimedOut.mockResolvedValueOnce({ ok: true, value: execution });

    await expect(recover({ id: 8 }, 'registered', 'execution', 4, 'request-1')).resolves.toMatchObject({
      ok: true, value: { executionId: 'execution', state: 'RUNNING' }
    });
    recoverTimedOut.mockRejectedValueOnce(new Error('offline'));
    await expect(state.shared.get(IPC.executionBoard.recoverTimedOut)!('registered', 'execution', 4, 'request-2')).resolves.toEqual({
      ok: false, code: 'UNAVAILABLE', message: 'timeout recovery unavailable'
    });
  });
it('does not fabricate a native window for shared launches and preserves local window confinement', async () => {
  const input = { projectId: 'registered' };
  await state.shared.get(IPC.teams.startJob)!(input);
  expect(start).toHaveBeenCalledExactlyOnceWith(input, undefined);
  expect(await state.windows.get(IPC.teams.startJob)!({ id: 7 }, input)).toMatchObject({ code: 'NOT_FOUND' });
  expect(start).toHaveBeenCalledOnce();
  await state.windows.get(IPC.teams.startJob)!({ id: 8 }, input);
  expect(start).toHaveBeenLastCalledWith(input, { windowId: 8 });
  expect(SHARED_PRODUCT_METHODS.has('executionBoard.relaunchMonitor')).toBe(false);
  expect(SHARED_PRODUCT_METHODS.has('executionSources.pick')).toBe(false);
});
it('contains a shared service failure without allowing any fallback launch', async () => {
  start.mockRejectedValueOnce(new Error('offline'));
  expect(await state.shared.get(IPC.teams.startJob)!({ projectId: 'registered' })).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(start).toHaveBeenCalledOnce();
});
