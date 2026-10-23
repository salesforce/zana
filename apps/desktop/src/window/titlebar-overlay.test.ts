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
  windowsTitleBarOverlay,
  type OverlayWindow,
  type WindowsTitleBarOverlay
} from './titlebar-overlay.js';

const css = readFileSync(fileURLToPath(new URL('../../../app/src/styles/global.css', import.meta.url)), 'utf8');

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`no rule ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

function token(selector: string, name: string): string | undefined {
  return rule(selector).match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
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
  it('match the title bar tokens in global.css for both themes', () => {
    expect(WINDOWS_TITLEBAR_OVERLAY_COLORS.dark).toEqual({
      color: token(':root', '--bg-base'),
      symbolColor: token(':root', '--text-muted')
    });
    expect(WINDOWS_TITLEBAR_OVERLAY_COLORS.light).toEqual({
      color: token(":root[data-theme='light']", '--bg-base'),
      symbolColor: token(":root[data-theme='light']", '--text-muted')
    });
  });

  it('sit on the surface every window kind paints under them, at the Windows title bar height', () => {
    // Main and project windows: .titlebar. Thread-view and plugin-view windows: .plugin-view-shell.
    expect(token('.titlebar', 'background')).toBe('var(--bg-base)');
    expect(token('.plugin-view-shell', 'background')).toBe('var(--bg-base)');
    expect(token(".app-shell[data-platform='windows']", '--titlebar-h')).toBe(`${WINDOWS_TITLEBAR_HEIGHT}px`);
    expect(token(".plugin-view-shell[data-platform='windows']", '--titlebar-h')).toBe(`${WINDOWS_TITLEBAR_HEIGHT}px`);
  });

  it('picks the theme colours, or the contrast theme colours when given', () => {
    expect(windowsTitleBarOverlay('light')).toEqual({ color: '#f6f8fa', symbolColor: '#57606a', height: 44 });
    expect(windowsTitleBarOverlay('dark')).toEqual({ color: '#181818', symbolColor: '#8b949e', height: 44 });
    expect(windowsTitleBarOverlay('light', { color: '#000000', symbolColor: '#ffffff' })).toEqual({
      color: '#000000',
      symbolColor: '#ffffff',
      height: 44
    });
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
  it('re-colours live windows, skips destroyed ones and logs a failing window without stopping', () => {
    const first = fakeWindow(1);
    const gone = fakeWindow(2, true);
    const broken = fakeWindow(3);
    const err = new Error('overlay not enabled');
    broken.win.setTitleBarOverlay = () => { throw err; };
    const last = fakeWindow(4);
    const logError = vi.fn();
    const overlay = windowsTitleBarOverlay('light');

    applyWindowsTitleBarOverlay([first.win, gone.win, broken.win, last.win], overlay, logError);

    expect(first.applied).toEqual([overlay]);
    expect(gone.applied).toEqual([]);
    expect(last.applied).toEqual([overlay]);
    expect(logError).toHaveBeenCalledExactlyOnceWith('titleBarOverlay window=3', err);
  });
});

describe('createWindowsTitleBarOverlays', () => {
  function setup(platform: NodeJS.Platform) {
    const nativeTheme = Object.assign(new EventEmitter(), { shouldUseHighContrastColors: false });
    const state = { theme: 'dark' as 'dark' | 'light' };
    const main = fakeWindow(1);
    const project = fakeWindow(2);
    const windows = new Map([[1, { win: main.win }], [2, { win: project.win, projectId: 'p-1' }]]);
    const getColor = vi.fn((name: string) => (name === 'window' ? '#000000ff' : '#ffffffff'));
    const overlays = createWindowsTitleBarOverlays({
      platform,
      windows,
      theme: () => state.theme,
      electron: () => ({ nativeTheme, systemPreferences: { getColor } }),
      logError: vi.fn()
    });
    return { overlays, nativeTheme, state, main, project, windows, getColor };
  }

  it('gives new windows the overlay for the current theme', () => {
    const { overlays, state, nativeTheme, getColor } = setup('win32');
    expect(overlays.current()).toEqual(windowsTitleBarOverlay('dark'));
    state.theme = 'light';
    expect(overlays.current()).toEqual(windowsTitleBarOverlay('light'));
    expect(getColor).not.toHaveBeenCalled();
    nativeTheme.shouldUseHighContrastColors = true;
    expect(overlays.current()).toEqual({ color: '#000000', symbolColor: '#ffffff', height: 44 });
  });

  it('falls back to the default dark colours, with a log line, when the theme read fails', () => {
    const err = new Error('nativeTheme unavailable');
    const logError = vi.fn();
    const overlays = createWindowsTitleBarOverlays({
      platform: 'win32',
      windows: new Map(),
      theme: () => { throw err; },
      electron: () => ({ nativeTheme: Object.assign(new EventEmitter(), { shouldUseHighContrastColors: false }), systemPreferences: { getColor: () => '' } }),
      logError
    });
    expect(overlays.current()).toEqual(windowsTitleBarOverlay('dark'));
    expect(logError).toHaveBeenCalledWith('titleBarOverlay theme', err);
  });

  it('re-colours every registered window when the Theme setting changes', () => {
    const { overlays, state, main, project } = setup('win32');
    state.theme = 'light';
    overlays.refresh();
    expect(main.applied).toEqual([windowsTitleBarOverlay('light')]);
    expect(project.applied).toEqual([windowsTitleBarOverlay('light')]);
  });

  it('follows OS appearance changes until unsubscribed, including windows opened later', () => {
    const { overlays, nativeTheme, state, main, windows } = setup('win32');
    const stop = overlays.bind();
    const later = fakeWindow(3);
    windows.set(3, { win: later.win });
    state.theme = 'light';
    nativeTheme.emit('updated');
    expect(main.applied).toEqual([windowsTitleBarOverlay('light')]);
    expect(later.applied).toEqual([windowsTitleBarOverlay('light')]);

    stop();
    expect(nativeTheme.listenerCount('updated')).toBe(0);
    nativeTheme.emit('updated');
    expect(main.applied).toHaveLength(1);
  });

  it('never touches a window on macOS and Linux, which have no overlay', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const { overlays, nativeTheme, main, getColor } = setup(platform);
      const stop = overlays.bind();
      nativeTheme.shouldUseHighContrastColors = true;
      nativeTheme.emit('updated');
      overlays.refresh();
      stop();
      expect(nativeTheme.listenerCount('updated')).toBe(0);
      expect(main.applied).toEqual([]);
      expect(getColor).not.toHaveBeenCalled();
    }
  });

  it('logs and carries on when the OS appearance listener cannot be attached', () => {
    const err = new Error('nativeTheme unavailable');
    const logError = vi.fn();
    const overlays = createWindowsTitleBarOverlays({
      platform: 'win32',
      windows: new Map(),
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
      theme: () => 'light',
      electron: () => ({ nativeTheme: Object.assign(new EventEmitter(), { shouldUseHighContrastColors: false }), systemPreferences: { getColor: () => '' } }),
      logError: vi.fn()
    });
    overlays.refresh();
    platform = 'win32';
    overlays.refresh();
    expect(main.applied).toEqual([windowsTitleBarOverlay('light')]);
  });
});
