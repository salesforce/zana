/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  THREAD_WORKING_PHRASES,
  nextWorkingPhraseTick,
  threadStatusLabel,
  threadWorkingIndicatorLabel,
  threadWorkingPhrase,
  threadWorkingPhraseIndex
} from './thread-timeline-model.js';
import { useThreadWorkingPhrase } from './useThreadWorkingPhrase.js';

function Probe({ active = true }: { active?: boolean }) {
  return <span>{useThreadWorkingPhrase(active)}</span>;
}

describe('thread working phrases', () => {
  it('keeps ten unique planning phrases and starts with Planning next move', () => {
    expect(THREAD_WORKING_PHRASES).toHaveLength(10);
    expect(new Set(THREAD_WORKING_PHRASES).size).toBe(10);
    expect(THREAD_WORKING_PHRASES[0]).toBe('Planning next move');
    expect(THREAD_WORKING_PHRASES).not.toContain('Working');
  });

  it('wraps the phrase index and maps ticks onto the roster', () => {
    expect(threadWorkingPhraseIndex(0)).toBe(0);
    expect(threadWorkingPhraseIndex(10)).toBe(0);
    expect(threadWorkingPhraseIndex(11)).toBe(1);
    expect(threadWorkingPhraseIndex(-1)).toBe(9);
    expect(threadWorkingPhrase(0)).toBe('Planning next move');
    expect(threadWorkingPhrase(1)).toBe(THREAD_WORKING_PHRASES[1]);
    expect(threadWorkingPhrase(10)).toBe('Planning next move');
    expect(threadWorkingPhrase(9)).toBe(THREAD_WORKING_PHRASES[9]);
  });

  it('advances the tick only when a working display ends', () => {
    expect(nextWorkingPhraseTick(0, false, false)).toBe(0);
    expect(nextWorkingPhraseTick(0, false, true)).toBe(0);
    expect(nextWorkingPhraseTick(0, true, true)).toBe(0);
    expect(nextWorkingPhraseTick(0, true, false)).toBe(1);
    expect(nextWorkingPhraseTick(9, true, false)).toBe(10);
    expect(threadWorkingPhrase(nextWorkingPhraseTick(9, true, false))).toBe(THREAD_WORKING_PHRASES[0]);
  });

  it('adds an ellipsis for the in-thread indicator and keeps Thinking distinct', () => {
    expect(threadWorkingIndicatorLabel(false, 'Planning next move')).toBe('Planning next move…');
    expect(threadWorkingIndicatorLabel(true, 'Planning next move')).toBe('Thinking…');
  });

  it('uses the live phrase for busy status labels', () => {
    expect(threadStatusLabel('active')).toBe('Planning next move');
    expect(threadStatusLabel('active', false, null, 'Charting a course')).toBe('Charting a course');
    expect(threadStatusLabel('active', false, { id: 'th', text: '', startedAt: 1, updatedAt: 1 }, 'Charting a course')).toBe('Thinking');
  });
});

describe('useThreadWorkingPhrase', () => {
  afterEach(() => {
    cleanup();
  });

  it('starts on the first phrase when active or idle', () => {
    expect(renderToStaticMarkup(<Probe />)).toContain('Planning next move');
    expect(renderToStaticMarkup(<Probe active={false} />)).toContain('Planning next move');
  });

  it('keeps the same phrase while working stays displayed', () => {
    const { rerender } = render(<Probe active />);
    expect(screen.getByText('Planning next move')).toBeTruthy();
    rerender(<Probe active />);
    expect(screen.getByText('Planning next move')).toBeTruthy();
    expect(screen.queryByText(THREAD_WORKING_PHRASES[1])).toBeNull();
  });

  it('swaps to the next phrase the next time working is displayed', () => {
    const { rerender } = render(<Probe active />);
    expect(screen.getByText('Planning next move')).toBeTruthy();
    rerender(<Probe active={false} />);
    rerender(<Probe active />);
    expect(screen.getByText(THREAD_WORKING_PHRASES[1])).toBeTruthy();
    expect(screen.queryByText('Planning next move')).toBeNull();
  });
});
