import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC, type ThreadViewTarget } from '@zana-ai/zcc-desktop-contract';
import { createThreadViewHost, type ThreadViewHostDeps } from './thread-view-host.js';
import type { PluginViewHostWindow } from './plugin-view-host.js';

const target = { threadId: 't-1', projectId: 'p-1' };

function fakeWindow(id: number) {
  return {
    id,
    destroyed: false,
    minimized: false,
    isDestroyed() { return this.destroyed; },
    isMinimized() { return this.minimized; },
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
    webContents: { isDestroyed: () => false, send: vi.fn() }
  };
}
type FakeWindow = ReturnType<typeof fakeWindow> & PluginViewHostWindow;

let windows: Map<number, { win: FakeWindow; threadView?: ThreadViewTarget }>;
let main: FakeWindow;
let deps: ThreadViewHostDeps<FakeWindow> & {
  createWindow: ReturnType<typeof vi.fn>;
  sendToMainWindow: ReturnType<typeof vi.fn>;
  broadcast: ReturnType<typeof vi.fn>;
  logError: ReturnType<typeof vi.fn>;
};

function addWindow(threadView?: ThreadViewTarget): FakeWindow {
  const win = fakeWindow(windows.size + 1) as FakeWindow;
  windows.set(win.id, { win, threadView });
  return win;
}

const threadWindow = () => [...windows.values()].find((entry) => entry.threadView)!.win;

beforeEach(() => {
  windows = new Map();
  main = addWindow();
  deps = {
    windows,
    projectIds: () => ['p-1'],
    createWindow: vi.fn((view: ThreadViewTarget) => { addWindow(view); }),
    sendToMainWindow: vi.fn(),
    broadcast: vi.fn(),
    logError: vi.fn(),
    keepHidden: false
  };
});

describe('open', () => {
  it('opens one window per thread and focuses it the next time', () => {
    const host = createThreadViewHost(deps);
    expect(host.open({ ...target, extra: 'x' })).toBe(true);
    expect(deps.createWindow).toHaveBeenCalledWith(target);
    const view = threadWindow();
    view.minimized = true;
    // Another project id still names the same thread.
    expect(host.open({ threadId: 't-1' })).toBe(true);
    expect(deps.createWindow).toHaveBeenCalledTimes(1);
    expect(view.restore).toHaveBeenCalled();
    expect(view.show).toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalled();
  });

  it('focuses without restoring a window that is not minimized', () => {
    const view = addWindow(target);
    expect(createThreadViewHost(deps).open(target)).toBe(true);
    expect(view.restore).not.toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalled();
  });

  it('opens a fresh window when the old one is already destroyed', () => {
    addWindow(target).destroyed = true;
    expect(createThreadViewHost(deps).open(target)).toBe(true);
    expect(deps.createWindow).toHaveBeenCalledWith(target);
  });

  it('never steals focus in E2E', () => {
    const view = addWindow(target);
    expect(createThreadViewHost({ ...deps, keepHidden: true }).open(target)).toBe(true);
    expect(view.show).not.toHaveBeenCalled();
    expect(view.focus).not.toHaveBeenCalled();
  });

  it('refuses what main cannot authorize and logs why', () => {
    const host = createThreadViewHost(deps);
    expect(host.open({ ...target, projectId: 'p-9' })).toBe(false);
    expect(host.open({ threadId: '../x' })).toBe(false);
    expect(deps.createWindow).not.toHaveBeenCalled();
    expect(deps.logError).toHaveBeenCalledWith('openThreadViewWindow', 'refused: unknown-project');
    expect(deps.logError).toHaveBeenCalledWith('openThreadViewWindow', 'refused: invalid');
  });
});

describe('close, list and broadcast', () => {
  it('closes the window showing a thread and reports when there is none', () => {
    const view = addWindow(target);
    const host = createThreadViewHost(deps);
    expect(host.close({ threadId: 't-1' })).toBe(true);
    expect(view.close).toHaveBeenCalled();
    expect(host.close({ threadId: 't-2' })).toBe(false);
    expect(host.close('junk')).toBe(false);
    expect(main.close).not.toHaveBeenCalled();
  });

  it('lists live thread windows and pushes the set to every window', () => {
    addWindow(target);
    addWindow({ threadId: 't-2' }).destroyed = true;
    const host = createThreadViewHost(deps);
    expect(host.list()).toEqual([target]);
    host.broadcast();
    expect(deps.broadcast).toHaveBeenCalledWith(IPC.windows.onThreadViewsChanged, [target]);
  });
});

describe('routeMenu', () => {
  it('closes a focused thread window on Close Tab and sends the rest to the main window', () => {
    const view = addWindow(target);
    const host = createThreadViewHost(deps);
    expect(host.routeMenu(view, 'app:closeTab', [])).toBe(true);
    expect(view.close).toHaveBeenCalled();
    expect(host.routeMenu(view, 'app:newTab', [1])).toBe(true);
    expect(deps.sendToMainWindow).toHaveBeenCalledWith('app:newTab', [1]);
  });

  it('leaves other windows to the normal routing', () => {
    const host = createThreadViewHost(deps);
    expect(host.routeMenu(main, 'app:closeTab', [])).toBe(false);
    expect(host.routeMenu(null, 'app:closeTab', [])).toBe(false);
    expect(main.close).not.toHaveBeenCalled();
  });
});
