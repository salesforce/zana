import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  WINDOWS_TITLEBAR_HEIGHT,
  WINDOWS_TITLEBAR_OVERLAY_COLORS,
  applyWindowsTitleBarOverlay,
  createWindowsTitleBarOverlays,
  highContrastOverlayColors,
  titleBarSurface,
  windowsTitleBarOverlay,
  type OverlayWindow,
  type TitleBarSurface,
  type WindowsTitleBarOverlay
} from './titlebar-overlay.js';

const appSourceFile = (path: string) => readFileSync(fileURLToPath(new URL(`../../../app/src/${path}`, import.meta.url)), 'utf8');
const css = appSourceFile('styles/global.css');
const insetCss = appSourceFile('styles/shell-inset.css');
const appSource = appSourceFile('App.tsx');
const HIGH_CONTRAST = { color: '#000000', symbolColor: '#ffffff' };

/** The declarations of the first rule in `source` whose selector list is exactly `selector`. */
function rule(selector: string, source = css): string {
  const start = source.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`no rule ${selector}`);
  return source.slice(start, source.indexOf('}', start));
}

function token(selector: string, name: string, source = css): string | undefined {
  return rule(selector, source).match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
}

/**
 * The colour the inset workspace's title bar paints: the `.titlebar` rule's
 * background in shell-inset.css, resolved through --inset-chrome for `theme`.
 */
function insetTitleBarColor(theme: 'dark' | 'light'): string | undefined {
  const background = token('.app-shell.shell-inset .titlebar,\n.app-shell.shell-inset .statusbar', 'background', insetCss);
  const variable = background?.match(/^var\((--[\w-]+)\)$/)?.[1];
  if (!variable) return background;
  const scope = theme === 'dark' ? '.app-shell.shell-inset' : ":root[data-theme='light'] .app-shell.shell-inset";
  return token(scope, variable, insetCss);
}

function fakeWindow(id: number, destroyed = false) {
  const applied: WindowsTitleBarOverlay[] = [];
  const win: OverlayWindow = {
    id,
    isDestroyed: () => destroyed,
    setTitleBarOverlay: (options) => {
      applied.push(options);
    }
  };
  return { win, applied };
}

describe('Windows title bar overlay colours', () => {
  it('match the colours each title bar paints, for both themes', () => {
    for (const theme of ['dark', 'light'] as const) {
      const root = theme === 'dark' ? ':root' : ":root[data-theme='light']";
      const symbolColor = token(root, '--text-muted');
      // Main and project windows: the inset workspace's .titlebar (#610).
      expect(WINDOWS_TITLEBAR_OVERLAY_COLORS['inset-chrome'][theme]).toEqual({ color: insetTitleBarColor(theme), symbolColor });
      // Thread view and plugin view windows, and the startup repair screen.
      expect(WINDOWS_TITLEBAR_OVERLAY_COLORS['bg-base'][theme]).toEqual({ color: token(root, '--bg-base'), symbolColor });
    }
  });

  it('sit on the surface every window kind paints under them, at the Windows title bar height', () => {
    // App.tsx puts the shell in the inset workspace unless the layout is compact, and the
    // compact layout never applies on the desktop surface (every Electron window's preload
    // exposes the desktop bridge), so a narrowed main or project window keeps
    // --inset-chrome. If desktop windows could go compact, their title bar would paint
    // --bg-base and the overlay would need to follow the layout.
    expect(appSource).toMatch(/!mobileNavigation\.isCompact \? ' shell-inset' : ''/);
    expect(appSource).toMatch(/const mobileNavigation = useMobileNavigation\(\);/);
    expect(appSourceFile('components/MobileShellChrome.tsx')).toMatch(/const isCompact = useCompactLayout\(\);/);
    expect(appSourceFile('hooks/useCompactLayout.ts')).toMatch(/return getAppSurface\(\) !== 'desktop' && /);
    expect(token('.plugin-view-shell', 'background')).toBe('var(--bg-base)');
    // The repair screen paints nothing itself, so it shows html/body's --bg-base (window-theme.test.ts).
    expect(token('.startup-repair', 'background')).toBeUndefined();
    expect(token(".app-shell[data-platform='windows']", '--titlebar-h')).toBe(`${WINDOWS_TITLEBAR_HEIGHT}px`);
    expect(token(".plugin-view-shell[data-platform='windows']", '--titlebar-h')).toBe(`${WINDOWS_TITLEBAR_HEIGHT}px`);
  });

  it('picks the surface for each window kind', () => {
    expect(titleBarSurface({}, false)).toBe('inset-chrome');
    expect(titleBarSurface({ view: { pluginId: 'p' } }, false)).toBe('bg-base');
    expect(titleBarSurface({ threadView: { threadId: 't-1' } }, false)).toBe('bg-base');
    expect(titleBarSurface({}, true)).toBe('bg-base');
  });

  it('picks the surface and theme colours, or the contrast theme colours whatever the surface', () => {
    expect(windowsTitleBarOverlay('inset-chrome', 'light')).toEqual({ color: '#edf0f4', symbolColor: '#57606a', height: 44 });
    expect(windowsTitleBarOverlay('inset-chrome', 'dark')).toEqual({ color: '#131313', symbolColor: '#8b949e', height: 44 });
    expect(windowsTitleBarOverlay('bg-base', 'light')).toEqual({ color: '#f6f8fa', symbolColor: '#57606a', height: 44 });
    expect(windowsTitleBarOverlay('bg-base', 'dark')).toEqual({ color: '#181818', symbolColor: '#8b949e', height: 44 });
    for (const surface of ['inset-chrome', 'bg-base'] as const) {
      expect(windowsTitleBarOverlay(surface, 'light', HIGH_CONTRAST)).toEqual({ ...HIGH_CONTRAST, height: 44 });
    }
  });
});

