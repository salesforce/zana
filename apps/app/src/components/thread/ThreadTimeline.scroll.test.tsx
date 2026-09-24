// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ThreadTimeline } from './ThreadTimeline.js';
import { dispatchOptimisticUserMessage, dispatchThreadMessageSent, THREAD_MESSAGE_SENT_EVENT } from './timeline/thread-optimistic-events.js';

vi.mock('./timeline/TimelineRows.js', () => ({ TimelineRows: () => <div>Conversation</div> }));
vi.mock('./timeline/ThreadBanners.js', () => ({
  ThreadGoalBanner: () => null,
  ThreadHostDisconnectedBanner: () => null,
  ThreadTimelineLoadError: () => null,
  ThreadWorkflowChips: () => null,
  ThreadWorkingIndicator: () => null,
  ThreadTodoCard: () => null,
  ThreadPromptModeCard: () => null
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fixture(threadId: string | undefined = 'thread-1') {
  const observers: Array<{ resize: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(public resize: () => void) { observers.push(this); }
  });
  const result = render(<ThreadTimeline threadId={threadId} rows={[]} status="idle" thinking={null} />);
  const pane = screen.getByTestId('thread-timeline');
  const size = { height: 600, content: 1800 };
  Object.defineProperties(pane, {
    clientHeight: { get: () => size.height },
    scrollHeight: { get: () => size.content }
  });
  act(() => observers.at(-1)!.resize());
  return { ...result, pane, size, observers };
}

it('keeps the newest message visible when keyboard/options resize the timeline', () => {
  const { pane, size, observers, unmount } = fixture();
  const observer = observers.at(-1)!;
  expect(observer.observe).toHaveBeenCalledWith(pane);
  expect(observer.observe).toHaveBeenCalledWith(pane.firstElementChild);
  expect(pane.scrollTop).toBe(1200);
  size.height = 300;
  act(() => observer.resize());
  expect(pane.scrollTop).toBe(1500);
  fireEvent.scroll(pane);
  expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).toBeNull();
  size.height = 700;
  act(() => observer.resize());
  expect(pane.scrollTop).toBe(1100);
  unmount();
  expect(observer.disconnect).toHaveBeenCalled();
});

it('preserves scrollback until a local send, then follows the new reply', () => {
  const { pane, size, observers } = fixture();
  const previousObserver = observers.at(-1)!;
  pane.scrollTop = 100;
  fireEvent.scroll(pane);
  expect(previousObserver.disconnect).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Scroll to bottom' })).toBeTruthy();
  act(() => {
    dispatchThreadMessageSent('other-thread');
    dispatchOptimisticUserMessage('thread-1', null);
    window.dispatchEvent(new Event(THREAD_MESSAGE_SENT_EVENT));
  });
  expect(pane.scrollTop).toBe(100);
  act(() => dispatchThreadMessageSent('thread-1'));
  expect(pane.scrollTop).toBe(1200);
  expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).toBeNull();
  size.content += 400;
  act(() => observers.at(-1)!.resize());
  expect(pane.scrollTop).toBe(1600);
});

it('does not mistake a delayed programmatic scroll for scrollback after a reply grows', () => {
  const { pane, size, observers } = fixture();
  const observer = observers.at(-1)!;
  expect(pane.scrollTop).toBe(1200);
  // WebView delivers the pin's scroll event after the new response is laid out,
  // but before ResizeObserver has delivered the response's new dimensions.
  size.content += 400;
  fireEvent.scroll(pane);
  expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).toBeNull();
  expect(observer.disconnect).not.toHaveBeenCalled();
  act(() => observer.resize());
  expect(pane.scrollTop).toBe(1600);
  // A real upward movement must still release following.
  pane.scrollTop = 1400;
  fireEvent.scroll(pane);
  expect(screen.getByRole('button', { name: 'Scroll to bottom' })).toBeTruthy();
});

it('resumes following for queued sends without optimistic rows and cleans up listeners', () => {
  const remove = vi.spyOn(window, 'removeEventListener');
  const { pane, rerender, unmount } = fixture();
  pane.scrollTop = 100;
  fireEvent.scroll(pane);
  act(() => dispatchThreadMessageSent('thread-1'));
  expect(pane.scrollTop).toBe(1200);
  rerender(<ThreadTimeline threadId="thread-2" rows={[]} status="idle" thinking={null} />);
  expect(remove).toHaveBeenCalledWith(THREAD_MESSAGE_SENT_EVENT, expect.any(Function));
  pane.scrollTop = 100;
  fireEvent.scroll(pane);
  act(() => dispatchThreadMessageSent('thread-1'));
  expect(pane.scrollTop).toBe(100);
  act(() => dispatchThreadMessageSent('thread-2'));
  expect(pane.scrollTop).toBe(1200);
  unmount();
  expect(remove.mock.calls.filter(([name]) => name === THREAD_MESSAGE_SENT_EVENT)).toHaveLength(2);
});

it('supports unscoped timelines and manual return to the latest message', () => {
  const { pane, rerender } = fixture();
  rerender(<ThreadTimeline rows={[]} status="idle" thinking={null} />);
  pane.scrollTop = 100;
  fireEvent.scroll(pane);
  act(() => dispatchThreadMessageSent('thread-1'));
  expect(pane.scrollTop).toBe(100);
  fireEvent.click(screen.getByRole('button', { name: 'Scroll to bottom' }));
  expect(pane.scrollTop).toBe(1200);
});
