// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ resolve: vi.fn(), open: vi.fn() }));
vi.mock('../lib/product-client.js', () => ({ product: { threads: { resolvePreviewPath: h.resolve } } }));
vi.mock('./thread/secondary-panel/useThreadOpenFileSignal.js', () => ({ dispatchThreadOpenFile: h.open }));
import { MarkdownContent } from './MarkdownContent.js';

beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

it.each([
  ['D:/repo/guide.md', 'D:/repo/guide.md', null],
  ['/D:/repo/guide.md', 'D:/repo/guide.md', null],
  ['D:/repo/guide.md:12', 'D:/repo/guide.md', 12],
  ['file:///D:/repo/guide.md#L3', 'D:/repo/guide.md', 3],
  ['/Users/Me/guide.md:12', '/Users/Me/guide.md', 12],
  ['file:///Users/Me/guide.md#L3', '/Users/Me/guide.md', 3],
  ['/Users/Me/report:2026.md', '/Users/Me/report:2026.md', null],
  ['file:///Users/Me/report:2026.md', '/Users/Me/report:2026.md', null],
  ['/Users/Me/report.v1:2026.md', '/Users/Me/report.v1:2026.md', null],
  ['file:///Users/Me/report.v1:2026.md', '/Users/Me/report.v1:2026.md', null],
  ['/Users/Me/report.v1:2026.md:7', '/Users/Me/report.v1:2026.md', 7],
  ['./docs/guide.md', './docs/guide.md', null],
  ['docs/a%20b.md#L2', 'docs/a b.md', 2],
  ['<D:/repo/שלום guide.md>', 'D:/repo/שלום guide.md', null]
])('previews rendered assistant link %s in its thread', async (destination, path, line) => {
  h.resolve.mockResolvedValue({ kind: 'resolved', path: 'docs/guide.md' });
  render(<MarkdownContent text={`[Guide](${destination})`} threadId="t1" projectId="p1" />);
  const link = screen.getByRole('link');
  expect(fireEvent.click(link)).toBe(false);
  expect(h.resolve).toHaveBeenCalledWith('t1', { path, hints: [], projectId: 'p1' });
  await waitFor(() => expect(h.open).toHaveBeenCalledWith('t1', 'docs/guide.md', line));
});

it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }])(
  'keeps modifier activation in file preview: %o', async (modifiers) => {
    h.resolve.mockResolvedValue({ kind: 'resolved', path: 'docs/guide.md' });
    render(<MarkdownContent text="[Guide](D:/repo/guide.md)" threadId="t1" />);
    expect(fireEvent.click(screen.getByRole('link'), modifiers)).toBe(false);
    await waitFor(() => expect(h.open).toHaveBeenCalled());
  }
);

it('intercepts middle-click file activation', async () => {
  h.resolve.mockResolvedValue({ kind: 'resolved', path: 'docs/guide.md' });
  render(<MarkdownContent text="[Guide](/Users/Me/guide.md)" threadId="t1" />);
  expect(fireEvent(screen.getByRole('link'), new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))).toBe(false);
  await waitFor(() => expect(h.open).toHaveBeenCalled());
});

it.each(['D:guide.md', '/D:/repo/a%2fb.md', 'file://server/share/a.md', '/Users/Me/../a.md']) (
  'explains invalid local destination %s without resolving', (destination) => {
    render(<MarkdownContent text={`[Guide](${destination})`} threadId="t1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Guide' }));
    expect(screen.getByRole('status').textContent).toMatch(/cannot preview/i);
    expect(h.resolve).not.toHaveBeenCalled();
  }
);

it('explains missing thread scope', () => {
  render(<MarkdownContent text="[Guide](/Users/Me/guide.md)" />);
  fireEvent.click(screen.getByRole('button', { name: 'Guide' }));
  expect(screen.getByRole('status').textContent).toMatch(/thread/i);
  expect(h.resolve).not.toHaveBeenCalled();
});

it.each(['https://example.com/a.md', '//workspace/a.md', '//workspace/volumes/repo/guide.md', '/threads/t1', 'example.com', 'report.md']) (
  'preserves navigation for %s', (destination) => {
    render(<MarkdownContent text={`[Navigate](${destination})`} threadId="t1" />);
    const link = screen.getByRole('link', { name: 'Navigate' });
    expect(link.getAttribute('href')).toBe(destination);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(h.resolve).not.toHaveBeenCalled();
  }
);

it('retains default sanitation of unsafe schemes and image sources', () => {
  const view = render(<MarkdownContent text="[Bad](javascript:alert%281%29)\n\n![bad](D:/repo/a.png)" threadId="t1" />);
  expect(view.container.querySelector('a')?.getAttribute('href')).toBe('');
  expect(view.container.querySelector('img[src^="D:"]')).toBeNull();
});
