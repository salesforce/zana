import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreadViewTarget } from '@zana-ai/zcc-desktop-contract';

const h = vi.hoisted(() => ({
  desktop: true,
  push: undefined as ((views: ThreadViewTarget[]) => void) | undefined,
  list: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  subscribe: vi.fn()
}));
vi.mock('./app-surface.js', () => ({ hasDesktopBridge: () => h.desktop }));
vi.mock('./product-client.js', () => ({
  product: {
    windows: {
      onThreadViewsChanged: (cb: (views: ThreadViewTarget[]) => void) => {
        h.subscribe();
        h.push = cb;
        return () => {};
      },
      listThreadViews: h.list,
      openThreadView: h.open,
      closeThreadView: h.close
    }
  }
}));

import {
  closeThreadViewWindow,
  isThreadViewOpen,
  listOpenThreadViews,
  openThreadViewWindow,
  resetThreadViewWindowsForTest,
  startThreadViewMirror,
  subscribeThreadViews
} from './thread-view-windows.js';

const view = { threadId: 't-1', projectId: 'p-1' };
const other = { threadId: 't-2' };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  h.desktop = true;
  h.push = undefined;
  h.list.mockReset().mockResolvedValue([]);
  h.open.mockReset().mockResolvedValue(true);
  h.close.mockReset().mockResolvedValue(true);
  h.subscribe.mockReset();
});
afterEach(() => resetThreadViewWindowsForTest());

describe('open thread view mirror', () => {
  it('starts empty and loads the open set on first subscribe', async () => {
    expect(listOpenThreadViews()).toEqual([]);
    h.list.mockResolvedValue([view]);
    const listener = vi.fn();
    subscribeThreadViews(listener);
    await flush();
    expect(listOpenThreadViews()).toEqual([view]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('starts once at init, before any reader subscribes', async () => {
    h.list.mockResolvedValue([view]);
    startThreadViewMirror();
    startThreadViewMirror();
    await flush();
    expect(listOpenThreadViews()).toEqual([view]);
    subscribeThreadViews(() => {});
    expect(h.subscribe).toHaveBeenCalledTimes(1);
    expect(h.list).toHaveBeenCalledTimes(1);
  });

  it('applies pushes and stops notifying a listener after it unsubscribes', () => {
    const listener = vi.fn();
    const off = subscribeThreadViews(listener);
    h.push!([view, other]);
    expect(listOpenThreadViews()).toEqual([view, other]);
    off();
    h.push!([]);
    expect(listOpenThreadViews()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps a push that lands while the first list is in flight', async () => {
    let resolveList!: (views: ThreadViewTarget[]) => void;
    h.list.mockReturnValue(new Promise((resolve) => (resolveList = resolve)));
    subscribeThreadViews(() => {});
    h.push!([other]);
    resolveList([view]);
    await flush();
    expect(listOpenThreadViews()).toEqual([other]);
  });

  it('copies pushed entries so callers cannot share main state', () => {
    subscribeThreadViews(() => {});
    const pushed = [view];
    h.push!(pushed);
    expect(listOpenThreadViews()).not.toBe(pushed);
    expect(listOpenThreadViews()[0]).not.toBe(view);
  });

  it('survives a failed list', async () => {
    h.list.mockRejectedValue(new Error('no main'));
    subscribeThreadViews(() => {});
    await flush();
    expect(listOpenThreadViews()).toEqual([]);
  });

  it('never subscribes outside the desktop app', () => {
    h.desktop = false;
    subscribeThreadViews(() => {});
    expect(h.subscribe).not.toHaveBeenCalled();
    expect(h.list).not.toHaveBeenCalled();
  });
});

it('matches open thread windows by thread alone', () => {
  expect(isThreadViewOpen([view], 't-1')).toBe(true);
  expect(isThreadViewOpen([view], 't-2')).toBe(false);
});

describe('window actions', () => {
  it('forwards to main on desktop', async () => {
    await expect(openThreadViewWindow(view)).resolves.toBe(true);
    await expect(closeThreadViewWindow(view)).resolves.toBe(true);
    expect(h.open).toHaveBeenCalledWith(view);
    expect(h.close).toHaveBeenCalledWith(view);
  });

  it('resolves false when main rejects', async () => {
    h.open.mockRejectedValue(new Error('x'));
    h.close.mockRejectedValue(new Error('x'));
    await expect(openThreadViewWindow(view)).resolves.toBe(false);
    await expect(closeThreadViewWindow(view)).resolves.toBe(false);
  });

  it('does nothing outside the desktop app', async () => {
    h.desktop = false;
    await expect(openThreadViewWindow(view)).resolves.toBe(false);
    await expect(closeThreadViewWindow(view)).resolves.toBe(false);
    expect(h.open).not.toHaveBeenCalled();
    expect(h.close).not.toHaveBeenCalled();
  });
});
