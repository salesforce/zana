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
import { createBrowserViewVisibilityCoordinator } from './browserViewVisibilityCoordinator.js';

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
  it('loads existing browser control and ignores control belonging to another tab', async () => {
    const harness = createHarness();
    vi.stubGlobal('cc', { browser: harness.api });
    const control = { leaseId: 'lease-existing', controllerLabel: 'Existing controller', expiresAt: Date.now() + 60_000 };
    vi.mocked(harness.api.getControl!).mockResolvedValueOnce({ tabId: 'browser:test', threadId: 'thread-1', control });
    const view = render(<BrowserTabContent tabId="browser:test" initialUrl="https://example.com"
      canShowNativeBrowserView visibilityCoordinator={null} threadId="thread-1" onUpdate={() => undefined} />);
    await act(async () => {});
    expect(screen.getByTestId('thread-browser-automation').textContent).toContain('Existing controller');
    view.unmount();
    vi.mocked(harness.api.getControl!).mockResolvedValueOnce({ tabId: 'browser:other', threadId: 'thread-1', control });
    render(<BrowserTabContent tabId="browser:test" initialUrl="https://example.com"
      canShowNativeBrowserView visibilityCoordinator={null} threadId="thread-1" onUpdate={() => undefined} />);
    await act(async () => {});
    expect(screen.queryByTestId('thread-browser-automation')).toBeNull();
  });

  it('ignores a late control reply after unmount and contains a failed control lookup', async () => {
    const harness = createHarness();
    vi.stubGlobal('cc', { browser: harness.api });
    const pending = Promise.withResolvers<DesktopBrowserControlState | null>();
    vi.mocked(harness.api.getControl!).mockReturnValueOnce(pending.promise);
    const view = render(<BrowserTabContent tabId="browser:test" initialUrl="https://example.com"
      canShowNativeBrowserView visibilityCoordinator={null} threadId="thread-1" onUpdate={() => undefined} />);
    view.unmount();
    await act(async () => { pending.resolve({ tabId: 'browser:test', threadId: 'thread-1', control: null }); });
    expect(screen.queryByTestId('thread-browser-automation')).toBeNull();
    vi.mocked(harness.api.getControl!).mockRejectedValueOnce(new Error('Disconnected'));
    render(<BrowserTabContent tabId="browser:test" initialUrl="https://example.com"
      canShowNativeBrowserView visibilityCoordinator={null} threadId="thread-1" onUpdate={() => undefined} />);
    await act(async () => {});
    expect(screen.queryByTestId('thread-browser-automation')).toBeNull();
  });

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

