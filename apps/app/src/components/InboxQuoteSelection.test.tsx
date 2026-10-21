// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxQuoteSelection } from './InboxQuoteSelection.js';
import { composeSeqFor, useInboxReplyDrafts } from '../stores/inbox-reply-drafts.js';

function Harness({ show = true }: { show?: boolean }) {
  const ref = createRef<HTMLDivElement>();
  return (
    <div className="inbox-view-detail" data-testid="scroller">
      <div className="inbox-detail" ref={ref}>
        <div className="inbox-detail-comments"><p data-testid="inside">Should the skipped case block merge?</p></div>
        <p data-testid="outside">Not quotable</p>
        {show && <InboxQuoteSelection entryId="e1" rootRef={ref} />}
      </div>
    </div>
  );
}

const select = (testId: string) => {
  const node = screen.getByTestId(testId).firstChild!;
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  Object.defineProperty(range, 'getClientRects', { value: () => [{ left: 40, right: 120, top: 100, bottom: 120 }], configurable: true });
};
const settle = () => act(async () => { document.dispatchEvent(new Event('selectionchange')); await new Promise((r) => setTimeout(r, 150)); });

describe('InboxQuoteSelection', () => {
  beforeEach(() => useInboxReplyDrafts.setState({ drafts: {}, order: [], composeRequest: null }));
  afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); vi.restoreAllMocks(); });

  it('shows for a selection in the comments and not outside', async () => {
    render(<Harness />);
    select('outside');
    await settle();
    expect(screen.queryByText('Quote in reply')).toBeNull();
    select('inside');
    await settle();
    expect(screen.getByText('Quote in reply')).toBeTruthy();
  });

  it('appends the quote and requests compose on click', async () => {
    render(<Harness />);
    select('inside');
    await settle();
    fireEvent.mouseDown(screen.getByText('Quote in reply'));
    fireEvent.click(screen.getByText('Quote in reply'));
    expect(useInboxReplyDrafts.getState().drafts.e1).toBe('> Should the skipped case block merge?\n- ');
    expect(composeSeqFor('e1')(useInboxReplyDrafts.getState())).toBe(1);
    expect(screen.queryByText('Quote in reply')).toBeNull();
    expect(window.getSelection()!.rangeCount).toBe(0);
  });

  it.each([
    ['scroll', () => fireEvent.scroll(screen.getByTestId('scroller'))],
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })]
  ])('hides on %s', async (_n, trigger) => {
    render(<Harness />);
    select('inside');
    await settle();
    act(() => { trigger(); });
    expect(screen.queryByText('Quote in reply')).toBeNull();
  });

  it('removes every listener on unmount', async () => {
    const docRemove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<Harness />);
    const scrollerRemove = vi.spyOn(screen.getByTestId('scroller'), 'removeEventListener');
    unmount();
    expect(docRemove.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['selectionchange', 'keydown']));
    expect(scrollerRemove).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  it('cancels its own pending debounce timer on unmount', () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<Harness />);
      const set = vi.spyOn(globalThis, 'setTimeout');
      const clear = vi.spyOn(globalThis, 'clearTimeout');
      select('inside');
      act(() => { document.dispatchEvent(new Event('selectionchange')); });
      const debounce = set.mock.results[set.mock.calls.findIndex((c) => c[1] === 120)]!.value;
      expect(debounce).toBeDefined();
      unmount();
      expect(clear).toHaveBeenCalledWith(debounce);
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.queryByText('Quote in reply')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
