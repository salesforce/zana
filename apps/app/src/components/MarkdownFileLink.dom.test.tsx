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

it.each(['//example.com/report.md', '//github.com/org/repo', '//workspace/report.md', '/settings', '/threads/abc', 'example.com', 'www.github.io', 'report.md'])(
  'retains web navigation for %s', (href) => {
    const { container } = render(<MarkdownContent text={`[Navigate](${href})`} threadId="thread-links" />);
    const anchor = screen.getByRole('link', { name: 'Navigate' });
    expect(anchor.getAttribute('href')).toBe(href);
    let prevented: boolean | undefined;
    container.addEventListener('click', (event) => {
      prevented = event.defaultPrevented;
      event.preventDefault(); // Observe native navigation without opening a test page.
    });
    fireEvent.click(anchor);
    expect(prevented).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();
    expect(h.resolve).not.toHaveBeenCalled();
  }
);

it.each([
  'java&#x09;script:alert(1)//x.md',
  '&#x01;javascript:alert(1)//x.md',
  'javascript:alert(1)//x.md',
  'java%09script:alert(1)//x.md'
])('does not preserve an obfuscated script destination: %s', (href) => {
  render(<MarkdownContent text={`[Unsafe](<${href}>)`} threadId="thread-links" />);
  expect(screen.getByText('Unsafe').getAttribute('href')).toBeNull();
  expect(h.resolve).not.toHaveBeenCalled();
});

it('does not put an invalid local destination in a native anchor', () => {
  render(<MarkdownContent text="[Invalid](D:relative.md)" threadId="thread-links" />);
  expect(screen.getByText('Invalid').getAttribute('href')).toBe('#');
});

it.each([
  ['D:/repo/report.md', 'D:/repo/report.md', null],
  ['/D:/repo/report.md', 'D:/repo/report.md', null],
  ['d:\\repo\\report.md', 'd:/repo/report.md', null],
  ['D:/repo/report%20one.md:12', 'D:/repo/report one.md', 12],
  ['/D:/repo/report%20one.md#L7', 'D:/repo/report one.md', 7],
  ['file:///D:/repo/report%20one.md#L7', 'D:/repo/report one.md', 7],
  ['./docs/שלום%20report.md:3', './docs/שלום report.md', 3],
  ['/tmp/report.md:5', '/tmp/report.md', 5]
])('previews the rendered Markdown destination %s', async (href, path, lineNumber) => {
  h.resolve.mockResolvedValue({ kind: 'resolved', path: 'docs/report.md' });
  render(<MarkdownContent text={`[Report](<${href}>)`} threadId="thread-links" />);
  const link = screen.getByRole('link', { name: /Preview/ });
  expect(fireEvent.click(link)).toBe(false);
  expect(h.resolve).toHaveBeenCalledWith('thread-links', { path, hints: [] });
  await waitFor(() => expect(h.open).toHaveBeenCalledWith('thread-links', 'docs/report.md', lineNumber));
});

it.each(['D:relative.md', '/D:/repo/%2e%2e/private.md', 'file://server/share/report.md', '/D:/repo/bad%zz.md', 'D:/repo/a%5cb.md'])(
  'explains unsupported local destination %s without navigation', async (href) => {
    render(<MarkdownContent text={`[Report](${href})`} threadId="thread-links" />);
    expect(fireEvent.click(screen.getByText('Report'))).toBe(false);
    expect((await screen.findByRole('status')).textContent).toMatch(/invalid|unsupported/i);
    expect(h.resolve).not.toHaveBeenCalled();
  }
);

it('explains when a local link has no owning thread', async () => {
  render(<MarkdownContent text="[Report](D:/repo/report.md)" />);
  expect(fireEvent.click(screen.getByText('Report'))).toBe(false);
  expect((await screen.findByRole('status')).textContent).toMatch(/thread/i);
  expect(h.resolve).not.toHaveBeenCalled();
});

it('preserves the title of an unavailable local link', () => {
  render(<MarkdownContent text={'[Report](D:/repo/report.md "File title")'} />);
  expect(screen.getByText('Report').getAttribute('title')).toBe('File title');
});

it.each([{ button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }])(
  'keeps modified local-link activation in the preview (%j)', async (options) => {
    h.resolve.mockResolvedValue({ kind: 'resolved', path: 'docs/report.md' });
    render(<MarkdownContent text="[Report](/tmp/report.md)" threadId="thread-links" />);
    const link = screen.getByRole('link', { name: 'Preview report.md' });
    const allowed = options.button === 1
      ? fireEvent(link, new MouseEvent('auxclick', { bubbles: true, cancelable: true, ...options }))
      : fireEvent.click(link, options);
    expect(allowed).toBe(false);
    await waitFor(() => expect(h.open).toHaveBeenCalledWith('thread-links', 'docs/report.md', null));
  }
);

