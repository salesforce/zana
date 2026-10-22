/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadDetailSearch, threadSearchAnnouncement, threadSearchCounterText } from './ThreadDetailSearch.js';

afterEach(cleanup);

describe('find-in-thread counter', () => {
  it('formats the counter and its announcement', () => {
    expect(threadSearchCounterText(0, 0)).toBe('0/0');
    expect(threadSearchCounterText(2, 7)).toBe('3/7');
    expect(threadSearchAnnouncement(-1, 0)).toBe('No matches');
    expect(threadSearchAnnouncement(-1, 1)).toBe('1 match');
    expect(threadSearchAnnouncement(-1, 4)).toBe('4 matches');
    expect(threadSearchAnnouncement(1, 4)).toBe('Match 2 of 4');
  });

  it('shows N/M in the box and announces it politely', () => {
    const { rerender } = render(<ThreadDetailSearch value="cat" onChange={() => undefined} onSubmit={() => undefined} />);
    expect(screen.queryByTestId('thread-detail-search-count')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');

    rerender(<ThreadDetailSearch value="cat" onChange={() => undefined} onSubmit={() => undefined} matchIndex={1} matchCount={3} />);
    const count = screen.getByTestId('thread-detail-search-count');
    expect(count.textContent).toBe('2/3');
    expect(count.className).toBe('thread-detail-search-count');
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('Match 2 of 3');

    rerender(<ThreadDetailSearch value="zebra" onChange={() => undefined} onSubmit={() => undefined} matchIndex={-1} matchCount={0} />);
    expect(screen.getByTestId('thread-detail-search-count').textContent).toBe('0/0');
    expect(screen.getByTestId('thread-detail-search-count').className).toContain('is-empty');
    expect(screen.getByRole('status').textContent).toBe('No matches');
  });
});

describe('find-in-thread keys', () => {
  it('submits next on Enter and previous on Shift+Enter, keeping focus', () => {
    const onSubmit = vi.fn();
    render(<ThreadDetailSearch value="  cat " onChange={() => undefined} onSubmit={onSubmit} />);
    const input = screen.getByRole('searchbox');
    input.focus();
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSubmit.mock.calls).toEqual([['cat', 'next'], ['cat', 'previous']]);
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('maxlength')).toBe('200');
  });

  it('leaves Enter to the IME while composing', () => {
    const onSubmit = vi.fn();
    render(<ThreadDetailSearch value="ねこ" onChange={() => undefined} onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter', isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('clears and closes on Escape', () => {
    const onSubmit = vi.fn();
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(<ThreadDetailSearch value="cat" onChange={onChange} onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(onChange).toHaveBeenCalledWith('');
    expect(onSubmit).toHaveBeenCalledWith('');
    expect(onClose).toHaveBeenCalled();
  });
});
