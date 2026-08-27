import { getDesktopBrowserApi } from './desktop-browser.js';
import { readBooleanPreference } from './boolean-preference.js';
import { useBooleanPreference } from './use-boolean-preference.js';

export const OPEN_LINKS_IN_APP_BROWSER_STORAGE_KEY = 'zcc.openLinksInAppBrowser';
export const OPEN_LINKS_IN_APP_BROWSER_DEFAULT = true;

export type UrlOpenTarget = 'in-app-browser' | 'external-browser' | 'unhandled';

export const OPEN_IN_APP_BROWSER_EVENT = 'zcc:open-in-app-browser';

const HTTP_URL_SCHEME_PATTERN = /^https?:\/\//iu;

export function isHttpOrHttpsUrl(url: string): boolean {
  return HTTP_URL_SCHEME_PATTERN.test(url);
}

export function resolveUrlOpenTarget(args: {
  desktopBrowserAvailable: boolean;
  openLinksInAppBrowser: boolean;
  url: string;
}): UrlOpenTarget {
  if (!isHttpOrHttpsUrl(args.url)) {
    return 'unhandled';
  }
  if (args.desktopBrowserAvailable && args.openLinksInAppBrowser) {
    return 'in-app-browser';
  }
  return 'external-browser';
}

export function openUrlByPreference(args: {
  desktopBrowserAvailable: boolean;
  openExternalBrowser: (url: string) => void;
  openInAppBrowser: (url: string) => void;
  openLinksInAppBrowser: boolean;
  url: string;
}): boolean {
  const target = resolveUrlOpenTarget(args);
  switch (target) {
    case 'in-app-browser':
      args.openInAppBrowser(args.url);
      return true;
    case 'external-browser':
      args.openExternalBrowser(args.url);
      return true;
    case 'unhandled':
      return false;
  }
}

export function useOpenLinksInAppBrowserPreference() {
  return useBooleanPreference(OPEN_LINKS_IN_APP_BROWSER_STORAGE_KEY, OPEN_LINKS_IN_APP_BROWSER_DEFAULT);
}

export function dispatchOpenInAppBrowser(url: string, ownerId?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_IN_APP_BROWSER_EVENT, {
    detail: { url, ownerId }
  }));
}

export function handleHttpLinkClick(url: string, ownerId?: string): boolean {
  return openUrlByPreference({
    desktopBrowserAvailable: getDesktopBrowserApi() !== null,
    openLinksInAppBrowser: readBooleanPreference(
      OPEN_LINKS_IN_APP_BROWSER_STORAGE_KEY,
      OPEN_LINKS_IN_APP_BROWSER_DEFAULT
    ),
    openInAppBrowser: (next) => dispatchOpenInAppBrowser(next, ownerId),
    openExternalBrowser: (next) => {
      window.open(next, '_blank', 'noopener,noreferrer');
    },
    url
  });
}
