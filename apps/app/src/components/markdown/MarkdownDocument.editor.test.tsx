// @vitest-environment happy-dom
import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MarkdownDocument from './MarkdownDocument.js';

vi.mock('../../hooks/useMonacoTheme.js', () => ({ useMonacoTheme: () => 'light' }));
vi.mock('../../lib/monacoSetup.js', () => ({}));
afterEach(cleanup);

it('mounts the real editor, focuses Edit, and updates native history without render loops', async () => {
  function Document() {
    const [value, setValue] = useState('# Heading\n\nParagraph.\n');
    return <MarkdownDocument value={value} savedValue="# Heading\n\nParagraph.\n" documentPath="/repo/doc.md" onChange={setValue} />;
  }
  render(<Document />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
  const editor = await screen.findByRole('textbox', { name: 'Document content' });
  await waitFor(() => expect(document.activeElement).toBe(editor));
  expect(editor.textContent).toContain('Paragraph.');
  const undo = screen.getByRole('button', { name: 'Undo document change' });
  const redo = screen.getByRole('button', { name: 'Redo document change' });
  expect(undo.hasAttribute('disabled')).toBe(true);
  const tiptap = (editor as HTMLElement & { editor: Editor }).editor;
  act(() => { tiptap.commands.insertContent('Added '); });
  await waitFor(() => expect(undo.hasAttribute('disabled')).toBe(false));
  fireEvent.click(undo);
  expect(editor.textContent).not.toContain('Added');
  expect(redo.hasAttribute('disabled')).toBe(false);
  fireEvent.click(redo);
  expect(editor.textContent).toContain('Added');
  fireEvent.click(screen.getByRole('button', { name: 'Read', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
  expect(screen.getByRole('textbox', { name: 'Document content' })).toBe(editor);
  fireEvent.click(undo);
  expect(editor.textContent).not.toContain('Added');
});
