// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CODE_COPY_FEEDBACK_MS, CodeBlockCopyButton } from './CodeBlockCopyButton';

const copy = vi.hoisted(() => vi.fn());
vi.mock('../lib/copy-text.js', () => ({ copyTextOrFail: copy }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  copy.mockReset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Let the copy promise settle under fake timers. */
async function flush() {
  await act(async () => { await Promise.resolve(); });
}

describe('CodeBlockCopyButton', () => {
  it('is a labelled, keyboard-reachable button', () => {
    render(<CodeBlockCopyButton code="x" />);
    const button = screen.getByRole('button', { name: 'Copy code' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('title')).toBe('Copy code');
    expect(button.getAttribute('data-state')).toBe('idle');
    expect(screen.getByRole('status').textContent).toBe('');
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it('copies the exact code, shows Copied, then resets', async () => {
    copy.mockResolvedValue(undefined);
    const code = '\tconst a = 1;\n  b();\n\n';
    render(<CodeBlockCopyButton code={code} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await flush();
    expect(copy).toHaveBeenCalledWith(code);
    // The result is announced once, by the live region; the name stays put.
    const button = screen.getByRole('button', { name: 'Copy code' });
    expect(button.getAttribute('title')).toBe('Copy code');
    expect(button.getAttribute('data-state')).toBe('copied');
    expect(screen.getByRole('status').textContent).toBe('Copied');
    act(() => { vi.advanceTimersByTime(CODE_COPY_FEEDBACK_MS); });
    expect(screen.getByRole('button', { name: 'Copy code' }).getAttribute('data-state')).toBe('idle');
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('shows and logs a failure when the clipboard write rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = new Error('denied');
    copy.mockRejectedValue(error);
    render(<CodeBlockCopyButton code="x" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await flush();
    expect(screen.getByRole('button', { name: 'Copy code' }).getAttribute('data-state')).toBe('failed');
    expect(warn).toHaveBeenCalledWith('[code-block-copy] clipboard write failed', error);
    expect(screen.getByRole('status').textContent).toBe('Copy failed');
    act(() => { vi.advanceTimersByTime(CODE_COPY_FEEDBACK_MS); });
    expect(screen.getByRole('button').getAttribute('data-state')).toBe('idle');
  });

  it('restarts the feedback window on a repeat click', async () => {
    copy.mockResolvedValue(undefined);
    render(<CodeBlockCopyButton code="x" />);
    fireEvent.click(screen.getByRole('button'));
    await flush();
    act(() => { vi.advanceTimersByTime(CODE_COPY_FEEDBACK_MS - 100); });
    fireEvent.click(screen.getByRole('button'));
    await flush();
    act(() => { vi.advanceTimersByTime(CODE_COPY_FEEDBACK_MS - 100); });
    expect(screen.getByRole('button').getAttribute('data-state')).toBe('copied');
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.getByRole('button').getAttribute('data-state')).toBe('idle');
  });

  it('does not bubble the click to a surrounding row', async () => {
    copy.mockResolvedValue(undefined);
    const onRowClick = vi.fn();
    render(<div onClick={onRowClick}><CodeBlockCopyButton code="x" /></div>);
    fireEvent.click(screen.getByRole('button'));
    await flush();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('clears its reset timer on unmount', async () => {
    copy.mockResolvedValue(undefined);
    const clear = vi.spyOn(window, 'clearTimeout');
    const view = render(<CodeBlockCopyButton code="x" />);
    fireEvent.click(screen.getByRole('button'));
    await flush();
    view.unmount();
    expect(clear).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a copy that finishes after unmount', async () => {
    let finish: (() => void) | undefined;
    copy.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = render(<CodeBlockCopyButton code="x" />);
    fireEvent.click(screen.getByRole('button'));
    view.unmount();
    finish!();
    await flush();
    expect(vi.getTimerCount()).toBe(0);
    expect(error).not.toHaveBeenCalled();
  });
});
