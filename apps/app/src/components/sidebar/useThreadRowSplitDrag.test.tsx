/** @vitest-environment happy-dom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SplitDragConfig } from '../../lib/split-drag/splitDragSession.js';
import { createSinglePaneLayout } from '../../lib/split-layout/splitThreadNavigation.js';
import { splitPane } from '../../lib/split-layout/ops.js';
import { useSplitWorkspace } from '../../lib/split-layout/store.js';

const h = vi.hoisted(() => ({ config: null as SplitDragConfig | null, cancel: vi.fn(), compact: false, open: vi.fn() }));
vi.mock('../../lib/split-drag/index.js', async (original) => ({
  ...await original<typeof import('../../lib/split-drag/index.js')>(),
  beginSplitDrag: (config: SplitDragConfig) => { h.config = config; return h.cancel; }
}));
vi.mock('../../lib/split-layout/openThreadInSplit.js', () => ({ openRoutedPaneInSplit: h.open }));
vi.mock('../../hooks/useIsCompactViewport.js', () => ({ useIsCompactViewport: () => h.compact }));
import { usePaneContentSplitDrag, useThreadRowSplitDrag } from './useThreadRowSplitDrag.js';

import { useData, useUi } from '../../store.js';
import { useThreads, type ThreadListItem } from '../../thread-store.js';
import { useSessionMove } from '../../lib/session-move.js';

function wrapper({ children }: { children: React.ReactNode }) { return <MemoryRouter>{children}</MemoryRouter>; }
function event(target?: HTMLElement) {
  const row = document.createElement('a');
  if (target) row.append(target);
  return { button: 0, currentTarget: row, target: target ?? row, pointerId: 1, clientX: 0, clientY: 100 } as unknown as ReactPointerEvent<HTMLElement>;
}
function start() {
  const hook = renderHook(() => usePaneContentSplitDrag({ content: { kind: 'inbox' }, title: 'Inbox' }), { wrapper });
  act(() => hook.result.current.onPointerDown?.(event()));
  return { ...hook, config: h.config! };
}
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, 'elementsFromPoint');
  h.config = null; h.compact = false;
  vi.clearAllMocks(); vi.useRealTimers();
  useSplitWorkspace.setState({ layout: null, scopeKey: 'global', maximizedPaneId: null, scopes: {} });
});

describe('sidebar split drag', () => {
  it('splits the current page and preserves normal click behavior after a drag', () => {
    vi.useFakeTimers();
    const { config, result } = start();
    expect(config.shouldEngage(300, 100)).toBe(true);
    expect(config.decide('pane-1', 'right')?.zone).toBe('right');
    act(() => config.onDrop({ paneId: 'pane-1', zone: 'right' }));
    expect(useSplitWorkspace.getState().layout?.root).toMatchObject({ type: 'split', dir: 'row' });
    act(() => config.onEnd?.({ dropped: true }));
    expect(result.current.consumeClick()).toBe(true);
    expect(result.current.consumeClick()).toBe(false);
    act(() => config.onEnd?.({ dropped: true }));
    vi.advanceTimersByTime(500);
    expect(result.current.consumeClick()).toBe(false);
    act(() => config.onEnd?.({ dropped: false }));
    act(() => result.current.onPointerDown?.(event()));
    expect(result.current.consumeClick()).toBe(false);
  });

  it('focuses an existing view rather than duplicating it', () => {
    const layout = splitPane(createSinglePaneLayout({ kind: 'home' }), 'pane-1', 'right', { kind: 'inbox' });
    useSplitWorkspace.setState({ layout });
    const { config } = start();
    expect(config.decide('pane-1', 'right')?.label).toMatch(/Already open/);
    act(() => config.onDrop({ paneId: 'pane-1', zone: 'center' }));
    expect(useSplitWorkspace.getState().layout?.root).toEqual(layout.root);
    expect(useSplitWorkspace.getState().layout?.focusedPaneId).toBe('pane-2');
  });

  it('replaces a target and falls back to focus if the target disappeared', () => {
    useSplitWorkspace.setState({ layout: createSinglePaneLayout({ kind: 'home' }) });
    const { config } = start();
    act(() => config.onDrop({ paneId: 'missing', zone: 'center' }));
    expect(useSplitWorkspace.getState().layout?.root).toMatchObject({ content: { kind: 'inbox' } });
  });

  it('fills an empty target and cancels on scope changes', () => {
    const layout = splitPane(createSinglePaneLayout({ kind: 'home' }), 'pane-1', 'right', { kind: 'empty' });
    useSplitWorkspace.setState({ layout });
    const { config } = start();
    expect(config.decide('pane-2', 'left')).toEqual({ zone: 'center', label: 'Open here' });
    useSplitWorkspace.setState({ scopeKey: 'project:other' });
    expect(config.decide('pane-2', 'left')).toBeNull();
    act(() => config.onDrop({ paneId: 'pane-2', zone: 'center' }));
    expect(useSplitWorkspace.getState().layout).toBe(layout);
  });

  it('does not start drags from row action buttons or right-clicks and cancels on unmount', () => {
    const { result, unmount } = start();
    h.config = null;
    act(() => result.current.onPointerDown?.(event(document.createElement('button'))));
    act(() => result.current.onPointerDown?.({ ...event(), button: 2 }));
    expect(h.config).toBeNull();
    unmount();
    expect(h.cancel).toHaveBeenCalled();
  });

  it('resolves project targets, expands a hovered destination, and opens the move dialog on drop', () => {
    vi.useFakeTimers();
    useData.setState({ projects: [
      { id: 'source', path: '/source' }, { id: 'destination', path: '/destination' },
      { id: 'remote', path: '/remote', hostId: 'h2' }
    ] as ReturnType<typeof useData.getState>['projects'] });
    useThreads.setState({ threads: [{ id: 't1', projectId: 'source', hostId: 'h1' } as ThreadListItem] });
    useSessionMove.setState({ request: null, primaryHostId: 'h1' });
    useUi.setState({ projectExpanded: {} });
    const { result } = renderHook(() => useThreadRowSplitDrag({ threadId: 't1', projectId: null, title: 'Thread' }), { wrapper });
    act(() => result.current.onPointerDown?.(event()));
    const config = h.config!;
    expect(config.shouldEngage(0, 110)).toBe(false);
    expect(config.shouldEngage(0, 113)).toBe(true);
    const header = document.createElement('div');header.dataset.sessionMoveProject = 'destination';
    const hitTest = vi.fn((): Element[] => [header]);
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: hitTest });
    expect(config.externalDrop?.resolve(0, 0)).toMatchObject({ id: 'destination', allowed: true });
    header.dataset.sessionMoveProject = 'source';
    expect(config.externalDrop?.resolve(0, 0)?.allowed).toBe(false);
    header.dataset.sessionMoveProject = 'remote';
    expect(config.externalDrop?.resolve(0, 0)).toMatchObject({ allowed: false, label: 'Other machine' });
    hitTest.mockReturnValue([]);expect(config.externalDrop?.resolve(0, 0)).toBeNull();
    act(() => config.externalDrop?.onHover?.('destination'));
    vi.advanceTimersByTime(649);expect(useUi.getState().projectExpanded.destination).toBeUndefined();
    act(() => vi.advanceTimersByTime(1));expect(useUi.getState().projectExpanded.destination).toBe(true);
    act(() => config.externalDrop?.onHover?.('remote'));
    config.externalDrop?.onHover?.(null);vi.advanceTimersByTime(650);
    expect(useUi.getState().projectExpanded.remote).toBeUndefined();
    act(() => config.externalDrop?.onDrop('destination'));
    expect(useSessionMove.getState().request).toEqual({ threadId: 't1', destinationId: 'destination' });
    useSessionMove.getState().close();
  });

  it('provides the same open-in-split action for threads and disables dragging on compact screens', () => {
    h.compact = true;
    const { result } = renderHook(() => useThreadRowSplitDrag({ threadId: 't1', projectId: null, title: 'Thread' }), { wrapper });
    expect(result.current.onPointerDown).toBeUndefined();
    act(() => result.current.openInSplit());
    expect(h.open).toHaveBeenCalledWith(expect.objectContaining({ isCompact: true, content: { kind: 'thread', threadId: 't1', projectId: null } }));
  });
});
