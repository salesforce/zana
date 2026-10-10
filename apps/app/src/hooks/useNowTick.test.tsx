// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNowTick } from './useNowTick.js';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('re-renders on every interval and stops after unmount', () => {
  const { result, unmount } = renderHook(() => useNowTick(30_000));
  expect(result.current).toBe(1_000_000);
  act(() => { vi.advanceTimersByTime(30_000); });
  expect(result.current).toBe(1_030_000);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
