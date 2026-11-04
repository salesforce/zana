// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const updateSpy = vi.hoisted(() => vi.fn());
const mocks = vi.hoisted(() => ({ options: undefined as any, onMount: undefined as any, onChange: undefined as any }));
vi.mock('./ExplorerEditor.js', () => ({
  default: (props: any) => { mocks.options = props.options; mocks.onMount = props.onMount; mocks.onChange = props.onChange; return <div data-testid="monaco" />; }
}));
vi.mock('../DiffViewer.js', () => ({ DiffViewer: () => null }));
vi.mock('../OpenerButtons.js', () => ({ OpenerButtons: () => null }));
vi.mock('react-markdown', () => ({ default: () => null }));
vi.mock('remark-gfm', () => ({ default: () => null }));
vi.mock('../../store.js', async () => {
  const { create } = await import('zustand');
  const { EXPLORER_MINIMAP_DEFAULTS } = await import('@zana-ai/zcc-domain/product');
  return { useData: create<any>(() => ({ explorerMinimap: EXPLORER_MINIMAP_DEFAULTS, updateExplorerMinimap: updateSpy })) };
});

import { EXPLORER_MINIMAP_DEFAULTS } from '@zana-ai/zcc-domain/product';
import { useData } from '../../store.js';
import { platformShortcut } from '../../lib/platformShortcut.js';
import { FileViewer } from './FileViewer.js';
import { readFileSync } from 'node:fs';
import { URL as NodeURL, fileURLToPath } from 'node:url';

let width = 800;
let resizeCb: () => void = () => {};
let frames: Array<() => void> = [];
const flushFrames = () => { const run = frames; frames = []; run.forEach((f) => f()); };
const disconnect = vi.fn();
class FakeResizeObserver {
  constructor(cb: () => void) { resizeCb = cb; }
  observe() {}
  disconnect = disconnect;
}

