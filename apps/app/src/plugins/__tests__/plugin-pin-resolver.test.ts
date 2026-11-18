/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applicationTabId, useApplicationTabs, type PluginApplicationTab } from '../../lib/application-tabs.js';
import { usePluginAppModules } from '../plugin-app-loader.js';
import { getTabDisplayTitle, usePinnedItemOverrides } from '../plugin-pinned-tabs.js';
import { createPinResolver, parseResolvePinResult, usePluginPinResolver } from '../plugin-pin-resolver.js';

const rpc = vi.hoisted(() => ({ callRpc: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({
  product: { pluginApps: { callRpc: (...args: unknown[]) => rpc.callRpc(...args) } }
}));

const tab = (itemKey = 'a', over: Partial<PluginApplicationTab> = {}): PluginApplicationTab => ({
  kind: 'plugin',
  pluginId: 'test-plugin',
  pageId: 'main',
  itemKey,
  title: 'Old',
  projectId: 'p1',
  ...over
});
const reported = (t: PluginApplicationTab) => usePinnedItemOverrides.getState().byId[applicationTabId(t)];
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  useApplicationTabs.setState({ open: [tab('a'), tab('b'), tab('c'), tab('d'), tab('e'), tab('f')], closed: [] });
  usePinnedItemOverrides.setState({ byId: {} });
  usePluginAppModules.setState({ reconciled: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('parseResolvePinResult', () => {
  it('accepts availability with an optional valid title', () => {
    expect(parseResolvePinResult(tab(), { available: true, title: 'New' })).toEqual({ available: true, title: 'New' });
    expect(parseResolvePinResult(tab(), { available: false })).toEqual({ available: false });
  });
  it('drops an oversized or control-character title but keeps availability', () => {
    expect(parseResolvePinResult(tab(), { available: true, title: 'x'.repeat(121) })).toEqual({ available: true });
    expect(parseResolvePinResult(tab(), { available: false, title: 'a\u0000b' })).toEqual({ available: false });
    expect(parseResolvePinResult(tab(), { available: true, title: 5 })).toEqual({ available: true });
  });
  it('rejects malformed replies', () => {
    for (const value of [null, undefined, 'x', 7, {}, { available: 'yes' }]) {
      expect(parseResolvePinResult(tab(), value)).toBeNull();
    }
  });
});

describe('createPinResolver', () => {
  it('calls the owner plugin with the item key and project, and applies a rename', async () => {
    const callRpc = vi.fn().mockResolvedValue({ available: true, title: 'Renamed' });
    createPinResolver({ callRpc }).request(tab());
    await flush();
    expect(callRpc).toHaveBeenCalledWith('test-plugin', 'resolvePin', { itemKey: 'a', projectId: 'p1' });
    expect(getTabDisplayTitle(tab())).toBe('Renamed');
    expect(reported(tab())).toEqual({ available: true, title: 'Renamed' });
  });

  it('marks a not-found item unavailable', async () => {
    const callRpc = vi.fn().mockResolvedValue({ available: false });
    createPinResolver({ callRpc }).request(tab());
    await flush();
    expect(reported(tab())).toEqual({ available: false });
  });

  it('keeps the previous state on timeout, then ignores the late reply', async () => {
    usePinnedItemOverrides.getState().merge(applicationTabId(tab()), { title: 'Prior' });
    let late!: (value: unknown) => void;
    const callRpc = vi.fn(() => new Promise((resolve) => { late = resolve; }));
    const resolver = createPinResolver({ callRpc, timeoutMs: 3000 });
    resolver.request(tab());
    await vi.advanceTimersByTimeAsync(3000);
    late({ available: false, title: 'Late' });
    await flush();
    expect(reported(tab())).toEqual({ title: 'Prior' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps state on rejection, a synchronous throw, a missing method and a bad reply', async () => {
    const replies = [
      () => Promise.reject(new Error('Unknown method resolvePin')),
      () => { throw new Error('boom'); },
      () => Promise.resolve(undefined),
      () => Promise.resolve({ available: 'maybe' })
    ];
    for (const [index, reply] of replies.entries()) {
      createPinResolver({ callRpc: vi.fn(reply) }).request(tab(String.fromCharCode(97 + index)));
    }
    await flush();
    expect(usePinnedItemOverrides.getState().byId).toEqual({});
  });

  it('allows one call per tab per interval', async () => {
    let clock = 0;
    const callRpc = vi.fn().mockResolvedValue({ available: true });
    const resolver = createPinResolver({ callRpc, now: () => clock });
    resolver.request(tab());
    await flush();
    clock = 29_999;
    resolver.request(tab());
    resolver.request(tab('b'));
    await flush();
    expect(callRpc).toHaveBeenCalledTimes(2);
    clock = 30_000;
    resolver.request(tab());
    await flush();
    expect(callRpc).toHaveBeenCalledTimes(3);
  });

  it('runs at most four calls at once and drains the queue as they finish', async () => {
    const pending: Array<(value: unknown) => void> = [];
    const callRpc = vi.fn(() => new Promise((resolve) => { pending.push(resolve); }));
    const resolver = createPinResolver({ callRpc });
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) resolver.request(tab(key));
    expect(callRpc).toHaveBeenCalledTimes(4);
    pending[0]!({ available: true });
    await flush();
    expect(callRpc).toHaveBeenCalledTimes(5);
    pending[1]!({ available: true });
    await flush();
    expect(callRpc).toHaveBeenCalledTimes(6);
  });

  it('frees a slot on timeout so queued tabs still run', async () => {
    const callRpc = vi.fn(() => new Promise(() => undefined));
    const resolver = createPinResolver({ callRpc, maxInFlight: 1, timeoutMs: 100 });
    resolver.request(tab('a'));
    resolver.request(tab('b'));
    expect(callRpc).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(callRpc).toHaveBeenCalledTimes(2);
  });

  it('does not apply results for tabs that were closed meanwhile', async () => {
    useApplicationTabs.setState({ open: [], closed: [] });
    const callRpc = vi.fn().mockResolvedValue({ available: false });
    createPinResolver({ callRpc }).request(tab());
    await flush();
    expect(usePinnedItemOverrides.getState().byId).toEqual({});
  });

  it('releases timers and drops late results when disposed', async () => {
    let late!: (value: unknown) => void;
    const callRpc = vi.fn(() => new Promise((resolve) => { late = resolve; }));
    const resolver = createPinResolver({ callRpc, maxInFlight: 1 });
    resolver.request(tab('a'));
    resolver.request(tab('b'));
    expect(vi.getTimerCount()).toBe(1);
    resolver.dispose();
    expect(vi.getTimerCount()).toBe(0);
    late({ available: false });
    await flush();
    resolver.request(tab('c'));
    expect(callRpc).toHaveBeenCalledTimes(1);
    expect(usePinnedItemOverrides.getState().byId).toEqual({});
  });
});

describe('usePluginPinResolver', () => {
  let resolve: ((tab: PluginApplicationTab) => void) | undefined;
  const mount = () => {
    const view = renderHook(() => usePluginPinResolver());
    resolve = (target) => view.result.current.resolve(target);
    return view;
  };

  beforeEach(() => {
    rpc.callRpc.mockReset().mockResolvedValue({ available: true });
  });

  it('refreshes plugin tabs once plugins have reconciled, on tab changes, and on demand', async () => {
    usePluginAppModules.setState({ reconciled: false });
    useApplicationTabs.setState({ open: [tab('a')], closed: [] });
    mount();
    expect(rpc.callRpc).not.toHaveBeenCalled();
    await act(async () => {
      usePluginAppModules.setState({ reconciled: true });
    });
    expect(rpc.callRpc).toHaveBeenCalledTimes(1);
    await act(async () => {
      useApplicationTabs.setState({ open: [tab('a'), tab('b')] });
    });
    expect(rpc.callRpc).toHaveBeenCalledTimes(2);
    act(() => resolve!(tab('a')));
    expect(rpc.callRpc).toHaveBeenCalledTimes(2);
  });

  it('prunes entries for closed tabs', async () => {
    useApplicationTabs.setState({ open: [tab('a')], closed: [] });
    usePinnedItemOverrides.getState().merge(applicationTabId(tab('gone')), { available: false });
    mount();
    expect(usePinnedItemOverrides.getState().byId[applicationTabId(tab('gone'))]).toBeUndefined();
  });

  it('releases its subscriptions and timers on unmount', async () => {
    let finish!: (value: unknown) => void;
    rpc.callRpc.mockReturnValue(new Promise((resolveCall) => { finish = resolveCall; }));
    useApplicationTabs.setState({ open: [tab('a')], closed: [] });
    const view = mount();
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    const calls = rpc.callRpc.mock.calls.length;
    await act(async () => {
      useApplicationTabs.setState({ open: [tab('a'), tab('z')] });
      usePluginAppModules.setState({ reconciled: true, modules: [] });
      finish({ available: false });
    });
    expect(rpc.callRpc.mock.calls.length).toBe(calls);
    expect(usePinnedItemOverrides.getState().byId).toEqual({});
    act(() => resolve!(tab('a')));
    expect(rpc.callRpc.mock.calls.length).toBe(calls);
  });
});