it('carries line focus through ambiguous-file selection', async () => {
  h.resolve.mockResolvedValue({ kind: 'ambiguous', paths: ['docs/report.md', 'examples/report.md'] });
  render(<MarkdownContent text="[Report](report.md:9)" threadId="thread-links" />);
  fireEvent.click(screen.getByText('Report'));
  fireEvent.click(await screen.findByRole('button', { name: 'docs/report.md' }));
  expect(h.open).toHaveBeenCalledWith('thread-links', 'docs/report.md', 9);
});

it('normalizes backslashes in reference links before Markdown URI encoding', async () => {
  h.resolve.mockResolvedValue({ kind: 'resolved', path: 'docs/report.md' });
  render(<MarkdownContent text={'[Report][ref]\n\n[ref]: <D:\\repo\\report.md>'} threadId="thread-links" />);
  fireEvent.click(screen.getByRole('link', { name: 'Preview report.md' }));
  expect(h.resolve).toHaveBeenCalledWith('thread-links', { path: 'D:/repo/report.md', hints: [] });
  await waitFor(() => expect(h.open).toHaveBeenCalledWith('thread-links', 'docs/report.md', null));
});

it('ignores a stale resolution after only the requested line changes', async () => {
  let finish!: (result: { kind: 'resolved'; path: string }) => void;
  h.resolve.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValue({ kind: 'resolved', path: 'docs/report.md' });
  const view = render(<MarkdownFileLink token="report.md" threadId="thread-lines" lineNumber={3} />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview report.md' }));
  view.rerender(<MarkdownFileLink token="report.md" threadId="thread-lines" lineNumber={4} />);
  finish({ kind: 'resolved', path: 'docs/report.md' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preview report.md' }).textContent).toBe('report.md'));
  expect(h.open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Preview report.md' }));
  await waitFor(() => expect(h.open).toHaveBeenCalledWith('thread-lines', 'docs/report.md', 4));
});

it('keeps HTTP link behavior and unsafe scheme sanitization', () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  try {
    render(<MarkdownContent text={'[Web](https://example.com/report.md)\n\n[Unsafe](javascript:bad)\n\n![drive](D:/repo/image.png)'} threadId="thread-links" />);
    expect(fireEvent.click(screen.getByRole('link', { name: 'Web' }))).toBe(false);
    expect(open).toHaveBeenCalledWith('https://example.com/report.md', '_blank', 'noopener,noreferrer');
    expect(screen.getByText('Unsafe').getAttribute('href')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(h.resolve).not.toHaveBeenCalled();
  } finally {
    open.mockRestore();
  }
});

it('shows denied-file errors from the resolver through rendered Markdown', async () => {
  h.resolve.mockRejectedValue(new Error('path is not inside the thread workspace'));
  render(<MarkdownContent text="[Private](D:/outside/private.md)" threadId="thread-links" />);
  fireEvent.click(screen.getByRole('link', { name: 'Preview private.md' }));
  expect((await screen.findByRole('status')).textContent).toContain('not inside the thread workspace');
  expect(h.open).not.toHaveBeenCalled();
});

it('prevents auxiliary navigation for an invalid local link', () => {
  render(<MarkdownContent text="[Invalid](file://server/share/report.md)" threadId="thread-links" />);
  const anchor = screen.getByText('Invalid');
  expect(fireEvent(anchor, new MouseEvent('auxclick', { button: 1, cancelable: true, bubbles: true }))).toBe(false);
  expect(screen.getByRole('status').textContent).toContain('invalid or unsupported');
  expect(h.resolve).not.toHaveBeenCalled();
});

it('shows duplicate basename choices and opens only the selected path', async () => {
  h.resolve.mockResolvedValue({ kind: 'ambiguous', paths: ['docs/guide.md', 'examples/guide.md'] });
  render(<MarkdownFileLink token="guide.md" threadId="thread-1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview guide.md' }));
  const choice = await screen.findByRole('button', { name: 'docs/guide.md' });
  expect(h.resolve).toHaveBeenCalledWith('thread-1', { path: 'guide.md', hints: [] });
  fireEvent.click(choice);
  expect(h.open).toHaveBeenCalledWith('thread-1', 'docs/guide.md', null);
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
  await waitFor(() => expect(h.open).toHaveBeenCalledWith('thread-2', 'docs/guide.md', null));
  expect(h.resolve).toHaveBeenCalledWith('thread-2', { path: 'guide.md', hints: ['docs/guide.md'], projectId: 'project-2' });
});

it('reports a missing path and retries after the file becomes available', async () => {
  h.resolve.mockResolvedValueOnce({ kind: 'not_found', path: 'reports/missing.md' })
    .mockResolvedValueOnce({ kind: 'resolved', path: 'reports/missing.md' });
  render(<MarkdownFileLink token="reports/missing.md" threadId="thread-3" />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview missing.md' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(h.open).toHaveBeenCalledWith('thread-3', 'reports/missing.md', null));
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
  await waitFor(() => expect(h.open).toHaveBeenCalledWith('thread-5', 'docs/guide.md', null));
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
  expect(h.open).toHaveBeenCalledWith('thread-1', 'docs/guide.md', null);
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
