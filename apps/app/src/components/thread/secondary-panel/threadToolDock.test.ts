// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { clampDockHeight, emptyToolDock, loadToolDock, moveDockTab, parseToolDock, resolveToolDock, saveToolDock, TOOL_DOCK_STORAGE_KEY } from './threadToolDock.js';
import { emptySecondaryPanelState } from './threadSecondaryPanelState.js';

beforeEach(() => localStorage.clear());
const state = { ...emptySecondaryPanelState(), isOpen: true, activeId: 'terminal', tabs: [
  { id: 'browser', kind: 'browser' as const, title: 'Preview', url: 'http://localhost:3000' },
  { id: 'terminal', kind: 'terminal' as const, title: 'Dev server', sessionId: 'pty-1' }
] };
it('moves presentation without dropping or recreating a tool resource', () => {
  const dock = moveDockTab(emptyToolDock(), state, 'terminal', 'bottom');
  const panels = resolveToolDock(dock, state);
  expect(panels.bottom.tabs[0]).toBe(state.tabs[1]);
  expect(panels.right.tabs).toEqual([state.tabs[0]]);
  expect(panels.bottom.activeId).toBe('terminal');
  expect(panels.right.activeId).toBe('browser');
  expect(moveDockTab(dock, state, 'terminal', 'bottom').bottomIds).toEqual(['terminal']);
  expect(moveDockTab(dock, state, 'missing', 'bottom')).toBe(dock);
  expect(resolveToolDock(moveDockTab(dock, state, 'terminal', 'right'), state).right.tabs).toEqual(state.tabs);
  expect(state.tabs[1]?.sessionId).toBe('pty-1');
});
it('recovers stale selections and closed tabs while retaining the right selection', () => {
  const dock = { ...emptyToolDock(), bottomIds: ['terminal'], rightActiveId: 'browser', bottomActiveId: 'gone' };
  expect(resolveToolDock(dock, state).right.activeId).toBe('browser');
  expect(resolveToolDock(dock, state).bottom.activeId).toBe('terminal');
  expect(resolveToolDock({ ...dock, rightActiveId: 'gone' }, state).right.activeId).toBe('info');
  expect(resolveToolDock(dock, { ...state, tabs: [] }).bottom.isOpen).toBe(false);
});
it('docks pinned views as persistent tabs, including a bottom pane with no tools', () => {
  const infoOnly = { ...emptySecondaryPanelState(), isOpen: true };
  let dock = moveDockTab(emptyToolDock(), infoOnly, 'info', 'bottom');
  let panels = resolveToolDock(dock, infoOnly, ['info']);
  expect(panels.rightPins).toEqual([]); expect(panels.right.activeId).toBe('');
  expect(panels.bottomPins).toEqual(['info']); expect(panels.bottom).toMatchObject({ isOpen: true, activeId: 'info', tabs: [] });
  saveToolDock('pinned', dock);
  expect(resolveToolDock(loadToolDock('pinned'), infoOnly, ['info']).bottom.activeId).toBe('info');
  dock = moveDockTab(dock, infoOnly, 'info', 'right');
  panels = resolveToolDock(dock, infoOnly, ['info']);
  expect(panels.rightPins).toEqual(['info']); expect(panels.right.activeId).toBe('info');
  expect(panels.bottom.isOpen).toBe(false);
});
it('keeps one selected tab per pane and recovers when a pinned view becomes unavailable', () => {
  let dock = moveDockTab({ ...emptyToolDock(), rightActiveId: 'diff' }, { ...state, activeId: 'diff' }, 'diff', 'bottom');
  expect(resolveToolDock(dock, state)).toMatchObject({ right: { activeId: 'browser' }, bottom: { activeId: 'diff' } });
  expect(resolveToolDock(dock, state, ['info'])).toMatchObject({ bottomPins: [], bottom: { activeId: '', isOpen: false } });
  dock = moveDockTab(dock, state, 'terminal', 'bottom');
  const panels = resolveToolDock({ ...dock, rightActiveId: 'plan', bottomActiveId: 'diff' }, state, ['info']);
  expect(panels.bottom.activeId).toBe('terminal'); expect(panels.bottom.isOpen).toBe(true); expect(panels.right.activeId).toBe('info');
  expect(resolveToolDock({ ...dock, bottomActiveId: 'info', rightActiveId: 'diff' }, state)).toMatchObject({
    right: { activeId: 'info' }, bottom: { activeId: 'diff' }
  });
});
it('normalizes hostile and corrupt stored layout data and clamps geometry', () => {
  expect(parseToolDock(null)).toEqual(emptyToolDock());
  expect(parseToolDock({ bottomIds: ['a', 'a', '', 1], collapsed: true, heightPx: Infinity, maximized: true })).toMatchObject({ bottomIds: ['a'], collapsed: true, heightPx: 240, maximized: false });
  expect(parseToolDock({ bottomIds: Array.from({ length: 150 }, (_, i) => String(i)), heightPx: 9999 }).bottomIds).toHaveLength(100);
  expect(clampDockHeight(-1)).toBe(120); expect(clampDockHeight(999)).toBe(480);
  for (const raw of ['broken', '{}', 'x'.repeat(262145), '[null,{}, {"owner":2}]']) {
    localStorage.setItem(TOOL_DOCK_STORAGE_KEY, raw); expect(loadToolDock('a')).toEqual(emptyToolDock());
  }
});
it('bounds persisted owners, restores independently and survives storage failures', () => {
  for (let i = 0; i < 70; i++) saveToolDock(String(i), { ...emptyToolDock(), heightPx: 200 + i, collapsed: true });
  expect(JSON.parse(localStorage.getItem(TOOL_DOCK_STORAGE_KEY)!)).toHaveLength(64);
  expect(loadToolDock('0').collapsed).toBe(false);
  expect(loadToolDock('69').heightPx).toBe(269);
  saveToolDock('69', emptyToolDock()); expect(loadToolDock('69').heightPx).toBe(240);
  const storage = { getItem: vi.fn(() => { throw new Error('denied'); }), setItem: vi.fn(() => { throw new Error('quota'); }) };
  expect(loadToolDock('a', storage)).toEqual(emptyToolDock());
  expect(() => saveToolDock('a', emptyToolDock(), storage)).not.toThrow();
  saveToolDock('', emptyToolDock());
  const large = { ...emptyToolDock(), bottomIds: Array.from({ length: 100 }, (_, i) => `${i}${'x'.repeat(500)}`) };
  for (let i = 0; i < 8; i++) saveToolDock(`large-${i}`, large);
  expect(localStorage.getItem(TOOL_DOCK_STORAGE_KEY)!.length).toBeLessThanOrEqual(262144);
  expect(loadToolDock('large-7').bottomIds).toHaveLength(100);
});
