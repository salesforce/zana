import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginViewTarget } from '@zana-ai/zcc-desktop-contract';

const h = vi.hoisted(() => ({
  desktop: true,
  push: undefined as ((views: PluginViewTarget[]) => void) | undefined,
  list: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  showInMain: vi.fn(),
  subscribe: vi.fn()
}));
vi.mock('../lib/app-surface.js', () => ({ hasDesktopBridge: () => h.desktop }));
vi.mock('../lib/product-client.js', () => ({
  product: {
    windows: {
      onPluginViewsChanged: (cb: (views: PluginViewTarget[]) => void) => {
        h.subscribe();
        h.push = cb;
        return () => {};
      },
      listPluginViews: h.list,
      openPluginView: h.open,
      closePluginView: h.close,
      showInMain: h.showInMain
    }
  }
}));

import {
  closePluginViewWindow,
  isPluginViewOpen,
  listOpenPluginViews,
  openPluginViewWindow,
  resetPluginViewWindowsForTest,
  showInMainWindow,
  startPluginViewMirror,
  subscribePluginViews
} from './plugin-view-windows.js';

const view = { pluginId: 'salesforce', tabId: 'salesforce', projectId: 'p-1' };
const other = { ...view, projectId: 'p-2' };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  h.desktop = true;
  h.push = undefined;
  h.list.mockReset().mockResolvedValue([]);
  h.open.mockReset().mockResolvedValue(true);
  h.close.mockReset().mockResolvedValue(true);
  h.showInMain.mockReset().mockResolvedValue(true);
  h.subscribe.mockReset();
});
afterEach(() => resetPluginViewWindowsForTest());

describe('open plugin view mirror', () => {
  it('starts empty and loads the open set on first subscribe', async () => {
    expect(listOpenPluginViews()).toEqual([]);
    h.list.mockResolvedValue([view]);
    const listener = vi.fn();
    subscribePluginViews(listener);
    await flush();
    expect(listOpenPluginViews()).toEqual([view]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('starts once at init, before any reader subscribes', async () => {
    h.list.mockResolvedValue([view]);
    startPluginViewMirror();
    startPluginViewMirror();
    await flush();
    expect(listOpenPluginViews()).toEqual([view]);
    subscribePluginViews(() => {});
    expect(h.subscribe).toHaveBeenCalledTimes(1);
    expect(h.list).toHaveBeenCalledTimes(1);
  });

  it('subscribes to main once however many readers there are', () => {
    subscribePluginViews(() => {});
    subscribePluginViews(() => {});
    expect(h.subscribe).toHaveBeenCalledTimes(1);
    expect(h.list).toHaveBeenCalledTimes(1);
  });

  it('applies pushes and stops notifying a listener after it unsubscribes', () => {
    const listener = vi.fn();
    const off = subscribePluginViews(listener);
    h.push!([view, other]);
    expect(listOpenPluginViews()).toEqual([view, other]);
    off();
    h.push!([]);
    expect(listOpenPluginViews()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps a push that lands while the first list is in flight', async () => {
    let resolveList!: (views: PluginViewTarget[]) => void;
    h.list.mockReturnValue(new Promise((resolve) => (resolveList = resolve)));
    subscribePluginViews(() => {});
    h.push!([other]);
    resolveList([view]);
    await flush();
    expect(listOpenPluginViews()).toEqual([other]);
  });

  it('copies pushed entries so callers cannot share main state', () => {
    subscribePluginViews(() => {});
    const pushed = [view];
    h.push!(pushed);
    expect(listOpenPluginViews()).not.toBe(pushed);
    expect(listOpenPluginViews()[0]).not.toBe(view);
  });

  it('survives a failed list', async () => {
    h.list.mockRejectedValue(new Error('no main'));
    subscribePluginViews(() => {});
    await flush();
    expect(listOpenPluginViews()).toEqual([]);
  });

  it('never subscribes outside the desktop app', () => {
    h.desktop = false;
    subscribePluginViews(() => {});
    expect(h.subscribe).not.toHaveBeenCalled();
    expect(h.list).not.toHaveBeenCalled();
  });
});

describe('isPluginViewOpen', () => {
  it('does not hide the whole project tab when only a resource window is open', () => {
    const a = { ...view, resourceId: 'Help.agent' };
    expect(isPluginViewOpen([a], view)).toBe(false);
    expect(isPluginViewOpen([view], a)).toBe(false);
    expect(isPluginViewOpen([a], { ...a })).toBe(true);
    expect(isPluginViewOpen([a], { ...a, resourceId: 'Quote.agent' })).toBe(false);
  });
  it('matches on plugin, tab and project', () => {
    expect(isPluginViewOpen([view], { ...view })).toBe(true);
    expect(isPluginViewOpen([view], other)).toBe(false);
    expect(isPluginViewOpen([view], { ...view, tabId: 'x' })).toBe(false);
    expect(isPluginViewOpen([view], { ...view, pluginId: 'x' })).toBe(false);
  });
});

describe('window actions', () => {
  it('forwards to main on desktop', async () => {
    await expect(openPluginViewWindow(view)).resolves.toBe(true);
    await expect(closePluginViewWindow(view)).resolves.toBe(true);
    await expect(showInMainWindow('/projects/p-1')).resolves.toBe(true);
    expect(h.open).toHaveBeenCalledWith(view);
    expect(h.close).toHaveBeenCalledWith(view);
    expect(h.showInMain).toHaveBeenCalledWith('/projects/p-1');
  });

  it('resolves false when main rejects', async () => {
    h.open.mockRejectedValue(new Error('x'));
    h.close.mockRejectedValue(new Error('x'));
    h.showInMain.mockRejectedValue(new Error('x'));
    await expect(openPluginViewWindow(view)).resolves.toBe(false);
    await expect(closePluginViewWindow(view)).resolves.toBe(false);
    await expect(showInMainWindow('/')).resolves.toBe(false);
  });

  it('does nothing outside the desktop app', async () => {
    h.desktop = false;
    await expect(openPluginViewWindow(view)).resolves.toBe(false);
    await expect(closePluginViewWindow(view)).resolves.toBe(false);
    await expect(showInMainWindow('/')).resolves.toBe(false);
    expect(h.open).not.toHaveBeenCalled();
    expect(h.close).not.toHaveBeenCalled();
    expect(h.showInMain).not.toHaveBeenCalled();
  });
});
