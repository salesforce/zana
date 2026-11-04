// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useThreadToolDock } from './useThreadToolDock.js';
import { emptySecondaryPanelState } from './threadSecondaryPanelState.js';
import { loadToolDock } from './threadToolDock.js';
afterEach(() => { cleanup(); localStorage.clear(); });
const initial = { ...emptySecondaryPanelState(), activeId: 'browser', tabs: [
  { id: 'browser', title: 'Preview', kind: 'browser' as const }, { id: 'term', title: 'Shell', kind: 'terminal' as const }
] };
it('restores each owner without writing the preceding owner into it', () => {
  const view = renderHook(({ owner, state, enabled }) => useThreadToolDock(owner, state, enabled), { initialProps: { owner: 'a', state: initial, enabled: true } });
  act(() => view.result.current.move('term', 'bottom'));
  expect(view.result.current.bottom.tabs.map(t => t.id)).toEqual(['term']);
  view.rerender({ owner: 'b', state: initial, enabled: true });
  expect(view.result.current.bottom.tabs).toEqual([]);
  act(() => view.result.current.update(dock => ({ ...dock, heightPx: 320 })));
  view.rerender({ owner: 'a', state: initial, enabled: false });
  expect(view.result.current.bottom.tabs[0]?.id).toBe('term');
  expect(loadToolDock('b').heightPx).toBe(320);
  view.rerender({ owner: 'a', state: { ...initial, activeId: 'term' }, enabled: true });
  expect(view.result.current.bottom.activeId).toBe('term');
  act(() => view.result.current.update(dock => ({ ...dock, collapsed: true })));
  view.rerender({ owner: 'a', state: initial, enabled: true });
  view.rerender({ owner: 'a', state: { ...initial, activeId: 'term' }, enabled: true });
  expect(view.result.current.dock.collapsed).toBe(false);
});
it('keeps a consumed bottom launcher in its region', () => {
  const state = { ...initial, activeId: 'new', tabs: [...initial.tabs, { id: 'new', kind: 'new-tab' as const, title: 'New Tab' }] };
  const view = renderHook(({ state }) => useThreadToolDock('a', state, true), { initialProps: { state: state as typeof initial } });
  act(() => view.result.current.move('new', 'bottom'));
  view.rerender({ state: { ...state, activeId: 'replacement', tabs: [...initial.tabs, { id: 'replacement', kind: 'browser', title: 'Second preview' }] } });
  expect(view.result.current.bottom.tabs[0]?.id).toBe('replacement');
  expect(view.result.current.right.activeId).toBe('browser');
  view.rerender({ state: { ...initial, activeId: 'info' } });
  expect(view.result.current.dock.bottomIds).toEqual([]);
  expect(view.result.current.dock.bottomActiveId).toBeNull();
  expect(view.result.current.right.activeId).toBe('browser');
});
it('routes pinned selections to their saved pane through navigation and experiment toggles', () => {
  const view = renderHook(({ owner, state, enabled }) => useThreadToolDock(owner, state, enabled), {
    initialProps: { owner: 'a', state: initial, enabled: true }
  });
  act(() => view.result.current.move('info', 'bottom'));
  expect(view.result.current.bottom).toMatchObject({ isOpen: true, tabs: [], activeId: 'info' });
  expect(view.result.current.right.activeId).toBe('browser');
  act(() => view.result.current.update(dock => ({ ...dock, collapsed: true })));
  view.rerender({ owner: 'a', state: { ...initial, activeId: 'info' }, enabled: true });
  expect(view.result.current.dock.collapsed).toBe(false);
  expect(view.result.current.right.activeId).toBe('browser');
  view.rerender({ owner: 'b', state: initial, enabled: true });
  expect(view.result.current.bottom.isOpen).toBe(false);
  view.rerender({ owner: 'a', state: initial, enabled: false });
  view.rerender({ owner: 'a', state: { ...initial, activeId: 'info' }, enabled: true });
  expect(view.result.current.bottomPins).toEqual(['info']);
  expect(view.result.current.rightPins).not.toContain('info');
  act(() => view.result.current.move('info', 'right'));
  expect(view.result.current.bottom.isOpen).toBe(false); expect(view.result.current.right.activeId).toBe('info');
});