describe('BrowserTabContent visibility', () => {
  function setup(initialUrl = 'http://127.0.0.1:3003/') {
    const harness = createHarness();
    vi.stubGlobal('cc', { browser: harness.api });
    const coordinator = createBrowserViewVisibilityCoordinator(harness.api);
    const browser = (
      <BrowserTabContent
        tabId="browser:test"
        initialUrl={initialUrl}
        canShowNativeBrowserView
        visibilityCoordinator={coordinator}
        threadId="thread-visibility"
        onUpdate={() => undefined}
      />
    );
    return { ...harness, browser };
  }

  it('displays and reloads a page inside its inspector, then hides it on unmount', async () => {
    const h = setup();
    const { unmount } = render(<div className="modal-backdrop"><div role="dialog" aria-modal="true">{h.browser}</div></div>);
    await act(async () => h.emitState(browserState({ url: 'http://127.0.0.1:3003/' })));
    expect(h.api.setVisible).toHaveBeenLastCalledWith({ tabId: 'browser:test', visible: true });
    expect(screen.queryByTestId('thread-browser-newtab')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reload', exact: true }));
    expect(h.api.reload).toHaveBeenCalledWith('browser:test');
    await act(async () => h.emitState(browserState({ isLoading: true })));
    fireEvent.click(screen.getByRole('button', { name: 'Stop loading' }));
    expect(h.api.stop).toHaveBeenCalledWith('browser:test');
    unmount();
    expect(h.api.setVisible).toHaveBeenLastCalledWith({ tabId: 'browser:test', visible: false });
  });

  it.each(['modal-backdrop', 'consent-overlay'])('hides behind a %s and restores without loading again', async (className) => {
    const h = setup();
    render(<div className="modal-backdrop">{h.browser}</div>);
    const overlay = document.createElement('div');
    overlay.className = className;
    await act(async () => { document.body.append(overlay); });
    expect(h.api.setVisible).toHaveBeenLastCalledWith({ tabId: 'browser:test', visible: false });
    expect(screen.queryByTestId('thread-browser-newtab')).toBeNull();
    await act(async () => { overlay.remove(); });
    expect(h.api.setVisible).toHaveBeenLastCalledWith({ tabId: 'browser:test', visible: true });
    expect(h.api.attach).toHaveBeenCalledTimes(1);
    expect(h.api.reload).not.toHaveBeenCalled();
  });

  it('hides for a nested modal dialog and restores when it becomes hidden', async () => {
    const h = setup();
    const { container } = render(<div className="modal-backdrop">{h.browser}<div data-testid="nested" /></div>);
    const nested = screen.getByTestId('nested');
    await act(async () => { nested.setAttribute('role', 'dialog'); nested.setAttribute('aria-modal', 'true'); });
    expect(h.api.setVisible).toHaveBeenLastCalledWith({ tabId: 'browser:test', visible: false });
    await act(async () => { nested.hidden = true; });
    expect(h.api.setVisible).toHaveBeenLastCalledWith({ tabId: 'browser:test', visible: true });
    expect(container.querySelector('.thread-browser-newtab')).toBeNull();
  });

  it.each(['display:none', 'visibility:hidden'])('ignores a backdrop inside a %s ancestor', async (style) => {
    const h = setup();
    const hiddenParent = document.createElement('div');
    hiddenParent.setAttribute('style', style);
    hiddenParent.innerHTML = '<div class="modal-backdrop"></div>';
    document.body.append(hiddenParent);
    try {
      render(h.browser);
      await act(async () => {});
      expect(h.api.setVisible).toHaveBeenLastCalledWith({ tabId: 'browser:test', visible: true });
      await act(async () => { hiddenParent.removeAttribute('style'); });
      expect(h.api.setVisible).toHaveBeenLastCalledWith({ tabId: 'browser:test', visible: false });
    } finally { hiddenParent.remove(); }
  });

  it('keeps a shared tab visible in the inspector when its background host becomes occluded', async () => {
    const h = setup();
    const second = createBrowserViewVisibilityCoordinator(h.api);
    const inspectorBrowser = <BrowserTabContent tabId="browser:test" initialUrl="http://127.0.0.1:3003/"
      canShowNativeBrowserView visibilityCoordinator={second} threadId="thread-visibility" onUpdate={() => undefined} />;
    const { rerender } = render(<main>{h.browser}</main>);
    await act(async () => {});
    rerender(<main>{h.browser}<div className="modal-backdrop">{inspectorBrowser}</div></main>);
    await act(async () => {});
    expect(h.api.setVisible).toHaveBeenLastCalledWith({ tabId: 'browser:test', visible: true });
    const contents = screen.getAllByTestId('thread-browser-tab').map((node) => node.querySelector('.thread-browser-view')!);
    vi.spyOn(contents[0]!, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 200, 300));
    vi.spyOn(contents[1]!, 'getBoundingClientRect').mockReturnValue(new DOMRect(300, 20, 200, 300));
    vi.mocked(h.api.setBounds).mockClear();
    fireEvent(window, new Event('resize'));
    expect(h.api.setBounds).toHaveBeenCalledTimes(1);
    expect(h.api.setBounds).toHaveBeenCalledWith({ tabId: 'browser:test', bounds: { x: 300, y: 20, width: 200, height: 300 } });
    rerender(<main>{h.browser}</main>);
    await act(async () => {});
    expect(h.api.setVisible).toHaveBeenLastCalledWith({ tabId: 'browser:test', visible: true });
  });

  it('shows history only for an empty tab and keeps load errors distinct', async () => {
    const h = setup('');
    render(h.browser);
    expect(screen.getByTestId('thread-browser-newtab')).toBeTruthy();
    await act(async () => h.emitState(browserState({ errorText: 'ERR_CONNECTION_REFUSED' })));
    expect(screen.queryByTestId('thread-browser-newtab')).toBeNull();
    expect(screen.getByTestId('thread-browser-error')).toBeTruthy();
    expect(h.api.setVisible).toHaveBeenLastCalledWith({ tabId: 'browser:test', visible: false });
  });

  it('reloads an explicitly resubmitted address and navigates a different one', async () => {
    const h = setup();
    render(h.browser);
    const address = screen.getByTestId('thread-browser-address');
    fireEvent.focus(address);
    fireEvent.submit(address.closest('form')!);
    expect(h.api.reload).toHaveBeenCalledWith('browser:test');
    expect(h.api.navigate).not.toHaveBeenCalled();
    fireEvent.focus(address);
    fireEvent.change(address, { target: { value: 'http://127.0.0.1:3003/next' } });
    fireEvent.submit(address.closest('form')!);
    expect(h.api.navigate).toHaveBeenCalledWith({ tabId: 'browser:test', url: 'http://127.0.0.1:3003/next' });
  });
});
