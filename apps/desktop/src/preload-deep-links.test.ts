import { expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';

const electron = vi.hoisted(() => ({ invoke: vi.fn(), on: vi.fn(), off: vi.fn(), exposeInMainWorld: vi.fn() }));

vi.mock('electron', () => ({
  ipcRenderer: { invoke: electron.invoke, on: electron.on, off: electron.off, setMaxListeners: vi.fn() },
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  webFrame: { getZoomFactor: vi.fn(() => 1) },
  webUtils: { getPathForFile: vi.fn() }
}));

it('bridges deep link config/open and subscribes/unsubscribes onLink', async () => {
  await import('./preload.js');
  const cc = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'cc')?.[1];
  electron.invoke.mockResolvedValue('r');
  await expect(cc.deepLinks.config()).resolves.toBe('r');
  expect(electron.invoke).toHaveBeenLastCalledWith(IPC.deepLinks.config);
  await cc.deepLinks.open('zana://x');
  expect(electron.invoke).toHaveBeenLastCalledWith(IPC.deepLinks.open, 'zana://x');

  const cb = vi.fn();
  const off = cc.deepLinks.onLink(cb);
  const [channel, handler] = electron.on.mock.calls.find(([c]) => c === IPC.deepLinks.onLink)!;
  expect(channel).toBe(IPC.deepLinks.onLink);
  handler({}, { url: 'u' });
  expect(cb).toHaveBeenCalledWith({ url: 'u' });
  off();
  expect(electron.off).toHaveBeenCalledWith(IPC.deepLinks.onLink, handler);

});
