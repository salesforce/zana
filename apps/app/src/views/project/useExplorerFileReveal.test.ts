// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import type { FsEntry } from '@zana-ai/zcc-domain/product';
import { expect, it, vi } from 'vitest';
import { useExplorerFileReveal } from './useExplorerFileReveal.js';

function setup(loadDir: (path: string) => Promise<FsEntry[]>) {
  const setExpanded = vi.fn();
  const activeRoot = { current: '/r' };
  const { result } = renderHook(() => useExplorerFileReveal({
    loadDir, setExpanded, treeBodyRef: { current: null }, activeRoot, treeMode: 'files'
  }));
  return { result, setExpanded, activeRoot };
}

it('walks down and expands intermediate directories to reveal target file', async () => {
  const loadDir = vi.fn(async (path: string) => {
    if (path === '/r') return [{ name: 'a', kind: 'dir', path: '/r/a' } as FsEntry];
    if (path === '/r/a') return [{ name: 'b.ts', kind: 'file', path: '/r/a/b.ts' } as FsEntry];
    return [];
  });
  const { result, setExpanded } = setup(loadDir);
  await act(async () => { await result.current.revealFile('/r/a/b.ts', '/r'); });
  expect(loadDir).toHaveBeenCalledWith('/r');
  expect(loadDir).toHaveBeenCalledWith('/r/a');
  expect(setExpanded).toHaveBeenCalledTimes(1);
});

it('stops a reveal when the active root changes during traversal', async () => {
  let resolveFirst!: (v: FsEntry[]) => void;
  const pending = new Promise<FsEntry[]>((res) => { resolveFirst = res; });
  const loadDir = vi.fn(() => pending);
  const { result, setExpanded, activeRoot } = setup(loadDir);
  let revealPromise!: Promise<void>;
  act(() => { revealPromise = result.current.revealFile('/r/a/b.ts', '/r'); });
  activeRoot.current = '/other';
  await act(async () => {
    resolveFirst([{ name: 'a', kind: 'dir', path: '/r/a' } as FsEntry]);
    await revealPromise;
  });
  expect(setExpanded).not.toHaveBeenCalled();
});

it('stops a reveal when a listing returns a folder that is not deeper than its parent', async () => {
  const loadDir = vi.fn(async (path: string) => [{ name: '.', kind: 'dir', path } as FsEntry]);
  const { result, setExpanded } = setup(loadDir);
  await act(async () => { await result.current.revealFile('/r/a/b.ts', '/r'); });
  expect(loadDir).toHaveBeenCalledTimes(1);
  expect(setExpanded).not.toHaveBeenCalled();
});

it('ignores a target file outside the active root', async () => {
  const loadDir = vi.fn(async () => []);
  const { result } = setup(loadDir);
  await act(async () => { await result.current.revealFile('/other/path/file.ts', '/r'); });
  expect(loadDir).not.toHaveBeenCalled();
});

it('cancels an ongoing reveal when cancelReveal is called', async () => {
  let resolveLoad!: (v: FsEntry[]) => void;
  const pending = new Promise<FsEntry[]>((res) => { resolveLoad = res; });
  const loadDir = vi.fn(() => pending);
  const { result, setExpanded } = setup(loadDir);
  let revealPromise!: Promise<void>;
  act(() => { revealPromise = result.current.revealFile('/r/a/b.ts', '/r'); });
  result.current.cancelReveal();
  await act(async () => {
    resolveLoad([{ name: 'a', kind: 'dir', path: '/r/a' } as FsEntry]);
    await revealPromise;
  });
  expect(setExpanded).not.toHaveBeenCalled();
});

it('scrolls the matched file row into view inside the tree pane', async () => {
  const loadDir = vi.fn(async () => [{ name: 'target.ts', kind: 'file', path: '/r/target.ts' } as FsEntry]);
  const body = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'tree-row file';
  row.dataset.path = '/r/target.ts';
  body.appendChild(row);
  vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 200, height: 200 } as DOMRect);
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ top: 250, bottom: 270, height: 20 } as DOMRect);

  const setExpanded = vi.fn();
  const activeRoot = { current: '/r' };
  const { result } = renderHook(() => useExplorerFileReveal({
    loadDir, setExpanded, treeBodyRef: { current: body }, activeRoot, treeMode: 'files'
  }));

  await act(async () => { await result.current.revealFile('/r/target.ts', '/r'); });
  expect(body.scrollTop).toBeGreaterThan(0);
});
