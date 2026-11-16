import type { MenuItemConstructorOptions } from 'electron';

/** Default renderer scale keeps the shell compact without changing text semantics. */
export const DEFAULT_RENDERER_ZOOM_FACTOR = 0.95;

/** Chromium's own page-zoom range (`kMinimumPageZoomFactor` / `kMaximumPageZoomFactor`). */
export const MIN_RENDERER_ZOOM_FACTOR = 0.25;
export const MAX_RENDERER_ZOOM_FACTOR = 5;

/** Same step as Electron's `zoomIn` / `zoomOut` roles: half a Chromium zoom level (about 9.5%). */
export const RENDERER_ZOOM_LEVEL_STEP = 0.5;

/** Chromium zoom level ↔ factor: factor = 1.2 ^ level. */
const ZOOM_LEVEL_BASE = 1.2;

export function zoomFactorFromLevel(level: number): number {
  return ZOOM_LEVEL_BASE ** level;
}

export function zoomLevelFromFactor(factor: number): number {
  return Math.log(factor) / Math.log(ZOOM_LEVEL_BASE);
}

const MIN_LEVEL = zoomLevelFromFactor(MIN_RENDERER_ZOOM_FACTOR);
const MAX_LEVEL = zoomLevelFromFactor(MAX_RENDERER_ZOOM_FACTOR);

/** The zoom level one step in `direction`, clamped to Chromium's range. */
export function steppedZoomLevel(current: number, direction: 1 | -1): number {
  const base = Number.isFinite(current) ? current : zoomLevelFromFactor(DEFAULT_RENDERER_ZOOM_FACTOR);
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, base + direction * RENDERER_ZOOM_LEVEL_STEP));
}

/** The part of `WebContents` the zoom commands use. */
export interface ZoomTarget {
  getZoomLevel(): number;
  setZoomLevel(level: number): void;
  setZoomFactor(factor: number): void;
}

/** The part of `BrowserWindow` the zoom commands use. */
export interface ZoomWindow {
  isDestroyed(): boolean;
  webContents: ZoomTarget;
}

/**
 * View-menu zoom entries.
 *
 * macOS keeps Electron's `zoomIn` / `zoomOut` roles, as on main. On Windows and
 * Linux those roles only bind `Ctrl+Plus`, which Electron matches as
 * Shift+`=`. A plain `Ctrl+=` (what the menu label and every other app teach)
 * and `Ctrl+Numpad+` did nothing, so the zoom stopped at whatever Ctrl+Shift+=
 * presses the user happened to make. Here `Ctrl+=` is the visible accelerator,
 * and hidden items keep `Ctrl+Shift+=` and the numpad keys working too.
 *
 * Chromium stores the level per origin, so every app window (same renderer
 * origin) shares it and it survives a restart without extra state.
 */
export function zoomMenuItems(
  platform: NodeJS.Platform,
  focusedWindow: () => ZoomWindow | null
): MenuItemConstructorOptions[] {
  const target = (): ZoomTarget | null => {
    const win = focusedWindow();
    return win && !win.isDestroyed() ? win.webContents : null;
  };
  const step = (direction: 1 | -1) => () => {
    const wc = target();
    if (wc) wc.setZoomLevel(steppedZoomLevel(wc.getZoomLevel(), direction));
  };
  const reset: MenuItemConstructorOptions = {
    label: 'Reset Zoom',
    accelerator: 'CmdOrCtrl+0',
    click: () => target()?.setZoomFactor(DEFAULT_RENDERER_ZOOM_FACTOR)
  };
  if (platform === 'darwin') return [reset, { role: 'zoomIn' }, { role: 'zoomOut' }];
  const alias = (accelerator: string, direction: 1 | -1): MenuItemConstructorOptions => ({
    label: direction > 0 ? 'Zoom In' : 'Zoom Out',
    accelerator,
    visible: false,
    acceleratorWorksWhenHidden: true,
    click: step(direction)
  });
  return [
    reset,
    { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: step(1) },
    alias('CmdOrCtrl+Plus', 1),
    alias('CmdOrCtrl+numadd', 1),
    { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: step(-1) },
    alias('CmdOrCtrl+numsub', -1)
  ];
}
