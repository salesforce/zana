// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  DESKTOP_BROWSER_MAX_FIND_TEXT_LENGTH,
  type DesktopBrowserApi,
  type DesktopBrowserControlState,
  type DesktopBrowserFindInPageRequest,
  type DesktopBrowserFindResult,
  type DesktopBrowserState
} from '@zana-ai/zcc-desktop-contract';
import { BrowserTabContent } from './BrowserTabContent.js';

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function browserState(overrides: Partial<DesktopBrowserState> = {}): DesktopBrowserState {
  return {
    tabId: 'browser:test',
    url: 'https://example.com',
    title: 'Example',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    errorText: null,
    ...overrides
  };
}

function createHarness() {
  const stateListeners = new Set<(state: DesktopBrowserState) => void>();
  const findListeners = new Set<(result: DesktopBrowserFindResult) => void>();
  const controlListeners = new Set<(state: DesktopBrowserControlState) => void>();
  const findInPage = vi.fn<(request: DesktopBrowserFindInPageRequest) => void>();
  const stopFindInPage = vi.fn();
  const releaseControl = vi.fn(async () => ({ ok: true }));
  const focus = vi.fn();
  const api: DesktopBrowserApi = {
    attach: vi.fn(),
    detach: vi.fn(),
    navigate: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    findInPage,
    stopFindInPage,
    focus,
    releaseControl,
    getControl: vi.fn(async () => null),
    onState(listener) {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
    onOpenTab: () => () => undefined,
    onFindResult(listener) {
      findListeners.add(listener);
      return () => {
        findListeners.delete(listener);
      };
    },
    onControl(listener) {
      controlListeners.add(listener);
      return () => {
        controlListeners.delete(listener);
      };
    }
  };
  return {
    api,
    findInPage,
    stopFindInPage,
    releaseControl,
    focus,
    emitState(state: DesktopBrowserState) {
      for (const listener of stateListeners) listener(state);
    },
    emitFind(result: DesktopBrowserFindResult) {
      for (const listener of findListeners) listener(result);
    },
    emitControl(state: DesktopBrowserControlState) {
      for (const listener of controlListeners) listener(state);
    }
  };
}

describe('BrowserTabContent chrome', () => {
  it('shows the controller label with Stop and Take over', async () => {
    const harness = createHarness();
    vi.stubGlobal('cc', { browser: harness.api });
    render(
      <BrowserTabContent
        tabId="browser:test"
        initialUrl="https://example.com"
        canShowNativeBrowserView
        visibilityCoordinator={null}
        threadId="thread-1"
        onUpdate={() => undefined}
      />
    );
    await act(async () => {
      harness.emitState(browserState());
      harness.emitControl({
        tabId: 'browser:test',
        threadId: 'thread-1',
        control: {
          leaseId: 'lease-1',
          controllerLabel: 'Browser Automation',
          expiresAt: Date.now() + 60_000
        }
      });
    });
    expect(screen.getByTestId('thread-browser-automation').textContent).toContain(
      'Browser Automation is controlling this tab'
    );
    fireEvent.click(screen.getByTestId('thread-browser-take-over'));
    expect(harness.releaseControl).toHaveBeenCalledWith('browser:test');
    expect(harness.focus).toHaveBeenCalledWith('browser:test');
  });

  it('opens find-in-page, bounds the query, and shows match counts', async () => {
    const harness = createHarness();
    vi.stubGlobal('cc', { browser: harness.api });
    render(
      <BrowserTabContent
        tabId="browser:test"
        initialUrl="https://example.com"
        canShowNativeBrowserView
        visibilityCoordinator={null}
        threadId="thread-1"
        onUpdate={() => undefined}
      />
    );
    await act(async () => {
      harness.emitState(browserState());
    });
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    const input = screen.getByPlaceholderText('Find in page');
    const oversized = 'a'.repeat(DESKTOP_BROWSER_MAX_FIND_TEXT_LENGTH + 10);
    fireEvent.change(input, { target: { value: oversized } });
    const sent = harness.findInPage.mock.lastCall?.[0];
    expect(sent?.text).toHaveLength(DESKTOP_BROWSER_MAX_FIND_TEXT_LENGTH);
    await act(async () => {
      harness.emitFind({
        tabId: 'browser:test',
        requestId: 1,
        activeMatchOrdinal: 2,
        matches: 5,
        finalUpdate: true
      });
    });
    expect(screen.getByTestId('browser-find-match-count').textContent).toBe('2/5');
  });
});
