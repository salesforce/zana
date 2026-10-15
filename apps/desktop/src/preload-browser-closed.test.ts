import { expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';

const electron = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, payload: unknown) => void>(), expose: vi.fn(), invoke: vi.fn() }));
vi.mock('electron', () => ({
  ipcRenderer: { invoke: electron.invoke, setMaxListeners: vi.fn(), on: (channel: string, callback: (event: unknown, payload: unknown) => void) => { electron.handlers.set(channel, callback); } },
  contextBridge: { exposeInMainWorld: electron.expose }, webFrame: { getZoomFactor: () => 1 }, webUtils: { getPathForFile: vi.fn() },
}));

it('validates native tab-closed events and unsubscribes each renderer listener', async () => {
  await import('./preload.js');
  const api = electron.expose.mock.calls.find(([name]) => name === 'cc')![1];
  electron.invoke.mockResolvedValueOnce([{ tabId: 'closed' }]);
  await expect(api.browser.getClosedTabs()).resolves.toEqual([{ tabId: 'closed' }]);
  expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(IPC.browser.getClosedTabs);
  const callback = vi.fn(), other = vi.fn();
  const unsubscribe = api.browser.onClosed(callback), unsubscribeOther = api.browser.onClosed(other);
  const deliver = electron.handlers.get(IPC.browser.closed)!;
  for (const payload of [null, {}, { tabId: '' }, { tabId: 'tab', extra: true }]) deliver({}, payload);
  expect(callback).not.toHaveBeenCalled();
  deliver({}, { tabId: 'tab' });
  expect(callback).toHaveBeenCalledExactlyOnceWith({ tabId: 'tab' });
  expect(other).toHaveBeenCalledTimes(1);
  unsubscribe();
  deliver({}, { tabId: 'next' });
  expect(callback).toHaveBeenCalledTimes(1);
  expect(other).toHaveBeenCalledTimes(2);
  unsubscribeOther();
  deliver({}, { tabId: 'last' });
  expect(other).toHaveBeenCalledTimes(2);
});
