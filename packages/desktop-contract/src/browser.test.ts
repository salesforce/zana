import { describe, expect, it } from 'vitest';
import {
  DESKTOP_BROWSER_MAX_FIND_TEXT_LENGTH,
  DESKTOP_BROWSER_MAX_URL_LENGTH,
  DESKTOP_BROWSER_MAX_TITLE_LENGTH,
  clampDesktopBrowserViewBounds,
  parseDesktopBrowserAttachRequest,
  parseDesktopBrowserAutomationOpenRequest,
  parseDesktopBrowserFindInPageRequest,
  parseDesktopBrowserFindResult,
  parseDesktopBrowserSetBoundsRequest,
  parseDesktopBrowserSetVisibleRequest,
  parseDesktopBrowserScopedOpenTabRequest,
  parseDesktopBrowserState,
  parseDesktopBrowserStopFindInPageRequest,
  type DesktopBrowserViewBounds,
  type DesktopBrowserViewportBounds
} from './browser.js';
import { isRetryableDesktopBrowserImportReason } from './browser-import.js';

interface BrowserBoundsClampTestCase {
  bounds: DesktopBrowserViewBounds;
  expected: DesktopBrowserViewBounds;
  label: string;
  viewport: DesktopBrowserViewportBounds;
}

const browserBoundsClampTestCases: BrowserBoundsClampTestCase[] = [
  {
    label: 'anchors the left edge and trims overflow at the right and bottom',
    bounds: { x: 180, y: 48, width: 400, height: 420 },
    viewport: { width: 500, height: 360 },
    expected: { x: 180, y: 48, width: 320, height: 312 }
  },
  {
    label: 'clamps negative origins to the host content edge',
    bounds: { x: -24, y: -10, width: 200, height: 120 },
    viewport: { width: 500, height: 360 },
    expected: { x: 0, y: 0, width: 176, height: 110 }
  },
  {
    label: 'collapses bounds that start outside the host content area',
    bounds: { x: 640, y: 400, width: 120, height: 90 },
    viewport: { width: 500, height: 360 },
    expected: { x: 500, y: 360, width: 0, height: 0 }
  },
  {
    label: 'leaves bounds that already fit the viewport untouched',
    bounds: { x: 100, y: 50, width: 300, height: 250 },
    viewport: { width: 500, height: 360 },
    expected: { x: 100, y: 50, width: 300, height: 250 }
  }
];

describe('desktop browser bounds containment', () => {
  it.each(browserBoundsClampTestCases)('$label', (testCase) => {
    expect(
      clampDesktopBrowserViewBounds({
        bounds: testCase.bounds,
        viewport: testCase.viewport
      })
    ).toEqual(testCase.expected);
  });
});

