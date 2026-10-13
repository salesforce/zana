/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunErrorDialog } from './RunErrorDialog.js';

// When true, the first useRef per render (the dialog node ref) is inert: it never
// receives the DOM node, simulating a node that is not attached when the effect runs.
const inertNodeRef = vi.hoisted(() => ({ on: false }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useRef: ((initial: unknown) => {
      const real = actual.useRef(initial);
      if (inertNodeRef.on && initial === null) {
        return { get current() { return null; }, set current(_v: unknown) { /* drop node */ } };
      }
      return real;
    }) as typeof actual.useRef,
  };
});

afterEach(cleanup);

describe('RunErrorDialog', () => {
  it('shows the full message and focuses the dialog', () => {
    render(<RunErrorDialog title="Nightly" when="now" message="boom: long cause" onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Run error details' });
    expect(screen.getByText('boom: long cause')).toBeTruthy();
    expect(screen.getByText('Nightly')).toBeTruthy();
    expect(document.activeElement).toBe(dialog);
  });

  it('closes on Escape, close button and backdrop, but not on dialog click or other keys', () => {
    const onClose = vi.fn();
    const { container } = render(<RunErrorDialog title="t" when="w" message="m" onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Enter' });
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(container.querySelector('.modal-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('does not steal focus back on re-render with a new onClose, and uses the latest handler', () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<RunErrorDialog title="t" when="w" message="m" onClose={first} />);
    const close = screen.getByRole('button', { name: 'Close' });
    close.focus();
    view.rerender(<RunErrorDialog title="t" when="w" message="m" onClose={second} />);
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('is a safe no-op when the dialog node is unavailable: no focus, no Escape handler, no crash', () => {
    inertNodeRef.on = true;
    try {
      const onClose = vi.fn();
      render(<RunErrorDialog title="t" when="w" message="m" onClose={onClose} />);
      const dialog = screen.getByRole('dialog');
      expect(document.activeElement).not.toBe(dialog);
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      inertNodeRef.on = false;
    }
  });
});
