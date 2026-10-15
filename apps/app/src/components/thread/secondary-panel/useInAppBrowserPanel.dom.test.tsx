/** @vitest-environment happy-dom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useInAppBrowserPanel } from './useInAppBrowserPanel.js';
import { OPEN_IN_APP_BROWSER_EVENT } from '../../../lib/in-app-browser-link-preference.js';

const mocks = vi.hoisted(() => ({
  scoped: new Set<(request: { tabId: string; url: string; openedTabId?: string }) => void>(),
  legacy: new Set<(request: { url: string }) => void>(),
  automation: new Set<(request: { threadId: string; tabId: string; targetId: string; url: string }) => void>(),
  closed: new Set<(request: { tabId: string }) => void>(),
  product: new Set<(request: { threadId?: string; url?: string }) => void>(),
  desktop: true,
  scopedAvailable: true,
  getClosedTabs: undefined as undefined | (() => Promise<Array<{ tabId: string }>>)
}));
vi.mock('../../../lib/desktop-browser.js', () => ({
  getDesktopBrowserApi: () => mocks.desktop ? {
    onScopedOpenTab: mocks.scopedAvailable ? (cb: never) => { mocks.scoped.add(cb); return () => mocks.scoped.delete(cb); } : undefined,
    onOpenTab: (cb: never) => { mocks.legacy.add(cb); return () => mocks.legacy.delete(cb); },
    onAutomationOpen: (cb: never) => { mocks.automation.add(cb); return () => mocks.automation.delete(cb); },
    onClosed: (cb: never) => { mocks.closed.add(cb); return () => mocks.closed.delete(cb); },
    getClosedTabs: mocks.getClosedTabs
  } : null
}));
vi.mock('../../../lib/product-ws.js', () => ({
  subscribeProductEvent: (_type: string, cb: never) => { mocks.product.add(cb); return () => mocks.product.delete(cb); }
}));
afterEach(() => {
  cleanup();
  for (const listeners of [mocks.scoped, mocks.legacy, mocks.automation, mocks.closed, mocks.product]) expect(listeners.size).toBe(0);
  mocks.desktop = true;
  mocks.scopedAvailable = true;
  mocks.getClosedTabs = undefined;
  localStorage.clear();
});

function panel(tabId: string) {
  return { state: { tabs: [{ id: tabId, kind: 'browser' as const, title: 'Browser' }] }, addTab: vi.fn(), closeTab: vi.fn() };
}

it('opens native popup requests only in the panel owning the source tab, with current tab membership', () => {
  const first = panel('source-a');
  const other = panel('source-b');
  const view = renderHook(({ current }) => useInAppBrowserPanel('a', current), { initialProps: { current: first } });
  renderHook(() => useInAppBrowserPanel('b', other));
  act(() => { for (const cb of mocks.scoped) cb({ tabId: 'source-a', url: 'https://example.test/child' }); });
  expect(first.addTab).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ url: 'https://example.test/child' }));
  expect(other.addTab).not.toHaveBeenCalled();
  const next = panel('source-c');
  view.rerender({ current: next });
  act(() => { for (const cb of mocks.scoped) cb({ tabId: 'source-a', url: 'https://example.test/old' }); });
  expect(next.addTab).not.toHaveBeenCalled();
  act(() => { for (const cb of mocks.scoped) cb({ tabId: 'source-c', url: 'https://example.test/new' }); });
  expect(next.addTab).toHaveBeenCalledTimes(1);
  expect(mocks.legacy.size).toBe(0);
});

it('adopts the existing popup ID without replaying its initial blank URL', () => {
  const current = panel('login');
  const other = panel('elsewhere');
  renderHook(() => useInAppBrowserPanel('a', current));
  renderHook(() => useInAppBrowserPanel('b', other));
  act(() => { for (const cb of mocks.scoped) cb({ tabId: 'login', url: 'about:blank', openedTabId: 'popup' }); });
  expect(current.addTab).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'popup', url: '', kind: 'browser' }));
  expect(other.addTab).not.toHaveBeenCalled();
});

it('keeps automation, product, and link requests scoped and removes listeners on unmount', () => {
  const current = panel('source');
  const view = renderHook(() => useInAppBrowserPanel('a', current));
  act(() => {
    for (const cb of mocks.automation) {
      cb({ threadId: 'other', tabId: 'wrong', targetId: 'target', url: 'https://wrong.test' });
      cb({ threadId: 'a', tabId: 'owned', targetId: 'target', url: '' });
    }
    for (const cb of mocks.product) {
      cb({ threadId: 'a' });
      cb({ threadId: 'other', url: 'https://wrong.test' });
      cb({ threadId: 'a', url: 'https://product.test' });
    }
    window.dispatchEvent(new CustomEvent(OPEN_IN_APP_BROWSER_EVENT));
    window.dispatchEvent(new CustomEvent(OPEN_IN_APP_BROWSER_EVENT, { detail: { ownerId: 'other', url: 'https://wrong.test' } }));
    const event = new CustomEvent(OPEN_IN_APP_BROWSER_EVENT, { cancelable: true, detail: { ownerId: 'a', url: 'https://link.test' } });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
  expect(current.addTab.mock.calls.map(([tab]) => tab.url)).toEqual(['', 'https://product.test', 'https://link.test']);
  view.unmount();
  window.dispatchEvent(new CustomEvent(OPEN_IN_APP_BROWSER_EVENT, { detail: { ownerId: 'a', url: 'https://closed.test' } }));
  expect(current.addTab).toHaveBeenCalledTimes(3);
});

it('supports legacy native events and web-only panels', () => {
  mocks.scopedAvailable = false;
  const current = panel('source');
  const view = renderHook(() => useInAppBrowserPanel('a', current));
  act(() => { for (const cb of mocks.legacy) cb({ url: 'https://legacy.test' }); });
  expect(current.addTab).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ url: 'https://legacy.test' }));
  view.unmount();
  mocks.desktop = false;
  renderHook(() => useInAppBrowserPanel('a', current));
  expect(mocks.legacy.size).toBe(0);
});

it('removes only closed browser tabs owned by this panel, using current callbacks', () => {
  const first = panel('owned');
  const other = panel('other');
  const view = renderHook(({ current }) => useInAppBrowserPanel('a', current), { initialProps: { current: first } });
  renderHook(() => useInAppBrowserPanel('b', other));
  act(() => { for (const cb of mocks.closed) cb({ tabId: 'owned' }); });
  expect(first.closeTab).toHaveBeenCalledExactlyOnceWith('owned');
  expect(other.closeTab).not.toHaveBeenCalled();
  const next = panel('next');
  view.rerender({ current: next });
  act(() => { for (const cb of mocks.closed) { cb({ tabId: 'owned' }); cb({ tabId: 'next' }); } });
  expect(next.closeTab).toHaveBeenCalledExactlyOnceWith('next');
  expect(first.closeTab).toHaveBeenCalledTimes(1);
});

it('reconciles missed closes on remount without touching other panels', async () => {
  mocks.getClosedTabs = async () => [{ tabId: 'owned' }, { tabId: 'unknown' }];
  const current = panel('owned');
  renderHook(() => useInAppBrowserPanel('a', current));
  await act(async () => {});
  expect(current.closeTab).toHaveBeenCalledExactlyOnceWith('owned');
});

it('ignores late reconciliation after unmount and handles a disconnected desktop', async () => {
  let resolve!: (tabs: Array<{ tabId: string }>) => void;
  mocks.getClosedTabs = () => new Promise(r => { resolve = r; });
  const current = panel('owned');
  const view = renderHook(() => useInAppBrowserPanel('a', current));
  view.unmount();
  await act(async () => { resolve([{ tabId: 'owned' }]); });
  expect(current.closeTab).not.toHaveBeenCalled();
  mocks.getClosedTabs = async () => { throw new Error('disconnected'); };
  renderHook(() => useInAppBrowserPanel('a', current));
  await act(async () => {});
  expect(current.closeTab).not.toHaveBeenCalled();
});
