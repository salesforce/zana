// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ resolve: vi.fn(), open: vi.fn() }));
vi.mock('../lib/product-client.js', () => ({ product: { threads: { resolvePreviewPath: h.resolve } } }));
vi.mock('./thread/secondary-panel/useThreadOpenFileSignal.js', () => ({
  dispatchThreadOpenFile: h.open
}));
import { MarkdownFileLink } from './MarkdownFileLink.js';
import { MarkdownContent } from './MarkdownContent.js';

beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

it('shows duplicate basename choices and opens only the selected path', async () => {
  h.resolve.mockResolvedValue({ kind: 'ambiguous', paths: ['docs/guide.md', 'examples/guide.md'] });
  render(<MarkdownFileLink token="guide.md" threadId="thread-1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview guide.md' }));
  const choice = await screen.findByRole('button', { name: 'docs/guide.md' });
  expect(h.resolve).toHaveBeenCalledWith('thread-1', { path: 'guide.md', hints: [] });
  fireEvent.click(choice);
  expect(h.open).toHaveBeenCalledWith('thread-1', 'docs/guide.md');
});

it('shows an incomplete-search message without guessing a file', async () => {
  h.resolve.mockResolvedValue({ kind: 'incomplete', paths: ['docs/guide.md'] });
  render(<MarkdownFileLink token="guide.md" threadId="thread-1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview guide.md' }));
  expect((await screen.findByRole('status')).textContent).toMatch(/could not check every folder/i);
  expect(h.open).not.toHaveBeenCalled();
});

it('shows an incomplete-search message when no matches were found', async () => {
  h.resolve.mockResolvedValue({ kind: 'incomplete', paths: [] });
  render(<MarkdownFileLink token="guide.md" threadId="thread-1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview guide.md' }));
  const status = await screen.findByRole('status');
  expect(status.textContent).toBe('Could not check every folder. Use a full path.');
  expect(h.open).not.toHaveBeenCalled();
});

it('opens a uniquely resolved path and passes thread scope, project and hints', async () => {
  h.resolve.mockResolvedValue({ kind: 'resolved', path: 'docs/guide.md' });
  render(<MarkdownFileLink token="guide.md" threadId="thread-2" projectId="project-2" hints={['docs/guide.md']} />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview guide.md' }));
  await waitFor(() => expect(h.open).toHaveBeenCalledWith('thread-2', 'docs/guide.md'));
  expect(h.resolve).toHaveBeenCalledWith('thread-2', { path: 'guide.md', hints: ['docs/guide.md'], projectId: 'project-2' });
});

it('reports a missing path and retries after the file becomes available', async () => {
  h.resolve.mockResolvedValueOnce({ kind: 'not_found', path: 'reports/missing.md' })
    .mockResolvedValueOnce({ kind: 'resolved', path: 'reports/missing.md' });
  render(<MarkdownFileLink token="reports/missing.md" threadId="thread-3" />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview missing.md' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(h.open).toHaveBeenCalledWith('thread-3', 'reports/missing.md'));
});

it('renders resolver errors and permits retry', async () => {
  h.resolve.mockRejectedValueOnce(new Error('Host is offline'))
    .mockResolvedValueOnce({ kind: 'not_found', path: 'guide.md' });
  render(<MarkdownFileLink token="guide.md" threadId="thread-4" />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview guide.md' }));
  expect((await screen.findByRole('status')).textContent).toContain('Host is offline');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect((await screen.findByRole('status')).textContent).toContain('Could not find guide.md');
});

it('preserves file URL anchors and resolves their normalized path', async () => {
  h.resolve.mockResolvedValue({ kind: 'resolved', path: 'docs/guide.md' });
  render(<MarkdownFileLink token="D:/repo/docs/guide.md" threadId="thread-5" href="file:///D:/repo/docs/guide.md" link>
    Guide
  </MarkdownFileLink>);
  const link = screen.getByRole('link', { name: 'Preview guide.md' });
  expect(link.getAttribute('href')).toBe('file:///D:/repo/docs/guide.md');
  fireEvent.click(link);
  expect(h.resolve).toHaveBeenCalledWith('thread-5', { path: 'D:/repo/docs/guide.md', hints: [] });
  await waitFor(() => expect(h.open).toHaveBeenCalledWith('thread-5', 'docs/guide.md'));
});

it('does not allow choices from an old token or thread to open after rerender', async () => {
  h.resolve.mockResolvedValue({ kind: 'ambiguous', paths: ['docs/old.md', 'archive/old.md'] });
  const view = render(<MarkdownFileLink token="old.md" threadId="thread-old" />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview old.md' }));
  const oldChoice = await screen.findByRole('button', { name: 'docs/old.md' });
  view.rerender(<MarkdownFileLink token="new.md" threadId="thread-new" />);
  expect(screen.queryByRole('button', { name: 'docs/old.md' })).toBeNull();
  fireEvent.click(oldChoice);
  expect(h.open).not.toHaveBeenCalled();
});

it('deduplicates relevant hints and omits hints for explicit paths', async () => {
  h.resolve.mockResolvedValue({ kind: 'not_found', path: 'guide.md' });
  const hints = ['docs/guide.md', 'docs/guide.md', 'examples/other.md', 'examples/guide.md'];
  const view = render(<MarkdownFileLink token="guide.md" threadId="thread-1" hints={hints} />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview guide.md' }));
  await waitFor(() => expect(h.resolve).toHaveBeenCalledWith('thread-1', {
    path: 'guide.md', hints: ['docs/guide.md', 'examples/guide.md']
  }));
  view.rerender(<MarkdownFileLink token="docs/guide.md" threadId="thread-1" hints={hints} />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview guide.md' }));
  await waitFor(() => expect(h.resolve).toHaveBeenLastCalledWith('thread-1', {
    path: 'docs/guide.md', hints: []
  }));
});

it('forwards hints with differing basename case for bare tokens', async () => {
  h.resolve.mockResolvedValue({ kind: 'resolved', path: 'docs/Guide.md' });
  render(<MarkdownFileLink token="guide.md" threadId="thread-1" hints={['docs/Guide.md']} />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview guide.md' }));
  await waitFor(() => expect(h.resolve).toHaveBeenCalledWith('thread-1', {
    path: 'guide.md', hints: ['docs/Guide.md']
  }));
});

it('falls back to full search instead of truncating over-limit ambiguity hints', async () => {
  h.resolve.mockResolvedValue({ kind: 'not_found', path: 'guide.md' });
  const hints = Array.from({ length: 51 }, (_, index) => `dir-${index}/guide.md`);
  render(<MarkdownFileLink token="guide.md" threadId="thread-many" hints={hints} />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview guide.md' }));
  await waitFor(() => expect(h.resolve).toHaveBeenCalledWith('thread-many', { path: 'guide.md', hints: [] }));
});

it('resolves a bare filename when a single timeline hint is stale and opens the live server match', async () => {
  h.resolve.mockResolvedValue({ kind: 'resolved', path: 'docs/guide.md' });
  render(
    <MarkdownContent
      text="Check `guide.md`"
      threadId="thread-1"
      filePathHints={['old/guide.md']}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Preview guide.md' }));
  await waitFor(() => expect(h.resolve).toHaveBeenCalledWith('thread-1', {
    path: 'guide.md',
    hints: ['old/guide.md']
  }));
  expect(h.open).toHaveBeenCalledWith('thread-1', 'docs/guide.md');
});

it('renders three or more duplicate basename choices from server ambiguity', async () => {
  h.resolve.mockResolvedValue({
    kind: 'ambiguous',
    paths: ['docs/guide.md', 'examples/guide.md', 'archive/guide.md']
  });
  render(<MarkdownFileLink token="guide.md" threadId="thread-1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview guide.md' }));
  expect(await screen.findByRole('button', { name: 'docs/guide.md' })).toBeDefined();
  expect(await screen.findByRole('button', { name: 'examples/guide.md' })).toBeDefined();
  expect(await screen.findByRole('button', { name: 'archive/guide.md' })).toBeDefined();
});

it('renders checkedPath in not_found error message', async () => {
  h.resolve.mockResolvedValue({ kind: 'not_found', path: 'missing.md', checkedPath: '/work/missing.md' });
  render(<MarkdownFileLink token="missing.md" threadId="thread-err" />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview missing.md' }));
  expect((await screen.findByRole('status')).textContent).toContain('Could not find missing.md (checked /work/missing.md)');
});
