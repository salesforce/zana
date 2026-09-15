import type { ILinkHandler } from '@xterm/xterm';
import { handleHttpLinkClick } from './in-app-browser-link-preference.js';

/**
 * Open a terminal hyperlink the same way markdown does (in-app browser
 * preference, else `window.open(url)` so Electron's `setWindowOpenHandler`
 * can `shell.openExternal`).
 *
 * xterm's default OSC 8 handler `confirm()`s then calls `window.open()` with
 * no URL. Electron sees `about:blank`, denies it, and the browser never opens.
 */
export function openXtermHttpLink(_event: MouseEvent, uri: string): boolean {
  return handleHttpLinkClick(uri);
}

export const xtermHttpLinkHandler: ILinkHandler = {
  activate: openXtermHttpLink
};
