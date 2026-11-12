import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { IPC, type CcApi } from '@zana-ai/zcc-desktop-contract';

const h = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }));
vi.mock('electron', () => ({
  ipcRenderer: { invoke: h.invoke, setMaxListeners: vi.fn(), on: vi.fn(), off: vi.fn() },
  contextBridge: { exposeInMainWorld: h.expose },
  webFrame: { getZoomFactor: () => 1 }, webUtils: { getPathForFile: vi.fn() },
}));

let api: CcApi;
beforeAll(async () => {
  await import('./preload.js');
  api = h.expose.mock.calls.find(([name]) => name === 'cc')![1];
});
beforeEach(() => { h.invoke.mockReset(); });

it('mcp.catalogue invokes the catalogue IPC channel with no renderer-supplied arguments', async () => {
  const result = { ok: true, value: { entries: [], notes: [] } };
  h.invoke.mockResolvedValueOnce(result);
  await expect(api.mcp.catalogue()).resolves.toBe(result);
  expect(h.invoke).toHaveBeenCalledWith(IPC.mcp.catalogue);
});
