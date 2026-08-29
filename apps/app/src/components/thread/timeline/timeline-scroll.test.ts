import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  THREAD_SCROLLBAR_IDLE_MS,
  clearTransientScrollbarScrolling,
  markTransientScrollbarScrolling
} from './timeline-scroll.js';

afterEach(() => {
  vi.useRealTimers();
});

function fakeScrollArea() {
  return {
    dataset: {} as { scrollbarScrolling?: string },
    removeAttribute(name: string) {
      if (name === 'data-scrollbar-scrolling') delete this.dataset.scrollbarScrolling;
    }
  };
}

describe('transient thread scrollbar', () => {
  it('shows the thread scrollbar only while scroll events are active', () => {
    vi.useFakeTimers();
    const scrollArea = fakeScrollArea();
    const idleTimeout = { current: null as ReturnType<typeof setTimeout> | null };

    markTransientScrollbarScrolling(scrollArea, idleTimeout);
    expect(scrollArea.dataset.scrollbarScrolling).toBe('true');

    vi.advanceTimersByTime(THREAD_SCROLLBAR_IDLE_MS - 1);
    expect(scrollArea.dataset.scrollbarScrolling).toBe('true');

    vi.advanceTimersByTime(1);
    expect(scrollArea.dataset.scrollbarScrolling).toBeUndefined();
  });

  it('keeps the thumb visible while scroll events keep arriving', () => {
    vi.useFakeTimers();
    const scrollArea = fakeScrollArea();
    const idleTimeout = { current: null as ReturnType<typeof setTimeout> | null };

    markTransientScrollbarScrolling(scrollArea, idleTimeout);
    vi.advanceTimersByTime(THREAD_SCROLLBAR_IDLE_MS - 50);
    markTransientScrollbarScrolling(scrollArea, idleTimeout);
    vi.advanceTimersByTime(THREAD_SCROLLBAR_IDLE_MS - 1);
    expect(scrollArea.dataset.scrollbarScrolling).toBe('true');

    vi.advanceTimersByTime(1);
    expect(scrollArea.dataset.scrollbarScrolling).toBeUndefined();
  });

  it('clears a pending idle timer on unmount', () => {
    vi.useFakeTimers();
    const scrollArea = fakeScrollArea();
    const idleTimeout = { current: null as ReturnType<typeof setTimeout> | null };

    markTransientScrollbarScrolling(scrollArea, idleTimeout);
    clearTransientScrollbarScrolling(scrollArea, idleTimeout);
    expect(scrollArea.dataset.scrollbarScrolling).toBeUndefined();
    expect(idleTimeout.current).toBeNull();

    vi.runAllTimers();
    expect(scrollArea.dataset.scrollbarScrolling).toBeUndefined();
  });
});
