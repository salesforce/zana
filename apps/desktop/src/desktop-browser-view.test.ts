import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
const views = vi.hoisted(() => [] as any[]);
const sessions = vi.hoisted(() => new Map<string, any>());
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: vi.fn() },
  session: { fromPartition: (partition: string) => { const value = Object.assign(new EventEmitter(), { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() }); sessions.set(partition, value); return value; } },
  WebContentsView: class {
    webContents = Object.assign(new EventEmitter(), {
      destroyed: false, isDestroyed() { return this.destroyed; }, getURL: () => 'about:blank', getTitle: () => '',
      isLoadingMainFrame: () => false, navigationHistory: { canGoBack: () => false, canGoForward: () => false },
      setWindowOpenHandler: (handler: unknown) => { this.open = handler; }, loadURL: vi.fn().mockResolvedValue(undefined),
      debugger: { isAttached: () => false }, close: vi.fn(), focus: vi.fn(),
      audioMuted: false, setAudioMuted(muted: boolean) { this.audioMuted = muted; },
      capturePage: vi.fn().mockResolvedValue({ isEmpty: () => true }),
      mainFrame: { framesInSubtree: [0, 1].map(() => ({ detached: false, executeJavaScript: vi.fn().mockResolvedValue(null) })) }
    });
    open: any;
    setBounds = vi.fn(); setVisible = vi.fn();
    constructor(options: any = {}) { if (options.webContents) this.webContents = options.webContents; views.push(this); }
  }
}));
import { createDesktopBrowserViewManager } from './desktop-browser-view.js';

it('notifies the owning renderer once when a native tab closes, without touching other tabs', () => {
  const hostWindow = { isDestroyed: () => false, getContentBounds: () => ({ width: 800, height: 600 }), contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }, webContents: { id: 100, isDestroyed: () => false, send: vi.fn() } };
  const manager = createDesktopBrowserViewManager();
  try {
    const tab = manager.createTab({ hostWindow, tabId: 'owned', threadId: 'thread', url: 'about:blank', profile: { kind: 'automation', id: 'run' }, viewport: { width: 800, height: 600 } });
    manager.createTab({ hostWindow, tabId: 'other', threadId: 'thread', url: 'about:blank', profile: { kind: 'personal' }, viewport: { width: 800, height: 600 } });
    manager.closeTab({ hostWebContentsId: 100, threadId: 'thread', tabId: 'owned', generation: 'stale' });
    expect(hostWindow.webContents.send).not.toHaveBeenCalledWith(IPC.browser.closed, expect.anything());
    manager.closeTab({ hostWebContentsId: 100, threadId: 'thread', tabId: 'owned', generation: tab.generation });
    manager.closeTab({ hostWebContentsId: 100, threadId: 'thread', tabId: 'owned', generation: tab.generation });
    expect(hostWindow.webContents.send.mock.calls.filter(([channel]) => channel === IPC.browser.closed)).toEqual([[IPC.browser.closed, { tabId: 'owned' }]]);
    expect(manager.listTabs({ hostWebContentsId: 100, threadId: 'thread' }).map(tab => tab.tabId)).toEqual(['other']);
    expect(manager.getClosedTabs(100)).toEqual([{ tabId: 'owned' }]);
    expect(manager.getClosedTabs(999)).toEqual([]);
    const createdViews = views.length;
    manager.attach({ hostWindow, request: { tabId: 'owned', threadId: 'thread', url: 'https://example.test', visible: true, bounds: { x: 0, y: 0, width: 800, height: 600 } } });
    expect(views).toHaveLength(createdViews);
    expect(hostWindow.webContents.send).toHaveBeenLastCalledWith(IPC.browser.closed, { tabId: 'owned' });
    manager.createTab({ hostWindow, tabId: 'owned', threadId: 'thread', url: 'about:blank', profile: { kind: 'automation', id: 'new-run' }, viewport: { width: 800, height: 600 } });
    expect(manager.listTabs({ hostWebContentsId: 100, threadId: 'thread' })).toHaveLength(2);
    const reopened = manager.listTabs({ hostWebContentsId: 100, threadId: 'thread' }).find(tab => tab.tabId === 'owned')!;
    manager.closeTab({ hostWebContentsId: 100, threadId: 'thread', tabId: reopened.tabId, generation: reopened.generation });
    expect(manager.getClosedTabs(100)).toEqual([{ tabId: 'owned' }]);
    manager.releaseWindow(100);
    expect(manager.getClosedTabs(100)).toEqual([]);
    manager.attach({ hostWindow, request: { tabId: 'owned', threadId: 'thread', url: '', visible: false, bounds: { x: 0, y: 0, width: 0, height: 0 } } });
    expect(views).toHaveLength(createdViews + 2);
  } finally { manager.destroyAll(); views.length = 0; }
});

