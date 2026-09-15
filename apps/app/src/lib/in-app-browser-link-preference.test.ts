// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleHttpLinkClick,
  inAppBrowserEventMatchesOwner,
  isHttpOrHttpsUrl,
  isSidePanelModifierClick,
  OPEN_IN_APP_BROWSER_EVENT
} from './in-app-browser-link-preference.js';

const DOCS_URL = 'https://example.com/docs';

describe('isHttpOrHttpsUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isHttpOrHttpsUrl('http://example.com')).toBe(true);
    expect(isHttpOrHttpsUrl('https://example.com/docs?q=1#frag')).toBe(true);
    expect(isHttpOrHttpsUrl('HTTPS://EXAMPLE.COM')).toBe(true);
  });

  it('rejects non-http schemes, relative paths, and protocol-relative URLs', () => {
    expect(isHttpOrHttpsUrl('mailto:hi@example.com')).toBe(false);
    expect(isHttpOrHttpsUrl('file:///Users/me/app.ts')).toBe(false);
    expect(isHttpOrHttpsUrl('/projects/abc')).toBe(false);
    expect(isHttpOrHttpsUrl('#section')).toBe(false);
    expect(isHttpOrHttpsUrl('//example.com')).toBe(false);
    expect(isHttpOrHttpsUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('isSidePanelModifierClick', () => {
  it('treats Cmd and Ctrl as the side-panel modifier', () => {
    expect(isSidePanelModifierClick({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(isSidePanelModifierClick({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(isSidePanelModifierClick({ metaKey: false, ctrlKey: false })).toBe(false);
  });
});

describe('inAppBrowserEventMatchesOwner', () => {
  it('matches the same owner and the session modal suffix', () => {
    expect(inAppBrowserEventMatchesOwner(undefined, 'sess-1')).toBe(true);
    expect(inAppBrowserEventMatchesOwner('sess-1', 'sess-1')).toBe(true);
    expect(inAppBrowserEventMatchesOwner('sess-1', 'sess-1:modal')).toBe(true);
    expect(inAppBrowserEventMatchesOwner('sess-1', 'sess-2')).toBe(false);
  });
});

describe('handleHttpLinkClick', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, 'cc');
  });

  it('opens http(s) URLs in the OS browser on a plain click', () => {
    Object.assign(window, { cc: { browser: {} } });
    const open = vi.fn(() => null);
    vi.stubGlobal('open', open);
    const seen: string[] = [];
    const onOpen = (event: Event) => {
      seen.push((event as CustomEvent<{ url: string }>).detail.url);
    };
    window.addEventListener(OPEN_IN_APP_BROWSER_EVENT, onOpen);
    try {
      expect(handleHttpLinkClick(DOCS_URL)).toBe(true);
      expect(open).toHaveBeenCalledWith(DOCS_URL, '_blank', 'noopener,noreferrer');
      expect(seen).toEqual([]);
    } finally {
      window.removeEventListener(OPEN_IN_APP_BROWSER_EVENT, onOpen);
    }
  });

  it('opens the in-app side panel on Cmd-click when a listener handles it', () => {
    Object.assign(window, { cc: { browser: {} } });
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const seen: Array<{ url: string; ownerId?: string }> = [];
    const onOpen = (event: Event) => {
      event.preventDefault();
      seen.push((event as CustomEvent<{ url: string; ownerId?: string }>).detail);
    };
    window.addEventListener(OPEN_IN_APP_BROWSER_EVENT, onOpen);
    try {
      expect(handleHttpLinkClick(DOCS_URL, {
        event: { metaKey: true, ctrlKey: false },
        ownerId: 'thread-1'
      })).toBe(true);
      expect(seen).toEqual([{ url: DOCS_URL, ownerId: 'thread-1' }]);
      expect(open).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(OPEN_IN_APP_BROWSER_EVENT, onOpen);
    }
  });

  it('falls back to the OS browser on Cmd-click when no panel listens', () => {
    Object.assign(window, { cc: { browser: {} } });
    const open = vi.fn();
    vi.stubGlobal('open', open);
    expect(handleHttpLinkClick(DOCS_URL, {
      event: { metaKey: true, ctrlKey: false }
    })).toBe(true);
    expect(open).toHaveBeenCalledWith(DOCS_URL, '_blank', 'noopener,noreferrer');
  });

  it('leaves non-web schemes unhandled', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    expect(handleHttpLinkClick('file:///Users/me/app.ts')).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
