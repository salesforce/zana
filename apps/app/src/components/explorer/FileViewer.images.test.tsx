// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { FsReadResult, Project } from '@zana-ai/zcc-domain/product';

const mocks = vi.hoisted(() => ({ readDataUrl: vi.fn() }));
vi.mock('@monaco-editor/react', () => ({ default: () => null, DiffEditor: () => null }));
vi.mock('../OpenerButtons.js', () => ({ OpenerButtons: () => <span>openers</span> }));
vi.mock('../../lib/product-client.js', () => ({ product: {
  fs: { readDataUrl: mocks.readDataUrl },
  threads: { hostFileContent: vi.fn(), storageContent: vi.fn() }
} }));

import { FileViewer } from './FileViewer';

const DATA_URL = 'data:image/png;base64,AAAA';

beforeEach(() => {
  mocks.readDataUrl.mockReset();
  mocks.readDataUrl.mockResolvedValue({ ok: true, dataUrl: DATA_URL });
});
afterEach(cleanup);

function viewerProps(isRemote: boolean): Parameters<typeof FileViewer>[0] {
  const noop = () => {};
  return {
    project: { id: 'p1', name: 'P', path: '/tmp/p1', createdAt: 0, lastActiveAt: 0 } as Project,
    explorerFile: '/tmp/p1/docs/a.md',
    fileResult: { ok: true, content: '![Diagram](pic.png)\n\n![Web](https://example.com/w.png)' } as FsReadResult,
    fileLoading: false, editedContent: null, saving: false, previewMode: true, diffMode: false,
    diffAvailable: false, showDiff: false, showPreview: true, headResult: null, headLoading: false,
    imageDataUrl: null, imageError: null, viewRoot: '/tmp/p1', monacoTheme: 'vs-dark',
    isRemote, isMarkdown: true,
    onContentChange: noop, onEditorMount: noop, onSave: noop, onTogglePreview: noop, onToggleDiff: noop
  };
}

const viewer = (isRemote: boolean) => <FileViewer {...viewerProps(isRemote)} />;

it('reads a local project image next to the open Markdown file', async () => {
  render(viewer(false));
  expect((await screen.findByRole('img', { name: 'Diagram' })).getAttribute('src')).toBe(DATA_URL);
  expect(mocks.readDataUrl).toHaveBeenCalledWith('/tmp/p1/docs/pic.png');
});

it('never reads the local disk for a remote project file, so an unrelated local file at the same path cannot show', async () => {
  render(viewer(true));
  expect((await screen.findByRole('img', { name: 'Web' })).getAttribute('src')).toBe('https://example.com/w.png');
  await waitFor(() => expect(screen.getByText('Diagram')).toBeTruthy());
  expect(screen.queryByRole('img', { name: 'Diagram' })).toBeNull();
  expect(mocks.readDataUrl).not.toHaveBeenCalled();
});

it('renders an empty preview when the file result has no content', () => {
  const { container } = render(<FileViewer {...viewerProps(false)} fileResult={{ ok: true } as FsReadResult} />);
  expect(container.querySelector('.explorer-md-preview')).toBeTruthy();
  expect(container.querySelector('img')).toBeNull();
});
