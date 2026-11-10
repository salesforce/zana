/**
 * Colours for the Windows title bar overlay (the native minimize / maximize /
 * close buttons). Electron paints it from `color` and `symbolColor`, outside the
 * renderer's CSS, so main re-themes it whenever the effective theme changes.
 *
 * The buttons must sit on the colour the window's own title bar paints, which
 * depends on the window kind (checked against the CSS by
 * titlebar-overlay.test.ts):
 * - `inset-chrome`: main and project windows. The desktop shell is the inset
 *   workspace, whose `.titlebar` paints --inset-chrome
 *   (apps/app/src/styles/shell-inset.css).
 * - `bg-base`: thread view and plugin view windows (`.plugin-view-shell`) and
 *   the startup repair screen, which paint --bg-base
 *   (apps/app/src/styles/global.css).
 * Text is --text-muted on both, in `:root` (dark) and
 * `:root[data-theme='light']`; the height is the Windows --titlebar-h (44px).
 */
import { BG_BASE, type EffectiveTheme } from './window-theme.js';

export const WINDOWS_TITLEBAR_HEIGHT = 44;

/** --inset-chrome in shell-inset.css, dark and light. */
export const INSET_CHROME = {
  dark: '#131313',
  light: '#edf0f4'
} as const satisfies Record<EffectiveTheme, string>;

const TEXT_MUTED = {
  dark: '#8b949e',
  light: '#57606a'
} as const satisfies Record<EffectiveTheme, string>;

export type TitleBarSurface = 'inset-chrome' | 'bg-base';

export const WINDOWS_TITLEBAR_OVERLAY_COLORS = {
  'inset-chrome': {
    dark: { color: INSET_CHROME.dark, symbolColor: TEXT_MUTED.dark },
    light: { color: INSET_CHROME.light, symbolColor: TEXT_MUTED.light }
  },
  'bg-base': {
    dark: { color: BG_BASE.dark, symbolColor: TEXT_MUTED.dark },
    light: { color: BG_BASE.light, symbolColor: TEXT_MUTED.light }
  }
} as const satisfies Record<TitleBarSurface, Record<EffectiveTheme, { color: string; symbolColor: string }>>;

/** The fields of a window registry entry that decide what its title bar shows. */
export interface TitleBarWindowKind {
  view?: unknown;
  threadView?: unknown;
}

/**
 * The surface under a window's caption buttons. Thread and plugin view windows,
 * and the window showing the startup repair screen, paint --bg-base; main and
 * project windows paint the inset workspace's --inset-chrome.
 */
export function titleBarSurface(kind: TitleBarWindowKind, repairing: boolean): TitleBarSurface {
  return kind.view || kind.threadView || repairing ? 'bg-base' : 'inset-chrome';
}

export interface TitleBarOverlayColors {
  color: string;
  symbolColor: string;
}

export interface WindowsTitleBarOverlay extends TitleBarOverlayColors {
  height: number;
}

/**
 * The overlay for a title bar surface in the effective theme. In a Windows
 * contrast theme Chromium forces every page surface to the system Window /
 * WindowText colours, so the overlay takes those instead (when they could be
 * read), whatever the surface.
 */
export function windowsTitleBarOverlay(
  surface: TitleBarSurface,
  theme: EffectiveTheme,
  highContrast: TitleBarOverlayColors | null = null
): WindowsTitleBarOverlay {
  const colors = highContrast ?? WINDOWS_TITLEBAR_OVERLAY_COLORS[surface][theme];
  return { color: colors.color, symbolColor: colors.symbolColor, height: WINDOWS_TITLEBAR_HEIGHT };
}

const HEX_RGB = /^#[0-9a-f]{6}/i;

/**
 * The contrast theme's Window / WindowText colours as `#rrggbb`, via
 * `systemPreferences.getColor`, which reports `#rrggbbaa`. Null, with a log
 * line, when either can't be read, so the caller keeps the theme colours.
 */
export function highContrastOverlayColors(
  readSystemColor: (name: 'window' | 'window-text') => string,
  logError: (context: string, err: unknown) => void
): TitleBarOverlayColors | null {
  try {
    const color = readSystemColor('window').match(HEX_RGB)?.[0];
    const symbolColor = readSystemColor('window-text').match(HEX_RGB)?.[0];
    if (color && symbolColor) return { color, symbolColor };
    logError('titleBarOverlay high contrast', `unexpected system colours window=${color} window-text=${symbolColor}`);
  } catch (err) {
    logError('titleBarOverlay high contrast', err);
  }
  return null;
}

