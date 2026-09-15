import type { ILinkHandler } from '@xterm/xterm';
import { handleHttpLinkClick } from './in-app-browser-link-preference.js';

/**
 * Open a CLI-agent terminal hyperlink.
 *
 * Delegates to `handleHttpLinkClick` so PTY and thread markdown cannot drift.
 * Cmd/Ctrl-click uses the in-app side panel when a session panel is listening.
 * xterm's default OSC 8 handler `confirm()`s then calls `window.open()` with
 * no URL. Electron sees `about:blank`, denies it, and the browser never opens.
 */
export function openXtermHttpLink(event: MouseEvent, uri: string, ownerId?: string): boolean {
  return handleHttpLinkClick(uri, { event, ownerId });
}

export const xtermHttpLinkHandler: ILinkHandler = {
  activate: openXtermHttpLink as any
};
