import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  THREAD_WORKING_PHRASE_INTERVAL_MS,
  THREAD_WORKING_PHRASES,
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
    expect(THREAD_WORKING_PHRASE_INTERVAL_MS).toBe(3500);
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
  it('starts on the first phrase and resets when inactive', () => {
    expect(renderToStaticMarkup(<Probe />)).toContain('Planning next move');
    expect(renderToStaticMarkup(<Probe active={false} />)).toContain('Planning next move');
  });

  it('advances on a timer and clears it on teardown', () => {
    const source = readFileSync(new URL('./useThreadWorkingPhrase.ts', import.meta.url), 'utf8');
    expect(source).toContain('window.setInterval');
    expect(source).toContain('THREAD_WORKING_PHRASE_INTERVAL_MS');
    expect(source).toContain('setTick((n) => n + 1)');
    expect(source).toContain('window.clearInterval(id)');
    expect(source).toContain('setTick(0)');
  });
});
