import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC, type PluginViewTarget } from '@zana-ai/zcc-desktop-contract';
import { createPluginViewHost, type PluginViewHostDeps, type PluginViewHostWindow } from './plugin-view-host.js';

const target = { pluginId: 'salesforce', tabId: 'studio', projectId: 'p-1' };
const app = { id: 'salesforce', enabled: true, status: 'running', appUrl: '/plugins/salesforce/app.js' };

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
    webContents: { destroyed: false, isDestroyed() { return this.destroyed; }, send: vi.fn() }
  };
}
type FakeWindow = ReturnType<typeof fakeWindow> & PluginViewHostWindow;

let windows: Map<number, { win: FakeWindow; view?: PluginViewTarget }>;
let main: FakeWindow | null;
let deps: PluginViewHostDeps<FakeWindow> & {
  createWindow: ReturnType<typeof vi.fn>;
  broadcast: ReturnType<typeof vi.fn>;
  logError: ReturnType<typeof vi.fn>;
  showMainWindow: ReturnType<typeof vi.fn>;
  ensureMainWindowReady: ReturnType<typeof vi.fn>;
};

function addWindow(view?: PluginViewTarget): FakeWindow {
  const win = fakeWindow(windows.size + 1) as FakeWindow;
  windows.set(win.id, { win, view });
  return win;
}

beforeEach(() => {
  windows = new Map();
  main = addWindow();
  deps = {
    windows,
    listApps: async () => [app],
    projectIds: () => ['p-1'],
    createWindow: vi.fn((view: PluginViewTarget) => { addWindow(view); }),
    ensureMainWindowReady: vi.fn(async () => true),
    mainWindow: () => main,
    showMainWindow: vi.fn(),
    broadcast: vi.fn(),
    logError: vi.fn(),
    keepHidden: false
  };
});

describe('open', () => {
  it('opens resources independently, deduplicates overlapping requests and closes only the addressed resource', async () => {
    const host = createPluginViewHost(deps);
    const a = { ...target, resourceId: 'agents/Help.agent' };
    const b = { ...target, resourceId: 'agents/Quote.agent' };
    await Promise.all([host.open(a), host.open(a), host.open(b), host.open(target)]);
    expect(deps.createWindow).toHaveBeenCalledTimes(3);
    expect(host.list()).toEqual([a, b, target]);
    const entries = [...windows.values()].filter((entry) => entry.view);
    expect(host.close({ ...a, resourceId: 'missing' })).toBe(false);
    expect(host.close(a)).toBe(true);
    expect(entries[0]!.win.close).toHaveBeenCalledTimes(1);
    expect(entries[1]!.win.close).not.toHaveBeenCalled();
    expect(entries[2]!.win.close).not.toHaveBeenCalled();
    await expect(host.open({ ...a, resourceId: 'bad\n' })).resolves.toBe(false);
    expect(deps.createWindow).toHaveBeenCalledTimes(3);
  });
  it('opens one window per authorized tab and focuses it the next time', async () => {
    const host = createPluginViewHost(deps);
    await expect(host.open({ ...target, extra: 'x' })).resolves.toBe(true);
    expect(deps.createWindow).toHaveBeenCalledWith(target);
    const view = [...windows.values()].find((entry) => entry.view)!.win;
    view.minimized = true;
    await expect(host.open(target)).resolves.toBe(true);
    expect(deps.createWindow).toHaveBeenCalledTimes(1);
    expect(view.restore).toHaveBeenCalled();
    expect(view.show).toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalled();
  });

  it('opens a fresh window when the old one is already destroyed', async () => {
    addWindow(target).destroyed = true;
    await expect(createPluginViewHost(deps).open(target)).resolves.toBe(true);
    expect(deps.createWindow).toHaveBeenCalledWith(target);
  });

  it('never steals focus in E2E', async () => {
    const view = addWindow(target);
    await expect(createPluginViewHost({ ...deps, keepHidden: true }).open(target)).resolves.toBe(true);
    expect(view.show).not.toHaveBeenCalled();
    expect(view.focus).not.toHaveBeenCalled();
  });

  it('refuses what main cannot authorize and logs why', async () => {
    const host = createPluginViewHost(deps);
    await expect(host.open({ ...target, projectId: 'p-9' })).resolves.toBe(false);
    await expect(host.open({ ...target, pluginId: 'BAD' })).resolves.toBe(false);
    expect(deps.createWindow).not.toHaveBeenCalled();
    expect(deps.logError).toHaveBeenCalledWith('openPluginViewWindow', 'refused: unknown-project');
    expect(deps.logError).toHaveBeenCalledWith('openPluginViewWindow', 'refused: invalid');
  });
});

