// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPEN_IN_APP_BROWSER_EVENT } from './in-app-browser-link-preference.js';
import { openXtermHttpLink, xtermHttpLinkHandler } from './xterm-http-link.js';

const PR_URL = 'https://gitcore.example.com/org/repo/pull/25344';

describe('openXtermHttpLink', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, 'cc');
  });

  it('opens the given https URL instead of an empty window.open()', () => {
    const open = vi.fn(() => null);
    vi.stubGlobal('open', open);
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);

    expect(openXtermHttpLink(new MouseEvent('click'), PR_URL)).toBe(true);

    expect(confirm).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]).toEqual([PR_URL, '_blank', 'noopener,noreferrer']);
  });

  it('opens the OS browser even when the desktop in-app browser API is present', () => {
    Object.assign(window, { cc: { browser: {} } });
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const seen: string[] = [];
    const onOpen = (event: Event) => {
      seen.push((event as CustomEvent<{ url: string }>).detail.url);
    };
    window.addEventListener(OPEN_IN_APP_BROWSER_EVENT, onOpen);
    try {
      expect(openXtermHttpLink(new MouseEvent('click'), PR_URL)).toBe(true);
      expect(open).toHaveBeenCalledWith(PR_URL, '_blank', 'noopener,noreferrer');
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
      expect(openXtermHttpLink(
        new MouseEvent('click', { metaKey: true }),
        PR_URL,
        'sess-1'
      )).toBe(true);
      expect(seen).toEqual([{ url: PR_URL, ownerId: 'sess-1' }]);
      expect(open).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(OPEN_IN_APP_BROWSER_EVENT, onOpen);
    }
  });

  it('does not open non-http URLs', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    expect(openXtermHttpLink(new MouseEvent('click'), 'javascript:alert(1)')).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('is the OSC 8 activate handler', () => {
    expect(xtermHttpLinkHandler.activate).toBe(openXtermHttpLink);
    expect(xtermHttpLinkHandler.allowNonHttpProtocols).toBeUndefined();
  });
});
