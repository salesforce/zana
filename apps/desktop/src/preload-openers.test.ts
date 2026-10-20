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
});
