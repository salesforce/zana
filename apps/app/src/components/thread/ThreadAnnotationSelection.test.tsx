// @vitest-environment happy-dom
import { createRef } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ThreadAnnotationSelection } from './ThreadAnnotationSelection.js';
import { readThreadAnnotation } from './thread-annotation-selection.js';
import { registerThreadContextTarget, registerThreadContextControls } from '../../plugins/thread-context-target.js';
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});
function fixture() {
  const root = document.createElement('div');
  root.innerHTML =
    '<div data-thread-annotation-prose data-message-id="reply" data-source-seq-end="8"><p>Original introduction</p><a href="#">Link</a></div><div>Other message</div>';
  document.body.append(root);
  const range = document.createRange();
  range.selectNodeContents(root.querySelector('p')!);
  range.getBoundingClientRect = () => ({ left: 20, top: 100 }) as DOMRect;
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return { root, selection, range };
}
async function select() {
  fireEvent(document, new Event('selectionchange'));
  await screen.findByRole('toolbar');
}
it('confines a snapshot to a single prose message and rejects controls or invalid metadata', () => {
  const { root, selection, range } = fixture();
  expect(
    readThreadAnnotation(root, 'thread', selection)?.reference,
  ).toMatchObject({
    text: 'Original introduction',
    source: { kind: 'thread', messageId: 'reply', sourceSeqEnd: 8 },
  });
  range.setEndAfter(root.lastChild!);
  expect(readThreadAnnotation(root, 'thread', selection)).toBeNull();
  range.selectNodeContents(root.querySelector('a')!);
  expect(readThreadAnnotation(root, 'thread', selection)).toBeNull();
  range.selectNodeContents(root.querySelector('p')!);
  root.firstElementChild!.setAttribute('data-source-seq-end', '0');
  expect(readThreadAnnotation(root, 'thread', selection)).toBeNull();
  selection.removeAllRanges();
  expect(readThreadAnnotation(root, 'thread', selection)).toBeNull();
  expect(readThreadAnnotation(root, 'thread', null)).toBeNull();
});
it('asks about a source snapshot and focuses only the owning composer without opening a dialog', async () => {
  const { root, selection } = fixture();
  const ref = createRef<HTMLElement>();
  ref.current = root;
  const insert = vi.fn().mockReturnValue(true);
  const other = vi.fn();
  const input = document.createElement('textarea');
  document.body.append(input);
  const focus = vi.fn(() => input.focus());
  const dispose = registerThreadContextTarget('thread', insert);
  const disposeOther = registerThreadContextTarget('other', other);
  const disposeControls = registerThreadContextControls('thread', { update: () => false, focus });
  render(<ThreadAnnotationSelection rootRef={ref} threadId="thread" />);
  try {
    await select();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    const button = screen.getByRole('button', { name: 'Ask Zana' });
    expect(fireEvent.pointerDown(button)).toBe(false);
    expect(selection.toString()).toBe('Original introduction');
    fireEvent.click(button);
    expect(insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      text: 'Original introduction',
      source: { kind: 'thread', threadId: 'thread', messageId: 'reply', sourceSeqEnd: 8 },
    }));
    expect(insert.mock.calls[0]![0].comment).toBeUndefined();
    expect(other).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(input);
    expect(selection.isCollapsed).toBe(true);
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  } finally {
    dispose(); disposeOther(); disposeControls();
  }
});

it('keeps the passage available when insertion fails and allows retry', async () => {
  const { root, selection } = fixture();
  const ref = createRef<HTMLElement>();
  ref.current = root;
  const insert = vi.fn().mockReturnValue(false);
  const focus = vi.fn();
  const dispose = registerThreadContextTarget('thread', insert);
  const disposeControls = registerThreadContextControls('thread', { update: () => false, focus });
  render(<ThreadAnnotationSelection rootRef={ref} threadId="thread" />);
  try {
    await select();
    fireEvent.click(screen.getByRole('button', { name: 'Ask Zana' }));
    expect(screen.getByRole('alert').textContent).toContain('unavailable or full');
    expect(selection.toString()).toBe('Original introduction');
    expect(focus).not.toHaveBeenCalled();
    insert.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Ask Zana' }));
    expect(insert).toHaveBeenCalledTimes(2);
    expect(focus).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).toBeNull();
  } finally { dispose(); disposeControls(); }
});

it('dismisses on scroll, resize and Escape and cancels pending selection reads', async () => {
  const { root } = fixture();
  const ref = createRef<HTMLElement>();
  ref.current = root;
  const view = render(<ThreadAnnotationSelection rootRef={ref} threadId="thread" />);
  for (const dismiss of [() => fireEvent.scroll(window), () => fireEvent.resize(window), () => fireEvent.keyDown(document, { key: 'Escape' })]) {
    await select();
    fireEvent.keyDown(document, { key: 'Shift' });
    expect(screen.getByRole('toolbar')).toBeTruthy();
    dismiss();
    expect(screen.queryByRole('toolbar')).toBeNull();
  }
  fireEvent(document, new Event('selectionchange'));
  fireEvent.scroll(window);
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(screen.queryByRole('toolbar')).toBeNull();
  await select();
  view.unmount();
  fireEvent(document, new Event('selectionchange'));
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(screen.queryByRole('toolbar')).toBeNull();
});

it('resets errors and snapshots on thread changes and handles a missing root', async () => {
  const { root } = fixture();
  const ref = createRef<HTMLElement>();
  ref.current = root;
  const view = render(<ThreadAnnotationSelection rootRef={ref} threadId="first" />);
  await select();
  fireEvent.click(screen.getByRole('button', { name: 'Ask Zana' }));
  expect(screen.getByRole('alert')).toBeTruthy();
  view.rerender(<ThreadAnnotationSelection rootRef={ref} threadId="second" />);
  expect(screen.queryByRole('toolbar')).toBeNull();
  await select();
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.scroll(window);
  ref.current = null;
  fireEvent(document, new Event('selectionchange'));
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(screen.queryByRole('toolbar')).toBeNull();
  ref.current = root;
  await select();
  window.getSelection()?.removeAllRanges();
  fireEvent(document, new Event('selectionchange'));
  await waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull());
});

it('keeps the action inside viewport edges', async () => {
  const { root, range } = fixture();
  const ref = createRef<HTMLElement>();
  ref.current = root;
  range.getBoundingClientRect = () => ({ left: -50, top: 0 }) as DOMRect;
  render(<ThreadAnnotationSelection rootRef={ref} threadId="thread" />);
  await select();
  expect(screen.getByRole('toolbar').style.left).toBe('8px');
  expect(screen.getByRole('toolbar').style.top).toBe('8px');
  range.getBoundingClientRect = () => ({ left: 10000, top: 10000 }) as DOMRect;
  await select();
  await waitFor(() => {
    expect(screen.getByRole('toolbar').style.left).toBe(`${window.innerWidth - 128}px`);
    expect(screen.getByRole('toolbar').style.top).toBe(`${window.innerHeight - 48}px`);
  });
});
