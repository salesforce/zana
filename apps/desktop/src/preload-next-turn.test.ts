import { expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';

const electron = vi.hoisted(() => ({
  invoke: vi.fn(),
  exposeInMainWorld: vi.fn()
}));

vi.mock('electron', () => ({
  ipcRenderer: { invoke: electron.invoke, on: vi.fn(), setMaxListeners: vi.fn() },
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  webFrame: { getZoomFactor: vi.fn(() => 1) },
  webUtils: { getPathForFile: vi.fn() }
}));

it('exposes Send now through the authorized UI-send IPC channel', async () => {
  await import('./preload.js');
  const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'cc')?.[1];
  expect(api).toBeDefined();
  const result = { ok: true };
  electron.invoke.mockResolvedValueOnce(result);

  await expect(api.threads.sendNextTurn('thread/one', 'item two')).resolves.toBe(result);
  expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(IPC.uiSend, 'thread/one', 'item two');
});

it('forwards skill-state batches and propagates persistence failures to the caller', async () => {
  await import('./preload.js');
  const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'cc')?.[1];
  const updates = [{ id: 'zcc:plugin/review', name: 'review', state: 'manual' }];
  const result = { ok: true, applied: 1, rejected: 0 };
  electron.invoke.mockClear();
  electron.invoke.mockResolvedValueOnce(result);
  await expect(api.skills.setState(updates)).resolves.toEqual(result);
  expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(IPC.skills.setState, updates);
  electron.invoke.mockRejectedValueOnce(new Error('disk unavailable'));
  await expect(api.skills.setState(updates)).rejects.toThrow('disk unavailable');
});

it('exposes timeout recovery through its dedicated execution IPC channel', async () => {
  await import('./preload.js');
  const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'cc')?.[1];
  const result = { ok: true };
  electron.invoke.mockClear();
  electron.invoke.mockResolvedValueOnce(result);

  await expect(api.executionBoard.recoverTimedOut('project-1', 'execution-1', 4, 'request-1')).resolves.toBe(result);
  expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(
    IPC.executionBoard.recoverTimedOut, 'project-1', 'execution-1', 4, 'request-1'
  );
});

it('exposes typed retained-run recovery through its dedicated execution IPC channel', async () => {
  await import('./preload.js');
  const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'cc')?.[1];
  electron.invoke.mockClear();
  electron.invoke.mockResolvedValueOnce({ ok: true });

  await api.executionBoard.recoverRetainedSquad('project-1', 'execution-1', 4, 'exact-native');
  expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(IPC.executionBoard.recoverRetained, 'project-1', 'execution-1', 4, 'exact-native');
});

it('exposes schedule get and reload through their distinct product IPC channels', async () => {
  await import('./preload.js');
  const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'cc')?.[1];
  electron.invoke.mockClear();
  electron.invoke.mockResolvedValueOnce({ ok: true, value: { id: 'schedule-1' } });
  electron.invoke.mockResolvedValueOnce({ ok: true, value: { id: 'schedule-1', name: 'Reloaded' } });
  await expect(api.scheduler.get('schedule-1')).resolves.toEqual({ ok: true, value: { id: 'schedule-1' } });
  await expect(api.scheduler.reload('schedule-1')).resolves.toEqual({ ok: true, value: { id: 'schedule-1', name: 'Reloaded' } });
  expect(electron.invoke.mock.calls).toEqual([[IPC.scheduler.get, 'schedule-1'], [IPC.scheduler.reload, 'schedule-1']]);
});

it('exposes run query, retry, resume and dismiss through their own scheduler IPC channels', async () => {
  await import('./preload.js');
  const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'cc')?.[1];
  electron.invoke.mockClear();
  electron.invoke.mockResolvedValue({ ok: true, value: [] });
  const refs = [{ scheduleId: 's1', runId: 'r1' }];
  await api.scheduler.queryRuns({ state: 'open' });
  await api.scheduler.retryRuns(refs);
  await api.scheduler.resumeRun({ scheduleId: 's1', runId: 'r1' });
  await api.scheduler.dismissRuns(refs);
  expect(electron.invoke.mock.calls).toEqual([
    [IPC.scheduler.queryRuns, { state: 'open' }],
    [IPC.scheduler.retryRuns, refs],
    [IPC.scheduler.resumeRun, { scheduleId: 's1', runId: 'r1' }],
    [IPC.scheduler.dismissRuns, refs]
  ]);
});

