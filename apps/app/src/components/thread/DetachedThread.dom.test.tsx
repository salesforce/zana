/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  surface: false,
  open: [] as Array<{ threadId: string; projectId?: string }>,
  focus: vi.fn(async () => true),
  close: vi.fn(async () => true)
}));
vi.mock('../../lib/threadViewSurface.js', () => ({ isThreadViewSurface: () => h.surface }));
vi.mock('../../lib/thread-view-windows.js', () => ({
  useThreadViewWindows: () => h.open,
  isThreadViewOpen: (open: Array<{ threadId: string }>, threadId: string) => open.some((view) => view.threadId === threadId),
  openThreadViewWindow: h.focus,
  closeThreadViewWindow: h.close
}));

import { DetachedThread, useThreadDetached } from './DetachedThread.js';

beforeEach(() => {
  h.surface = false;
  h.open = [{ threadId: 't-1' }];
  h.focus.mockClear();
  h.close.mockClear();
});
afterEach(cleanup);

it('treats a thread open in its own window as detached everywhere but there', () => {
  expect(renderHook(() => useThreadDetached('t-1')).result.current).toBe(true);
  expect(renderHook(() => useThreadDetached('t-2')).result.current).toBe(false);
  h.surface = true;
  expect(renderHook(() => useThreadDetached('t-1')).result.current).toBe(false);
});

it('focuses the thread window or brings the thread back', () => {
  render(<DetachedThread threadId="t-1" projectId="p-1" />);
  expect(screen.getByText('This agent is open in its own window')).toBeTruthy();
  fireEvent.click(screen.getByTestId('thread-detached-focus'));
  expect(h.focus).toHaveBeenCalledWith({ threadId: 't-1', projectId: 'p-1' });
  fireEvent.click(screen.getByTestId('thread-detached-bring-back'));
  expect(h.close).toHaveBeenCalledWith({ threadId: 't-1', projectId: 'p-1' });
});

it('targets a thread with no project by id alone', () => {
  render(<DetachedThread threadId="t-1" projectId={null} />);
  fireEvent.click(screen.getByTestId('thread-detached-focus'));
  expect(h.focus).toHaveBeenCalledWith({ threadId: 't-1' });
});
