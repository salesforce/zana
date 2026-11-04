import { expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';

const electron = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  exposeInMainWorld: vi.fn()
}));

vi.mock('electron', () => ({
  ipcRenderer: { invoke: electron.invoke, on: electron.on, off: electron.off, setMaxListeners: vi.fn() },
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  webFrame: { getZoomFactor: vi.fn(() => 1) },
  webUtils: { getPathForFile: vi.fn() }
}));

async function api() {
  await import('./preload.js');
  return electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'cc')?.[1];
}

it('opens, closes and lists plugin view windows through their IPC channels', async () => {
  const cc = await api();
  const target = { projectId: 'p1', pluginId: 'salesforce', tabId: 'studio' };
  electron.invoke.mockClear();
  electron.invoke.mockResolvedValue(true);
  await cc.windows.openPluginView(target);
  await cc.windows.closePluginView(target);
  await cc.windows.listPluginViews();
  await cc.windows.showInMain('/projects/p1');
  await cc.pluginApprovals.request({ pluginId: 'salesforce', title: 'Publish' });
  expect(electron.invoke.mock.calls).toEqual([
    [IPC.windows.openPluginView, target],
    [IPC.windows.closePluginView, target],
    [IPC.windows.listPluginViews],
    [IPC.windows.showInMain, '/projects/p1'],
    [IPC.pluginApprovals.request, { pluginId: 'salesforce', title: 'Publish' }]
  ]);
});

it('subscribes to open plugin views and to main-window navigation, and unsubscribes', async () => {
  const cc = await api();
  const views = vi.fn();
  const paths = vi.fn();
  const offViews = cc.windows.onPluginViewsChanged(views);
  const offPaths = cc.windows.onNavigate(paths);
  const handler = (channel: string) => electron.on.mock.calls.find(([name]) => name === channel)![1];
  handler(IPC.windows.onPluginViewsChanged)({}, [{ projectId: 'p1', pluginId: 'salesforce', tabId: 'studio' }]);
  handler(IPC.windows.onNavigate)({}, '/projects/p1');
  expect(views).toHaveBeenCalledWith([{ projectId: 'p1', pluginId: 'salesforce', tabId: 'studio' }]);
  expect(paths).toHaveBeenCalledWith('/projects/p1');
  offViews();
  offPaths();
  expect(electron.off).toHaveBeenCalledWith(IPC.windows.onPluginViewsChanged, handler(IPC.windows.onPluginViewsChanged));
  expect(electron.off).toHaveBeenCalledWith(IPC.windows.onNavigate, handler(IPC.windows.onNavigate));
});

it('opens, closes, lists and subscribes to thread view windows through their IPC channels', async () => {
  const cc = await api();
  const target = { threadId: 't1', projectId: 'p1' };
  electron.invoke.mockClear();
  electron.invoke.mockResolvedValue(true);
  await cc.windows.openThreadView(target);
  await cc.windows.closeThreadView(target);
  await cc.windows.listThreadViews();
  expect(electron.invoke.mock.calls).toEqual([
    [IPC.windows.openThreadView, target],
    [IPC.windows.closeThreadView, target],
    [IPC.windows.listThreadViews]
  ]);
  const views = vi.fn();
  const off = cc.windows.onThreadViewsChanged(views);
  const handler = electron.on.mock.calls.find(([name]) => name === IPC.windows.onThreadViewsChanged)![1];
  handler({}, [target]);
  expect(views).toHaveBeenCalledWith([target]);
  off();
  expect(electron.off).toHaveBeenCalledWith(IPC.windows.onThreadViewsChanged, handler);
});

it('binds close preflight readiness, completion and requests to the preload IPC bridge', async () => {
  const cc = await api();
  electron.invoke.mockClear();
  await cc.windows.pluginViewCloseReady(true);
  await cc.windows.pluginViewCloseComplete('r1', { ok: true });
  expect(electron.invoke.mock.calls).toEqual([
    [IPC.windows.pluginViewCloseReady, true],
    [IPC.windows.pluginViewCloseComplete, 'r1', { ok: true }]
  ]);
  const callback = vi.fn();
  const off = cc.windows.onPluginViewCloseRequest(callback);
  const handler = electron.on.mock.calls.find(([name]) => name === IPC.windows.onPluginViewCloseRequest)![1];
  handler({}, { requestId: 'r1' });
  expect(callback).toHaveBeenCalledWith({ requestId: 'r1' });
  off();
  expect(electron.off).toHaveBeenCalledWith(IPC.windows.onPluginViewCloseRequest, handler);
});
