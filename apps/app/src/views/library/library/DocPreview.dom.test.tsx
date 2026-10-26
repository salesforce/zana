/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { LibraryDoc } from '@zana-ai/zcc-domain/product';
import { DocPreview } from './DocPreview.js';

const mocks = vi.hoisted(() => ({
  read: vi.fn(async () => ({ ok: true, content: '# Saved note', sha256: 'a'.repeat(64) })),
  write: vi.fn(async () => ({ ok: true, sha256: 'b'.repeat(64) })),
  update: vi.fn(async () => null),
  exportPdf: vi.fn(async () => ({ ok: true })),
  renderReportHtml: vi.fn(async () => '<html>note</html>'),
  pushToast: vi.fn()
}));
vi.mock('../../../lib/product-client.js', () => ({ product: {
  library: { read: mocks.read, write: mocks.write, update: mocks.update }, inbox: { exportPdf: mocks.exportPdf }
} }));
vi.mock('../../../store.js', () => ({ useUi: (select: Function) => select({ pushToast: mocks.pushToast }) }));
vi.mock('../../../lib/renderReportHtml.js', () => ({ renderReportHtml: mocks.renderReportHtml }));
vi.mock('../../../lib/monacoSetup', () => ({}));
vi.mock('../../../hooks/useMonacoTheme', () => ({ useMonacoTheme: () => 'light' }));
vi.mock('../../../components/AiEnhanceSelection', () => ({ useAiEnhanceSelection: () => ({ registerEditor: vi.fn(), modal: null }) }));
vi.mock('@monaco-editor/react', () => ({ default: ({ value, onChange, language, options }: any) => <textarea aria-label="Source editor" data-language={language} readOnly={options.readOnly} value={value} onChange={event => onChange?.(event.target.value || undefined)} /> }));
vi.mock('./LibraryAssetPreview.js', () => ({ LibraryAssetPreview: ({ doc }: any) => <div>Asset: {doc.relPath}</div> }));
vi.mock('../../../components/MermaidDiagram', () => ({ MermaidDiagram: ({ code }: any) => <div>Diagram: {code}</div> }));
vi.mock('./LibraryMarkdownEditor.js', () => ({
  LibraryMarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <><textarea aria-label="Edit note" value={value} onChange={(e) => onChange(e.target.value)} /><a href="linked.md">Linked from editor</a></>
  )
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it.each(['global', 'project'] as const)('downloads a %s library document and the current unsaved draft', async (scope) => {
  const doc: LibraryDoc = {
    id: 'note', title: 'My note', kind: 'md', relPath: 'note.md', scope,
    ...(scope === 'project' ? { projectId: 'p1' } : {}), createdAt: 1, updatedAt: 1
  };
  const view = render(<DocPreview doc={doc} />);
  await view.findByRole('heading', { name: 'Saved note' });
  expect(mocks.read).toHaveBeenCalledWith(scope, 'note.md', doc.projectId);
  fireEvent.click(view.getByRole('button', { name: 'Download PDF' }));
  await waitFor(() => expect(mocks.renderReportHtml).toHaveBeenCalledWith({
    title: 'My note', docs: [{ path: 'note.md', content: '# Saved note' }]
  }));
  fireEvent.click(view.getByRole('button', { name: 'Edit' }));
  fireEvent.change(view.getByLabelText('Edit note'), { target: { value: '# Unsaved revision' } });
  await waitFor(() => expect((view.getByRole('button', { name: 'Download PDF' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(view.getByRole('button', { name: 'Download PDF' }));
  await waitFor(() => expect(mocks.renderReportHtml).toHaveBeenLastCalledWith({
    title: 'My note', docs: [{ path: 'note.md', content: '# Unsaved revision' }]
  }));
});

it('saves the read revision and advances it for a subsequent edit', async () => {
  const doc: LibraryDoc = { id: 'note', title: 'Saved note', kind: 'md', relPath: 'note.md', scope: 'project', projectId: 'p1', createdAt: 1, updatedAt: 1 };
  const view = render(<DocPreview doc={doc} />); await view.findByRole('heading', { name: 'Saved note' });
  fireEvent.click(view.getByRole('button', { name: 'Edit' }));
  fireEvent.change(view.getByLabelText('Edit note'), { target: { value: '# Saved note\nFirst edit' } });
  fireEvent.click(view.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.write).toHaveBeenCalledWith('project', 'note.md', '# Saved note\nFirst edit', 'p1', 'a'.repeat(64)));
  await view.findByRole('button', { name: 'Edit' }); fireEvent.click(view.getByRole('button', { name: 'Edit' }));
  fireEvent.change(view.getByLabelText('Edit note'), { target: { value: '# Saved note\nSecond edit' } });
  fireEvent.click(view.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.write).toHaveBeenLastCalledWith('project', 'note.md', '# Saved note\nSecond edit', 'p1', 'b'.repeat(64)));
});

it('retains the draft and revision when a concurrent edit prevents saving', async () => {
  mocks.write.mockResolvedValueOnce({ ok: false, message: 'Changed elsewhere' } as any);
  const doc: LibraryDoc = { id: 'note', title: 'Saved note', kind: 'md', relPath: 'note.md', scope: 'global', createdAt: 1, updatedAt: 1 };
  const view = render(<DocPreview doc={doc} />); await view.findByRole('heading', { name: 'Saved note' });
  fireEvent.click(view.getByRole('button', { name: 'Edit' })); fireEvent.change(view.getByLabelText('Edit note'), { target: { value: 'Unsaved draft' } });
  fireEvent.click(view.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.pushToast).toHaveBeenCalledWith('Changed elsewhere', 'error'));
  expect((view.getByLabelText('Edit note') as HTMLTextAreaElement).value).toBe('Unsaved draft');
});

const note: LibraryDoc = { id: 'note', title: 'Saved note', kind: 'md', relPath: 'note.md', scope: 'project', projectId: 'p1', createdAt: 1, updatedAt: 1 };
it('reviews and merges a conflicting version while keeping revision checks for later changes', async () => {
  mocks.write.mockResolvedValueOnce({ ok: false, message: 'Changed elsewhere' } as any);
  const view = render(<DocPreview doc={note} />); await view.findByRole('button', { name: 'Edit' });
  fireEvent.click(view.getByRole('button', { name: 'Edit' }));
  fireEvent.change(view.getByLabelText('Edit note'), { target: { value: 'my draft' } });
  fireEvent.click(view.getByRole('button', { name: 'Save' })); await view.findByTestId('library-save-recovery');
  mocks.read.mockResolvedValueOnce({ ok: true, content: 'latest saved elsewhere', sha256: 'c'.repeat(64) });
  fireEvent.click(view.getByRole('button', { name: 'Review latest version' })); await view.findByText('latest saved elsewhere');
  expect((view.getByLabelText('Edit note') as HTMLTextAreaElement).value).toBe('my draft');
  fireEvent.change(view.getByLabelText('Edit note'), { target: { value: 'latest saved elsewhere\nmy draft' } });
  fireEvent.click(view.getByRole('button', { name: 'Save merged draft' }));
  await waitFor(() => expect(mocks.write).toHaveBeenLastCalledWith('project', 'note.md', 'latest saved elsewhere\nmy draft', 'p1', 'c'.repeat(64)));
  await view.findByRole('button', { name: 'Edit' });
});
it('can explicitly discard a conflicting draft after reviewing the latest version', async () => {
  mocks.write.mockRejectedValueOnce(new Error('offline'));
  const view = render(<DocPreview doc={note} autoEdit />); await view.findByLabelText('Edit note');
  fireEvent.click(view.getByRole('button', { name: 'Save' })); await view.findByTestId('library-save-recovery');
  mocks.read.mockResolvedValueOnce({ ok: true, content: '# Latest version', sha256: 'c'.repeat(64) });
  fireEvent.click(view.getByRole('button', { name: 'Review latest version' })); await view.findByText('# Latest version');
  fireEvent.click(view.getByRole('button', { name: 'Discard draft and use latest' }));
  // A real parent consumes autoEdit after the first load.
  view.rerender(<DocPreview doc={note} />);
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(view.queryByTestId('library-save-recovery')).toBeNull();
});
it('preserves keystrokes entered during a pending save and uses its acknowledged revision next', async () => {
  let resolve!: (value: any) => void;
  mocks.write.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = render(<DocPreview doc={note} />); await view.findByRole('button', { name: 'Edit' });
  fireEvent.click(view.getByRole('button', { name: 'Edit' }));
  fireEvent.change(view.getByLabelText('Edit note'), { target: { value: 'first draft' } });
  fireEvent.click(view.getByRole('button', { name: 'Save' }));
  fireEvent.change(view.getByLabelText('Edit note'), { target: { value: 'first draft plus new typing' } });
  await act(async () => { resolve({ ok: true, sha256: 'd'.repeat(64) }); });
  expect((view.getByLabelText('Edit note') as HTMLTextAreaElement).value).toBe('first draft plus new typing');
  fireEvent.click(view.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.write).toHaveBeenLastCalledWith('project', 'note.md', 'first draft plus new typing', 'p1', 'd'.repeat(64)));
});
it('ignores a late read after switching documents', async () => {
  let resolve!: (value: any) => void;
  mocks.read.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = render(<DocPreview doc={note} />);
  mocks.read.mockResolvedValueOnce({ ok: true, content: '# Second note', sha256: 'e'.repeat(64) });
  view.rerender(<DocPreview doc={{ ...note, id: 'second', relPath: 'second.md' }} />);
  await view.findByRole('heading', { name: 'Second note' });
  await act(async () => { resolve({ ok: true, content: '# Stale first note', sha256: 'a'.repeat(64) }); });
  expect(view.queryByRole('heading', { name: 'Stale first note' })).toBeNull();
});
it('ignores a late save acknowledgement even after navigating away and back', async () => {
  let resolve!: (value: any) => void;
  mocks.write.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = render(<DocPreview doc={note} />); await view.findByRole('button', { name: 'Edit' });
  fireEvent.click(view.getByRole('button', { name: 'Edit' }));
  fireEvent.change(view.getByLabelText('Edit note'), { target: { value: '# Old pending draft' } });
  fireEvent.click(view.getByRole('button', { name: 'Save' }));
  view.rerender(<DocPreview doc={{ ...note, id: 'second', relPath: 'second.md' }} />); await view.findByRole('heading', { name: 'Saved note' });
  view.rerender(<DocPreview doc={note} />); await view.findByRole('heading', { name: 'Saved note' });
  await act(async () => { resolve({ ok: true, sha256: 'old-reply' }); });
  expect(view.queryByRole('heading', { name: 'Old pending draft' })).toBeNull(); expect(mocks.update).not.toHaveBeenCalled();
});

it('requires another review if the reviewed version also changed before a merged save', async () => {
  mocks.write.mockResolvedValueOnce({ ok: false, message: 'Changed again' } as any).mockResolvedValueOnce({ ok: false, message: 'Changed again' } as any);
  const view = render(<DocPreview doc={note} />); await view.findByRole('button', { name: 'Edit' });
  fireEvent.click(view.getByRole('button', { name: 'Edit' }));
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Save' })); });
  await view.findByTestId('library-save-recovery');
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Review latest version' })); });
  await view.findByRole('button', { name: 'Save merged draft' });
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Save merged draft' })); });
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(2));
  expect(view.queryByRole('button', { name: 'Save merged draft' })).toBeNull();
  expect((view.getByLabelText('Edit note') as HTMLTextAreaElement).value).toBe('# Saved note');
});
it('edits raw Markdown, switches back to rich text, and keeps title updates best effort', async () => {
  mocks.update.mockRejectedValueOnce(new Error('metadata unavailable'));
  const view = render(<DocPreview doc={note} />); await view.findByRole('button', { name: 'Edit' });
  fireEvent.click(view.getByRole('button', { name: 'Edit' })); fireEvent.click(view.getByRole('button', { name: 'Source' }));
  fireEvent.change(view.getByLabelText('Source editor'), { target: { value: '' } });
  fireEvent.change(view.getByLabelText('Source editor'), { target: { value: 'intro\n## New title ##\ntext' } });
  fireEvent.click(view.getByRole('button', { name: 'Rich' })); expect((view.getByLabelText('Edit note') as HTMLTextAreaElement).value).toContain('New title');
  fireEvent.click(view.getByRole('button', { name: 'Save' })); await view.findByRole('heading', { name: 'New title' });
  expect(mocks.update).toHaveBeenCalledWith('note', { title: 'New title' }, { scope: 'project', projectId: 'p1', relPath: 'note.md' });
  expect(view.queryByTestId('library-save-recovery')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Edit' })); fireEvent.click(view.getByRole('button', { name: 'Preview' }));
  await view.findByRole('heading', { name: 'New title' });
});
it.each(['image', 'pdf'] as const)('delegates %s bytes to the original-owner asset preview', kind => {
  const view = render(<DocPreview doc={{ ...note, kind, relPath: `asset.${kind}` }} />);
  expect(view.getByText(`Asset: asset.${kind}`)).toBeTruthy(); expect(mocks.read).not.toHaveBeenCalled();
});
it.each(['file.ts', 'file.unknown'])('shows a read-only code view for %s', async relPath => {
  const view = render(<DocPreview doc={{ ...note, kind: 'code', relPath }} />);
  const editor = await view.findByLabelText('Source editor') as HTMLTextAreaElement;
  expect(editor.readOnly).toBe(true); expect(editor.dataset.language).toBe(relPath.endsWith('.ts') ? 'typescript' : 'plaintext');
});
it('does not offer editing for untracked markdown or an unsupported file', async () => {
  const view = render(<DocPreview doc={{ ...note, id: '' }} />); await view.findByRole('heading', { name: 'Saved note' });
  expect(view.queryByRole('button', { name: 'Edit' })).toBeNull();
  view.rerender(<DocPreview doc={{ ...note, kind: 'other' }} />); await view.findByText('Preview not available for this file type');
});
it.each([
  { ok: false, message: 'Unreadable' },
  { ok: false }
])('shows a failed original-owner read: %j', async result => {
  mocks.read.mockResolvedValueOnce(result as any);
  const view = render(<DocPreview doc={note} />); await view.findByText(result.message ?? 'Failed to read file');
  expect(view.queryByRole('button', { name: 'Edit' })).toBeNull();
});
it('handles a rejected read and a document with no path', async () => {
  mocks.read.mockRejectedValueOnce(new Error('Owner offline'));
  const view = render(<DocPreview doc={note} />); await view.findByText('Error: Owner offline');
  view.rerender(<DocPreview doc={{ ...note, relPath: '' }} />); await view.findByText('No path available');
});
it('renders fenced text and Mermaid while preserving the source text for editing', async () => {
  mocks.read.mockResolvedValueOnce({ ok: true, content: '```text\nplain code\n```\n\n```mermaid\ngraph TD; A-->B;\n```', sha256: 'a'.repeat(64) });
  const view = render(<DocPreview doc={note} />); await view.findByText('plain code'); await view.findByText(/Diagram: graph TD/);
});

it('opens preview links inside the library, including bare and file hrefs', async () => {
  mocks.read.mockResolvedValueOnce({ ok: true, content: '[B](linked.md#section-2) [File](file:///project/linked.md)', sha256: 'a'.repeat(64) });
  const open = vi.fn();
  const view = render(<DocPreview doc={note} onOpenDocument={open} />);
  fireEvent.click(await view.findByRole('link', { name: 'B' }));
  expect(open).toHaveBeenLastCalledWith({ path: 'linked.md', fragment: 'section-2' });
  fireEvent.click(view.getByRole('link', { name: 'File' }));
  expect(open).toHaveBeenLastCalledWith({ path: '/project/linked.md', fragment: '' });
});

it('intercepts rich editor links and keeps unsaved changes until discard is confirmed', async () => {
  const open = vi.fn();
  const previousConfirm = window.confirm;
  const confirm = vi.fn(() => false);
  window.confirm = confirm;
  try {
    const view = render(<DocPreview doc={note} onOpenDocument={open} />);
    fireEvent.click(await view.findByRole('button', { name: 'Edit' }));
    fireEvent.click(view.getByRole('link', { name: 'Linked from editor' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.change(view.getByLabelText('Edit note'), { target: { value: '# Unsaved' } });
    fireEvent.click(view.getByRole('link', { name: 'Linked from editor' }));
    expect(confirm).toHaveBeenCalledWith('Discard unsaved changes?');
    expect(open).toHaveBeenCalledTimes(1);
    expect((view.getByLabelText('Edit note') as HTMLTextAreaElement).value).toBe('# Unsaved');
    confirm.mockReturnValue(true);
    fireEvent.click(view.getByRole('link', { name: 'Linked from editor' }));
    expect(open).toHaveBeenCalledTimes(2);
  } finally { window.confirm = previousConfirm; }
});
