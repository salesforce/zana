import { expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';

const electron = vi.hoisted(() => ({ invoke: vi.fn(), on: vi.fn(), off: vi.fn(), exposeInMainWorld: vi.fn() }));

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

it('passes plain RPC results through and unwraps expected-error envelopes into clean rejections', async () => {
  const cc = await api();
  electron.invoke.mockResolvedValueOnce({ count: 2 });
  await expect(cc.pluginApps.callRpc('docs', 'count', { a: 1 })).resolves.toEqual({ count: 2 });
  expect(electron.invoke).toHaveBeenLastCalledWith(IPC.pluginApps.callRpc, 'docs', 'count', { a: 1 });

  electron.invoke.mockResolvedValueOnce({ __zccRpcError: { message: 'a design doc must keep at least one file', code: 'invalid' } });
  const error = await cc.pluginApps.callRpc('docs', 'rm').catch((e: Error) => e);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe('a design doc must keep at least one file');
  expect(error.code).toBe('invalid');

  electron.invoke.mockResolvedValueOnce({ __zccRpcError: { message: 'no code' } });
  const bare = await cc.pluginApps.callRpc('docs', 'rm').catch((e: Error) => e);
  expect(bare.message).toBe('no code'); expect(bare).not.toHaveProperty('code');
});

it('treats malformed envelopes as ordinary values and propagates real IPC failures', async () => {
  const cc = await api();
  electron.invoke.mockResolvedValueOnce({ __zccRpcError: { message: 42 } });
  await expect(cc.pluginApps.callRpc('docs', 'x')).resolves.toEqual({ __zccRpcError: { message: 42 } });
  const failure = new Error("Error invoking remote method 'pluginApps:callRpc': Error: kaboom");
  electron.invoke.mockRejectedValueOnce(failure);
  await expect(cc.pluginApps.callRpc('docs', 'x')).rejects.toBe(failure);
});