beforeEach(() => {
  width = 800;
  disconnect.mockClear();
  frames = [];
  useData.setState({ explorerMinimap: EXPLORER_MINIMAP_DEFAULTS } as any);
  updateSpy.mockClear();
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function view() {
  return (
    <FileViewer
      {...({
        project: { id: 'p', name: 'P', path: '/a' },
        explorerFile: 'a.ts',
        fileResult: { ok: true, content: 'x', binary: false, truncated: false },
        editedContent: null,
        previewMode: false,
        diffMode: false,
        showDiff: false,
        showPreview: false,
        monacoTheme: 'dark',
        onContentChange: vi.fn(),
        onEditorMount: vi.fn(),
        onSave: vi.fn(),
        onTogglePreview: vi.fn(),
        onToggleDiff: vi.fn()
      } as any)}
    />
  );
}

async function renderEditor() {
  const rendered = render(view());
  await screen.findByTestId('monaco');
  return rendered;
}

it('enables the minimap at the configured size when the pane is wide enough', async () => {
  await renderEditor();
  expect(mocks.options.minimap).toMatchObject({ enabled: true, side: 'right', maxColumn: 120 });
});

it('follows the setting live', async () => {
  await renderEditor();
  act(() => useData.setState({ explorerMinimap: { ...EXPLORER_MINIMAP_DEFAULTS, width: 'wide' } } as any));
  expect(mocks.options.minimap.maxColumn).toBe(200);
  act(() => useData.setState({ explorerMinimap: { ...EXPLORER_MINIMAP_DEFAULTS, enabled: false } } as any));
  expect(mocks.options.minimap).toEqual({ enabled: false });
});

it('hides when the pane narrows and returns when it widens', async () => {
  await renderEditor();
  width = 300;
  act(() => { resizeCb(); flushFrames(); });
  expect(mocks.options.minimap).toEqual({ enabled: false });
  width = 900;
  act(() => { resizeCb(); flushFrames(); });
  expect(mocks.options.minimap.enabled).toBe(true);
});

it('disconnects the observer on unmount', () => {
  const { unmount } = render(view());
  unmount();
  expect(disconnect).toHaveBeenCalled();
});

function mountEditor() {
  const handlers: Record<string, (e?: any) => void> = {};
  const dispose = vi.fn();
  const editor = {
    onContextMenu: (cb: any) => { handlers.context = cb; return { dispose }; },
    onDidScrollChange: (cb: any) => { handlers.scroll = cb; return { dispose }; }
  };
  const monaco = { editor: { MouseTargetType: { SCROLLBAR: 11, CONTENT_TEXT: 6 } } };
  const onEditorMount = vi.fn();
  act(() => mocks.onMount(editor, monaco));
  return { handlers, dispose, onEditorMount };
}
const rightClick = (type: number) => ({ target: { type }, event: { posx: 700, posy: 120, preventDefault: vi.fn(), stopPropagation: vi.fn() } });

it('opens the minimap menu on a scrollbar/minimap right-click and applies a choice', async () => {
  await renderEditor();
  const { handlers } = mountEditor();
  const click = rightClick(11);
  act(() => handlers.context(click));
  expect(click.event.preventDefault).toHaveBeenCalled();
  expect(screen.getByRole('menu', { name: 'Minimap' })).toBeTruthy();

  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Minimap' }));
  expect(updateSpy).toHaveBeenCalledWith({ explorerMinimapEnabled: false });
  expect(screen.queryByRole('menu', { name: 'Minimap' })).toBeNull();
});

it('leaves right-clicks on the code to Monaco', async () => {
  await renderEditor();
  const { handlers } = mountEditor();
  const click = rightClick(6);
  act(() => handlers.context(click));
  expect(click.event.preventDefault).not.toHaveBeenCalled();
  expect(screen.queryByRole('menu', { name: 'Minimap' })).toBeNull();
});

it('closes the menu on scroll and disposes the editor subscriptions on unmount', async () => {
  const { unmount } = await renderEditor();
  const { handlers, dispose } = mountEditor();
  act(() => handlers.context(rightClick(11)));
  act(() => handlers.scroll());
  expect(screen.queryByRole('menu', { name: 'Minimap' })).toBeNull();
  unmount();
  expect(dispose).toHaveBeenCalledTimes(2);
});

it('tells the user when the preview is too narrow', async () => {
  await renderEditor();
  width = 300;
  act(() => { resizeCb(); flushFrames(); });
  const { handlers } = mountEditor();
  act(() => handlers.context(rightClick(11)));
  expect(screen.getByText('Hidden — preview too narrow')).toBeTruthy();
});

it('keeps the editor bootstrap out of the Explorer shell and empty viewer', () => {
  const shell = readFileSync(fileURLToPath(new NodeURL('../../views/project/ExplorerView.tsx', import.meta.url)), 'utf8');
  expect(shell).not.toContain("import '@/lib/monacoSetup'");
  const viewer = readFileSync(fileURLToPath(new NodeURL('./FileViewer.tsx', import.meta.url)), 'utf8');
  expect(viewer).toContain("lazy(() => import('./ExplorerEditor.js'))");
  expect(viewer).toContain("lazy(() => import('./MarkdownPreview.js'))");
  const props = view().props;
  render(<FileViewer {...props} explorerFile={undefined} />);
  expect(screen.getByText('Select a file from the tree to view it.')).toBeTruthy();
  expect(screen.queryByTestId('monaco')).toBeNull();
});

it('shows file and binary-image loading failures independently of the tree', () => {
  const props = { ...view().props, viewRoot: '/a', isRemote: false };
  const viewResult = render(<FileViewer {...props} fileLoading />);
  expect(screen.getByRole('status', { name: 'Loading file' })).toBeTruthy();
  viewResult.rerender(<FileViewer {...props} fileResult={null} />);
  expect(screen.queryByRole('status')).toBeNull();
  viewResult.rerender(<FileViewer {...props} fileResult={{ ok: false, message: 'Read failed' }} />);
  expect(screen.getByText('Read failed')).toBeTruthy();
  const imageProps = { ...props, explorerFile: '/a/photo.png', fileResult: { ok: true, binary: true, bytes: 123 } };
  viewResult.rerender(<FileViewer {...imageProps} />);
  expect(screen.getByRole('status', { name: 'Loading image' })).toBeTruthy();
  viewResult.rerender(<FileViewer {...imageProps} imageError="Image failed" />);
  expect(screen.getByText('Image failed')).toBeTruthy();
  viewResult.rerender(<FileViewer {...imageProps} imageDataUrl="data:image/png;base64,AA==" />);
  expect(screen.getByRole('img').getAttribute('alt')).toBe('photo.png');
  viewResult.rerender(<FileViewer {...imageProps} isRemote />);
  expect(screen.getByText('Binary file (123 B)')).toBeTruthy();
});

it('loads markdown and diff surfaces only when selected, keeping HEAD failures local', async () => {
  const props = { ...view().props, viewRoot: '/a', isRemote: false, nativeFiles: false };
  const result = render(<FileViewer {...props} showPreview isMarkdown previewMode />);
  expect(screen.queryByTestId('monaco')).toBeNull();
  await act(async () => { await Promise.resolve(); });
  result.rerender(<FileViewer {...props} showDiff headLoading />);
  expect(screen.getByRole('status', { name: 'Loading HEAD' })).toBeTruthy();
  result.rerender(<FileViewer {...props} showDiff headResult={{ ok: false, message: 'HEAD failed' }} />);
  expect(screen.getByText('HEAD failed')).toBeTruthy();
  result.rerender(<FileViewer {...props} showDiff headResult={{ ok: true, binary: true }} />);
  expect(screen.getByText('HEAD blob is binary; cannot diff as text.')).toBeTruthy();
  await act(async () => { result.rerender(<FileViewer {...props} showDiff headResult={{ ok: true, content: 'old' }} />); });
  expect(screen.queryByTestId('monaco')).toBeNull();
});

it('keeps editor changes and toolbar actions wired through the lazy editor', async () => {
  const props = { ...view().props, viewRoot: '/a', editedContent: 'changed', isMarkdown: true, diffAvailable: true, fileResult: { ok: true, content: 'x', bytes: 2500000, truncated: true } };
  await act(async () => { render(<FileViewer {...props} />); });
  await screen.findByTestId('monaco');
  fireEvent.click(screen.getByTitle(platformShortcut('Save (⌘S)')));
  fireEvent.click(screen.getByTitle('Preview markdown'));
  fireEvent.click(screen.getByTitle('Show diff against HEAD'));
  expect(props.onSave).toHaveBeenCalledOnce();
  expect(props.onTogglePreview).toHaveBeenCalledOnce();
  expect(props.onToggleDiff).toHaveBeenCalledOnce();
  expect(screen.getByText('truncated · 2MB cap (read-only)')).toBeTruthy();
  act(() => { mocks.onChange(undefined); mocks.onChange('x'); mocks.onChange('new'); });
  expect(props.onContentChange.mock.calls).toEqual([[null], ['new']]);
});
