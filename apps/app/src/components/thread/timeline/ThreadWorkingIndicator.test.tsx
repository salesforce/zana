/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
    render(<ThreadWorkingIndicator status="active" thinking={thinkingWithText} />);
    expect(screen.getByText('Thinking…')).toBeTruthy();
    expect(screen.getByText('Inspect nearby files.')).toBeTruthy();
    expect(screen.queryByText('Planning next move…')).toBeNull();
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
});
