import { beforeEach, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { SHARED_PRODUCT_METHODS } from '@zana-ai/zcc-contracts/shared-product';
const state = vi.hoisted(() => ({ shared: new Map<string, Function>(), windows: new Map<string, Function>(), projects: [{ id: 'registered', path: '/registered' }], teams: [] as Array<{ id: string; name: string }>, lifecycle: [] as unknown[], lifecycleFail: false, lifecycleFailRaw: undefined as unknown }));
vi.mock('electron', () => ({ dialog: {} }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: () => state.projects } }));
vi.mock('../shared-product-registry.js', () => ({ registerSharedProduct: (channel: string, fn: Function) => { state.shared.set(channel, fn); } }));
import { bindIpcCtx } from '../ctx.js';
import { registerExecutionBoardIpc } from '../execution-board.js';
const get = vi.fn(), stop = vi.fn(), start = vi.fn(), list = vi.fn(), clear = vi.fn(), recoverTimedOut = vi.fn(), recoverRetained = vi.fn(), exactNativeRecoveryAvailability = vi.fn(), squadWorktreeAction = vi.fn();
const execution = { id: 'execution', projectId: 'registered', teamId: 'team-1', request: {}, jobTitle: 'Job', state: 'RUNNING', attempt: 1, stateVersion: 4, createdAt: 1, updatedAt: 2, workUnits: [] };
beforeEach(() => {
  state.shared.clear(); state.windows.clear(); state.teams = []; state.lifecycle = []; state.lifecycleFail = false; state.lifecycleFailRaw = undefined; vi.clearAllMocks();
   get.mockImplementation(async (projectId: string, id: string) => projectId === 'registered' && id === 'execution' ? { id, projectId, callerPrincipalId: 'stored-owner' } : undefined);
   stop.mockResolvedValue({ ok: false, code: 'CONFLICT', message: 'Version changed' });
   recoverTimedOut.mockResolvedValue({ ok: false, code: 'CONFLICT', message: 'Already recovered' }); recoverRetained.mockResolvedValue({ ok: false, code: 'CONFLICT', message: 'Already recovered' });
   start.mockResolvedValue({ ok: true }); list.mockResolvedValue({ records: [], hasMore: false }); exactNativeRecoveryAvailability.mockReturnValue({ available: false, restorableSlots: 0 });
     bindIpcCtx({ safeHandle: vi.fn(), safeHandleFromWindow: (channel: string, fn: Function) => state.windows.set(channel, fn), ptys: { list: () => [] }, teams: { list: () => state.teams }, teamLifecycle: { list: async () => { if (state.lifecycleFailRaw !== undefined) throw state.lifecycleFailRaw; if (state.lifecycleFail) throw new Error('corrupt lifecycle store'); return state.lifecycle; } }, personas: { list: () => [] }, windows: new Map([[7, { projectId: 'different' }]]), executionStore: { getInProject: get }, executionResumeTokens: { clear, status: () => ({ state: 'missing' }) }, executionSources: {}, squadExecutionService: { stop, listProject: list, recoverTimedOut, recoverRetained }, startTeamJobFromUi: start, exactNativeRecoveryAvailability, squadWorktreeAction } as any);
  registerExecutionBoardIpc();
   });
  it('authorizes typed retained recovery and forwards only valid recovery inputs', async () => {
    const recover = state.windows.get(IPC.executionBoard.recoverRetained)!;
    await expect(recover({ id: 8 }, 'registered', 'execution', 3, 'exact-native')).resolves.toMatchObject({ code: 'CONFLICT' });
    expect(recoverRetained).toHaveBeenCalledWith('interactive:local', 'registered', 'execution', 3, 'exact-native');
    await expect(recover({ id: 8 }, 'registered', 'execution', 3, 'invalid')).resolves.toMatchObject({ code: 'INVALID' });
    await expect(recover({ id: 8 }, 'registered', 'execution', 3.5, 'fresh-plan')).resolves.toMatchObject({ code: 'INVALID' });
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
  it('logs a non-Error lifecycle failure as a string and still lists executions', async () => {
    state.lifecycleFailRaw = 'lifecycle store offline';
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    list.mockResolvedValueOnce({ records: [{ ...execution, id: 'execution', projectId: 'registered', callerPrincipalId: 'stored-owner' }], hasMore: false });
    const result = await state.shared.get(IPC.executionBoard.listProject)!('registered') as { executions: unknown[] };
    expect(result.executions).toHaveLength(1);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('lifecycle store offline'));
    errorLog.mockRestore();
  });
  it('still lists executions when the team lifecycle store is unreadable', async () => {
    state.lifecycleFail = true;
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    list.mockResolvedValueOnce({ records: [{ ...execution, id: 'execution', projectId: 'registered', callerPrincipalId: 'stored-owner' }], hasMore: false });
    const result = await state.shared.get(IPC.executionBoard.listProject)!('registered') as { executions: Array<{ executionId: string; modernMembers?: unknown }> };
    expect(result.executions).toHaveLength(1);
    expect(result.executions[0]!.modernMembers).toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('corrupt lifecycle store'));
    errorLog.mockRestore();
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
it('preserves resolved requirement guidance from host launch response', async () => {
  start.mockResolvedValueOnce({
    ok: false,
    code: 'REQUIREMENT_UNAVAILABLE',
    message: 'work unit build requirement unavailable: skills: review',
    requirementFailure: { workUnits: [{ id: 'build', title: 'Build UI', missingSkills: ['review'], missingMcpServers: [] }] }
  });

  await expect(state.windows.get(IPC.teams.startJob)!({ id: 8 }, { projectId: 'registered' })).resolves.toEqual({
    ok: false,
    code: 'REQUIREMENT_UNAVAILABLE',
    message: 'work unit build requirement unavailable: skills: review',
    requirementFailure: { workUnits: [{ id: 'build', title: 'Build UI', missingSkills: ['review'], missingMcpServers: [] }] }
  });
});
it('preserves availability-unknown guidance from host launch response', async () => {
  start.mockResolvedValueOnce({
    ok: false,
    code: 'CAPABILITY_AVAILABILITY_UNKNOWN',
    message: 'Project capability availability could not be verified',
    availabilityUnknown: { failedSources: ['skills', 'mcpServers'] }
  });

  await expect(state.windows.get(IPC.teams.startJob)!({ id: 8 }, { projectId: 'registered' })).resolves.toEqual({
    ok: false,
    code: 'CAPABILITY_AVAILABILITY_UNKNOWN',
    message: 'Project capability availability could not be verified',
    availabilityUnknown: { failedSources: ['skills', 'mcpServers'] }
  });
});
it('contains a shared service failure without allowing any fallback launch', async () => {
  start.mockRejectedValueOnce(new Error('offline'));
  expect(await state.shared.get(IPC.teams.startJob)!({ projectId: 'registered' })).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(start).toHaveBeenCalledOnce();
});

it('aligns desktop exact-native action with host-confirmed compatible slots without native ids', async () => {
  const retained = {
    ...execution,
    state: 'FAILED',
    nativeRecoverySnapshots: [{ attempt: 1, slotId: 'slot', role: 'worker', nativeConversationId: 'native-secret' }]
  };
  list.mockResolvedValueOnce({ records: [retained], hasMore: false });
  exactNativeRecoveryAvailability.mockReturnValueOnce({ available: true, restorableSlots: 1 });
  const enabled = await state.windows.get(IPC.executionBoard.listProject)!({ id: 8 }, 'registered');
  expect(enabled.executions[0].recovery.actions.exactNative).toEqual({ available: true, restorableSlots: 1 });
  expect(JSON.stringify(enabled)).not.toContain('native-secret');

  list.mockResolvedValueOnce({ records: [retained], hasMore: false });
  // Durable snapshots alone do not enable recovery: host rejects former persona/profile slots.
  exactNativeRecoveryAvailability.mockReturnValueOnce({ available: false, restorableSlots: 0 });
  const unsupported = await state.windows.get(IPC.executionBoard.listProject)!({ id: 8 }, 'registered');
  expect(unsupported.executions[0].recovery.actions.exactNative).toEqual({ available: false, restorableSlots: 0, reason: 'NATIVE_RESTORE_UNAVAILABLE' });
});

it('keeps native recovery available after a replacement launch fails without projecting snapshot ids', async () => {
  const retained = {
    ...execution,
    state: 'FAILED',
    attempt: 2,
    nativeRecoverySnapshots: [{ attempt: 1, slotId: 'slot', role: 'worker', nativeConversationId: 'native-secret' }]
  };
  list.mockResolvedValueOnce({ records: [retained], hasMore: false });
  exactNativeRecoveryAvailability.mockReturnValueOnce({ available: true, restorableSlots: 1 });

  const result = await state.windows.get(IPC.executionBoard.listProject)!({ id: 8 }, 'registered');
  expect(result.executions[0].recovery.actions.exactNative).toEqual({ available: true, restorableSlots: 1 });
  expect(JSON.stringify(result)).not.toContain('native-secret');
});

it('rejects retained recovery and worktree action outside the window project scope', async () => {
  const scoped = { id: 7 };
  for (const channel of [IPC.executionBoard.recoverRetained, IPC.executionBoard.worktreeAction]) {
    expect(await state.windows.get(channel)!(scoped, 'registered', 'execution', 3, 'fresh-plan')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }
  expect(recoverRetained).not.toHaveBeenCalled(); expect(squadWorktreeAction).not.toHaveBeenCalled();
});

it('maps retained recovery success and service failure', async () => {
  recoverRetained.mockResolvedValueOnce({ ok: true, value: execution });
  await expect(state.windows.get(IPC.executionBoard.recoverRetained)!({ id: 8 }, 'registered', 'execution', 4, 'fresh-plan'))
    .resolves.toMatchObject({ ok: true, value: { executionId: 'execution' } });
  recoverRetained.mockRejectedValueOnce(new Error('boom'));
  await expect(state.shared.get(IPC.executionBoard.recoverRetained)!('registered', 'execution', 4, 'fresh-plan'))
    .resolves.toEqual({ ok: false, code: 'UNAVAILABLE', message: 'retained recovery unavailable' });
});

it('validates and forwards squad worktree actions', async () => {
  const act = state.windows.get(IPC.executionBoard.worktreeAction)!;
  squadWorktreeAction.mockResolvedValueOnce({ ok: true, value: true });
  await expect(act({ id: 8 }, 'registered', 'execution', 3, 'instruct', 'do it')).resolves.toEqual({ ok: true, value: true });
  expect(squadWorktreeAction).toHaveBeenCalledWith('registered', 'execution', 3, 'instruct', 'do it', undefined);
  squadWorktreeAction.mockResolvedValueOnce({ ok: true, value: true });
  await act({ id: 8 }, 'registered', 'execution', 3, 'instruct', 'do it', 'persona-1');
  expect(squadWorktreeAction).toHaveBeenLastCalledWith('registered', 'execution', 3, 'instruct', 'do it', 'persona-1');
  for (const bad of [5, '', '  ', 'x'.repeat(201)]) {
    await expect(act({ id: 8 }, 'registered', 'execution', 3, 'instruct', 'do it', bad)).resolves.toMatchObject({ code: 'INVALID' });
  }
  expect(squadWorktreeAction).toHaveBeenCalledTimes(2);
  await expect(act({ id: 8 }, 'registered', 'execution', 3.5, 'leave')).resolves.toMatchObject({ code: 'INVALID' });
  await expect(act({ id: 8 }, 'registered', 'execution', 3, 'nuke')).resolves.toMatchObject({ code: 'INVALID' });
  await expect(act({ id: 8 }, 'registered', 'execution', 3, 'leave', 5)).resolves.toMatchObject({ code: 'INVALID' });
  expect(squadWorktreeAction).toHaveBeenCalledTimes(2);
  squadWorktreeAction.mockRejectedValueOnce(new Error('x'));
  await expect(state.shared.get(IPC.executionBoard.worktreeAction)!('registered', 'execution', 3, 'delete'))
    .resolves.toEqual({ ok: false, code: 'UNAVAILABLE', message: 'squad worktree action unavailable' });
});


it('falls back to an empty page when the project listing throws', async () => {
  list.mockRejectedValueOnce(new Error('x'));
  await expect(state.shared.get(IPC.executionBoard.listProject)!('registered')).resolves.toEqual({ executions: [], hasMore: false });
});

it('labels listed executions with the team name when the team exists', async () => {
  state.teams = [{ id: 'other', name: 'Other' }, { id: 'team-1', name: 'Alpha Squad' }];
  list.mockResolvedValueOnce({ records: [execution], hasMore: false });
  const page = await state.shared.get(IPC.executionBoard.listProject)!('registered');
  expect(page.executions[0].teamName).toBe('Alpha Squad');
});

it('projects Modern squad members from the team lifecycle onto their execution only', async () => {
  const worker = (threadId: string, executionId: string, projectId = 'registered') => ({
    transport: 'MODERN', threadId, slotId: 'slot', personaId: 'persona', projectId, bindingState: 'BOUND', process: 'running',
    capacityReleased: false, modernContext: { role: 'worker', executionId }
  });
  state.lifecycle = [{ workers: [worker('t1', 'execution'), worker('t2', 'other-execution'), worker('t3', 'execution', 'foreign')] }];
  list.mockResolvedValueOnce({ records: [execution], hasMore: false });
  const page = await state.shared.get(IPC.executionBoard.listProject)!('registered');
  expect(page.executions[0].modernMembers).toEqual([{ threadId: 't1', slotId: 'slot', personaId: 'persona', role: 'worker', live: true }]);
  state.lifecycle = [];
  list.mockResolvedValueOnce({ records: [execution], hasMore: false });
  expect((await state.shared.get(IPC.executionBoard.listProject)!('registered')).executions[0]).not.toHaveProperty('modernMembers');
});
