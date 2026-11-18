import { create } from 'zustand';
import {
  applicationTabId,
  parsePluginApplicationTab,
  useApplicationTabs,
  type PluginApplicationTab
} from '../lib/application-tabs.js';
import { getScopedProjectId } from '../lib/windowScope.js';
import { useData, useUi } from '../store.js';
import { usePluginAppModules } from './plugin-app-loader.js';
import { listNavPanels } from './plugin-slots.js';

export type PinnedItemState = 'available' | 'unavailable' | 'loading';

/** In-memory facts about a pinned item, reported by its page or by `resolvePin`. Never persisted. */
interface PinnedItemOverride {
  available?: boolean;
  title?: string;
}

interface PinnedItemOverridesState {
  byId: Readonly<Record<string, PinnedItemOverride>>;
  merge(id: string, patch: PinnedItemOverride): void;
  /** Drops entries whose tab is no longer open. */
  retain(openIds: ReadonlySet<string>): void;
}

export const usePinnedItemOverrides = create<PinnedItemOverridesState>((set) => ({
  byId: {},
  merge: (id, patch) =>
    set((state) => {
      const current = state.byId[id];
      const next = { ...current, ...patch };
      if (current && current.available === next.available && current.title === next.title) return state;
      return { byId: { ...state.byId, [id]: next } };
    }),
  retain: (openIds) =>
    set((state) => {
      const ids = Object.keys(state.byId);
      if (ids.every((id) => openIds.has(id))) return state;
      return { byId: Object.fromEntries(ids.filter((id) => openIds.has(id)).map((id) => [id, state.byId[id]!])) };
    })
}));

/**
 * Whether a plugin tab can be opened. Order: nothing is known before the first
 * plugin reconcile; then a missing, disabled or failed plugin or an unregistered
 * page; then what the page or `resolvePin` reported; otherwise available.
 */
export function getItemState(tab: PluginApplicationTab): PinnedItemState {
  const { reconciled, modules } = usePluginAppModules.getState();
  if (!reconciled) return 'loading';
  const module = modules.find((row) => row.id === tab.pluginId);
  if (!module || module.loadError) return 'unavailable';
  if (!listNavPanels().some((panel) => panel.pluginId === tab.pluginId && panel.id === tab.pageId)) return 'unavailable';
  if (usePinnedItemOverrides.getState().byId[applicationTabId(tab)]?.available === false) return 'unavailable';
  return 'available';
}

/** The tab label: a title learned in memory wins over the saved one. */
export function getTabDisplayTitle(tab: PluginApplicationTab): string {
  return usePinnedItemOverrides.getState().byId[applicationTabId(tab)]?.title ?? tab.title;
}

/** Reactive `getItemState`; re-renders when plugins reconcile or an item report arrives. */
export function useItemState(tab: PluginApplicationTab): PinnedItemState {
  usePluginAppModules((s) => s.reconciled && s.modules);
  usePinnedItemOverrides((s) => s.byId[applicationTabId(tab)]);
  return getItemState(tab);
}

/** Reactive `getTabDisplayTitle`. */
export function useTabDisplayTitle(tab: PluginApplicationTab): string {
  return usePinnedItemOverrides((s) => s.byId[applicationTabId(tab)]?.title) ?? tab.title;
}

/** Records what the host learned about an open tab's item. Unknown tabs are ignored. */
export function applyItemReport(tab: PluginApplicationTab, report: PinnedItemOverride): void {
  const id = applicationTabId(tab);
  if (!useApplicationTabs.getState().open.some((row) => applicationTabId(row) === id)) return;
  usePinnedItemOverrides.getState().merge(id, report);
}

/** Caller identity the host resolved itself; never taken from plugin input. */
export interface PinCaller {
  pluginId: string;
  pageId: string;
}

/**
 * Project a pin made now belongs to: the locked window's project, else the
 * plugin's own registered project for the item, else the selected one, else the
 * first registered project (a global item pinned with nothing selected).
 */
