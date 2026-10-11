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
