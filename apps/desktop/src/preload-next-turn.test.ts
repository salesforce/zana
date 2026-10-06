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
