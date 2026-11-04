import { expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';

const electron = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }));
vi.mock('electron', () => ({
  ipcRenderer: { invoke: electron.invoke, setMaxListeners: vi.fn(), on: vi.fn() },
  contextBridge: { exposeInMainWorld: electron.expose }, webFrame: { getZoomFactor: () => 1 }, webUtils: { getPathForFile: vi.fn() },
}));

it('forwards a Settings "Check an error" request to main unchanged', async () => {
  await import('./preload.js');
  const api = electron.expose.mock.calls.find(([name]) => name === 'cc')![1];
  const reply = { ruleId: 'gw', message: 'continue', delaySeconds: 20, skipped: [] };
  electron.invoke.mockResolvedValue(reply);
  const input = { text: 'Provider anthropic not found', rules: [{ id: 'gw' }] };
  await expect(api.apiErrorResume.check(input)).resolves.toEqual(reply);
  expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(IPC.apiErrorResume.check, input);
});
