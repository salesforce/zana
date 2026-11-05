import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, Menu } from 'electron';
import { COMPANION_MENU_ID, companionControllerDeps, createCompanionController, createCompanionHost, onVisibleParent, type CompanionControllerHost } from './companion-host.js';

const fakeWin = (over: Partial<Record<'destroyed' | 'minimized', boolean>> = {}) =>
  ({
    isDestroyed: vi.fn(() => over.destroyed === true),
    isMinimized: vi.fn(() => over.minimized === true),
    minimize: vi.fn(),
    restore: vi.fn(),
    showInactive: vi.fn()
  }) as unknown as BrowserWindow & Record<'minimize' | 'restore' | 'showInactive', ReturnType<typeof vi.fn>>;

function setup(over: { platform?: NodeJS.Platform; flag?: boolean; active?: boolean; entered?: boolean; noCompanion?: boolean; menu?: Menu | null } = {}) {
  const rail = {
    enter: vi.fn(() => over.entered ?? true),
    isActive: vi.fn(() => over.active === true),
    hideBehindRail: vi.fn(),
    ownsWindow: vi.fn((w: unknown) => w === railWin)
  };
  const railWin = fakeWin();
  const main = fakeWin();
  let focused: BrowserWindow | null = null;
  const refreshTray = vi.fn();
  const host = createCompanionHost({
    platform: over.platform ?? 'darwin',
    flag: () => over.flag ?? true,
    companion: () => (over.noCompanion ? null : rail),
    focusedWindow: () => focused,
    mainWindow: () => main,
    applicationMenu: () => over.menu ?? null,
    refreshTray
  });
  return { host, rail, railWin, main, refreshTray, focus: (w: BrowserWindow | null) => { focused = w; } };
}

describe('createCompanionHost', () => {
  it('is enabled only on macOS with the opt-in flag on', () => {
    expect(setup().host.enabled()).toBe(true);
    expect(setup({ flag: false }).host.enabled()).toBe(false);
    expect(setup({ platform: 'win32' }).host.enabled()).toBe(false);
  });

  it('enter shows the rail, and falls back to minimizing the focused (or main) window', () => {
    const shown = setup();
    shown.host.enter();
    expect(shown.rail.enter).toHaveBeenCalledOnce();
    expect(shown.main.minimize).not.toHaveBeenCalled();

    const refused = setup({ entered: false });
    const other = fakeWin();
    refused.focus(other);
    refused.host.enter();
    expect(other.minimize).toHaveBeenCalledOnce();

    const none = setup({ noCompanion: true });
    none.host.enter();
    expect(none.main.minimize).toHaveBeenCalledOnce();

    const gone = setup({ noCompanion: true });
    const destroyed = fakeWin({ destroyed: true });
    gone.focus(destroyed);
    gone.host.enter();
    expect(destroyed.minimize).not.toHaveBeenCalled();
  });

  it('syncMenu mirrors the gate onto the Window-menu item and refreshes the tray', () => {
    const item = { visible: true, enabled: true };
    const menu = { getMenuItemById: vi.fn(() => item) } as unknown as Menu;
    const off = setup({ flag: false, menu });
    off.host.syncMenu();
    expect(menu.getMenuItemById).toHaveBeenCalledWith(COMPANION_MENU_ID);
    expect(item).toEqual({ visible: false, enabled: false });
    expect(off.refreshTray).toHaveBeenCalledOnce();

    const noMenu = setup();
    noMenu.host.syncMenu();
    expect(noMenu.refreshTray).toHaveBeenCalledOnce();
  });

  it('routes menu commands to the focused app window, never a companion window', () => {
    const s = setup();
    expect(s.host.focusedAppWindow()).toBe(s.main);
    const app = fakeWin();
    s.focus(app);
    expect(s.host.focusedAppWindow()).toBe(app);
    s.focus(s.railWin);
    expect(s.host.focusedAppWindow()).toBe(s.main);
  });

  it('a minimized window hands off to the rail, or hides behind an active one', () => {
    const win = fakeWin();
    const idle = setup();
    idle.host.onWindowMinimized(win);
    expect(idle.rail.enter).toHaveBeenCalledOnce();

    const active = setup({ active: true });
    active.host.onWindowMinimized(win);
    expect(active.rail.hideBehindRail).toHaveBeenCalledWith(win);
    expect(active.rail.enter).not.toHaveBeenCalled();

    const off = setup({ flag: false });
    off.host.onWindowMinimized(win);
    expect(off.rail.enter).not.toHaveBeenCalled();
    setup({ noCompanion: true }).host.onWindowMinimized(win);
  });

  it('builds the Window-menu item from the same gate, and its click enters', () => {
    const s = setup({ flag: false });
    const item = s.host.menuItem();
    expect(item).toMatchObject({ id: COMPANION_MENU_ID, accelerator: 'Shift+CmdOrCtrl+M', visible: false, enabled: false, acceleratorWorksWhenHidden: false });
    (item.click as () => void)();
    expect(s.rail.enter).toHaveBeenCalledOnce();
    expect(setup().host.menuItem()).toMatchObject({ visible: true, enabled: true });
  });
});

