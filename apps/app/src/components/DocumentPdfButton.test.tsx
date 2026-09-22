/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { DocumentPdfButton } from './DocumentPdfButton.js';

const mocks = vi.hoisted(() => ({
  renderReportHtml: vi.fn(), exportPdf: vi.fn(), pushToast: vi.fn()
}));
vi.mock('../lib/renderReportHtml.js', () => ({ renderReportHtml: mocks.renderReportHtml }));
vi.mock('../lib/product-client.js', () => ({ product: { inbox: { exportPdf: mocks.exportPdf } } }));
vi.mock('../store.js', () => ({ useUi: (select: Function) => select({ pushToast: mocks.pushToast }) }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.renderReportHtml.mockResolvedValue('<html>full document</html>');
  mocks.exportPdf.mockResolvedValue({ ok: true, path: '/Downloads/Note.pdf' });
});
afterEach(cleanup);

describe('DocumentPdfButton', () => {
  it('disables export until content is loaded and exports the latest source', async () => {
    const view = render(<DocumentPdfButton path="note.md" title="Note" content={null} />);
    const button = view.getByRole('button', { name: 'Download PDF' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(mocks.exportPdf).not.toHaveBeenCalled();
    view.rerender(<DocumentPdfButton path="note.md" title="Note" content="# Unsaved edit" />);
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(mocks.exportPdf).toHaveBeenCalledWith({
      html: '<html>full document</html>', suggestedName: 'Note'
    }));
    expect(mocks.renderReportHtml).toHaveBeenCalledWith({
      title: 'Note', docs: [{ path: 'note.md', content: '# Unsaved edit' }]
    });
    expect(mocks.pushToast).toHaveBeenCalledWith('PDF saved to /Downloads/Note.pdf', 'info');
  });

  it('prevents duplicate downloads while rendering and allows an empty document', async () => {
    let finish!: (html: string) => void;
    mocks.renderReportHtml.mockReturnValue(new Promise<string>((resolve) => { finish = resolve; }));
    mocks.exportPdf.mockResolvedValue({ ok: true });
    const view = render(<DocumentPdfButton path="empty.md" title="Empty" content="" className="custom" />);
    const button = view.getByRole('button') as HTMLButtonElement;
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(mocks.renderReportHtml).toHaveBeenCalledTimes(1));
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Exporting…');
    expect(button.className).toBe('custom');
    finish('<html></html>');
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(mocks.exportPdf).toHaveBeenCalledTimes(1);
    expect(mocks.pushToast).toHaveBeenCalledWith('PDF saved', 'info');
  });

  it.each([
    [{ ok: false, message: 'Disk full' }, 'Disk full'],
    [{ ok: false }, 'PDF export failed']
  ])('reports a native failure and allows retry: %j', async (result, message) => {
    mocks.exportPdf.mockResolvedValueOnce(result);
    const view = render(<DocumentPdfButton path="note.md" title="Note" content="# Note" />);
    const button = view.getByRole('button') as HTMLButtonElement;
    fireEvent.click(button);
    await waitFor(() => expect(mocks.pushToast).toHaveBeenCalledWith(message, 'error'));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(mocks.exportPdf).toHaveBeenCalledTimes(2));
  });

  it.each([new Error('Render failed'), 'unexpected failure'])('handles render exceptions: %s', async (error) => {
    mocks.renderReportHtml.mockRejectedValue(error);
    const view = render(<DocumentPdfButton path="note.md" title="Note" content="# Note" />);
    const button = view.getByRole('button') as HTMLButtonElement;
    fireEvent.click(button);
    await waitFor(() => expect(mocks.pushToast).toHaveBeenCalledWith(
      error instanceof Error ? error.message : 'PDF export failed', 'error'
    ));
    expect(mocks.exportPdf).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
  });
});