describe('desktop browser IPC schemas', () => {
  it('validates temporary browser snapshot requests without weakening visibility validation', () => {
    const request = { tabId: 'browser', visible: false };
    for (const preserveSnapshot of [true, false]) {
      const value = { ...request, preserveSnapshot };
      expect(parseDesktopBrowserSetVisibleRequest(value)).toEqual({ success: true, data: value });
    }
    expect(parseDesktopBrowserSetVisibleRequest(request)).toEqual({ success: true, data: request });
    for (const value of [null, { ...request, preserveSnapshot: 'true' }, { ...request, visible: 0 },
      { ...request, tabId: '' }, { ...request, unknown: true }]) {
      expect(parseDesktopBrowserSetVisibleRequest(value)).toEqual({ success: false });
    }
  });
  it('accepts a well-formed attach request and rejects bad shapes', () => {
    expect(
      parseDesktopBrowserAttachRequest({
        tabId: 'browser:abc',
        url: '',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: false
      }).success
    ).toBe(true);

    expect(
      parseDesktopBrowserAttachRequest({
        tabId: '',
        url: '',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: false
      }).success
    ).toBe(false);
    expect(
      parseDesktopBrowserSetBoundsRequest({
        tabId: 'browser:abc',
        bounds: { x: 0, y: 0, width: -1, height: 600 }
      }).success
    ).toBe(false);
    expect(
      parseDesktopBrowserAttachRequest({
        tabId: 'browser:abc',
        url: '',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: false,
        extra: true
      }).success
    ).toBe(false);
  });

  it('accepts a well-formed state push and rejects non-integer bounds', () => {
    expect(
      parseDesktopBrowserState({
        tabId: 'browser:abc',
        url: 'https://example.com',
        title: 'Example',
        isLoading: false,
        canGoBack: true,
        canGoForward: false,
        errorText: null
      }).success
    ).toBe(true);

    expect(
      parseDesktopBrowserSetBoundsRequest({
        tabId: 'browser:abc',
        bounds: { x: 0.5, y: 0, width: 800, height: 600 }
      }).success
    ).toBe(false);
  });

  it('rejects extra keys on automationOpen including visible', () => {
    expect(
      parseDesktopBrowserAutomationOpenRequest({
        threadId: 'thr-1',
        tabId: 'browser:abc',
        targetId: 'browser-auto:1',
        url: 'https://example.com'
      }).success
    ).toBe(true);
    expect(
      parseDesktopBrowserAutomationOpenRequest({
        threadId: 'thr-1',
        tabId: 'browser:abc',
        targetId: 'browser-auto:1',
        url: 'https://example.com',
        visible: false
      }).success
    ).toBe(false);
  });

  it('accepts find-in-page requests and rejects empty or oversized text', () => {
    expect(
      parseDesktopBrowserFindInPageRequest({
        tabId: 'browser:abc',
        text: 'query',
        forward: true,
        newSession: true
      }).success
    ).toBe(true);
    expect(
      parseDesktopBrowserFindInPageRequest({
        tabId: 'browser:abc',
        text: '',
        forward: true,
        newSession: true
      }).success
    ).toBe(false);
    expect(
      parseDesktopBrowserFindInPageRequest({
        tabId: 'browser:abc',
        text: 'a'.repeat(DESKTOP_BROWSER_MAX_FIND_TEXT_LENGTH + 1),
        forward: true,
        newSession: true
      }).success
    ).toBe(false);
    expect(
      parseDesktopBrowserStopFindInPageRequest({
        tabId: 'browser:abc',
        action: 'clearSelection'
      }).success
    ).toBe(true);
    expect(
      parseDesktopBrowserStopFindInPageRequest({
        tabId: 'browser:abc',
        action: 'dropSelection'
      }).success
    ).toBe(false);
    expect(
      parseDesktopBrowserFindResult({
        tabId: 'browser:abc',
        requestId: 1,
        activeMatchOrdinal: 1,
        matches: 4,
        finalUpdate: true
      }).success
    ).toBe(true);
  });

  it('rejects oversized URLs beyond the length cap', () => {
    const longUrl = `https://example.com/${'a'.repeat(DESKTOP_BROWSER_MAX_URL_LENGTH)}`;
    expect(
      parseDesktopBrowserAttachRequest({
        tabId: 'browser:abc',
        url: longUrl,
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: true
      }).success
    ).toBe(false);
  });
});

describe('desktop browser cookie-import copy', () => {
  it('treats keychain and FDA failures as retryable', () => {
    expect(isRetryableDesktopBrowserImportReason('needsKeychainApproval')).toBe(true);
    expect(isRetryableDesktopBrowserImportReason('needsFullDiskAccess')).toBe(true);
    expect(isRetryableDesktopBrowserImportReason('notInstalled')).toBe(false);
    expect(isRetryableDesktopBrowserImportReason('unknownSource')).toBe(false);
  });
});

describe('native popup adoption requests', () => {
  it('accepts existing URL-only requests and the bounded native child ID', () => {
    const request = { tabId: 'source', url: 'about:blank' };
    expect(parseDesktopBrowserScopedOpenTabRequest(request)).toEqual({ success: true, data: request });
    const adopted = { ...request, openedTabId: 'browser:popup-child' };
    expect(parseDesktopBrowserScopedOpenTabRequest(adopted)).toEqual({ success: true, data: adopted });
  });
  it.each([null, '', 12, 'a'.repeat(DESKTOP_BROWSER_MAX_TITLE_LENGTH + 1)])('rejects an invalid opened tab ID: %s', (openedTabId) => {
    expect(parseDesktopBrowserScopedOpenTabRequest({ tabId: 'source', url: 'about:blank', openedTabId }).success).toBe(false);
  });
  it('rejects malformed requests and extra keys', () => {
    for (const request of [null, {}, { tabId: '', url: 'about:blank' }, { tabId: 'source', url: '' }, { tabId: 'source', url: 'about:blank', windowId: 1 }]) {
      expect(parseDesktopBrowserScopedOpenTabRequest(request).success).toBe(false);
    }
  });
});
