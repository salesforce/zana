// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TimelineRow } from '@zana-ai/zcc-server-contract';
import { ThreadTimeline } from './ThreadTimeline.js';
import { THREAD_SEARCH_CURRENT_ROW_CLASS } from './timeline/search-highlight.js';

vi.mock('./timeline/TimelineRows.js', () => ({
  TimelineRows: ({ rows }: { rows: Array<{ id: string; text?: string }> }) => <div>
    {rows.map((row) => <div key={row.id} data-row-id={row.id}><p>{row.text}</p></div>)}
  </div>
}));
vi.mock('./timeline/ThreadBanners.js', () => ({
  ThreadGoalBanner: () => null,
  ThreadHostDisconnectedBanner: () => null,
  ThreadTimelineLoadError: () => null,
  ThreadWorkflowChips: () => null,
  ThreadWorkingIndicator: () => null,
  ThreadTodoCard: () => null,
  ThreadPromptModeCard: () => null
}));

const message = (id: string, text: string, sequence: number) => ({
  id, kind: 'conversation', threadId: 't1', turnId: null, role: 'assistant',
  text, attachments: null, turnRequest: null,
  sourceSeqStart: sequence, sourceSeqEnd: sequence, startedAt: 0, createdAt: 0
}) as unknown as TimelineRow;

const rows = [message('m1', 'first cat', 1), message('m2', 'second cat', 2)];
const scrolled: Element[] = [];

beforeEach(() => {
  scrolled.length = 0;
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) { scrolled.push(this); });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const timeline = (props: Partial<Parameters<typeof ThreadTimeline>[0]>) =>
  <ThreadTimeline threadId="t1" rows={rows} status="idle" thinking={null} {...props} />;

it('flashes a linked message row when no search is active', () => {
  vi.useFakeTimers();
  const view = render(timeline({ searchHitRowId: 'm2' }));
  const row = view.container.querySelector('[data-row-id="m2"]')!;
  expect(row.classList.contains('thread-timeline-search-hit')).toBe(true);
  expect(scrolled).toEqual([row]);
  act(() => { vi.advanceTimersByTime(1600); });
  expect(row.classList.contains('thread-timeline-search-hit')).toBe(false);
});

it('scrolls to and marks the current search match instead of flashing its row', () => {
  const view = render(timeline({ searchHitRowId: 'm2', search: { query: 'cat', occurrence: 0, navigation: 1 } }));
  const row = view.container.querySelector('[data-row-id="m2"]')!;
  expect(row.classList.contains('thread-timeline-search-hit')).toBe(false);
  // happy-dom has no Highlight API, so the row carries the current-match mark.
  expect(row.classList.contains(THREAD_SEARCH_CURRENT_ROW_CLASS)).toBe(true);
  expect(scrolled.map((element) => element.textContent)).toEqual(['second cat']);

  view.rerender(timeline({ searchHitRowId: null, search: { query: 'zebra', occurrence: -1, navigation: 2 } }));
  expect(row.classList.contains(THREAD_SEARCH_CURRENT_ROW_CLASS)).toBe(false);
  expect(scrolled).toHaveLength(1);
});