describe('highContrastOverlayColors', () => {
  it('reads Window / WindowText and drops the alpha byte', () => {
    const colours: Record<string, string> = { window: '#000000ff', 'window-text': '#FFFF00FF' };
    expect(highContrastOverlayColors((name) => colours[name], vi.fn())).toEqual({ color: '#000000', symbolColor: '#FFFF00' });
  });

  it('logs and falls back when a colour is malformed', () => {
    const logError = vi.fn();
    expect(highContrastOverlayColors((name) => (name === 'window' ? '' : '#ffffff'), logError)).toBeNull();
    expect(logError).toHaveBeenCalledWith('titleBarOverlay high contrast', 'unexpected system colours window=undefined window-text=#ffffff');
  });

  it('logs and falls back when the read throws', () => {
    const logError = vi.fn();
    const err = new Error('no such color');
    expect(highContrastOverlayColors(() => { throw err; }, logError)).toBeNull();
    expect(logError).toHaveBeenCalledWith('titleBarOverlay high contrast', err);
  });
});

describe('applyWindowsTitleBarOverlay', () => {
  it('re-colours live windows for their surface, skips destroyed ones and logs a failing window without stopping', () => {
    const first = fakeWindow(1);
    const gone = fakeWindow(2, true);
    const broken = fakeWindow(3);
    const err = new Error('overlay not enabled');
    broken.win.setTitleBarOverlay = () => { throw err; };
    const last = fakeWindow(4);
    const logError = vi.fn();
    const overlay = (surface: TitleBarSurface) => windowsTitleBarOverlay(surface, 'light');

    applyWindowsTitleBarOverlay(
      [
        { win: first.win, surface: 'inset-chrome' },
        { win: gone.win, surface: 'inset-chrome' },
        { win: broken.win, surface: 'bg-base' },
        { win: last.win, surface: 'bg-base' }
      ],
      overlay,
      logError
    );

    expect(first.applied).toEqual([overlay('inset-chrome')]);
    expect(gone.applied).toEqual([]);
    expect(last.applied).toEqual([overlay('bg-base')]);
    expect(logError).toHaveBeenCalledExactlyOnceWith('titleBarOverlay window=3', err);
  });
});

