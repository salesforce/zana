// @vitest-environment happy-dom
import React, { type ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type MarkdownDocument from '../markdown/MarkdownDocument.js';
import { FileViewer } from './FileViewer.js';

const document = vi.hoisted(() => vi.fn());
vi.mock('../markdown/MarkdownDocument.js', () => ({
  default: (props: ComponentProps<typeof MarkdownDocument>) => {
    document(props);
    return <><textarea aria-label="Markdown draft" value={props.value} readOnly={!!props.readOnlyReason} onChange={event => props.onChange(event.target.value)} />
      <button onClick={props.onSave}>Save Markdown fixture</button></>;
  }
}));
vi.mock('../OpenerButtons.js', () => ({ OpenerButtons: () => null }));
vi.mock('./useMonacoMinimap.js', () => ({ useMonacoMinimap: () => ({}) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function props(): ComponentProps<typeof FileViewer> {
  return {
    project: { id: 'p', name: 'Project', path: '/checkout' } as ComponentProps<typeof FileViewer>['project'],
    explorerFile: '/checkout/note.md', fileResult: { ok: true, content: '# Saved' }, fileLoading: false,
    editedContent: null, saving: false, previewMode: false, diffMode: false, diffAvailable: false,
    showDiff: false, showPreview: false, headResult: null, headLoading: false,
    imageDataUrl: null, imageError: null, viewRoot: '/checkout', monacoTheme: 'dark', isRemote: false,
    nativeFiles: false, isMarkdown: true, onContentChange: vi.fn(), onEditorMount: vi.fn(),
    onSave: vi.fn(), onTogglePreview: vi.fn(), onToggleDiff: vi.fn()
  };
}

it('routes Markdown edits, save, document links and image scope through the shared document', async () => {
  const base = props();
  const scope = { projectId: 'p', hostId: 'h', environmentId: 'e' };
  const onOpenDocument = vi.fn();
  const view = render(<FileViewer {...base} fileScope={scope} fragment="heading" onOpenDocument={onOpenDocument} sourceKey="checkout-e" saveRecovery={<p>Recover draft</p>} />);
  await screen.findByLabelText('Markdown draft');
  expect(document.mock.lastCall?.[0]).toMatchObject({
    value: '# Saved', savedValue: '# Saved', documentPath: '/checkout/note.md', fileScope: scope,
    fragment: 'heading', onOpenDocument, localImages: true, saving: false, readOnlyReason: undefined
  });
  expect(screen.getByText('Recover draft')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Markdown draft'), { target: { value: 'my edit' } });
  view.rerender(<FileViewer {...base} editedContent="my edit" />);
  fireEvent.change(screen.getByLabelText('Markdown draft'), { target: { value: '# Saved' } });
  expect(vi.mocked(base.onContentChange).mock.calls).toEqual([['my edit'], [null]]);
  fireEvent.click(screen.getByText('Save Markdown fixture'));
  expect(base.onSave).toHaveBeenCalledOnce();
  view.rerender(<FileViewer {...base} editedContent="pending edit" saving />);
  expect(document.mock.lastCall?.[0]).toMatchObject({ value: 'pending edit', savedValue: '# Saved', saving: true });
});

it('makes truncated and legacy remote Markdown read-only with the relevant explanation', async () => {
  const base = props();
  const view = render(<FileViewer {...base} fileResult={{ ok: true, content: 'partial', truncated: true }} />);
  await screen.findByLabelText('Markdown draft');
  expect(document.mock.lastCall?.[0].readOnlyReason).toContain('truncated');
  view.rerender(<FileViewer {...base} isRemote />);
  expect(document.mock.lastCall?.[0]).toMatchObject({ localImages: false, readOnlyReason: expect.stringContaining('legacy remote') });
});

it('passes an empty document when a successful read has no text', async () => {
  render(<FileViewer {...props()} fileResult={{ ok: true }} />);
  await screen.findByLabelText('Markdown draft');
  expect(document.mock.lastCall?.[0]).toMatchObject({ value: '', savedValue: '' });
});
