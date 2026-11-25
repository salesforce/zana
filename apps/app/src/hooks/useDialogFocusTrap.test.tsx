// @vitest-environment happy-dom
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { claimEscape, useDialogFocusTrap } from './useDialogFocusTrap.js';

afterEach(cleanup);
function Fixture({ close, enabled = true, editorFocus = false, nested = false }: { close: () => void; enabled?: boolean; editorFocus?: boolean; nested?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(ref, close, enabled);
  return <div ref={ref} role="dialog">
    <button>First</button><input aria-label="Message" autoFocus={editorFocus} /><button>Last</button><button disabled>Unavailable</button>
    {nested && createPortal(<input aria-label="Nested picker" />, document.body)}
  </div>;
}
it('focuses the dialog without focusing the mobile editor, traps Tab and handles Escape', () => {
  const close = vi.fn();
  render(<Fixture close={close} />);
  const dialog = screen.getByRole('dialog');
  expect(document.activeElement).toBe(dialog);
  expect(dialog.tabIndex).toBe(-1);
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(screen.getByText('Last'));
  fireEvent.keyDown(screen.getByText('Last'), { key: 'Tab' });
  expect(document.activeElement).toBe(screen.getByText('First'));
  fireEvent.keyDown(screen.getByText('First'), { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(screen.getByText('Last'));
  fireEvent.keyDown(screen.getByText('Last'), { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});
it('preserves an explicitly focused editor and lets a nested portal own Escape', () => {
  const close = vi.fn();
  render(<Fixture close={close} editorFocus nested />);
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' }));
  const nested = screen.getByRole('textbox', { name: 'Nested picker' });
  nested.focus(); fireEvent.keyDown(nested, { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(nested, { key: 'ArrowDown' });
  expect(close).not.toHaveBeenCalled();
});
it('restores the opener, removes its temporary tabindex and does nothing while disabled', () => {
  const opener = document.createElement('button'); document.body.append(opener); opener.focus();
  const close = vi.fn();
  const { rerender, unmount } = render(<Fixture close={close} enabled={false} />);
  expect(document.activeElement).toBe(opener);
  fireEvent.keyDown(opener, { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  rerender(<Fixture close={close} />);
  const dialog = screen.getByRole('dialog');
  expect(document.activeElement).toBe(dialog);
  rerender(<Fixture close={close} enabled={false} />);
  expect(document.activeElement).toBe(opener);
  expect(dialog.hasAttribute('tabindex')).toBe(false);
  unmount(); opener.remove();
});
it('uses the latest close callback without resetting focus when a parent rerenders', () => {
  const oldClose = vi.fn(); const nextClose = vi.fn();
  const { rerender } = render(<Fixture close={oldClose} />);
  const last = screen.getByText('Last'); last.focus();
  rerender(<Fixture close={nextClose} />);
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: 'Escape' });
  expect(nextClose).toHaveBeenCalledOnce();
  expect(oldClose).not.toHaveBeenCalled();
});

// ProseMirror calls preventDefault on every Escape keydown it receives, so the
// event reaches the window already defaultPrevented.
function editorEscape(editor: Element, claim: boolean) {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  editor.addEventListener('keydown', (e) => { e.preventDefault(); if (claim) claimEscape(e); }, { once: true });
  editor.dispatchEvent(event);
}
function EditorFixture({ close }: { close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(ref, close);
  return <div ref={ref} role="dialog"><div className="tiptap ProseMirror" contentEditable data-testid="pm" /><div data-testid="plain" /></div>;
}
it('closes on Escape from a ProseMirror editor even though the editor prevented default', () => {
  const close = vi.fn();
  render(<EditorFixture close={close} />);
  editorEscape(screen.getByTestId('pm'), false);
  expect(close).toHaveBeenCalledOnce();
});
it('keeps the dialog open when the editor claimed Escape (typeahead dismiss)', () => {
  const close = vi.fn();
  render(<EditorFixture close={close} />);
  editorEscape(screen.getByTestId('pm'), true);
  expect(close).not.toHaveBeenCalled();
});
it('still ignores a default-prevented Escape from outside an editor', () => {
  const close = vi.fn();
  render(<EditorFixture close={close} />);
  editorEscape(screen.getByTestId('plain'), false);
  expect(close).not.toHaveBeenCalled();
});
