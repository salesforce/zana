// @vitest-environment happy-dom
import { createRef } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ThreadAnnotationSelection } from './ThreadAnnotationSelection.js';
import { readThreadAnnotation } from './thread-annotation-selection.js';
import { registerThreadContextTarget } from '../../plugins/thread-context-target.js';
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
it('annotates with shortcuts, retains failed insertions and sends only to the owning thread', async () => {
  const { root } = fixture();
  const ref = createRef<HTMLElement>();
  ref.current = root;
  const insert = vi.fn().mockReturnValue(false);
  const dispose = registerThreadContextTarget('thread', insert);
  const view = render(
    <ThreadAnnotationSelection rootRef={ref} threadId="thread" />,
  );
  try {
    await select();
    fireEvent.click(screen.getByRole('button', { name: 'Annotate' }));
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Your change' }),
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'Add to composer',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove this' }));
    fireEvent.keyDown(screen.getByRole('textbox'), {
      key: 'Enter',
      ctrlKey: true,
    });
    expect(screen.getByRole('alert').textContent).toContain('unavailable');
    insert.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Keep this' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to composer' }));
    expect(insert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        comment: 'Keep this as proposed.',
        text: 'Original introduction',
      }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  } finally {
    view.unmount();
    dispose();
  }
});
it('adds a bare quote, dismisses on scrolling and cancels annotation with Escape', async () => {
  const { root, range, selection } = fixture();
  const ref = createRef<HTMLElement>();
  ref.current = root;
  const insert = vi.fn().mockReturnValue(true);
  const dispose = registerThreadContextTarget('thread', insert);
  const view = render(
    <ThreadAnnotationSelection rootRef={ref} threadId="thread" />,
  );
  try {
    await select();
    fireEvent.scroll(window);
    expect(screen.queryByRole('toolbar')).toBeNull();
    await select();
    fireEvent.click(screen.getByRole('button', { name: 'Annotate' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    selection.addRange(range);
    await select();
    fireEvent.click(screen.getByRole('button', { name: 'Add quote' }));
    expect(insert.mock.calls[0]?.[0].comment).toBeUndefined();
  } finally {
    view.unmount();
    dispose();
  }
});
it('supports keyboard focus cycling, explicit cancellation and changing threads', async () => {
  const { root } = fixture();
  const ref = createRef<HTMLElement>();
  ref.current = root;
  const view = render(
    <ThreadAnnotationSelection rootRef={ref} threadId="first" />,
  );
  await select();
  fireEvent.click(screen.getByRole('button', { name: 'Annotate' }));
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'Shorten' } });
  fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Add to composer' }),
  );
  fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
  expect(document.activeElement).toBe(input);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await select();
  fireEvent.click(screen.getByRole('button', { name: 'Annotate' }));
  view.rerender(<ThreadAnnotationSelection rootRef={ref} threadId="second" />);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await select();
  fireEvent.click(screen.getByRole('button', { name: 'Annotate' }));
  fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
  expect(screen.queryByRole('dialog')).toBeNull();
  await select();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('toolbar')).toBeNull();
});
