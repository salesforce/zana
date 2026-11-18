/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applicationTabId, useApplicationTabs, type PluginApplicationTab } from '../../lib/application-tabs.js';
import { MAX_PLUGIN_TABS, MAX_PLUGIN_TABS_PER_PLUGIN } from '../../lib/thread-tabs.js';
import { useData, useUi } from '../../store.js';
import { usePluginAppModules } from '../plugin-app-loader.js';

const panels = vi.hoisted(() => ({ list: [] as Array<{ pluginId: string; id: string }> }));
vi.mock('../plugin-slots.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../plugin-slots.js')>()),
  listNavPanels: () => panels.list
}));
const scoped = vi.hoisted(() => ({ id: null as string | null }));
vi.mock('../../lib/windowScope.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/windowScope.js')>()),
  getScopedProjectId: () => scoped.id
}));

import {
  applyItemReport,
  getItemState,
  getTabDisplayTitle,
  isPluginTabPinned,
  pinPluginTab,
  subscribePluginPins,
  unpinPluginTab,
  updatePluginPinnedItem,
  useItemState,
  usePinnedItemOverrides,
  useTabDisplayTitle
} from '../plugin-pinned-tabs.js';

const caller = { pluginId: 'test-plugin', pageId: 'main' };
const tab = (over: Partial<PluginApplicationTab> = {}): PluginApplicationTab => ({
  kind: 'plugin',
  pluginId: 'test-plugin',
  pageId: 'main',
  itemKey: 'a',
  title: 'A',
  projectId: 'p1',
  ...over
});
const gesture = (active: boolean | undefined) =>
  Object.defineProperty(navigator, 'userActivation', {
    value: active === undefined ? undefined : { isActive: active },
    configurable: true
  });
const toasts = () => vi.spyOn(useUi.getState(), 'pushToast').mockImplementation(() => undefined);

beforeEach(() => {
  useApplicationTabs.setState({ open: [], closed: [] });
  usePinnedItemOverrides.setState({ byId: {} });
  useData.setState({ projects: [{ id: 'p1' }, { id: 'p2' }] as never });
  useUi.setState({ selectedProjectId: 'p1' });
  scoped.id = null;
  panels.list = [{ pluginId: 'test-plugin', id: 'main' }];
  usePluginAppModules.setState({ reconciled: true, modules: [{ id: 'test-plugin', title: 'T' } as never] });
  gesture(true);
});
afterEach(() => vi.restoreAllMocks());

