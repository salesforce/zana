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
  it('plays videos without reading them as text and resets errors when the file changes', async () => {
    mocks.readFile.mockClear();
    const view = render(<ThreadFilePreviewTab path="clips/demo.MP4" threadId="t1" lineNumber={10} />);
    const player = view.getByLabelText('Video preview: demo.MP4') as HTMLVideoElement;
    expect(player.getAttribute('src')).toBe('/api/v1/file-preview/video?path=clips%2Fdemo.MP4&source=workspace&threadId=t1');
    expect(player.controls).toBe(true);
    expect(player.autoplay).toBe(false);
    expect(player.preload).toBe('metadata');
    expect(mocks.readFile).not.toHaveBeenCalled();
    fireEvent.error(player);
    expect(view.getByRole('status').textContent).toContain('Could not play this video');
    fireEvent.loadedMetadata(player);
    expect(view.queryByRole('status')).toBeNull();
    fireEvent.error(player);
    view.rerender(<ThreadFilePreviewTab path="clip.webm" threadId="t1" storage />);
    const storagePlayer = view.getByLabelText('Video preview: clip.webm');
    expect(storagePlayer.getAttribute('src')).toContain('source=thread-storage');
    expect(view.queryByRole('status')).toBeNull();
    expect(storagePlayer).not.toBe(player);
    view.rerender(<ThreadFilePreviewTab path="/project/clip.mov" projectId="p1" />);
    expect(view.getByLabelText('Video preview: clip.mov').getAttribute('src')).not.toContain('threadId');
    expect(view.getByLabelText('Video preview: clip.mov').getAttribute('src')).toContain('projectId=p1');
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

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
