import { expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';

const electron = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }));
vi.mock('electron', () => ({
  ipcRenderer: { invoke: electron.invoke, setMaxListeners: vi.fn(), on: vi.fn() },
  contextBridge: { exposeInMainWorld: electron.expose }, webFrame: { getZoomFactor: () => 1 }, webUtils: { getPathForFile: vi.fn() },
}));

it('forwards the opener target, path and project root to main', async () => {
  await import('./preload.js');
  const api = electron.expose.mock.calls.find(([name]) => name === 'cc')![1];
  electron.invoke.mockResolvedValue({ ok: true });
  await expect(api.openers.openIn('code', '/work/src/a.ts', { projectRoot: '/work' })).resolves.toEqual({ ok: true });
  expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(IPC.openers.openIn, 'code', '/work/src/a.ts', { projectRoot: '/work' });
  electron.invoke.mockClear();
  const input = { path: 'dist/app.dmg', threadId: 't1', projectId: 'p1', source: 'workspace' };
  await api.openers.fileLocation(input);
  await api.openers.revealFile(input);
  expect(electron.invoke.mock.calls).toEqual([[IPC.openers.fileLocation, input], [IPC.openers.revealFile, input]]);
});

it('forwards bulk plugin updates to main and returns the result', async () => {
  await import('./preload.js');
  const api = electron.expose.mock.calls.find(([name]) => name === 'cc')![1];
  const result = { ok: true, value: { updated: ['plugin-1'], failed: [] } };
  electron.invoke.mockClear();
  electron.invoke.mockResolvedValueOnce(result);
  await expect(api.pluginApps.applyAllUpdates()).resolves.toEqual(result);
  expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(IPC.pluginApps.applyAllUpdates);
});

it('throws when threads.resolvePreviewPath is called without product server', async () => {
  await import('./preload.js');
  const api = electron.expose.mock.calls.find(([name]) => name === 'cc')![1];
  await expect(api.threads.resolvePreviewPath('t1', { path: 'a.md' })).rejects.toThrow('threads require the product server');
});

it('forwards only the installed id and recovery action through the plugin bridge', async () => {
  await import('./preload.js');
  const api = electron.expose.mock.calls.find(([name]) => name === 'cc')![1];
  electron.invoke.mockClear(); electron.invoke.mockResolvedValueOnce({ ok: true, value: true });
  await expect(api.pluginApps.repair('example', 'locate')).resolves.toEqual({ ok: true, value: true });
  expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(IPC.pluginApps.repair, 'example', 'locate');
});