describe('pinPluginTab', () => {
  it('pins with the caller-bound plugin and page, ignoring a plugin-supplied identity', () => {
    expect(pinPluginTab(caller, { itemKey: 'a', title: 'A', pluginId: 'other', pageId: 'x' })).toBe(true);
    expect(useApplicationTabs.getState().open).toEqual([tab()]);
  });

  it('uses the project the plugin names when it is registered', () => {
    expect(pinPluginTab(caller, { itemKey: 'a', title: 'A', projectId: 'p2' })).toBe(true);
    expect(useApplicationTabs.getState().open).toEqual([tab({ projectId: 'p2' })]);
  });

  it('pins an item of a project that is not selected, even with nothing selected', () => {
    useUi.setState({ selectedProjectId: null });
    expect(pinPluginTab(caller, { itemKey: 'a', title: 'A', projectId: 'p2' })).toBe(true);
    expect(useApplicationTabs.getState().open).toEqual([tab({ projectId: 'p2' })]);
  });

  it('falls back from an unregistered plugin project to the selection', () => {
    expect(pinPluginTab(caller, { itemKey: 'a', title: 'A', projectId: 'gone' })).toBe(true);
    expect(useApplicationTabs.getState().open).toEqual([tab({ projectId: 'p1' })]);
  });

  it('falls back to the first registered project with nothing selected or named', () => {
    useUi.setState({ selectedProjectId: null });
    expect(pinPluginTab(caller, { itemKey: 'a', title: 'A' })).toBe(true);
    expect(useApplicationTabs.getState().open).toEqual([tab({ projectId: 'p1' })]);
  });

  it('keeps one tab per item even when pinned from another project', () => {
    pinPluginTab(caller, { itemKey: 'a', title: 'A', projectId: 'p1' });
    expect(pinPluginTab(caller, { itemKey: 'a', title: 'A', projectId: 'p2' })).toBe(true);
    expect(useApplicationTabs.getState().open).toHaveLength(1);
  });

  it('keeps one tab for a repeat pin', () => {
    pinPluginTab(caller, { itemKey: 'a', title: 'A' });
    const before = useApplicationTabs.getState().open;
    expect(pinPluginTab(caller, { itemKey: 'a', title: 'A' })).toBe(true);
    expect(useApplicationTabs.getState().open).toBe(before);
  });

  it('rejects without transient user activation', () => {
    gesture(false);
    expect(pinPluginTab(caller, { itemKey: 'a', title: 'A' })).toBe(false);
    gesture(undefined);
    expect(pinPluginTab(caller, { itemKey: 'a', title: 'A' })).toBe(false);
    expect(useApplicationTabs.getState().open).toEqual([]);
  });

  it('takes the project of a project-locked window over the plugin\'s', () => {
    scoped.id = 'p2';
    expect(pinPluginTab(caller, { itemKey: 'a', title: 'A', projectId: 'p1' })).toBe(true);
    expect(useApplicationTabs.getState().open[0]).toMatchObject({ projectId: 'p2' });
  });

  it('tells the user to add a project when none is registered', () => {
    useData.setState({ projects: [] as never });
    useUi.setState({ selectedProjectId: null });
    const toast = toasts();
    expect(pinPluginTab(caller, { itemKey: 'a', title: 'A' })).toBe(false);
    expect(toast).toHaveBeenCalledWith('Add a project to pin tabs', 'error');
  });

  it('rejects a selection that is not registered when nothing else resolves', () => {
    useData.setState({ projects: [] as never });
    useUi.setState({ selectedProjectId: 'gone' });
    expect(pinPluginTab(caller, { itemKey: 'a', title: 'A' })).toBe(false);
  });

  it.each([
    ['not an object', 'a'],
    ['null', null],
    ['no key', { title: 'A' }],
    ['oversized key', { itemKey: 'k'.repeat(257), title: 'A' }],
    ['oversized title', { itemKey: 'a', title: 't'.repeat(121) }],
    ['control characters', { itemKey: 'a', title: 'A\u0007' }],
    ['icon url', { itemKey: 'a', title: 'A', icon: 'https://x.test/i.png' }]
  ])('rejects invalid input: %s', (_name, item) => {
    expect(pinPluginTab(caller, item)).toBe(false);
    expect(useApplicationTabs.getState().open).toEqual([]);
  });

  it('accepts an icon token', () => {
    expect(pinPluginTab(caller, { itemKey: 'a', title: 'A', icon: 'FileText' })).toBe(true);
  });

  it('refuses over the per-plugin cap with an error toast', () => {
    const toast = toasts();
    for (let i = 0; i < MAX_PLUGIN_TABS_PER_PLUGIN; i++) expect(pinPluginTab(caller, { itemKey: `k${i}`, title: 'T' })).toBe(true);
    expect(pinPluginTab(caller, { itemKey: 'extra', title: 'T' })).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('refuses over the total cap with an error toast', () => {
    const toast = toasts();
    for (let i = 0; i < MAX_PLUGIN_TABS; i++) {
      expect(pinPluginTab({ pluginId: `p${Math.floor(i / 5)}`, pageId: 'main' }, { itemKey: `k${i}`, title: 'T' })).toBe(true);
    }
    expect(pinPluginTab({ pluginId: 'fresh', pageId: 'main' }, { itemKey: 'x', title: 'T' })).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('toasts a size refusal and stays silent for an invalid refusal', () => {
    const toast = toasts();
    const openTab = vi.spyOn(useApplicationTabs.getState(), 'openTab');
    openTab.mockReturnValueOnce('size');
    expect(pinPluginTab(caller, { itemKey: 'a', title: 'A' })).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.any(String), 'error');
    toast.mockClear();
    openTab.mockReturnValueOnce('invalid');
    expect(pinPluginTab(caller, { itemKey: 'a', title: 'A' })).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('owner-only unpin, update and pinned state', () => {
  beforeEach(() => {
    useApplicationTabs.setState({ open: [tab(), tab({ pluginId: 'other', pageId: 'o' })], closed: [] });
  });

  it('reports and removes only the owner plugin tab, whichever project it was pinned in', () => {
    expect(isPluginTabPinned('test-plugin', 'a')).toBe(true);
    expect(isPluginTabPinned('test-plugin', 'zzz')).toBe(false);
    expect(isPluginTabPinned('test-plugin', 42)).toBe(false);
    useUi.setState({ selectedProjectId: 'p2' });
    expect(isPluginTabPinned('test-plugin', 'a')).toBe(true);
    unpinPluginTab('test-plugin', 'a');
    expect(useApplicationTabs.getState().open.map((row) => (row.kind === 'plugin' ? row.pluginId : ''))).toEqual(['other']);
  });

  it('does not let a plugin unpin another plugin tab', () => {
    unpinPluginTab('third', 'a');
    expect(useApplicationTabs.getState().open).toHaveLength(2);
  });

  it('applies title and availability for the owner only', () => {
    updatePluginPinnedItem('third', 'a', { title: 'Hijack', available: false });
    expect(usePinnedItemOverrides.getState().byId).toEqual({});
    updatePluginPinnedItem('test-plugin', 'a', { title: 'Renamed', available: false });
    expect(getTabDisplayTitle(tab())).toBe('Renamed');
    expect(getItemState(tab())).toBe('unavailable');
    updatePluginPinnedItem('test-plugin', 'a', { available: true });
    expect(getItemState(tab())).toBe('available');
    expect(getTabDisplayTitle(tab())).toBe('Renamed');
  });

  it('ignores invalid updates', () => {
    updatePluginPinnedItem('test-plugin', 'a', null);
    updatePluginPinnedItem('test-plugin', 7, { title: 'x' });
    updatePluginPinnedItem('test-plugin', 'a', { title: 'x'.repeat(121), available: 'no' });
    updatePluginPinnedItem('test-plugin', 'a', { title: 'bad\u0000' });
    expect(usePinnedItemOverrides.getState().byId).toEqual({});
    expect(getTabDisplayTitle(tab())).toBe('A');
  });

  it('ignores reports for tabs that are not open', () => {
    applyItemReport(tab({ itemKey: 'nope' }), { available: false });
    expect(usePinnedItemOverrides.getState().byId).toEqual({});
  });

  it('retains only open entries and skips identical merges', () => {
    const id = applicationTabId(tab());
    const { merge, retain } = usePinnedItemOverrides.getState();
    merge(id, { available: false });
    const first = usePinnedItemOverrides.getState().byId;
    merge(id, { available: false });
    expect(usePinnedItemOverrides.getState().byId).toBe(first);
    retain(new Set([id]));
    expect(usePinnedItemOverrides.getState().byId).toBe(first);
    retain(new Set());
    expect(usePinnedItemOverrides.getState().byId).toEqual({});
  });

  it('notifies subscribers of the owner pinned set and stops after unsubscribe', () => {
    const callback = vi.fn();
    const off = subscribePluginPins('test-plugin', callback);
    useApplicationTabs.setState({ open: [...useApplicationTabs.getState().open] });
    expect(callback).not.toHaveBeenCalled();
    useApplicationTabs.getState().openTab(tab({ itemKey: 'b' }));
    expect(callback).toHaveBeenCalledTimes(1);
    useApplicationTabs.getState().openTab({ ...tab({ itemKey: 'c' }), pluginId: 'other', pageId: 'o' });
    expect(callback).toHaveBeenCalledTimes(1);
    useUi.setState({ selectedProjectId: 'p2' });
    expect(callback).toHaveBeenCalledTimes(1);
    off();
    useApplicationTabs.getState().closeTab(applicationTabId(tab({ itemKey: 'b' })));
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe('getItemState', () => {
  it('is loading before the first reconcile, even for a missing plugin', () => {
    usePluginAppModules.setState({ reconciled: false, modules: [] });
    expect(getItemState(tab())).toBe('loading');
  });

  it('is unavailable for a missing, disabled or failed plugin', () => {
    usePluginAppModules.setState({ modules: [] });
    expect(getItemState(tab())).toBe('unavailable');
    usePluginAppModules.setState({ modules: [{ id: 'test-plugin', title: 'T', loadError: 'boom' } as never] });
    expect(getItemState(tab())).toBe('unavailable');
  });

  it('is unavailable for an unregistered page', () => {
    panels.list = [{ pluginId: 'test-plugin', id: 'other-page' }];
    expect(getItemState(tab())).toBe('unavailable');
    panels.list = [{ pluginId: 'someone', id: 'main' }];
    expect(getItemState(tab())).toBe('unavailable');
  });

  it('follows reported availability, otherwise available', () => {
    expect(getItemState(tab())).toBe('available');
    useApplicationTabs.setState({ open: [tab()], closed: [] });
    applyItemReport(tab(), { available: false });
    expect(getItemState(tab())).toBe('unavailable');
  });
});

describe('reactive item state', () => {
  it('re-renders on reconcile and on item reports', () => {
    useApplicationTabs.setState({ open: [tab()], closed: [] });
    usePluginAppModules.setState({ reconciled: false });
    const state = renderHook(() => useItemState(tab()));
    const title = renderHook(() => useTabDisplayTitle(tab()));
    expect(state.result.current).toBe('loading');
    expect(title.result.current).toBe('A');
    act(() => usePluginAppModules.setState({ reconciled: true }));
    expect(state.result.current).toBe('available');
    act(() => applyItemReport(tab(), { available: false, title: 'Gone' }));
    expect(state.result.current).toBe('unavailable');
    expect(title.result.current).toBe('Gone');
  });
});
