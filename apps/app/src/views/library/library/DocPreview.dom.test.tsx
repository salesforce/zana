/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { LibraryDoc } from '@zana-ai/zcc-domain/product';
import { DocPreview } from './DocPreview.js';

const mocks = vi.hoisted(() => ({
  read: vi.fn(async () => ({ ok: true, content: '# Saved note' })),
  exportPdf: vi.fn(async () => ({ ok: true })),
  renderReportHtml: vi.fn(async () => '<html>note</html>'),
  pushToast: vi.fn()
}));
vi.mock('../../../lib/product-client.js', () => ({ product: {
  library: { read: mocks.read }, inbox: { exportPdf: mocks.exportPdf }
} }));
vi.mock('../../../store.js', () => ({ useUi: (select: Function) => select({ pushToast: mocks.pushToast }) }));
vi.mock('../../../lib/renderReportHtml.js', () => ({ renderReportHtml: mocks.renderReportHtml }));
vi.mock('../../../lib/monacoSetup', () => ({}));
vi.mock('../../../hooks/useMonacoTheme', () => ({ useMonacoTheme: () => 'light' }));
vi.mock('../../../components/AiEnhanceSelection', () => ({ useAiEnhanceSelection: () => ({ registerEditor: vi.fn(), modal: null }) }));
vi.mock('./LibraryMarkdownEditor.js', () => ({
  LibraryMarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="Edit note" value={value} onChange={(e) => onChange(e.target.value)} />
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