it('bounds remembered closed IDs so repeated sessions cannot grow the history indefinitely', () => {
  const hostWindow = { isDestroyed: () => false, getContentBounds: () => ({ width: 800, height: 600 }), contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }, webContents: { id: 101, isDestroyed: () => false, send: vi.fn() } };
  const manager = createDesktopBrowserViewManager();
  try {
    for (let index = 0; index < 4097; index++) {
      const tab = manager.createTab({ hostWindow, tabId: `tab-${index}`, threadId: 'thread', url: 'about:blank', profile: { kind: 'automation', id: 'run' }, viewport: { width: 800, height: 600 } });
      manager.closeTab({ hostWebContentsId: 101, threadId: 'thread', tabId: tab.tabId, generation: tab.generation });
    }
    const count = views.length;
    const attach = (tabId: string) => manager.attach({ hostWindow, request: { tabId, threadId: 'thread', url: '', visible: false, bounds: { x: 0, y: 0, width: 0, height: 0 } } });
    attach('tab-4096');
    expect(manager.getClosedTabs(101)).toHaveLength(4096);
    expect(views).toHaveLength(count);
    attach('tab-0');
    expect(views).toHaveLength(count + 1);
  } finally { manager.destroyAll(); views.length = 0; }
});

it('only creates allowed popups from visible pages and retains the rate limit and profile', () => {
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
    const allowed = view.open({ url: 'https://example.test/visible' });
    expect(allowed.action).toBe('allow');
    expect(allowed.overrideBrowserWindowOptions.webPreferences).toEqual(expect.objectContaining({ sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true }));
    expect(hostWindow.webContents.send).not.toHaveBeenCalled();
    const child = allowed.createWindow({});
    expect(child.loadURL).toHaveBeenCalledExactlyOnceWith('https://example.test/visible');
    const popup = manager.listTabs({ hostWebContentsId: 1, threadId: 'thread' }).find(tab => tab.tabId !== 'tab')!;
    expect(popup.profile).toEqual({ kind: 'automation', id: 'run' });
    expect(hostWindow.webContents.send).toHaveBeenCalledWith(IPC.browser.scopedOpenTab, { tabId: 'tab', url: 'https://example.test/visible', openedTabId: popup.tabId });
    expect(hostWindow.webContents.send).toHaveBeenCalledWith(IPC.browser.openTab, { url: 'https://example.test/visible' });
    hostWindow.webContents.send.mockClear();
    expect(view.open({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' });
    expect(hostWindow.webContents.send).not.toHaveBeenCalled();
    expect(view.open({ url: 'https://example.test/third' }).action).toBe('allow');
    hostWindow.webContents.send.mockClear();
    expect(view.open({ url: 'https://example.test/limited' })).toEqual({ action: 'deny' });
    expect(hostWindow.webContents.send).not.toHaveBeenCalled();
  } finally { manager.destroyAll(); views.length = 0; }
});

it('adopts the real blank popup without reloading it and cleans up a scripted native close', () => {
  const hostWindow = { isDestroyed: () => false, getContentBounds: () => ({ width: 800, height: 600 }), contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }, webContents: { id: 111, isDestroyed: () => false, send: vi.fn() } };
  const manager = createDesktopBrowserViewManager();
  try {
    manager.createTab({ hostWindow, tabId: 'login', threadId: 'thread', url: 'about:blank', profile: { kind: 'personal' }, viewport: { width: 800, height: 600 } });
    manager.setVisibleWithoutFocus({ hostWindow, request: { tabId: 'login', visible: true } });
    const source = views.at(-1);
    const provisional = new source.constructor();
    const nativePopup = provisional.webContents;
    const result = source.open({ url: 'about:blank' });
    expect(result.createWindow({ webContents: nativePopup })).toBe(nativePopup);
    expect(views.at(-1).webContents).toBe(nativePopup);
    expect(nativePopup.loadURL).not.toHaveBeenCalled();
    const popup = manager.listTabs({ hostWebContentsId: 111, threadId: 'thread' }).find(tab => tab.tabId !== 'login')!;
    expect(popup.profile).toEqual({ kind: 'personal' });
    const popupView = views.at(-1);
    Object.defineProperty(popupView, 'webContents', { get() { throw new Error('Native view has been disposed'); } });
    hostWindow.contentView.removeChildView.mockImplementationOnce(() => { throw new Error('Native view has been disposed'); });
    nativePopup.destroyed = true;
    expect(() => nativePopup.emit('destroyed')).not.toThrow();
    expect(manager.listTabs({ hostWebContentsId: 111, threadId: 'thread' }).map(tab => tab.tabId)).toEqual(['login']);
    expect(hostWindow.webContents.send).toHaveBeenCalledWith(IPC.browser.closed, { tabId: popup.tabId });
    expect(hostWindow.contentView.removeChildView.mock.calls[0]?.[0] === popupView).toBe(true);
    expect(nativePopup.close).not.toHaveBeenCalled();
  } finally { manager.destroyAll(); views.length = 0; }
});

it('exempts only live managed browser contents from the app navigation guard and revokes them on teardown', () => {
  const hostWindow = { isDestroyed: () => false, getContentBounds: () => ({ width: 800, height: 600 }), contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }, webContents: { id: 112, isDestroyed: () => false, send: vi.fn() } };
  const manager = createDesktopBrowserViewManager();
  try {
    const tab = manager.createTab({ hostWindow, tabId: 'page', threadId: 'thread', url: 'about:blank', profile: { kind: 'personal' }, viewport: { width: 800, height: 600 } });
    const contents = views.at(-1).webContents;
    expect(manager.allowsNavigation(contents, 'https://example.test/login')).toBe(true);
    expect(manager.allowsNavigation(contents, 'about:blank')).toBe(true);
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,unsafe']) expect(manager.allowsNavigation(contents, url)).toBe(false);
    expect(manager.allowsNavigation({ ...contents } as any, 'https://example.test')).toBe(false);
    contents.destroyed = true;
    expect(manager.allowsNavigation(contents, 'https://example.test')).toBe(false);
    contents.destroyed = false;
    manager.closeTab({ hostWebContentsId: 112, threadId: 'thread', tabId: 'page', generation: tab.generation });
    expect(manager.allowsNavigation(contents, 'https://example.test')).toBe(false);
    manager.createTab({ hostWindow, tabId: 'window-page', threadId: 'thread', url: 'about:blank', profile: { kind: 'personal' }, viewport: { width: 800, height: 600 } });
    const windowPage = views.at(-1).webContents;
    manager.releaseWindow(112);
    expect(manager.allowsNavigation(windowPage, 'https://example.test')).toBe(false);
    manager.createTab({ hostWindow, tabId: 'final-page', threadId: 'thread', url: 'about:blank', profile: { kind: 'personal' }, viewport: { width: 800, height: 600 } });
    const finalPage = views.at(-1).webContents;
    manager.destroyAll();
    expect(manager.allowsNavigation(finalPage, 'https://example.test')).toBe(false);
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

describe('hidden browser media', () => {
  const hostWindow = () => ({ isDestroyed: () => false, getContentBounds: () => ({ width: 800, height: 600 }), contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }, webContents: { id: 20, isDestroyed: () => false, send: vi.fn() } });
  const frames = (view: any): Array<{ detached: boolean; executeJavaScript: ReturnType<typeof vi.fn> }> => view.webContents.mainFrame.framesInSubtree;
  const clearFrames = (view: any) => frames(view).forEach((frame) => frame.executeJavaScript.mockClear());
  const setup = (run: (ctx: { manager: ReturnType<typeof createDesktopBrowserViewManager>; host: ReturnType<typeof hostWindow>; view: any }) => void | Promise<void>) => async () => {
    const host = hostWindow();
    const manager = createDesktopBrowserViewManager({ partition: 'test-media' });
    try {
      manager.createTab({ hostWindow: host, tabId: 'media', threadId: 'thread', url: 'about:blank', profile: { kind: 'personal' }, viewport: { width: 800, height: 600 } });
      await run({ manager, host, view: views.at(-1) });
    } finally { manager.destroyAll(); sessions.clear(); views.length = 0; }
  };

  it('creates tabs muted and paused so autoplay stays silent until revealed', setup(async ({ view }) => {
    expect(view.webContents.audioMuted).toBe(true);
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    for (const frame of frames(view)) expect(frame.executeJavaScript).toHaveBeenCalledTimes(1);
  }));

  it('replaces a temporarily occluded native page with a snapshot and clears it on restore', setup(async ({ manager, host, view }) => {
    view.webContents.capturePage.mockResolvedValue({ isEmpty: () => false, toJPEG: () => Buffer.from('page') });
    manager.setVisible({ hostWindow: host, request: { tabId: 'media', visible: true } });
    view.setVisible.mockClear(); host.webContents.send.mockClear();
    manager.setVisible({ hostWindow: host, request: { tabId: 'media', visible: false, preserveSnapshot: true } });
    expect(view.setVisible).not.toHaveBeenCalled();
    // A repeated observer notification must not discard the pending capture.
    manager.setVisible({ hostWindow: host, request: { tabId: 'media', visible: false, preserveSnapshot: true } });
    await Promise.resolve();
    expect(host.webContents.send).toHaveBeenCalledWith(IPC.browser.snapshot, { tabId: 'media', dataUrl: 'data:image/jpeg;base64,cGFnZQ==' });
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    manager.setVisible({ hostWindow: host, request: { tabId: 'media', visible: true } });
    expect(host.webContents.send).toHaveBeenCalledWith(IPC.browser.snapshot, { tabId: 'media', dataUrl: null });
    expect(view.setVisible).toHaveBeenLastCalledWith(true);
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(1);
  }));

  it.each(['restore', 'hide', 'close'] as const)('discards an unfinished overlay capture after %s', (action) => setup(async ({ manager, host, view }) => {
    let resolve!: (value: unknown) => void;
    view.webContents.capturePage.mockReturnValue(new Promise(done => { resolve = done; }));
    manager.setVisible({ hostWindow: host, request: { tabId: 'media', visible: true } });
    manager.setVisible({ hostWindow: host, request: { tabId: 'media', visible: false, preserveSnapshot: true } });
    if (action === 'close') manager.detach({ hostWindow: host, tabId: 'media' });
    else manager.setVisible({ hostWindow: host, request: { tabId: 'media', visible: action === 'restore' } });
    host.webContents.send.mockClear(); view.setVisible.mockClear();
    resolve({ isEmpty: () => false, toJPEG: () => Buffer.from('stale') }); await Promise.resolve();
    expect(host.webContents.send).not.toHaveBeenCalled(); expect(view.setVisible).not.toHaveBeenCalled();
  })());

  it.each(['setVisible', 'setVisibleWithoutFocus'] as const)('%s mutes and pauses every frame on hide, and only unmutes on reveal', (method) => setup(async ({ manager, host, view }) => {
    manager[method]({ hostWindow: host, request: { tabId: 'media', visible: true } });
    expect(view.webContents.audioMuted).toBe(false);
    clearFrames(view);
    manager[method]({ hostWindow: host, request: { tabId: 'media', visible: false } });
    expect(view.webContents.audioMuted).toBe(true);
    const pause = vi.fn();
    for (const frame of frames(view)) {
      expect(frame.executeJavaScript).toHaveBeenCalledTimes(1);
      pause.mockClear();
      await runInNewContext(frame.executeJavaScript.mock.calls[0]![0], { document: { querySelectorAll: () => [{ pause }] } });
      expect(pause).toHaveBeenCalledOnce();
    }
    clearFrames(view);
    manager[method]({ hostWindow: host, request: { tabId: 'media', visible: true } });
    expect(view.webContents.audioMuted).toBe(false);
    for (const frame of frames(view)) expect(frame.executeJavaScript).not.toHaveBeenCalled();
  })());

  it('pauses media inside nested open shadow roots and tolerates pages without any', setup(async ({ view }) => {
    const code = frames(view)[0]!.executeJavaScript.mock.calls[0]![0];
    const pause = vi.fn();
    const nestedHost = { shadowRoot: { querySelectorAll: () => [{ pause }] } };
    const outerHost = { shadowRoot: { querySelectorAll: (selector: string) => (selector === '*' ? [nestedHost] : []) } };
    await runInNewContext(code, { document: { querySelectorAll: (selector: string) => (selector === '*' ? [outerHost, { shadowRoot: null }] : []) } });
    expect(pause).toHaveBeenCalledOnce();
    expect(() => runInNewContext(code, { document: { querySelectorAll: () => [] } })).not.toThrow();
  }));

  it('re-pauses playback that starts while hidden but leaves visible playback alone', setup(({ manager, host, view }) => {
    clearFrames(view);
    view.webContents.emit('media-started-playing');
    for (const frame of frames(view)) expect(frame.executeJavaScript).toHaveBeenCalledTimes(1);
    manager.setVisible({ hostWindow: host, request: { tabId: 'media', visible: true } });
    clearFrames(view);
    view.webContents.emit('media-started-playing');
    for (const frame of frames(view)) expect(frame.executeJavaScript).not.toHaveBeenCalled();
  }));

  it('keeps visible media playing through a window resize', setup(async ({ manager, host, view }) => {
    manager.setVisible({ hostWindow: host, request: { tabId: 'media', visible: true } });
    clearFrames(view);
    manager.beginWindowResize(host);
    await vi.waitFor(() => expect(view.webContents.capturePage).toHaveBeenCalled());
    await Promise.resolve();
    manager.endWindowResize(host);
    expect(view.webContents.audioMuted).toBe(false);
    for (const frame of frames(view)) expect(frame.executeJavaScript).not.toHaveBeenCalled();
  }));

  it('skips detached frames and swallows script failures', setup(({ view }) => {
    const [first, second] = frames(view);
    first!.detached = true;
    second!.executeJavaScript.mockRejectedValue(new Error('frame gone'));
    clearFrames(view);
    view.webContents.emit('media-started-playing');
    expect(first!.executeJavaScript).not.toHaveBeenCalled();
    expect(second!.executeJavaScript).toHaveBeenCalledOnce();
  }));

  it('still applies visibility when the frame tree cannot be read', setup(({ manager, host, view }) => {
    manager.setVisible({ hostWindow: host, request: { tabId: 'media', visible: true } });
    Object.defineProperty(view.webContents.mainFrame, 'framesInSubtree', { get() { throw new Error('frame disposed'); } });
    manager.setVisible({ hostWindow: host, request: { tabId: 'media', visible: false } });
    expect(view.webContents.audioMuted).toBe(true);
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
  }));

  it('touches neither audio nor frames once the page is destroyed', setup(({ manager, host, view }) => {
    manager.setVisible({ hostWindow: host, request: { tabId: 'media', visible: true } });
    clearFrames(view);
    view.webContents.destroyed = true;
    manager.setVisible({ hostWindow: host, request: { tabId: 'media', visible: false } });
    view.webContents.emit('media-started-playing');
    expect(view.webContents.audioMuted).toBe(false);
    for (const frame of frames(view)) expect(frame.executeJavaScript).not.toHaveBeenCalled();
  }));

  it('does not script a hidden page whose renderer is not healthy', setup(({ view }) => {
    view.webContents.emit('render-process-gone', {}, { reason: 'launch-failed' });
    clearFrames(view);
    view.webContents.emit('media-started-playing');
    expect(view.webContents.audioMuted).toBe(true);
    for (const frame of frames(view)) expect(frame.executeJavaScript).not.toHaveBeenCalled();
  }));

  it('mutes hidden automation tabs without pausing the media an agent is driving', async () => {
    const host = hostWindow();
    const manager = createDesktopBrowserViewManager({ partition: 'test-media' });
    try {
      manager.createTab({ hostWindow: host, tabId: 'agent', threadId: 'thread', url: 'about:blank', profile: { kind: 'automation', id: 'run' }, viewport: { width: 800, height: 600 } });
      const view = views.at(-1);
      expect(view.webContents.audioMuted).toBe(true);
      view.webContents.emit('media-started-playing');
      manager.setVisibleWithoutFocus({ hostWindow: host, request: { tabId: 'agent', visible: true } });
      expect(view.webContents.audioMuted).toBe(false);
      manager.setVisibleWithoutFocus({ hostWindow: host, request: { tabId: 'agent', visible: false } });
      expect(view.webContents.audioMuted).toBe(true);
      for (const frame of frames(view)) expect(frame.executeJavaScript).not.toHaveBeenCalled();
    } finally { manager.destroyAll(); sessions.clear(); views.length = 0; }
  });

  it.each(['detach', 'destroyAll', 'releaseWindow'] as const)('releases the playback listener when the tab is torn down via %s', (path) => setup(({ manager, host, view }) => {
    expect(view.webContents.listenerCount('media-started-playing')).toBe(1);
    if (path === 'detach') manager.detach({ hostWindow: host, tabId: 'media' });
    else if (path === 'destroyAll') manager.destroyAll();
    else manager.releaseWindow(host.webContents.id);
    expect(view.webContents.listenerCount('media-started-playing')).toBe(0);
    expect(view.webContents.close).toHaveBeenCalledOnce();
  })());
});
