// @vitest-environment happy-dom
import React, { Suspense } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DirectoryLoading } from './DirectoryLoading.js';
import { DIRECTORY_SLOW_MS } from './useDirectoryLoader.js';
import { ViewerBoundary } from './ViewerBoundary.js';
import { TreeList } from './TreeList.js';
import MarkdownPreview from './MarkdownPreview.js';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('warns about slow root resolution without a deadline or retry button', () => {
  vi.useFakeTimers();
  const { unmount } = render(<DirectoryLoading />);
  act(() => vi.advanceTimersByTime(DIRECTORY_SLOW_MS));
  expect(screen.getByRole('status').textContent).toBe('Taking longer than expected');
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('isolates rejected viewer modules and recovers when resetKey changes', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const Broken = () => { throw new Error('Chunk unavailable'); };
  const view = render(<ViewerBoundary resetKey="file1.ts"><Broken /></ViewerBoundary>);
  expect(screen.getByRole('alert').textContent).toContain('An unexpected error occurred');
  view.rerender(<ViewerBoundary resetKey="file2.ts"><p>File ready</p></ViewerBoundary>);
  expect(screen.getByText('File ready')).toBeTruthy();
});

it('handles non-Error viewer failures and shows a fallback while a module is pending', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const Broken = () => { throw 'Module failed'; };
  const view = render(<ViewerBoundary><Broken /></ViewerBoundary>);
  expect(screen.getByRole('alert').textContent).toContain('An unexpected error occurred');
  view.unmount();
  const Pending = React.lazy(() => new Promise(() => {}));
  render(<ViewerBoundary><Pending /></ViewerBoundary>);
  expect(screen.getByRole('status', { name: 'Loading file viewer' })).toBeTruthy();
});

it('waits for slow child directories and reports failures without blocking siblings', () => {
  const props = {
    list: [{ path: '/repo/src', name: 'src', kind: 'dir' as const }, { path: '/repo/file', name: 'file', kind: 'file' as const }],
    depth: 0, expanded: new Map([['/repo/src', true]]), entries: new Map(), loading: new Set(['/repo/src']),
    slow: new Set(['/repo/src']), errors: new Map<string, string>(), activeFile: undefined, gitFiles: undefined,
    dirtyDirs: new Set<string>(), onToggleDir: vi.fn(), onFileClick: vi.fn(), onContext: vi.fn()
  };
  const view = render(<TreeList {...props} />);
  expect(screen.getByText('file')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Taking longer than expected');
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  view.rerender(<TreeList {...props} errors={new Map([['/repo/src', 'Permission denied']])} loading={new Set()} />);
  expect(screen.getByRole('alert').textContent).toBe('Permission denied');
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  view.rerender(<TreeList {...props} entries={new Map([['/repo/src', [{ path: '/repo/src/child', name: 'child', kind: 'file' }]]])} />);
  expect(screen.getByText('child')).toBeTruthy();
});

it('renders markdown links and tables in the independent preview', async () => {
  render(<Suspense><MarkdownPreview content={'[Docs](https://example.com)\n\n| Name |\n| --- |\n| Value |'} /></Suspense>);
  expect(screen.getByRole('link', { name: 'Docs' }).getAttribute('rel')).toBe('noreferrer');
  expect(screen.getByRole('table')).toBeTruthy();
});

it('keeps nested rows interactive and renders normal pending and unloaded states', () => {
  const toggle = vi.fn(), click = vi.fn(), context = vi.fn();
  const props = {
    list: [{ path: '/repo/src', name: 'src', kind: 'dir' as const }, { path: '/repo/file', name: 'file', kind: 'file' as const }],
    depth: 0, expanded: new Map([['/repo/src', true]]), entries: new Map(), loading: new Set(['/repo/src']),
    slow: new Set<string>(), errors: new Map<string, string>(), activeFile: '/repo/file', gitFiles: { '/repo/file': '?' as const },
    dirtyDirs: new Set(['/repo/src']), onToggleDir: toggle, onFileClick: click, onContext: context
  };
  const view = render(<TreeList {...props} />);
  expect(screen.getByRole('status').textContent).toBe('Loading…');
  fireEvent.click(screen.getByText('src'));
  fireEvent.click(screen.getByText('file'));
  fireEvent.contextMenu(screen.getByText('file'));
  expect(toggle).toHaveBeenCalledWith(props.list[0]);
  expect(click).toHaveBeenCalledWith(props.list[1]);
  expect(context).toHaveBeenCalled();
  expect(screen.getByText('file').closest('.tree-row')?.classList.contains('active')).toBe(true);
  view.rerender(<TreeList {...props} loading={new Set()} />);
  expect(screen.queryByRole('status')).toBeNull();
  view.rerender(<TreeList {...props} expanded={new Map()} />);
  expect(screen.queryByRole('status')).toBeNull();
});