describe('companionControllerDeps', () => {
  function host(over: Partial<CompanionControllerHost> = {}) {
    const h = {
      ptys: {},
      scheduler: {},
      agentStatus: {},
      inboxStore: {},
      triageCache: new Map([['s1', { verdict: 'question' }]]),
      runtime: () => null,
      theme: () => 'dark',
      isEnabled: () => true,
      showMainWindow: vi.fn(),
      sendToApp: vi.fn(),
      preloadPath: '/preload.js',
      logger: vi.fn(),
      store: { listProjects: () => [{ id: 'p1', name: 'Alpha', color: '#f00' }], getConfig: () => ({ companionPlacement: 'right' }), setConfig: vi.fn() },
      windows: new Map(),
      ensureMainWindowReady: vi.fn(async () => true),
      openThread: vi.fn(async () => ({ ok: true })),
      e2e: false,
      ...over
    } as unknown as CompanionControllerHost;
    return { h, deps: companionControllerDeps(h) };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('resolves project names and colors, with a generic fallback', () => {
    const { deps } = host();
    expect(deps.projectName('p1')).toBe('Alpha');
    expect(deps.projectColor('p1')).toBe('#f00');
    expect(deps.projectName('missing')).toBe('project');
    expect(deps.projectColor('missing')).toBeUndefined();
  });

  it('persists the rail placement through the config store', () => {
    const { h, deps } = host();
    const placement = { displayId: 1, edge: 'right', offset: 0.5 } as never;
    deps.savePlacement(placement);
    expect(deps.getPlacement()).toBe('right');
    expect(h.store.setConfig).toHaveBeenCalledWith({ companionPlacement: placement });
  });

  it('opens a thread once the main window is ready', async () => {
    const { h, deps } = host();
    deps.openThread!('t1', 'p1');
    await settle();
    expect(h.showMainWindow).toHaveBeenCalledOnce();
    expect(h.openThread).toHaveBeenCalledWith('t1', 'p1');
    expect(h.logger).not.toHaveBeenCalled();
  });

  it('logs when the renderer never becomes ready, the thread is gone, or opening throws', async () => {
    const notReady = host({ ensureMainWindowReady: vi.fn(async () => false) });
    notReady.deps.openThread!('t1', 'p1');
    await settle();
    expect(notReady.h.openThread).not.toHaveBeenCalled();
    expect(notReady.h.logger).toHaveBeenCalledWith('companion open thread', 'main renderer did not become ready');

    const gone = host({ openThread: vi.fn(async () => null) });
    gone.deps.openThread!('t1', 'p1');
    await settle();
    expect(gone.h.logger).toHaveBeenCalledWith('companion open thread', 'thread unavailable');

    const boom = new Error('boom');
    const failing = host({ openThread: vi.fn(async () => { throw boom; }), logger: undefined });
    failing.deps.openThread!('t1', 'p1');
    await settle();
    const thrown = host({ openThread: vi.fn(async () => { throw boom; }) });
    thrown.deps.openThread!('t1', 'p1');
    await settle();
    expect(thrown.h.logger).toHaveBeenCalledWith('companion open thread', boom);
  });

  it('restores hidden windows without stealing focus, skipping destroyed ones and E2E', () => {
    const { deps } = host();
    const minimized = fakeWin({ minimized: true });
    const plain = fakeWin();
    const destroyed = fakeWin({ destroyed: true });
    deps.restoreWindows([minimized, plain, destroyed]);
    expect(minimized.restore).toHaveBeenCalledOnce();
    expect(minimized.showInactive).toHaveBeenCalledOnce();
    expect(plain.restore).not.toHaveBeenCalled();
    expect(plain.showInactive).toHaveBeenCalledOnce();
    expect(destroyed.showInactive).not.toHaveBeenCalled();

    const e2e = host({ e2e: true });
    const win = fakeWin({ minimized: true });
    e2e.deps.restoreWindows([win]);
    expect(win.showInactive).not.toHaveBeenCalled();
  });

  it('reads triage from main\'s cache and threads from the runtime once booted', () => {
    const { deps } = host();
    expect(deps.triage('s1')).toEqual({ verdict: 'question' });
    expect(deps.triage('missing')).toBeNull();
    const offEarly = deps.onThreadsChanged!(vi.fn());
    expect(offEarly).toBeTypeOf('function');
    offEarly();
    const off = vi.fn();
    const runtime = { onMenubarThreadsChanged: vi.fn(() => off) };
    const listener = vi.fn();
    expect(host({ runtime: () => runtime }).deps.onThreadsChanged!(listener)).toBe(off);
    expect(runtime.onMenubarThreadsChanged).toHaveBeenCalledWith(listener);
  });

  it('passes host services and windows through unchanged', () => {
    const win = fakeWin();
    const { h, deps } = host({ windows: new Map([[1, { win }]]) });
    expect(deps.mainWindows()).toEqual([win]);
    expect(deps.ptys).toBe(h.ptys);
    expect(deps.preloadPath).toBe('/preload.js');
    expect(deps.showMainWindow).toBe(h.showMainWindow);
  });
});

describe('createCompanionController', () => {
  it('constructs the controller on macOS only', () => {
    const made = { start: vi.fn() } as never;
    const make = vi.fn(() => made);
    const h = { store: { listProjects: () => [] } } as unknown as CompanionControllerHost;
    expect(createCompanionController('darwin', h, make)).toBe(made);
    expect(make).toHaveBeenCalledOnce();
    expect(createCompanionController('linux', h, make)).toBeNull();
    expect(make).toHaveBeenCalledOnce();
  });
});

describe('onVisibleParent', () => {
  it('attaches a dialog only to a visible window', () => {
    const win = { isVisible: () => true } as BrowserWindow;
    const hidden = { isVisible: () => false } as BrowserWindow;
    const sheet = (w: BrowserWindow) => w;
    expect(onVisibleParent(win, sheet, () => null)).toBe(win);
    expect(onVisibleParent(hidden, sheet, () => null)).toBeNull();
    expect(onVisibleParent(null, sheet, () => null)).toBeNull();
  });
});
