/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, render } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  THREAD_SEARCH_CURRENT_HIGHLIGHT,
  THREAD_SEARCH_CURRENT_ROW_CLASS,
  THREAD_SEARCH_MATCH_HIGHLIGHT,
  THREAD_SEARCH_MAX_RANGES,
  THREAD_SEARCH_REPAINT_MS,
  findThreadSearchRanges,
  useThreadSearchHighlights,
  type ThreadSearchHighlightTarget
} from './search-highlight.js';

class FakeHighlight {
  readonly ranges: Range[];
  constructor(...ranges: Range[]) { this.ranges = ranges; }
}

const registry = new Map<string, FakeHighlight>();
const scrolled: Element[] = [];

function Pane({ target, children }: { target?: ThreadSearchHighlightTarget; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useThreadSearchHighlights(ref, target);
  return <div ref={ref}>{children}</div>;
}

const target = (rowId: string | null, occurrence: number, navigation = 1, query = 'cat'): ThreadSearchHighlightTarget =>
  ({ query, rowId, occurrence, navigation });

const texts = (name: string) => registry.get(name)?.ranges.map((range) => range.toString()) ?? [];
const owner = (range: Range | undefined) => range?.startContainer.parentElement?.closest('[data-row-id]')?.getAttribute('data-row-id');
const currentRange = () => registry.get(THREAD_SEARCH_CURRENT_HIGHLIGHT)?.ranges[0];

function staticPane(children: ReactNode): HTMLElement {
  return render(<div>{children}</div>).container.firstElementChild as HTMLElement;
}

beforeEach(() => {
  registry.clear();
  scrolled.length = 0;
  vi.stubGlobal('Highlight', FakeHighlight);
  // happy-dom hands out a fresh CSS object per access, so stub the whole global.
  vi.stubGlobal('CSS', { escape: (value: string) => value, highlights: registry });
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) { scrolled.push(this); });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('findThreadSearchRanges', () => {
  it('finds matches in rendered text and picks the n-th in the target row, not its child rows', () => {
    const pane = staticPane(<>
      <div data-row-id="a">
        <p>Cat and <b>cat</b></p>
        <div data-row-id="child"><p>cat</p></div>
        <p>last cat</p>
      </div>
      <div data-row-id="b" aria-hidden="true">cat</div>
      <style>{'.cat {}'}</style>
    </>);
    const first = findThreadSearchRanges(pane, target('a', 0));
    expect(first.all.map(String)).toEqual(['Cat', 'cat', 'cat', 'cat']);
    expect(first.row?.getAttribute('data-row-id')).toBe('a');
    expect(first.current?.toString()).toBe('Cat');
    expect(findThreadSearchRanges(pane, target('a', 2)).current?.startContainer.textContent).toBe('last cat');
    // Past the rendered matches (text split or hidden): the last one stands in.
    expect(findThreadSearchRanges(pane, target('a', 9)).current?.startContainer.textContent).toBe('last cat');
    expect(findThreadSearchRanges(pane, target('a', -1)).current).toBeNull();
    const missing = findThreadSearchRanges(pane, target('missing', 0));
    expect(missing.row).toBeNull();
    expect(missing.current).toBeNull();
    expect(findThreadSearchRanges(pane, target(null, 0, 1, '  ')).all).toEqual([]);
  });

  it('caps the ranges it collects', () => {
    const pane = staticPane(<><p>{'x '.repeat(THREAD_SEARCH_MAX_RANGES + 10)}</p><p>x</p></>);
    expect(findThreadSearchRanges(pane, target(null, -1, 1, 'x')).all).toHaveLength(THREAD_SEARCH_MAX_RANGES);
  });
});

describe('useThreadSearchHighlights', () => {
  it('highlights every match, marks the current one and scrolls to it once per navigation', () => {
    const rows = <>
      <div data-row-id="a"><p>cat</p></div>
      <div data-row-id="b"><p>cat</p><p>two cats</p></div>
    </>;
    const view = render(<Pane target={target('b', 1)}>{rows}</Pane>);
    expect(texts(THREAD_SEARCH_MATCH_HIGHLIGHT)).toEqual(['cat', 'cat', 'cat']);
    expect(owner(currentRange())).toBe('b');
    expect(currentRange()?.startContainer.textContent).toBe('two cats');
    expect(scrolled.map((element) => element.textContent)).toEqual(['two cats']);

    view.rerender(<Pane target={target('a', 0, 2)}>{rows}</Pane>);
    expect(owner(currentRange())).toBe('a');
    expect(scrolled).toHaveLength(2);

    view.rerender(<Pane>{rows}</Pane>);
    expect(registry.size).toBe(0);
  });

  it('marks the row when the match is not in rendered text, and waits for a row that is not rendered yet', async () => {
    vi.useFakeTimers();
    const view = render(<Pane target={target('late', 0)}>
      <div data-row-id="a"><p>cat</p></div>
    </Pane>);
    expect(scrolled).toEqual([]);
    expect(texts(THREAD_SEARCH_CURRENT_HIGHLIGHT)).toEqual([]);

    // The row renders collapsed: its matching output is not in the DOM.
    view.rerender(<Pane target={target('late', 0)}>
      <div data-row-id="a"><p>cat</p></div>
      <div data-row-id="late"><p>Run command</p></div>
    </Pane>);
    await act(async () => { await vi.advanceTimersByTimeAsync(THREAD_SEARCH_REPAINT_MS); });
    const late = view.container.querySelector('[data-row-id="late"]')!;
    expect(late.classList.contains(THREAD_SEARCH_CURRENT_ROW_CLASS)).toBe(true);
    expect(scrolled).toEqual([late]);

    // It expands: the real match takes over, without scrolling again.
    view.rerender(<Pane target={target('late', 0)}>
      <div data-row-id="a"><p>cat</p></div>
      <div data-row-id="late"><p>Run command</p><pre>cat file</pre></div>
    </Pane>);
    await act(async () => { await vi.advanceTimersByTimeAsync(THREAD_SEARCH_REPAINT_MS); });
    expect(late.classList.contains(THREAD_SEARCH_CURRENT_ROW_CLASS)).toBe(false);
    expect(owner(currentRange())).toBe('late');
    expect(scrolled).toHaveLength(1);

    view.unmount();
    expect(registry.size).toBe(0);
  });

  it('combines the highlights of several panes', () => {
    render(<>
      <Pane target={target('a', 0)}><div data-row-id="a">cat</div></Pane>
      <Pane target={target('b', 0)}><div data-row-id="b">cat cat</div></Pane>
    </>);
    expect(texts(THREAD_SEARCH_MATCH_HIGHLIGHT)).toHaveLength(3);
    expect(texts(THREAD_SEARCH_CURRENT_HIGHLIGHT)).toHaveLength(2);
  });

  it('falls back to marking the row without the Highlight API', () => {
    vi.unstubAllGlobals();
    const view = render(<Pane target={target('a', 0)}><div data-row-id="a">cat</div></Pane>);
    const row = view.container.querySelector('[data-row-id="a"]')!;
    expect(row.classList.contains(THREAD_SEARCH_CURRENT_ROW_CLASS)).toBe(true);
    expect(scrolled).toHaveLength(1);
    view.rerender(<Pane><div data-row-id="a">cat</div></Pane>);
    expect(row.classList.contains(THREAD_SEARCH_CURRENT_ROW_CLASS)).toBe(false);
  });
});
