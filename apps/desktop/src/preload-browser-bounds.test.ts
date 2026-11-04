import { expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';

const electron = vi.hoisted(() => ({ expose: vi.fn(), send: vi.fn(), zoom: vi.fn(() => 1) }));
vi.mock('electron', () => ({
  ipcRenderer: { invoke: vi.fn(), send: electron.send, setMaxListeners: vi.fn(), on: vi.fn() },
  contextBridge: { exposeInMainWorld: electron.expose }, webFrame: { getZoomFactor: electron.zoom }, webUtils: { getPathForFile: vi.fn() },
}));

it('scales browser bounds to window pixels, rounding inward so borders stay visible', async () => {
  await import('./preload.js');
  const api = electron.expose.mock.calls.find(([name]) => name === 'cc')![1];
  const bounds = { x: 801, y: 103, width: 351, height: 641 };

  api.browser.setBounds({ tabId: 'tab', bounds });
  expect(electron.send).toHaveBeenLastCalledWith(IPC.browser.setBounds, { tabId: 'tab', bounds });

  electron.zoom.mockReturnValue(0.95);
  api.browser.setBounds({ tabId: 'tab', bounds });
  // 801*0.95 = 760.95 → 761 (ceil); right 1152*0.95 = 1094.4 → 1094, bottom 744*0.95 = 706.8 → 706 (floor).
  expect(electron.send).toHaveBeenLastCalledWith(IPC.browser.setBounds, { tabId: 'tab', bounds: { x: 761, y: 98, width: 333, height: 608 } });

  electron.zoom.mockReturnValue(0.5);
  api.browser.setBounds({ tabId: 'tab', bounds: { x: 3, y: 3, width: 0, height: 0 } });
  expect(electron.send).toHaveBeenLastCalledWith(IPC.browser.setBounds, { tabId: 'tab', bounds: { x: 2, y: 2, width: 0, height: 0 } });
});
