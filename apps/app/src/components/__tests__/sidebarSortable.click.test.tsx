// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST_DRAG_CLICK_SUPPRESS_MS } from '../../lib/suppress-post-drag-click.js';
import { PROJECT_NAV_ORDER_KEY, useSortableSidebarNav } from '../sidebarSortable.js';

function renderRail() {
  return renderHook(() => useSortableSidebarNav(PROJECT_NAV_ORDER_KEY, ['agents', 'explorer'], []));
}

function pointerDrag(rail: ReturnType<typeof renderRail>, end: 'end' | 'cancel') {
  act(() => {
    rail.result.current.onDragStart({ activatorEvent: new Event('pointerdown') } as DragStartEvent);
    if (end === 'end') {
      rail.result.current.onDragEnd({ active: { id: 'agents' }, over: null } as unknown as DragEndEvent);
    } else {
      rail.result.current.onDragCancel();
    }
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useSortableSidebarNav post-drag clicks', () => {
  it('swallows the click the drag itself leaves behind', () => {
    const rail = renderRail();
    pointerDrag(rail, 'end');
    expect(rail.result.current.consumeNavClick()).toBe(true);
    expect(rail.result.current.consumeNavClick()).toBe(false);
  });

  it('lets a fresh press through even before the timeout', () => {
    const rail = renderRail();
    pointerDrag(rail, 'cancel');
    document.dispatchEvent(new Event('pointerdown'));
    expect(rail.result.current.consumeNavClick()).toBe(false);
  });

  it('lets a fresh key through even before the timeout', () => {
    const rail = renderRail();
    pointerDrag(rail, 'end');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta' }));
    expect(rail.result.current.consumeNavClick()).toBe(false);
  });

  it('stops swallowing once the timeout passes', () => {
    const rail = renderRail();
    pointerDrag(rail, 'cancel');
    vi.advanceTimersByTime(POST_DRAG_CLICK_SUPPRESS_MS);
    expect(rail.result.current.consumeNavClick()).toBe(false);
  });

  it('never swallows clicks after a keyboard reorder', () => {
    const rail = renderRail();
    act(() => {
      rail.result.current.onDragStart({ activatorEvent: new KeyboardEvent('keydown') } as DragStartEvent);
      rail.result.current.onDragCancel();
    });
    expect(rail.result.current.consumeNavClick()).toBe(false);
  });
});
