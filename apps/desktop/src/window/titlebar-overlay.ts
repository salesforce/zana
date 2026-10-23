/**
 * Colours for the Windows title bar overlay (the native minimize / maximize /
 * close buttons). Electron paints it from `color` and `symbolColor`, outside the
 * renderer's CSS, so main re-themes it whenever the effective theme changes.
 *
 * Must match the CSS tokens in apps/app/src/styles/global.css (checked by
 * titlebar-overlay.test.ts). Every window's title bar paints --bg-base with
 * --text-muted text, in both `:root` (dark) and `:root[data-theme='light']`;
 * the height is the Windows --titlebar-h (44px).
 */
export const WINDOWS_TITLEBAR_HEIGHT = 44;
export const WINDOWS_TITLEBAR_OVERLAY_COLORS = {
  dark: { color: '#181818', symbolColor: '#8b949e' },
  light: { color: '#f6f8fa', symbolColor: '#57606a' }
} as const;

export interface TitleBarOverlayColors {
  color: string;
  symbolColor: string;
}

export interface WindowsTitleBarOverlay extends TitleBarOverlayColors {
  height: number;
}

/**
 * The overlay for the effective theme. In a Windows contrast theme Chromium
 * forces the page to the system Window / WindowText colours, so the overlay
 * takes those instead (when they could be read).
 */
export function windowsTitleBarOverlay(
  theme: 'dark' | 'light',
  highContrast: TitleBarOverlayColors | null = null
): WindowsTitleBarOverlay {
  const colors = highContrast ?? WINDOWS_TITLEBAR_OVERLAY_COLORS[theme];
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

/** Re-colour every live window; one failing window doesn't stop the rest. */
export function applyWindowsTitleBarOverlay(
  windows: Iterable<OverlayWindow>,
  overlay: WindowsTitleBarOverlay,
  logError: (context: string, err: unknown) => void
): void {
  for (const win of windows) {
    if (win.isDestroyed()) continue;
    try {
      win.setTitleBarOverlay(overlay);
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
  windows: { values(): Iterable<{ win: OverlayWindow }> };
  /** The effective app theme (Theme setting, with System resolved). */
  theme: () => 'dark' | 'light';
  /** Electron's theme APIs, read lazily and only on Windows. */
  electron: () => {
    nativeTheme: ThemeEvents;
    systemPreferences: { getColor(name: 'window' | 'window-text'): string };
  };
  logError: (context: string, err: unknown) => void;
}

/**
 * The overlay for new windows (`current`), a re-colour of every open window
 * (`refresh`, after the Theme setting changes), and the OS appearance listener
 * (`bind`: light/dark while Theme is System, and contrast themes). `bind` is
 * called once at app init and returns its unsubscribe for shutdown. Off
 * Windows there is no overlay, so `refresh` does nothing.
 */
export function createWindowsTitleBarOverlays(deps: WindowsTitleBarOverlayDeps) {
  // A failed theme read must not stop a window from opening: fall back to the
  // default (dark) theme's colours.
  const current = () => {
    try {
      const { nativeTheme, systemPreferences } = deps.electron();
      return windowsTitleBarOverlay(
        deps.theme(),
        nativeTheme.shouldUseHighContrastColors
          ? highContrastOverlayColors((name) => systemPreferences.getColor(name), deps.logError)
          : null
      );
    } catch (err) {
      deps.logError('titleBarOverlay theme', err);
      return windowsTitleBarOverlay('dark');
    }
  };
  const refresh = () => {
    if (deps.platform !== 'win32') return;
    applyWindowsTitleBarOverlay(Array.from(deps.windows.values(), (entry) => entry.win), current(), deps.logError);
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
