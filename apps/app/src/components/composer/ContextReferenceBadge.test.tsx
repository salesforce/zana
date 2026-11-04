// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ContextReferenceBadge } from './editor-selection-extension.js';

afterEach(cleanup);
const reference = { version: 1 as const, label: 'Introduction', text: 'Original passage', comment: 'Shorten it', source: { kind: 'thread' as const, threadId: 'source', messageId: 'msg', sourceSeqEnd: 9 } };

it.each(['ctrlKey', 'metaKey'] as const)('saves an edited annotation with %s+Enter and leaves ordinary keys alone', (modifier) => {
  const onUpdate = vi.fn();
  render(<ContextReferenceBadge reference={reference} onUpdate={onUpdate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Introduction' }));
  const input = screen.getByRole('textbox', { name: 'Edit annotation comment' });
  fireEvent.change(input, { target: { value: '  Open with chat  ' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.keyDown(input, { key: 'a', [modifier]: true });
  expect(onUpdate).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter', [modifier]: true });
  expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ ...reference, comment: 'Open with chat' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('shows immutable sent comments and a usable source link without an editor', () => {
  const view = render(<ContextReferenceBadge reference={reference} />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Introduction' }));
  expect(screen.getByText('Shorten it', { selector: 'p' })).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByRole('link', { name: 'Show in thread' }).getAttribute('href')).toBe('/threads/source?message=9');
  view.unmount();
  render(<MemoryRouter><ContextReferenceBadge reference={reference} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Introduction' }));
  fireEvent.click(screen.getByRole('link', { name: 'Show in thread' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
