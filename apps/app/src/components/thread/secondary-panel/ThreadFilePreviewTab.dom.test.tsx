/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ThreadFilePreviewTab } from './ThreadFilePreviewTab.js';

const mocks = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock('../../../lib/product-client.js', () => ({
  product: { fs: { readFile: mocks.readFile }, threads: {} }
}));
vi.mock('../../../plugins/plugin-slots.js', async () => {
  const { DocsOpener } = await import('../../../../../../plugins/docs/src/app/DocsOpener.js');
  const openers = [{
    id: 'markdown', pluginId: 'docs', generation: 1, title: 'Docs',
    extensions: ['md'], component: DocsOpener
  }];
  return { listFileOpeners: () => openers, subscribePluginSlots: () => () => undefined };
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe('file opener host preview lifetime', () => {
  it('preserves the document DOM and scroll through unrelated parent updates', async () => {
    mocks.readFile.mockResolvedValue({ ok: true, content: '# Document\n\nRead this independently.' });
    const view = render(<ThreadFilePreviewTab path="guide.md" threadId="t1" />);
    await view.findByRole('heading', { name: 'Document' });
    const preview = view.getByTestId('thread-file-preview');
    preview.scrollTop = 640;
    const heading = view.getByRole('heading', { name: 'Document' });
    for (let i = 0; i < 5; i++) {
      view.rerender(<ThreadFilePreviewTab path="guide.md" threadId="t1" />);
      expect(view.getByTestId('thread-file-preview')).toBe(preview);
      expect(view.getByRole('heading', { name: 'Document' })).toBe(heading);
      expect(preview.scrollTop).toBe(640);
    }
    expect(mocks.readFile).toHaveBeenCalledTimes(1);
  });

  it('delivers updated preview content without a stale closure and isolates simultaneous previews', async () => {
    mocks.readFile.mockImplementation(async (path: string) => ({ ok: true, content: `# ${path}` }));
    const view = render(<>
      <ThreadFilePreviewTab path="first.md" />
      <ThreadFilePreviewTab path="second.md" />
    </>);
    await view.findByRole('heading', { name: 'first.md' });
    await view.findByRole('heading', { name: 'second.md' });
    view.rerender(<>
      <ThreadFilePreviewTab path="changed.md" />
      <ThreadFilePreviewTab path="second.md" />
    </>);
    await view.findByRole('heading', { name: 'changed.md' });
    expect(view.getByRole('heading', { name: 'second.md' })).toBeTruthy();
    await waitFor(() => expect(view.queryByRole('heading', { name: 'first.md' })).toBeNull());
  });

  it('keeps line navigation current without scrolling back on unrelated updates', async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    mocks.readFile.mockResolvedValue({ ok: true, content: 'one\ntwo\nthree' });
    const view = render(<ThreadFilePreviewTab path="guide.md" lineNumber={2} />);
    await view.findByTestId('thread-file-preview-focus-line');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    view.rerender(<ThreadFilePreviewTab path="guide.md" lineNumber={2} />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    view.rerender(<ThreadFilePreviewTab path="guide.md" lineNumber={3} />);
    expect(view.getByTestId('thread-file-preview-focus-line').textContent).toContain('three');
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('supports switching to the host preview and surfaces read failures', async () => {
    mocks.readFile.mockResolvedValue({ ok: true, content: '# Loaded' });
    const view = render(<ThreadFilePreviewTab path="guide.md" />);
    await view.findByRole('heading', { name: 'Loaded' });
    expect(view.container.querySelector('.docs-file-opener')).not.toBeNull();
    fireEvent.change(view.getByRole('combobox', { name: 'Open with' }), { target: { value: 'host' } });
    expect(view.container.querySelector('.docs-file-opener')).toBeNull();
    expect(view.getByRole('heading', { name: 'Loaded' })).toBeTruthy();
    fireEvent.change(view.getByRole('combobox', { name: 'Open with' }), { target: { value: 'docs/markdown' } });
    expect(view.container.querySelector('.docs-file-opener')).not.toBeNull();
    mocks.readFile.mockRejectedValue(new Error('unavailable'));
    view.rerender(<ThreadFilePreviewTab path="missing.md" />);
    await view.findByText('Could not read file');
    expect(view.queryByRole('heading', { name: 'Loaded' })).toBeNull();
  });
});
