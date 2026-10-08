/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ActiveThinking } from '@zana-ai/zcc-domain/thread-runtime';
import { THREAD_WORKING_PHRASES } from '../thread-timeline-model.js';
import { ThreadWorkingIndicator } from './ThreadBanners.js';

const thinking: ActiveThinking = { id: 'th1', text: '', startedAt: 1, updatedAt: 1 };
const thinkingWithText: ActiveThinking = {
  id: 'th1',
  text: 'Inspect nearby files.',
  startedAt: 1,
  updatedAt: 1
};

describe('ThreadWorkingIndicator', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows Thinking… while reasoning and restores the same working phrase after', () => {
    const { rerender } = render(
      <ThreadWorkingIndicator status="active" thinking={null} />
    );
    expect(screen.getByText('Planning next move…')).toBeTruthy();

    rerender(<ThreadWorkingIndicator status="active" thinking={thinking} />);
    expect(screen.getByText('Thinking…')).toBeTruthy();
    expect(screen.queryByText('Planning next move…')).toBeNull();
    expect(screen.queryByText(`${THREAD_WORKING_PHRASES[1]}…`)).toBeNull();

    rerender(<ThreadWorkingIndicator status="active" thinking={null} />);
    expect(screen.getByText('Planning next move…')).toBeTruthy();
    expect(screen.queryByText('Thinking…')).toBeNull();
    expect(screen.queryByText(`${THREAD_WORKING_PHRASES[1]}…`)).toBeNull();
  });

  it('keeps expandable thinking details while reasoning text is streaming', () => {
    const { container } = render(<ThreadWorkingIndicator status="active" thinking={thinkingWithText} />);
    expect(screen.getByText('Thinking…')).toBeTruthy();
    expect(screen.getByTestId('thread-thinking').querySelector('.thread-thinking-details')?.textContent).toBe('Inspect nearby files.');
    expect(screen.queryByText('Planning next move…')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Thinking…');
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
    expect(container.querySelector('summary .thread-activity-spark')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('summary .thread-timeline-work-chevron')).not.toBeNull();
    expect(container.querySelector('details')?.open).toBe(false);
    expect(container.querySelector('details')?.classList.contains('has-thinking')).toBe(true);
    expect(screen.getByRole('status').classList.contains('is-shimmer')).toBe(true);
    const peek = container.querySelector('summary .thread-thinking-peek');
    expect(peek?.textContent).toBe('Inspect nearby files.');
    expect(peek?.getAttribute('aria-hidden')).toBe('true');
  });

  it('uses the same compact treatment without a disclosure for plain progress', () => {
    const { container, rerender } = render(<ThreadWorkingIndicator status="active" thinking={null} />);
    expect(screen.getByRole('status').textContent).toBe('Planning next move…');
    expect(container.querySelectorAll('.thread-activity-spark')).toHaveLength(1);
    expect(container.querySelector('.thread-thinking-peek')).toBeNull();
    expect(container.querySelector('summary')).toBeNull();
    expect(container.querySelector('.thread-working-indicator-gutter')).toBeNull();
    rerender(<ThreadWorkingIndicator status="active" thinking={null} waitingOnUser />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('advances the working phrase only after the indicator hides', () => {
    const { rerender } = render(
      <ThreadWorkingIndicator status="active" thinking={null} />
    );
    rerender(<ThreadWorkingIndicator status="idle" thinking={null} />);
    rerender(<ThreadWorkingIndicator status="active" thinking={null} />);
    expect(screen.getByText(`${THREAD_WORKING_PHRASES[1]}…`)).toBeTruthy();
    expect(screen.queryByText('Planning next move…')).toBeNull();
  });

  it('hides leftover thinking when the thread is idle or waiting for the host', () => {
    const { rerender } = render(
      <ThreadWorkingIndicator status="idle" thinking={thinkingWithText} />
    );
    expect(screen.queryByTestId('thread-thinking')).toBeNull();
    rerender(<ThreadWorkingIndicator status="waiting-for-host" thinking={thinkingWithText} />);
    expect(screen.queryByTestId('thread-thinking')).toBeNull();
  });

  it('shows Waiting for reconnection instead of a planning phrase', () => {
    render(<ThreadWorkingIndicator status="host-reconnecting" thinking={null} />);
    expect(screen.getByText('Waiting for reconnection…')).toBeTruthy();
    expect(screen.queryByText('Planning next move…')).toBeNull();
  });

  it('hides thinking while tools are running and keeps the same phrase after', () => {
    const { rerender } = render(
      <ThreadWorkingIndicator status="active" thinking={thinkingWithText} hasRunningWork />
    );
    expect(screen.queryByTestId('thread-thinking')).toBeNull();
    rerender(
      <ThreadWorkingIndicator status="active" thinking={thinkingWithText} hasRunningWork={false} />
    );
    expect(screen.getByText('Thinking…')).toBeTruthy();
    expect(screen.getByTestId('thread-thinking').querySelector('.thread-thinking-details')?.textContent).toBe('Inspect nearby files.');
    rerender(
      <ThreadWorkingIndicator status="active" thinking={null} hasRunningWork={false} />
    );
    expect(screen.getByText('Planning next move…')).toBeTruthy();
    expect(screen.queryByText(`${THREAD_WORKING_PHRASES[1]}…`)).toBeNull();
  });

  it('still shows reconnection copy when tools were left running', () => {
    render(
      <ThreadWorkingIndicator status="host-reconnecting" thinking={null} hasRunningWork />
    );
    expect(screen.getByText('Waiting for reconnection…')).toBeTruthy();
  });

  it('peeks at the newest reasoning line', () => {
    const { container } = render(
      <ThreadWorkingIndicator
        status="active"
        thinking={{ ...thinkingWithText, text: 'Read the scheduler test.\n\nThe beforeEach never clears tmp.' }}
      />
    );
    expect(container.querySelector('.thread-thinking-peek')?.textContent).toBe('The beforeEach never clears tmp.');
  });

  it('shows an elapsed clock outside the live region and restarts it per busy span', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<ThreadWorkingIndicator status="active" thinking={null} />);
    expect(container.querySelector('.thread-activity-elapsed')).toBeNull();
    act(() => { vi.advanceTimersByTime(12_000); });
    const elapsed = container.querySelector('.thread-activity-elapsed');
    expect(elapsed?.textContent).toBe('· 12s');
    expect(elapsed?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Planning next move…');

    rerender(<ThreadWorkingIndicator status="idle" thinking={null} />);
    rerender(<ThreadWorkingIndicator status="active" thinking={null} />);
    expect(container.querySelector('.thread-activity-elapsed')).toBeNull();
    act(() => { vi.advanceTimersByTime(65_000); });
    expect(container.querySelector('.thread-activity-elapsed')?.textContent).toBe('· 1m 05s');
  });

  it('restarts the clock when tools take over and hand back', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<ThreadWorkingIndicator status="active" thinking={null} />);
    act(() => { vi.advanceTimersByTime(5_000); });
    rerender(<ThreadWorkingIndicator status="active" thinking={null} hasRunningWork />);
    act(() => { vi.advanceTimersByTime(30_000); });
    rerender(<ThreadWorkingIndicator status="active" thinking={null} hasRunningWork={false} />);
    expect(container.querySelector('.thread-activity-elapsed')).toBeNull();
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(container.querySelector('.thread-activity-elapsed')?.textContent).toBe('· 2s');
  });
});
