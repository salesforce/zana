import type { MenuItemConstructorOptions } from 'electron';

/**
 * Platform-specific tail of the Window menu. macOS lists open windows only on
 * the top-level item whose role is 'window' (NSApp.windowsMenu), so the caller
 * sets that role on the menu itself and this tail never nests a { role:
 * 'window' } item, which AppKit would render as nothing.
 */
export function windowMenuTail(isMac: boolean): MenuItemConstructorOptions[] {
  return isMac
    ? [{ type: 'separator' }, { role: 'front' }]
    : [{ role: 'close' }];
}
