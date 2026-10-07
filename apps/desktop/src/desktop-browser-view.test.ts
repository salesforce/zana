import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
const views = vi.hoisted(() => [] as any[]);
const sessions = vi.hoisted(() => new Map<string, any>());
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: vi.fn() },
  session: { fromPartition: (partition: string) => { const value = Object.assign(new EventEmitter(), { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() }); sessions.set(partition, value); return value; } },
  WebContentsView: class {
    webContents = Object.assign(new EventEmitter(), {
      isDestroyed: () => false, getURL: () => 'about:blank', getTitle: () => '',
      isLoadingMainFrame: () => false, navigationHistory: { canGoBack: () => false, canGoForward: () => false },
      setWindowOpenHandler: (handler: unknown) => { this.open = handler; }, loadURL: vi.fn().mockResolvedValue(undefined),
      debugger: { isAttached: () => false }, close: vi.fn()
    });
    open: any;
    setBounds = vi.fn(); setVisible = vi.fn();
    constructor() { views.push(this); }
  }
}));
import { createDesktopBrowserViewManager } from './desktop-browser-view.js';

it('only forwards allowed popups from visible pages and retains the rate limit', () => {
  const hostWindow = {
    isDestroyed: () => false, getContentBounds: () => ({ width: 800, height: 600 }),
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    webContents: { id: 1, isDestroyed: () => false, send: vi.fn() }
  };
  const manager = createDesktopBrowserViewManager();
  try {
    manager.createTab({ hostWindow, tabId: 'tab', threadId: 'thread', url: 'about:blank', profile: { kind: 'automation', id: 'run' }, viewport: { width: 800, height: 600 } });
    const view = views.at(-1);
    expect(view.open({ url: 'https://example.test/hidden' })).toEqual({ action: 'deny' });
    expect(hostWindow.webContents.send).not.toHaveBeenCalled();
    manager.setVisibleWithoutFocus({ hostWindow, request: { tabId: 'tab', visible: true } });
    view.open({ url: 'https://example.test/visible' });
    expect(hostWindow.webContents.send).toHaveBeenCalledWith(IPC.browser.scopedOpenTab, { tabId: 'tab', url: 'https://example.test/visible' });
    expect(hostWindow.webContents.send).toHaveBeenCalledWith(IPC.browser.openTab, { url: 'https://example.test/visible' });
    hostWindow.webContents.send.mockClear();
    view.open({ url: 'file:///etc/passwd' });
    expect(hostWindow.webContents.send).not.toHaveBeenCalled();
    view.open({ url: 'https://example.test/third' });
    hostWindow.webContents.send.mockClear();
    view.open({ url: 'https://example.test/limited' });
    expect(hostWindow.webContents.send).not.toHaveBeenCalled();
  } finally { manager.destroyAll(); views.length = 0; }
});

it('offers a native save dialog only for visible personal tabs under user control', () => {
  const hostWindow = { isDestroyed: () => false, getContentBounds: () => ({ width: 800, height: 600 }), contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }, webContents: { id: 10, isDestroyed: () => false, send: vi.fn() } };
  const manager = createDesktopBrowserViewManager({ partition: 'test-personal' });
  const event = { preventDefault: vi.fn() };
  const item = { setSaveDialogOptions: vi.fn() };
  try {
    manager.createTab({ hostWindow, tabId: 'personal', threadId: 'thread', url: 'about:blank', profile: { kind: 'personal' }, viewport: { width: 800, height: 600 } });
    const personal = views.at(-1);
    sessions.get('test-personal').emit('will-download', event, item, personal.webContents);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    manager.setVisibleWithoutFocus({ hostWindow, request: { tabId: 'personal', visible: true } });
    sessions.get('test-personal').emit('will-download', event, item, personal.webContents);
    expect(item.setSaveDialogOptions).toHaveBeenCalledWith({ title: 'Save downloaded file' });
    manager.setDownloadControlGuard?.(() => true);
    sessions.get('test-personal').emit('will-download', event, item, personal.webContents);
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    manager.createTab({ hostWindow, tabId: 'automation', threadId: 'thread', url: 'about:blank', profile: { kind: 'automation', id: 'run' }, viewport: { width: 800, height: 600 } });
    const automation = views.at(-1);
    const automationSession = [...sessions.entries()].find(([key]) => key !== 'test-personal')![1];
    automationSession.emit('will-download', event, item, automation.webContents);
    expect(event.preventDefault).toHaveBeenCalledTimes(3);
  } finally { manager.destroyAll(); sessions.clear(); views.length = 0; }
});
