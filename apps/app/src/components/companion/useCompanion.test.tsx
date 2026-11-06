// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CompanionRequest, CompanionSnapshot } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({
  request: vi.fn(),
  onSnapshot: vi.fn(),
  off: vi.fn()
}));
vi.mock('../../lib/product-client.js', () => ({
  product: { companion: { request: h.request, onSnapshot: h.onSnapshot } }
}));
import { ANSWERED_STORAGE_KEY } from './companion-model.js';
import { EMPTY_SNAPSHOT, useCompanion, useNow } from './useCompanion.js';

let push: (s: CompanionSnapshot) => void;

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  h.off.mockReset();
  h.request.mockReset().mockResolvedValue(null);
  h.onSnapshot.mockReset().mockImplementation((cb: (s: CompanionSnapshot) => void) => {
    push = cb;
    return h.off;
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const req = (over: Partial<CompanionRequest> = {}): CompanionRequest => ({
  id: 'inbox:e1',
  kind: 'question',
  entryId: 'e1',
  projectId: 'p',
  projectName: 'P',
  agentTitle: 'A',
  prompt: 'q',
  ts: 0,
  answerable: true,
  ...over
});
const snap = (over: Partial<CompanionSnapshot> = {}): CompanionSnapshot => ({ ...EMPTY_SNAPSHOT, ...over });

it('hydrates from the requested snapshot and applies the theme', async () => {
  h.request.mockResolvedValue(snap({ theme: 'light', requests: [req()] }));
  const { result } = renderHook(() => useCompanion());
  expect(result.current.snapshot).toBe(EMPTY_SNAPSHOT);
  await act(async () => {});
  expect(result.current.pending).toHaveLength(1);
  expect(document.documentElement.dataset.theme).toBe('light');
});

it('applies live pushes and ignores a request() that rejects', async () => {
  h.request.mockRejectedValue(new Error('x'));
  const { result } = renderHook(() => useCompanion());
  await act(async () => {});
  act(() => push(snap({ theme: 'light', userInitials: 'PC' })));
  expect(result.current.snapshot.userInitials).toBe('PC');
});

it('does not apply a late request() result after unmount, and unsubscribes', async () => {
  let resolve!: (s: CompanionSnapshot) => void;
  h.request.mockReturnValue(new Promise((r) => (resolve = r)));
  const { unmount } = renderHook(() => useCompanion());
  unmount();
  expect(h.off).toHaveBeenCalled();
  await act(async () => resolve(snap()));
});

it('hides answered entries (resolve) and follows cross-window storage events', async () => {
  h.request.mockResolvedValue(snap({ requests: [req(), req({ id: 'inbox:e2', entryId: 'e2' })] }));
  const { result } = renderHook(() => useCompanion());
  await act(async () => {});
  act(() => result.current.resolve(result.current.pending[0]));
  expect(result.current.pending.map((r) => r.id)).toEqual(['inbox:e2']);
  expect(localStorage.getItem(ANSWERED_STORAGE_KEY)).toContain('e1');

  localStorage.setItem(
    ANSWERED_STORAGE_KEY,
    JSON.stringify({ state: { answeredIds: { e1: true, e2: true } }, version: 1 })
  );
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
  });
  expect(result.current.pending).toHaveLength(1);
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: ANSWERED_STORAGE_KEY }));
  });
  expect(result.current.pending).toHaveLength(0);
});

it('dismisses entry-less requests locally and brings them back after DISMISS_MS', async () => {
  vi.useFakeTimers();
  const blocked = req({ id: 'agent:s1', kind: 'blocked', entryId: undefined });
  h.request.mockResolvedValue(snap({ requests: [blocked] }));
  const { result } = renderHook(() => useCompanion());
  await act(async () => {});
  expect(result.current.pending).toHaveLength(1);
  act(() => result.current.resolve(blocked));
  expect(result.current.pending).toHaveLength(0);
  act(() => {
    vi.advanceTimersByTime(30_000);
  });
  expect(result.current.pending).toHaveLength(1);
});

it('expires each dismissal on time even when another request is dismissed later', async () => {
  vi.useFakeTimers({ now: 1000 });
  const first = req({ id: 'agent:a', entryId: undefined });
  const second = req({ id: 'agent:b', entryId: undefined });
  h.request.mockResolvedValue(snap({ requests: [first, second] }));
  const { result } = renderHook(() => useCompanion());
  await act(async () => {});
  act(() => result.current.resolve(first));
  act(() => vi.advanceTimersByTime(10_000));
  act(() => result.current.resolve(second));
  act(() => vi.advanceTimersByTime(20_000));
  expect(result.current.pending.map(r => r.id)).toEqual(['agent:a']);
  act(() => vi.advanceTimersByTime(10_000));
  expect(result.current.pending).toHaveLength(2);
});

it('survives an unavailable localStorage', async () => {
  const spy = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new Error('denied');
  });
  h.request.mockResolvedValue(snap({ requests: [req()] }));
  const { result } = renderHook(() => useCompanion());
  await act(async () => {});
  act(() => result.current.resolve(result.current.pending[0]));
  expect(result.current.pending).toHaveLength(0);
  spy.mockRestore();
});

it('useNow ticks on its interval and cleans up', () => {
  vi.useFakeTimers({ now: 1000 });
  const { result, unmount } = renderHook(() => useNow(10));
  expect(result.current).toBe(1000);
  act(() => {
    vi.advanceTimersByTime(10);
  });
  expect(result.current).toBe(1010);
  unmount();
});