export function currentPinProjectId(requested?: unknown): string | null {
  const scoped = getScopedProjectId();
  if (scoped) return scoped;
  const projects = useData.getState().projects;
  if (typeof requested === 'string' && projects.some((project) => project.id === requested)) return requested;
  return useUi.getState().selectedProjectId ?? projects[0]?.id ?? null;
}

const hasTransientActivation = () =>
  typeof navigator !== 'undefined' &&
  (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive === true;

export const REFUSAL_MESSAGES = {
  'plugin-total-cap': 'Too many pinned tabs. Unpin one first.',
  'plugin-cap': 'This plugin has too many pinned tabs. Unpin one first.',
  size: 'Pinned tab is too large to save. Unpin one first.'
} as const;

/** Pins `item` for `caller`. Returns false, with a toast for cap and size refusals, when it cannot. */
export function pinPluginTab(caller: PinCaller, item: unknown): boolean {
  if (!hasTransientActivation()) return false;
  const raw = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
  const projectId = currentPinProjectId(raw.projectId);
  if (!projectId || !useData.getState().projects.some((project) => project.id === projectId)) {
    useUi.getState().pushToast('Add a project to pin tabs', 'error');
    return false;
  }
  const tab = parsePluginApplicationTab({
    kind: 'plugin',
    pluginId: caller.pluginId,
    pageId: caller.pageId,
    itemKey: raw.itemKey,
    title: raw.title,
    ...(raw.icon === undefined ? {} : { icon: raw.icon }),
    projectId
  });
  if (!tab) return false;
  // One tab per item: a second pin from another project is the same item.
  if (ownedTabs(caller.pluginId, tab.itemKey).length > 0) return true;
  const refusal = useApplicationTabs.getState().openTab(tab);
  if (!refusal) return true;
  if (refusal !== 'invalid') useUi.getState().pushToast(REFUSAL_MESSAGES[refusal], 'error');
  return false;
}

function ownedTabs(pluginId: string, itemKey: unknown): PluginApplicationTab[] {
  if (typeof itemKey !== 'string') return [];
  return useApplicationTabs
    .getState()
    .open.filter(
      (tab): tab is PluginApplicationTab =>
        tab.kind === 'plugin' && tab.pluginId === pluginId && tab.itemKey === itemKey
    );
}

/** Removes the owner's tab for `itemKey`, in whichever project it was pinned; the tab can be reopened from closed memory. */
export function unpinPluginTab(pluginId: string, itemKey: unknown): void {
  for (const tab of ownedTabs(pluginId, itemKey)) useApplicationTabs.getState().closeTab(applicationTabId(tab));
}

export function isPluginTabPinned(pluginId: string, itemKey: unknown): boolean {
  return ownedTabs(pluginId, itemKey).length > 0;
}

/** Calls `callback` when the plugin's own pinned set may have changed. */
export function subscribePluginPins(pluginId: string, callback: () => void): () => void {
  const signature = () =>
    `${useApplicationTabs
      .getState()
      .open.flatMap((tab) => (tab.kind === 'plugin' && tab.pluginId === pluginId ? [applicationTabId(tab)] : []))
      .join('\n')}`;
  let last = signature();
  const check = () => {
    const next = signature();
    if (next === last) return;
    last = next;
    callback();
  };
  const offTabs = useApplicationTabs.subscribe(check);
  return () => {
    offTabs();
  };
}

/** Owner-only update: a title (validated like pin input) and/or `available`. */
export function updatePluginPinnedItem(pluginId: string, itemKey: unknown, update: unknown): void {
  if (!update || typeof update !== 'object') return;
  const raw = update as { title?: unknown; available?: unknown };
  for (const tab of ownedTabs(pluginId, itemKey)) {
    const patch: PinnedItemOverride = {};
    if (raw.title !== undefined && parsePluginApplicationTab({ ...tab, title: raw.title })) patch.title = raw.title as string;
    if (typeof raw.available === 'boolean') patch.available = raw.available;
    if (Object.keys(patch).length > 0) applyItemReport(tab, patch);
  }
}
