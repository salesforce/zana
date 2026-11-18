// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import type { DesignDocDetail } from '../shared/contract.js';
import { activateDocAgent } from './Agents.js';
import { sortLinkedThreads, useDocPinned, usePinnedChanges } from './pin.js';

const hostRef = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('@zana-ai/zcc-plugin-sdk/app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zana-ai/zcc-plugin-sdk/app')>()),
  useZccNavigate: () => hostRef.current
}));

afterEach(() => cleanup());

const thread = (threadId: string, lastActivityAt: number) => ({ threadId, title: threadId, role: 'assistant' as const, lastActivityAt });

describe('sortLinkedThreads', () => {
  it('orders by last activity, newest first, without mutating the input', () => {
    const input = [thread('a', 1), thread('c', 3), thread('b', 2)];
    expect(sortLinkedThreads(input).map((item) => item.threadId)).toEqual(['c', 'b', 'a']);
    expect(input.map((item) => item.threadId)).toEqual(['a', 'c', 'b']);
    expect(sortLinkedThreads([])).toEqual([]);
  });
});

describe('activateDocAgent', () => {
  const doc = (threads: ReturnType<typeof thread>[]): Pick<DesignDocDetail, 'id' | 'title' | 'threads' | 'projectId'> => ({ id: 'doc1', title: 'Doc', threads, projectId: 'p1' });
  const navigate = (accept: boolean) => ({
    openPanelAgent: vi.fn(() => accept),
    openThreadPanel: vi.fn(() => true),
    toThread: vi.fn()
  }) as unknown as ZccNavigate & { openPanelAgent: ReturnType<typeof vi.fn>; openThreadPanel: ReturnType<typeof vi.fn>; toThread: ReturnType<typeof vi.fn> };

  it('opens the most recent linked thread even when it is listed last', () => {
    const host = navigate(true);
    activateDocAgent(host, doc([thread('old', 1), thread('recent', 9), thread('mid', 5)]));
    expect(host.openPanelAgent).toHaveBeenCalledTimes(1);
    expect(host.openPanelAgent).toHaveBeenCalledWith({ threadId: 'recent', title: 'Doc' });
    expect(host.openThreadPanel).not.toHaveBeenCalled();
  });

  it('drafts in the composer, scoped to the doc, when nothing is linked', () => {
    const host = navigate(true);
    activateDocAgent(host, doc([]));
    expect(host.openPanelAgent).toHaveBeenCalledWith(expect.objectContaining({ draft: expect.objectContaining({ view: 'doc1', projectId: 'p1' }), title: 'Doc' }));
  });

  it('stays on the doc when the host has no side panel', () => {
    const host = navigate(false);
    activateDocAgent(host, doc([thread('only', 1)]));
    expect(host.openThreadPanel).not.toHaveBeenCalled();
    expect(host.toThread).not.toHaveBeenCalled();
  });

  it('does not throw on a host without the side-panel agent API', () => {
    const host = { openThreadPanel: vi.fn(), toThread: vi.fn() } as unknown as ZccNavigate;
    expect(() => activateDocAgent(host, doc([thread('only', 1)]))).not.toThrow();
    expect(() => activateDocAgent(host, doc([]))).not.toThrow();
  });

  it('stays put on a pinned doc with a linked thread when the host lacks openPanelAgent', () => {
    const openThreadPanel = vi.fn();
    const toThread = vi.fn();
    const host = { openThreadPanel, toThread } as unknown as ZccNavigate;
    activateDocAgent(host, doc([thread('linked', 4)]));
    expect(openThreadPanel).not.toHaveBeenCalled();
    expect(toThread).not.toHaveBeenCalled();
  });

  it('does nothing when there is neither a thread nor a composer', () => {
    const host = navigate(false);
    activateDocAgent(host, doc([]));
    expect(host.openThreadPanel).not.toHaveBeenCalled();
  });
});

describe('pin hooks', () => {
  function pinHost(initial: boolean) {
    let pinned = initial;
    const listeners = new Set<() => void>();
    const host = {
      isPinned: vi.fn(() => pinned),
      onPinnedChange: vi.fn((cb: () => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      })
    };
    return { host, listeners, set(value: boolean) { pinned = value; listeners.forEach((cb) => cb()); } };
  }

  it('useDocPinned follows host pin changes and unsubscribes on unmount', () => {
    const h = pinHost(false);
    hostRef.current = h.host;
    const view = renderHook(() => useDocPinned('doc1'));
    expect(view.result.current).toBe(false);
    expect(h.host.isPinned).toHaveBeenCalledWith('doc1');
    act(() => h.set(true));
    expect(view.result.current).toBe(true);
    view.unmount();
    expect(h.listeners.size).toBe(0);
  });

  it('useDocPinned is false on a host without the pin API', () => {
    hostRef.current = {};
    const view = renderHook(() => useDocPinned('doc1'));
    expect(view.result.current).toBe(false);
    expect(() => view.unmount()).not.toThrow();
  });

  it('usePinnedChanges re-renders on pin changes and unsubscribes on unmount', () => {
    const h = pinHost(false);
    hostRef.current = h.host;
    let renders = 0;
    const view = renderHook(() => { renders += 1; usePinnedChanges(); });
    const before = renders;
    act(() => h.set(true));
    expect(renders).toBeGreaterThan(before);
    view.unmount();
    expect(h.listeners.size).toBe(0);
  });

  it('usePinnedChanges is inert on a host without the pin API', () => {
    hostRef.current = {};
    const view = renderHook(() => usePinnedChanges());
    expect(() => view.unmount()).not.toThrow();
  });
});
