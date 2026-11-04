// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FsReadResult, Project } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));
vi.mock('@monaco-editor/react', () => ({ default: () => null, DiffEditor: () => null }));
vi.mock('../OpenerButtons.js', () => ({
  OpenerButtons: (props: Record<string, unknown>) => { h.props.push(props); return <span>openers</span>; }
}));

import { FileViewer } from './FileViewer';

afterEach(() => { cleanup(); h.props = []; });

function viewer(patch: Partial<Parameters<typeof FileViewer>[0]>) {
  const noop = () => {};
  return (
    <FileViewer
      project={{ id: 'p1', name: 'P', path: '/tmp/p1', remote: { host: 'devbox' }, createdAt: 0, lastActiveAt: 0 } as Project}
      explorerFile="/tmp/p1-wt/src/a.ts"
      fileResult={{ ok: true, content: 'x', bytes: 1 } as FsReadResult}
      fileLoading={false} editedContent={null} saving={false} previewMode={false} diffMode={false}
      diffAvailable={false} showDiff={false} showPreview={false} headResult={null} headLoading={false}
      imageDataUrl={null} imageError={null} viewRoot="/tmp/p1-wt" monacoTheme="vs-dark"
      isRemote={patch.isRemote ?? false} nativeFiles={patch.nativeFiles} isMarkdown={false}
      onContentChange={noop} onEditorMount={noop} onSave={noop} onTogglePreview={noop} onToggleDiff={noop}
      {...patch}
    />
  );
}

it('opens the viewed file inside the root being browsed', () => {
  render(viewer({}));
  expect(h.props).toEqual([expect.objectContaining({ path: '/tmp/p1-wt/src/a.ts', projectRoot: '/tmp/p1-wt' })]);
});

it.each(['b.md', './b.md', '../b.md', 'file:///tmp/p1-wt/docs/b.md'])('opens Markdown link %s relative to the viewed file', async href => {
  const open = vi.fn();
  render(viewer({ explorerFile: '/tmp/p1-wt/docs/a.md', isMarkdown: true, previewMode: true, showPreview: true,
    fileResult: { ok: true, content: `[B](${href}#section-2)` }, onOpenDocument: open }));
  const link = await screen.findByRole('link', { name: 'B' });
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  fireEvent(link, event);
  expect(event.defaultPrevented).toBe(true);
  expect(open).toHaveBeenCalledWith({ path: href === '../b.md' ? '/tmp/p1-wt/b.md' : '/tmp/p1-wt/docs/b.md', fragment: 'section-2' });
});

it('offers no local openers for a remote file or a non-native checkout', () => {
  render(viewer({ isRemote: true }));
  expect(screen.getByText('remote · devbox')).toBeTruthy();
  cleanup();
  render(viewer({ nativeFiles: false }));
  expect(screen.queryByText('openers')).toBeNull();
  expect(h.props).toEqual([]);
});
