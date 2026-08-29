import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  POST_DRAG_CLICK_SUPPRESS_MS,
  suppressPostDragClick
} from './suppress-post-drag-click.js';

function stubDocument() {
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();
  vi.stubGlobal('document', { addEventListener, removeEventListener });
  return { addEventListener, removeEventListener };
}

function clickEvent() {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn()
  };
}

describe('suppressPostDragClick', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('cancels the next click and unhooks before a later one', () => {
    const { addEventListener, removeEventListener } = stubDocument();
    suppressPostDragClick(1_000);
    expect(addEventListener).toHaveBeenCalledWith('click', expect.any(Function), true);
    const onClick = addEventListener.mock.calls[0][1] as (event: ReturnType<typeof clickEvent>) => void;

    const first = clickEvent();
    onClick(first);
    expect(first.preventDefault).toHaveBeenCalled();
    expect(first.stopPropagation).toHaveBeenCalled();
    expect(first.stopImmediatePropagation).toHaveBeenCalled();
    expect(removeEventListener).toHaveBeenCalledWith('click', onClick, true);

    const later = clickEvent();
    onClick(later);
    expect(later.preventDefault).not.toHaveBeenCalled();
  });

  it('expires so a delayed real click still works', () => {
    vi.useFakeTimers();
    const { addEventListener, removeEventListener } = stubDocument();
    suppressPostDragClick(POST_DRAG_CLICK_SUPPRESS_MS);
    const onClick = addEventListener.mock.calls[0][1] as (event: ReturnType<typeof clickEvent>) => void;
    vi.advanceTimersByTime(POST_DRAG_CLICK_SUPPRESS_MS);
    expect(removeEventListener).toHaveBeenCalledWith('click', onClick, true);
  });

  it('can be released before a click arrives', () => {
    const { addEventListener, removeEventListener } = stubDocument();
    const cleanup = suppressPostDragClick(1_000);
    const onClick = addEventListener.mock.calls[0][1] as (event: ReturnType<typeof clickEvent>) => void;
    cleanup();
    cleanup();
    expect(removeEventListener).toHaveBeenCalledWith('click', onClick, true);
    expect(removeEventListener).toHaveBeenCalledTimes(1);
    const event = clickEvent();
    onClick(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('is a no-op when document is unavailable', () => {
    const cleanup = suppressPostDragClick();
    expect(cleanup).toEqual(expect.any(Function));
    cleanup();
  });
});
