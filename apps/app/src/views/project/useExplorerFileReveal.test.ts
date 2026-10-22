// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import type { FsEntry } from '@zana-ai/zcc-domain/product';
import { expect, it, vi } from 'vitest';
import { useExplorerFileReveal } from './useExplorerFileReveal.js';

function setup(fetchDir: (path: string) => Promise<FsEntry[]>) {
  const setExpanded = vi.fn();
  const activeRoot = { current: '/r' };
  // `entries` never changes here: nothing re-renders between calls, which is
  // the window where a listing has resolved but its state isn't committed yet.
  const { result } = renderHook(() => useExplorerFileReveal({
    fetchDir, entries: new Map(), setExpanded, treeBodyRef: { current: null }, activeRoot, treeMode: 'files'
  }));
  return { result, setExpanded, activeRoot };
}

it('does not list a folder again after its listing resolves but before the tree re-renders', async () => {
  const fetchDir = vi.fn(async (path: string) => [{ name: 'f', kind: 'file', path: `${path}/f` } as FsEntry]);
  const { result } = setup(fetchDir);
  await act(async () => { await result.current.loadDir('/r/x'); });
  await act(async () => { await result.current.loadDir('/r/x'); });
  expect(fetchDir).toHaveBeenCalledTimes(1);
  // A forced reload still lists it.
  await act(async () => { await result.current.loadDir('/r/x', true); });
  expect(fetchDir).toHaveBeenCalledTimes(2);
});

it('does not cache a listing that resolves after the tree moved to another root', async () => {
  const fetchDir = vi.fn(async () => [] as FsEntry[]);
  const { result, activeRoot } = setup(fetchDir);
  await act(async () => {
    const request = result.current.loadDir('/r/x');
    activeRoot.current = '/other';
    await request;
  });
  activeRoot.current = '/r';
  await act(async () => { await result.current.loadDir('/r/x'); });
  expect(fetchDir).toHaveBeenCalledTimes(2);
});

it('stops a reveal when a listing returns a folder that is not deeper than its parent', async () => {
  const fetchDir = vi.fn(async (path: string) => [{ name: '.', kind: 'dir', path } as FsEntry]);
  const { result, setExpanded } = setup(fetchDir);
  await act(async () => { await result.current.revealFile('/r/a/b.ts', '/r'); });
  expect(fetchDir).toHaveBeenCalledTimes(1);
  expect(setExpanded).not.toHaveBeenCalled();
});
