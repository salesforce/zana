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