it('forwards plugin settings read options to the getSettings IPC channel', async () => {
  await import('./preload.js');
  const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'cc')?.[1];
  electron.invoke.mockClear();
  electron.invoke.mockResolvedValue({ descriptors: {}, values: {} });
  await api.pluginApps.getSettings('plug', { omitSecrets: true });
  expect(electron.invoke).toHaveBeenLastCalledWith(IPC.pluginApps.getSettings, 'plug', { omitSecrets: true });
});

it('answers side-panel conversation calls with empty results until main serves them over HTTP', async () => {
  await import('./preload.js');
  const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'cc')?.[1];
  await expect(api.threads.panelConversations('notes', 'board')).resolves.toEqual([]);
  await expect(api.threads.openAsThread('thread-1')).resolves.toEqual({ thread: {} });
});

it('leaves background stops to the product client', async () => {
  await import('./preload.js');
  const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'cc')?.[1];
  await expect(api.threads.stopBackground('thread-1', ['item-1'])).resolves.toEqual({ ok: false });
});

it('leaves queued-message editing to the product client', async () => {
  await import('./preload.js');
  const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'cc')?.[1];
  electron.invoke.mockClear();
  await expect(api.threads.holdNextTurnForEdit('thread-1', 'item-1')).rejects.toThrow('threads require the product server');
  await expect(api.threads.releaseNextTurnEditHold('thread-1', 'item-1')).rejects.toThrow('threads require the product server');
  await expect(api.threads.updateNextTurn('thread-1', 'item-1', { text: 'x' })).rejects.toThrow('threads require the product server');
  expect(electron.invoke).not.toHaveBeenCalled();
});

it('leaves thread notification levels to the product client', async () => {
  await import('./preload.js');
  const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'cc')?.[1];
  electron.invoke.mockClear();
  await expect(api.threads.notificationLevel('thread-1')).rejects.toThrow('threads require the product server');
  await expect(api.threads.setNotificationLevel('thread-1', 'muted')).rejects.toThrow('threads require the product server');
  expect(electron.invoke).not.toHaveBeenCalled();
});

it('exposes squad worktree, resume and inbox host-action channels with coerced replay', async () => {
  await import('./preload.js');
  const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'cc')?.[1];
  electron.invoke.mockClear();
  electron.invoke.mockResolvedValue({ ok: true });

  await api.executionBoard.worktreeAction('p', 'e', 2, 'instruct', 'go', 'pers');
  expect(electron.invoke).toHaveBeenLastCalledWith(IPC.executionBoard.worktreeAction, 'p', 'e', 2, 'instruct', 'go', 'pers');
  await api.executionBoard.recoverRetainedSquad('p', 'e', 2, 'fresh-plan');
  expect(electron.invoke).toHaveBeenLastCalledWith(IPC.executionBoard.recoverRetained, 'p', 'e', 2, 'fresh-plan');

  await api.inbox.hostActions.list();
  expect(electron.invoke).toHaveBeenLastCalledWith(IPC.inbox.hostActions.list);
  await api.inbox.hostActions.get('entry');
  expect(electron.invoke).toHaveBeenLastCalledWith(IPC.inbox.hostActions.get, 'entry');
  await api.inbox.hostActions.run('entry', { optionId: 'o' });
  expect(electron.invoke).toHaveBeenLastCalledWith(IPC.inbox.hostActions.run, 'entry', { optionId: 'o' });
  await api.inbox.hostActions.readDecisionArtifact('entry', '.zana/x.md');
  expect(electron.invoke).toHaveBeenLastCalledWith(IPC.inbox.hostActions.readDecisionArtifact, 'entry', '.zana/x.md');
});

it('serves host bootstrapBySsh over product HTTP with an empty local result', async () => {
  await import('./preload.js');
  const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'cc')?.[1];
  await expect(api.hosts.bootstrapBySsh()).resolves.toEqual([]);
});

it('relaunches the local host through the host-utility IPC channel', async () => {
  await import('./preload.js');
  const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'cc')?.[1];
  electron.invoke.mockClear();
  electron.invoke.mockResolvedValueOnce({ ok: true });
  await expect(api.hosts.relaunchLocal()).resolves.toEqual({ ok: true });
  expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(IPC.hosts.relaunchLocal);
});

it('exposes Squad proposal review through its dedicated teams IPC channel', async () => {
  await import('./preload.js');
  const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'cc')?.[1];
  electron.invoke.mockClear();
  electron.invoke.mockResolvedValueOnce({ ok: true });

  await api.teams.reviewProposal('proposal-1');
  expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(IPC.teams.reviewProposal, 'proposal-1');
});
