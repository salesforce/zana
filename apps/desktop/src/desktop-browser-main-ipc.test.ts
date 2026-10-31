import { expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
const f = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), evaluate: vi.fn(async (..._args: any[]) => 42), window: { webContents: { id: 42 } } as { webContents: { id: number } } | null }));
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: () => f.window }, ipcMain: { on: vi.fn(), handle: (channel: string, handler: (...args: any[]) => any) => f.handlers.set(channel, handler) }, shell: {} }));
vi.mock('./desktop-browser-page.js', () => ({ createBrowserPageEvaluator: () => f.evaluate }));
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
it('rejects invalid evaluation and tabs outside the authenticated window and thread', async () => {
 f.window={webContents:{id:42}};
 const getAutomationTabs=vi.fn(()=>[]);
 registerDesktopBrowserIpc({getAutomationTabs} as never);
 const invoke=f.handlers.get(IPC.browser.evaluate)!;
 await expect(invoke({sender:{id:42}},{tabId:'x',threadId:'t',expression:'1',hostWebContentsId:99})).rejects.toThrow('Invalid');
 await expect(invoke({sender:{id:42}},{tabId:'x',threadId:'t',expression:'1'})).rejects.toThrow('unavailable');
 expect(getAutomationTabs).toHaveBeenCalledExactlyOnceWith({hostWebContentsId:42,threadId:'t'});
 f.window=null;await expect(invoke({sender:{id:42}},{tabId:'x',threadId:'t',expression:'1'})).rejects.toThrow('Invalid');
});

it('authorizes owned tabs, rejects leases, and stamps messages only while the owner lives', async()=>{
 const send=vi.fn(),isDestroyed=vi.fn(()=>false),pageDestroyed=vi.fn(()=>false);
 const win={isDestroyed,webContents:{id:42,isDestroyed:pageDestroyed,send}};f.window=win;
 const page={id:88};const getControl=vi.fn(()=>null as unknown);
 const getAutomationTabs=vi.fn(()=>[{tabId:'other',webContents:{}},{tabId:'owned',webContents:page}]);
 registerDesktopBrowserIpc({getAutomationTabs} as never,{broker:{getControl} as never});
 const invoke=f.handlers.get(IPC.browser.evaluate)!;
 const request={tabId:'owned',threadId:'thread',expression:'1'};
 await expect(invoke({sender:{id:42}},request)).resolves.toBe(42);
 expect(getAutomationTabs).toHaveBeenCalledWith({hostWebContentsId:42,threadId:'thread'});
 expect(f.evaluate.mock.lastCall?.[0]).toBe(page);
 const deliver=f.evaluate.mock.lastCall![2];deliver({pin:1});
 expect(send).toHaveBeenCalledExactlyOnceWith(IPC.browser.pageMessage,{tabId:'owned',threadId:'thread',data:{pin:1}});
 isDestroyed.mockReturnValue(true);deliver({pin:2});
 isDestroyed.mockReturnValue(false);pageDestroyed.mockReturnValue(true);deliver({pin:3});expect(send).toHaveBeenCalledTimes(1);
 getControl.mockReturnValue({control:{owner:'agent'}});
 await expect(invoke({sender:{id:42}},request)).rejects.toThrow('controlled');
});
