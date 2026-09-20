/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ThreadDisplayedImage } from './ThreadDisplayedImage.js';
import { MarkdownContent } from '../../MarkdownContent.js';
import { ThreadImageLightbox } from './ThreadImageLightbox.js';

const { local, host } = vi.hoisted(() => ({ local: vi.fn(), host: vi.fn() }));
vi.mock('../../../lib/product-client.js', () => ({ product: { fs: { readDataUrl: local }, threads: { hostFileContent: host } } }));
beforeEach(() => {
  local.mockReset().mockResolvedValue({ ok: false });
  host.mockReset().mockResolvedValue({ content: 'cG5n', encoding: 'base64', contentType: 'image/png' });
});
afterEach(cleanup);

it('reads registered absolute project files through the authorized desktop reader', async () => {
  local.mockResolvedValue({ ok: true, dataUrl: 'data:image/png;base64,bG9jYWw=' });
  const open = vi.fn();
  const view = render(<ThreadDisplayedImage path="file:///other-project/image%20one.png" threadId="t1" alt="Art" variant="thumb" onOpen={open} />);
  fireEvent.click(await view.findByRole('button'));
  expect(open).toHaveBeenCalledWith('data:image/png;base64,bG9jYWw=', 'Art');
  expect(local).toHaveBeenCalledWith('/other-project/image one.png');
  expect(host).not.toHaveBeenCalled();
});

it('keeps relative Markdown images in the thread workspace and resolves them in the gallery', async () => {
  const view = render(<MarkdownContent threadId="t1" projectId="p1" text="![Art](docs/art.png)\n\n![Other](docs/other.png)" />);
  fireEvent.click(await view.findByRole('button', { name: 'View Art' }));
  expect(host).toHaveBeenCalledWith('t1', 'docs/art.png');
  expect(local).not.toHaveBeenCalled();
  expect(view.container.innerHTML).not.toContain('attachments/content');
  const next = view.getByRole('button', { name: 'Next image' });
  fireEvent.click(next);
  await waitFor(() => expect(view.getByRole('dialog').querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,cG5n'));
  expect(view.getByTestId('thread-image-lightbox-count').textContent).toBe('2 of 2');
});

it('falls back to the host on local failure and clears stale images during navigation', async () => {
  local.mockRejectedValue(Error('unavailable'));
  const pending = Promise.withResolvers<any>();
  host.mockReturnValueOnce(pending.promise);
  const view = render(<ThreadDisplayedImage path="/project/old.png" threadId="t1" />);
  await waitFor(() => expect(host).toHaveBeenCalled());
  view.rerender(<ThreadDisplayedImage path="new.png" threadId="t1" />);
  expect((await view.findByRole('img')).getAttribute('src')).toBe('data:image/png;base64,cG5n');
  await act(async () => pending.resolve({ content: 'b2xk', encoding: 'base64', contentType: 'image/png' }));
  expect(view.getByRole('img').getAttribute('src')).toBe('data:image/png;base64,cG5n');
});

it.each(['missing', 'invalid', 'no-thread'])('shows a readable fallback for %s files', async (kind) => {
  if (kind === 'missing') host.mockRejectedValue(Error('not found'));
  if (kind === 'invalid') host.mockResolvedValue({ content: 'junk', contentType: 'text/plain' });
  const view = render(<ThreadDisplayedImage path="missing.png" threadId={kind === 'no-thread' ? undefined : 't1'} alt="Missing artwork" />);
  await view.findByText('Missing artwork — Image unavailable');
  expect(view.queryByRole('img')).toBeNull();
});

it('handles remote load errors in both Markdown and the lightbox without broken image icons', () => {
  const view = render(<ThreadImageLightbox src="https://example.com/a.png" alt="Remote art" onClose={() => {}} />);
  fireEvent.error(view.getByRole('img'));
  expect(view.getByText('Remote art — Image unavailable')).toBeTruthy();
  view.unmount();
  const markdown = render(<MarkdownContent text="![Remote art](https://example.com/a.png)" />);
  expect(markdown.getByRole('img').getAttribute('referrerpolicy')).toBe('no-referrer');
  fireEvent.error(markdown.getByRole('img'));
  expect(markdown.queryByRole('button', { name: 'View Remote art' })).toBeNull();
  expect(markdown.getByText('Remote art — Image unavailable')).toBeTruthy();
});

it('does not load unsafe schemes as images', async () => {
  const view = render(<ThreadDisplayedImage path="javascript:bad.png" threadId="t1" />);
  await view.findByText(/Image unavailable/);
  expect(host).not.toHaveBeenCalled();
  expect(local).not.toHaveBeenCalled();
});