describe('list and broadcast', () => {
  it('lists live view windows only and broadcasts them to every window', () => {
    addWindow(target);
    addWindow({ ...target, tabId: 'gone' }).destroyed = true;
    const host = createPluginViewHost(deps);
    expect(host.list()).toEqual([target]);
    host.broadcast();
    expect(deps.broadcast).toHaveBeenCalledWith(IPC.windows.onPluginViewsChanged, [target]);
  });
});

describe('close', () => {
  it('closes the matching window and ignores anything else', () => {
    const view = addWindow(target);
    const host = createPluginViewHost(deps);
    expect(host.close({ ...target, tabId: 'other' })).toBe(false);
    expect(host.close('nope')).toBe(false);
    expect(host.close(target)).toBe(true);
    expect(view.close).toHaveBeenCalledTimes(1);
  });
});

describe('showPath', () => {
  it('navigates the main window to a relative path and brings it forward', async () => {
    await expect(createPluginViewHost(deps).showPath('/projects/p-1')).resolves.toBe(true);
    expect(main!.webContents.send).toHaveBeenCalledWith(IPC.windows.onNavigate, '/projects/p-1');
    expect(deps.showMainWindow).toHaveBeenCalled();
  });

  it('refuses paths that leave the app and a main window that is not there', async () => {
    const host = createPluginViewHost(deps);
    await expect(host.showPath('https://example.com')).resolves.toBe(false);
    await expect(host.showPath('//evil')).resolves.toBe(false);
    deps.ensureMainWindowReady.mockResolvedValueOnce(false);
    await expect(host.showPath('/projects/p-1')).resolves.toBe(false);
    main!.webContents.destroyed = true;
    await expect(host.showPath('/projects/p-1')).resolves.toBe(false);
    main = null;
    await expect(host.showPath('/projects/p-1')).resolves.toBe(false);
    expect(deps.showMainWindow).not.toHaveBeenCalled();
  });

  it('logs a failed send and leaves the main window where it is', async () => {
    main!.webContents.send.mockImplementationOnce(() => { throw new Error('gone'); });
    await expect(createPluginViewHost(deps).showPath('/projects/p-1')).resolves.toBe(false);
    expect(deps.logError).toHaveBeenCalledWith('showPathInMainWindow', expect.any(Error));
    expect(deps.showMainWindow).not.toHaveBeenCalled();
  });
});

describe('routeMenu', () => {
  it('leaves the main window and project windows to the normal menu path', () => {
    const host = createPluginViewHost(deps);
    expect(host.routeMenu(null, 'app:newTab', [])).toBe(false);
    expect(host.routeMenu(main, 'app:newTab', [])).toBe(false);
  });

  it('closes a focused view window on Close Tab', () => {
    const view = addWindow(target);
    expect(createPluginViewHost(deps).routeMenu(view, 'app:closeTab', [])).toBe(true);
    expect(view.close).toHaveBeenCalled();
    expect(main!.webContents.send).not.toHaveBeenCalled();
  });

  it('runs any other command in the main window', async () => {
    const view = addWindow(target);
    expect(createPluginViewHost(deps).routeMenu(view, 'app:openSettings', ['plugins'])).toBe(true);
    await vi.waitFor(() => expect(main!.webContents.send).toHaveBeenCalledWith('app:openSettings', 'plugins'));
    expect(deps.showMainWindow).toHaveBeenCalled();
    expect(view.close).not.toHaveBeenCalled();
  });

  it('logs a menu command the main window could not take', async () => {
    const view = addWindow(target);
    main!.webContents.send.mockImplementationOnce(() => { throw new Error('gone'); });
    createPluginViewHost(deps).routeMenu(view, 'app:newTab', []);
    await vi.waitFor(() => expect(deps.logError).toHaveBeenCalledWith('sendToMainWindow app:newTab', expect.any(Error)));
    expect(deps.showMainWindow).not.toHaveBeenCalled();
  });
});
