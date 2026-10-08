/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ThreadFilePreviewTab } from './ThreadFilePreviewTab.js';

const mocks = vi.hoisted(() => ({ readFile: vi.fn(), hostFileContent: vi.fn(), storageContent: vi.fn() }));
vi.mock('../../../lib/product-client.js', () => ({
  product: {
    fs: { readFile: mocks.readFile },
    threads: { hostFileContent: mocks.hostFileContent, storageContent: mocks.storageContent }
  }
}));
vi.mock('../../../plugins/plugin-slots.js', async () => {
  const { DocsOpener } = await import('../../../../../../plugins/docs/src/app/DocsOpener.js');
  const openers = [{
    id: 'markdown', pluginId: 'docs', generation: 1, title: 'Docs',
    extensions: ['md', 'mdx'], component: DocsOpener
  }];
  return { listFileOpeners: () => openers, subscribePluginSlots: () => () => undefined };
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); localStorage.clear(); });

describe('file opener host preview lifetime', () => {
  it('keeps Open with choices scoped to their file type and honors a changed explicit opener', async () => {
    mocks.hostFileContent.mockResolvedValue({ content: '# Report' });
    const view = render(<ThreadFilePreviewTab path="first.md" threadId="t1" />);
    await view.findByRole('heading', { name: 'Report' });
    fireEvent.change(view.getByRole('combobox', { name: 'Open with' }), { target: { value: 'host' } });
    expect(view.container.querySelector('.docs-file-opener')).toBeNull();
    view.rerender(<ThreadFilePreviewTab path="second.mdx" threadId="t1" />);
    await view.findByRole('heading', { name: 'Report' });
    expect(view.container.querySelector('.docs-file-opener')).not.toBeNull();
    view.rerender(<ThreadFilePreviewTab path="second.mdx" threadId="t1" openerKey="host" />);
    expect(view.container.querySelector('.docs-file-opener')).toBeNull();
    view.rerender(<ThreadFilePreviewTab path="first.md" threadId="t1" />);
    await view.findByRole('heading', { name: 'Report' });
    expect(view.container.querySelector('.docs-file-opener')).toBeNull();
  });
  it('passes the CLI panel project scope when a relative workspace file needs the host reader', async () => {
    mocks.readFile.mockResolvedValue({ ok: false, message: 'Path is not inside a known project' });
    mocks.hostFileContent.mockImplementation(async (_id, _path, projectId) => ({ content: `# ${projectId}`, encoding: 'utf8' }));
    const view = render(<ThreadFilePreviewTab path=".zcc/report.md" threadId="cli-session" projectId="p1" />);
    await view.findByRole('heading', { name: 'p1' });
    expect(mocks.hostFileContent).toHaveBeenCalledWith('cli-session', '.zcc/report.md', 'p1');
    view.rerender(<ThreadFilePreviewTab path=".zcc/report.md" threadId="cli-session" projectId="p2" />);
    await view.findByRole('heading', { name: 'p2' });
    expect(mocks.hostFileContent).toHaveBeenLastCalledWith('cli-session', '.zcc/report.md', 'p2');
  });

  it('loads CLI workspace images using the same project scope', async () => {
    mocks.hostFileContent.mockResolvedValue({ content: 'iVBORw0KGgo=', encoding: 'base64', contentType: 'image/png' });
    const view = render(<ThreadFilePreviewTab path="shot.png" threadId="cli-session" projectId="p1" />);
    expect((await view.findByRole('img', { name: 'shot.png' })).getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(mocks.hostFileContent).toHaveBeenCalledWith('cli-session', 'shot.png', 'p1');
  });

  it('keeps thread-storage files on the storage reader even when a project is supplied', async () => {
    mocks.storageContent.mockResolvedValue({ content: '# Stored', encoding: 'utf8' });
    const view = render(<ThreadFilePreviewTab path="stored.md" threadId="t1" projectId="p1" storage />);
    await view.findByRole('heading', { name: 'Stored' });
    expect(mocks.storageContent).toHaveBeenCalledWith('t1', 'stored.md');
    expect(mocks.hostFileContent).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it('preserves conversation previews without a project and displays read errors', async () => {
    mocks.readFile.mockResolvedValue({ ok: false });
    mocks.hostFileContent.mockRejectedValue(new Error('file not found'));
    const view = render(<ThreadFilePreviewTab path="missing.md" threadId="t1" />);
    await view.findByText('file not found');
    expect(mocks.hostFileContent).toHaveBeenCalledWith('t1', 'missing.md', undefined);
  });

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
    view.rerender(<ThreadFilePreviewTab path="clips/demo.MP4" threadId="t1" previewRevision={1} />);
    expect(view.getByLabelText('Video preview: demo.MP4')).not.toBe(player);
    expect(view.queryByRole('status')).toBeNull();
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
    mocks.hostFileContent.mockResolvedValue({ content: '# Document\n\nRead this independently.' });
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
    expect(mocks.hostFileContent).toHaveBeenCalledTimes(1);
  });

  it('recovers after a read error and clears old content while another file loads', async () => {
    mocks.hostFileContent.mockRejectedValueOnce(new Error('file not found'));
    const view = render(<ThreadFilePreviewTab path="missing.md" threadId="t1" />);
    await view.findByText('file not found');
    mocks.hostFileContent.mockResolvedValueOnce({ content: '# Recovered' });
    view.rerender(<ThreadFilePreviewTab path="valid.md" threadId="t1" />);
    await view.findByRole('heading', { name: 'Recovered' });
    expect(view.queryByText('file not found')).toBeNull();
    const pending = Promise.withResolvers<{ content: string }>();
    mocks.hostFileContent.mockReturnValueOnce(pending.promise);
    view.rerender(<ThreadFilePreviewTab path="next.md" threadId="t1" />);
    expect(view.queryByRole('heading', { name: 'Recovered' })).toBeNull();
    pending.resolve({ content: '# Next' });
    await view.findByRole('heading', { name: 'Next' });
  });

  it('reloads the same file only on an explicit preview revision and ignores cancelled reads', async () => {
    mocks.hostFileContent.mockResolvedValueOnce({ content: '# Original' });
    const view = render(<ThreadFilePreviewTab path="report.md" threadId="t1" />);
    await view.findByRole('heading', { name: 'Original' });
    const stale = Promise.withResolvers<{ content: string }>();
    mocks.hostFileContent.mockReturnValueOnce(stale.promise);
    view.rerender(<ThreadFilePreviewTab path="report.md" threadId="t1" previewRevision={1} />);
    mocks.hostFileContent.mockResolvedValueOnce({ content: '# Updated' });
    view.rerender(<ThreadFilePreviewTab path="report.md" threadId="t1" previewRevision={2} />);
    await view.findByRole('heading', { name: 'Updated' });
    await act(async () => { stale.resolve({ content: '# Obsolete' }); });
    expect(view.queryByRole('heading', { name: 'Obsolete' })).toBeNull();
    expect(view.getByRole('heading', { name: 'Updated' })).toBeTruthy();
    expect(mocks.hostFileContent).toHaveBeenCalledTimes(3);
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

it('retains the same document during refresh and hides it immediately for a new scope', async () => {
  mocks.hostFileContent.mockResolvedValueOnce({ content: '# Original' });
  const view = render(<ThreadFilePreviewTab path="report.md" threadId="t1" openerKey="host" />);
  await view.findByRole('heading', { name: 'Original' });
  let resolveRefresh!: (value: { content: string }) => void;
  mocks.hostFileContent.mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve; }));
  view.rerender(<ThreadFilePreviewTab path="report.md" threadId="t1" openerKey="host" previewRevision={1} />);
  expect(view.getByRole('heading', { name: 'Original' })).toBeTruthy();
  mocks.hostFileContent.mockResolvedValueOnce({ content: '# Other' });
  view.rerender(<ThreadFilePreviewTab path="report.md" threadId="t2" openerKey="host" />);
  expect(view.queryByRole('heading', { name: 'Original' })).toBeNull();
  await view.findByRole('heading', { name: 'Other' });
  await act(async () => { resolveRefresh({ content: '# Stale' }); });
  expect(view.queryByRole('heading', { name: 'Stale' })).toBeNull();
});
it('keeps the existing document and shows a failed-refresh status', async () => {
  mocks.hostFileContent.mockResolvedValueOnce({ content: '# Original' });
  const view = render(<ThreadFilePreviewTab path="report.md" threadId="t1" openerKey="host" />);
  await view.findByRole('heading', { name: 'Original' });
  mocks.hostFileContent.mockRejectedValueOnce(new Error('offline'));
  mocks.readFile.mockResolvedValue({ ok: false });
  view.rerender(<ThreadFilePreviewTab path="report.md" threadId="t1" openerKey="host" previewRevision={1} />);
  expect((await view.findByRole('status')).textContent).toContain('offline');
  expect(view.getByRole('heading', { name: 'Original' })).toBeTruthy();
});

describe('HTML file preview', () => {
  it('renders HTML in a sandboxed frame by default and toggles to the source', async () => {
    mocks.hostFileContent.mockResolvedValue({ content: '<h1>Mock</h1>', encoding: 'utf8' });
    const view = render(<ThreadFilePreviewTab path="mockups/page.html" threadId="t1" />);
    const frame = await view.findByTestId('thread-file-preview-html');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('srcdoc')).toBe('<h1>Mock</h1>');
    expect(view.getByTestId('thread-file-preview-mode-preview').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(view.getByTestId('thread-file-preview-mode-code'));
    expect(view.queryByTestId('thread-file-preview-html')).toBeNull();
    expect(view.getByTestId('thread-file-preview').textContent).toContain('<h1>Mock</h1>');
    expect(view.getByTestId('thread-file-preview-mode-code').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(view.getByTestId('thread-file-preview-mode-preview'));
    expect(view.getByTestId('thread-file-preview-html')).toBeTruthy();
  });

  it('opens on the source when a line is targeted and forgets the choice for another file', async () => {
    mocks.hostFileContent.mockResolvedValue({ content: '<p>a</p>\n<p>b</p>', encoding: 'utf8' });
    const view = render(<ThreadFilePreviewTab path="a.htm" threadId="t1" lineNumber={2} />);
    await view.findByTestId('thread-file-preview-focus-line');
    expect(view.queryByTestId('thread-file-preview-html')).toBeNull();
    view.rerender(<ThreadFilePreviewTab path="b.html" threadId="t1" />);
    expect(await view.findByTestId('thread-file-preview-html')).toBeTruthy();
  });

  it('offers no HTML toggle for other file types', async () => {
    mocks.hostFileContent.mockResolvedValue({ content: 'plain', encoding: 'utf8' });
    const view = render(<ThreadFilePreviewTab path="notes.txt" threadId="t1" />);
    await waitFor(() => expect(view.getByTestId('thread-file-preview').textContent).toContain('plain'));
    expect(view.queryByTestId('thread-file-preview-mode-code')).toBeNull();
  });
});