export interface OverlayWindow {
  id: number;
  isDestroyed(): boolean;
  setTitleBarOverlay(options: WindowsTitleBarOverlay): void;
}

/**
 * Re-colour every live window with the overlay for its title bar surface; one
 * failing window doesn't stop the rest.
 */
export function applyWindowsTitleBarOverlay(
  windows: Iterable<{ win: OverlayWindow; surface: TitleBarSurface }>,
  overlay: (surface: TitleBarSurface) => WindowsTitleBarOverlay,
  logError: (context: string, err: unknown) => void
): void {
  for (const { win, surface } of windows) {
    if (win.isDestroyed()) continue;
    try {
      win.setTitleBarOverlay(overlay(surface));
    } catch (err) {
      logError(`titleBarOverlay window=${win.id}`, err);
    }
  }
}

interface ThemeEvents {
  shouldUseHighContrastColors: boolean;
  on(event: 'updated', listener: () => void): unknown;
  off(event: 'updated', listener: () => void): unknown;
}

export interface WindowsTitleBarOverlayDeps {
  /** Read on every refresh. */
  readonly platform: NodeJS.Platform;
  /** The live window registry; read on every refresh. */
  windows: { values(): Iterable<TitleBarWindowKind & { win: OverlayWindow }> };
  /** Whether startup is paused for repair, so the unscoped window shows the repair screen. */
  repairing: () => boolean;
  /** The effective app theme (Theme setting, with System resolved). */
  theme: () => EffectiveTheme;
  /** Electron's theme APIs, read lazily and only on Windows. */
  electron: () => {
    nativeTheme: ThemeEvents;
    systemPreferences: { getColor(name: 'window' | 'window-text'): string };
  };
  logError: (context: string, err: unknown) => void;
}

/**
 * The overlay for a new window (`current`, given its registry entry), a
 * re-colour of every open window (`refresh`, after the Theme setting changes or
 * startup repair finishes), and the OS appearance listener (`bind`: light/dark
 * while Theme is System, and contrast themes). `bind` is called once at app
 * init and returns its unsubscribe for shutdown. Off Windows there is no
 * overlay, so `refresh` does nothing.
 */
export function createWindowsTitleBarOverlays(deps: WindowsTitleBarOverlayDeps) {
  const surfaceOf = (kind: TitleBarWindowKind) => titleBarSurface(kind, deps.repairing());
  // A failed theme read must not stop a window from opening: fall back to the
  // default (dark) theme's colours.
  const overlayFor = (surface: TitleBarSurface) => {
    try {
      const { nativeTheme, systemPreferences } = deps.electron();
      return windowsTitleBarOverlay(
        surface,
        deps.theme(),
        nativeTheme.shouldUseHighContrastColors
          ? highContrastOverlayColors((name) => systemPreferences.getColor(name), deps.logError)
          : null
      );
    } catch (err) {
      deps.logError('titleBarOverlay theme', err);
      return windowsTitleBarOverlay(surface, 'dark');
    }
  };
  const current = (kind: TitleBarWindowKind) => overlayFor(surfaceOf(kind));
  const refresh = () => {
    if (deps.platform !== 'win32') return;
    const windows = Array.from(deps.windows.values(), (entry) => ({ win: entry.win, surface: surfaceOf(entry) }));
    // One theme read per surface per refresh, shared by the windows on it.
    const overlays = new Map<TitleBarSurface, WindowsTitleBarOverlay>();
    const overlay = (surface: TitleBarSurface) => {
      const cached = overlays.get(surface);
      if (cached) return cached;
      const fresh = overlayFor(surface);
      overlays.set(surface, fresh);
      return fresh;
    };
    applyWindowsTitleBarOverlay(windows, overlay, deps.logError);
  };
  // Subscribes on every platform, like the tray's theme listener, so the boot
  // wiring is the same everywhere; `refresh` itself does nothing off Windows.
  // A failed subscription must not abort boot: log it and carry on.
  const bind = () => {
    try {
      const { nativeTheme } = deps.electron();
      nativeTheme.on('updated', refresh);
      return () => {
        nativeTheme.off('updated', refresh);
      };
    } catch (err) {
      deps.logError('titleBarOverlay bind', err);
      return () => {};
    }
  };
  return { current, refresh, bind };
}