describe('createWindowsTitleBarOverlays', () => {
  function plainTheme() {
    return Object.assign(new EventEmitter(), { shouldUseHighContrastColors: false });
  }

  function setup(platform: NodeJS.Platform) {
    const nativeTheme = plainTheme();
    const state = { theme: 'dark' as 'dark' | 'light', repairing: false };
    const main = fakeWindow(1);
    const project = fakeWindow(2);
    const thread = fakeWindow(3);
    const plugin = fakeWindow(4);
    const windows = new Map<number, { win: OverlayWindow; projectId?: string; view?: unknown; threadView?: unknown }>([
      [1, { win: main.win }],
      [2, { win: project.win, projectId: 'p-1' }],
      [3, { win: thread.win, threadView: { threadId: 't-1' } }],
      [4, { win: plugin.win, projectId: 'p-1', view: { pluginId: 'docs' } }]
    ]);
    const getColor = vi.fn((name: string) => (name === 'window' ? '#000000ff' : '#ffffffff'));
    const theme = vi.fn(() => state.theme);
    const overlays = createWindowsTitleBarOverlays({
      platform,
      windows,
      repairing: () => state.repairing,
      theme,
      electron: () => ({ nativeTheme, systemPreferences: { getColor } }),
      logError: vi.fn()
    });
    return { overlays, nativeTheme, state, main, project, thread, plugin, windows, getColor, theme };
  }

  it('gives a new window the overlay for its surface and the current theme', () => {
    const { overlays, state, nativeTheme, getColor } = setup('win32');
    expect(overlays.current({})).toEqual(windowsTitleBarOverlay('inset-chrome', 'dark'));
    expect(overlays.current({ threadView: { threadId: 't-1' } })).toEqual(windowsTitleBarOverlay('bg-base', 'dark'));
    state.theme = 'light';
    expect(overlays.current({})).toEqual(windowsTitleBarOverlay('inset-chrome', 'light'));
    expect(overlays.current({ view: { pluginId: 'docs' } })).toEqual(windowsTitleBarOverlay('bg-base', 'light'));
    state.repairing = true;
    expect(overlays.current({})).toEqual(windowsTitleBarOverlay('bg-base', 'light'));
    expect(getColor).not.toHaveBeenCalled();
    nativeTheme.shouldUseHighContrastColors = true;
    expect(overlays.current({})).toEqual({ ...HIGH_CONTRAST, height: 44 });
  });

  it('falls back to the default dark colours of the surface, with a log line, when the theme read fails', () => {
    const err = new Error('nativeTheme unavailable');
    const logError = vi.fn();
    const overlays = createWindowsTitleBarOverlays({
      platform: 'win32',
      windows: new Map(),
      repairing: () => false,
      theme: () => { throw err; },
      electron: () => ({ nativeTheme: plainTheme(), systemPreferences: { getColor: () => '' } }),
      logError
    });
    expect(overlays.current({})).toEqual(windowsTitleBarOverlay('inset-chrome', 'dark'));
    expect(overlays.current({ threadView: {} })).toEqual(windowsTitleBarOverlay('bg-base', 'dark'));
    expect(logError).toHaveBeenCalledWith('titleBarOverlay theme', err);
  });

  it('re-colours every registered window for its surface when the Theme setting changes, reading the theme once per surface', () => {
    const { overlays, state, main, project, thread, plugin, theme } = setup('win32');
    state.theme = 'light';
    overlays.refresh();
    expect(main.applied).toEqual([windowsTitleBarOverlay('inset-chrome', 'light')]);
    expect(project.applied).toEqual([windowsTitleBarOverlay('inset-chrome', 'light')]);
    expect(thread.applied).toEqual([windowsTitleBarOverlay('bg-base', 'light')]);
    expect(plugin.applied).toEqual([windowsTitleBarOverlay('bg-base', 'light')]);
    expect(theme).toHaveBeenCalledTimes(2);
  });

  it('moves the main window to the inset surface when startup repair finishes', () => {
    const { overlays, state, main } = setup('win32');
    state.repairing = true;
    overlays.refresh();
    state.repairing = false;
    overlays.refresh();
    expect(main.applied).toEqual([windowsTitleBarOverlay('bg-base', 'dark'), windowsTitleBarOverlay('inset-chrome', 'dark')]);
  });

  it('follows OS appearance changes until unsubscribed, including windows opened later', () => {
    const { overlays, nativeTheme, state, main, windows } = setup('win32');
    const stop = overlays.bind();
    const later = fakeWindow(5);
    windows.set(5, { win: later.win, threadView: { threadId: 't-2' } });
    state.theme = 'light';
    nativeTheme.emit('updated');
    expect(main.applied).toEqual([windowsTitleBarOverlay('inset-chrome', 'light')]);
    expect(later.applied).toEqual([windowsTitleBarOverlay('bg-base', 'light')]);

    stop();
    expect(nativeTheme.listenerCount('updated')).toBe(0);
    nativeTheme.emit('updated');
    expect(main.applied).toHaveLength(1);
  });

  it('gives every surface the contrast theme colours', () => {
    const { overlays, nativeTheme, main, thread } = setup('win32');
    nativeTheme.shouldUseHighContrastColors = true;
    overlays.refresh();
    expect(main.applied).toEqual([{ ...HIGH_CONTRAST, height: 44 }]);
    expect(thread.applied).toEqual([{ ...HIGH_CONTRAST, height: 44 }]);
  });

  it('never touches a window on macOS and Linux, which have no overlay', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const { overlays, nativeTheme, main, thread, getColor } = setup(platform);
      const stop = overlays.bind();
      nativeTheme.shouldUseHighContrastColors = true;
      nativeTheme.emit('updated');
      overlays.refresh();
      stop();
      expect(nativeTheme.listenerCount('updated')).toBe(0);
      expect(main.applied).toEqual([]);
      expect(thread.applied).toEqual([]);
      expect(getColor).not.toHaveBeenCalled();
    }
  });

  it('logs and carries on when the OS appearance listener cannot be attached', () => {
    const err = new Error('nativeTheme unavailable');
    const logError = vi.fn();
    const overlays = createWindowsTitleBarOverlays({
      platform: 'win32',
      windows: new Map(),
      repairing: () => false,
      theme: () => 'dark',
      electron: () => { throw err; },
      logError
    });
    const stop = overlays.bind();
    expect(logError).toHaveBeenCalledExactlyOnceWith('titleBarOverlay bind', err);
    expect(stop).not.toThrow();
  });

  it('reads the platform on every refresh', () => {
    const main = fakeWindow(1);
    let platform: NodeJS.Platform = 'linux';
    const overlays = createWindowsTitleBarOverlays({
      get platform() { return platform; },
      windows: new Map([[1, { win: main.win }]]),
      repairing: () => false,
      theme: () => 'light',
      electron: () => ({ nativeTheme: plainTheme(), systemPreferences: { getColor: () => '' } }),
      logError: vi.fn()
    });
    overlays.refresh();
    platform = 'win32';
    overlays.refresh();
    expect(main.applied).toEqual([windowsTitleBarOverlay('inset-chrome', 'light')]);
  });
});
