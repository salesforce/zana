import { getDesktopBrowserApi } from './desktop-browser.js';

export const OPEN_IN_APP_BROWSER_EVENT = 'zcc:open-in-app-browser';

const HTTP_URL_SCHEME_PATTERN = /^https?:\/\//iu;
const MODAL_OWNER_SUFFIX = ':modal';

export function isHttpOrHttpsUrl(url: string): boolean {
  return HTTP_URL_SCHEME_PATTERN.test(url);
}

export function isSidePanelModifierClick(event: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>): boolean {
  return event.metaKey === true || event.ctrlKey === true;
}

/** Cmd/Ctrl-click events scoped to a session also match that session's modal panel. */
export function inAppBrowserEventMatchesOwner(
  eventOwnerId: string | undefined,
  panelOwnerId: string
): boolean {
  if (!eventOwnerId) return true;
  if (eventOwnerId === panelOwnerId) return true;
  return panelOwnerId === `${eventOwnerId}${MODAL_OWNER_SUFFIX}`;
}

export type HttpLinkClickOptions = {
  event?: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>;
  ownerId?: string;
};

/**
 * Open an http(s) URL.
 *
 * Plain click → OS browser (`window.open` → Electron `shell.openExternal`).
 * Cmd/Ctrl-click on desktop → in-app side panel when a listener handles the
 * event; otherwise fall back to the OS browser.
 */
export function handleHttpLinkClick(url: string, opts: HttpLinkClickOptions = {}): boolean {
  if (!isHttpOrHttpsUrl(url)) return false;
  if (opts.event && isSidePanelModifierClick(opts.event) && getDesktopBrowserApi()) {
    const opened = new CustomEvent(OPEN_IN_APP_BROWSER_EVENT, {
      cancelable: true,
      detail: { url, ownerId: opts.ownerId }
    });
    window.dispatchEvent(opened);
    if (opened.defaultPrevented) return true;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

export function dispatchOpenInAppBrowser(url: string, ownerId?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_IN_APP_BROWSER_EVENT, {
    detail: { url, ownerId }
  }));
}
