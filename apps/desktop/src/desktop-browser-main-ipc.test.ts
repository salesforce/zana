import { expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
const f = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), window: { webContents: { id: 42 } } as { webContents: { id: number } } | null }));
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: () => f.window }, ipcMain: { on: vi.fn(), handle: (channel: string, handler: (...args: any[]) => any) => f.handlers.set(channel, handler) }, shell: {} }));
import { registerDesktopBrowserIpc } from './desktop-browser-main-ipc.js';
it('confines closed-tab reconciliation to the sender window and denies non-window callers', () => {
  const getClosedTabs = vi.fn(() => [{ tabId: 'closed' }]);
  registerDesktopBrowserIpc({ getClosedTabs } as never);
  const invoke = f.handlers.get(IPC.browser.getClosedTabs)!;
  expect(invoke({ sender: { id: 42 } }, { hostWebContentsId: 99 })).toEqual([{ tabId: 'closed' }]);
  expect(getClosedTabs).toHaveBeenCalledExactlyOnceWith(42);
  f.window = null;
  expect(invoke({ sender: { id: 99 } })).toEqual([]);
  expect(getClosedTabs).toHaveBeenCalledTimes(1);
});
