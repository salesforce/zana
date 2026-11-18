import { create } from 'zustand';
import {
  MAX_CLOSED_TABS,
  MAX_PLUGIN_ICON_CHARS,
  MAX_PLUGIN_ITEM_KEY_CHARS,
  MAX_PLUGIN_ROWS_CHARS,
  MAX_PLUGIN_TABS,
  MAX_PLUGIN_TABS_PER_PLUGIN,
  MAX_PLUGIN_TITLE_CHARS,
  MAX_THREAD_TABS,
  parseThreadTab,
  readThreadTabs,
  type ThreadTab
} from './thread-tabs.js';

/** A user-pinned item owned by a plugin page. `icon` is a short host-known token, never a URL. */
export type PluginApplicationTab = {
  kind: 'plugin';
  pluginId: string;
  pageId: string;
  itemKey: string;
  title: string;
  icon?: string;
  projectId: string;
};
export type ApplicationTab =
  | ({ kind: 'thread' } & ThreadTab)
  | { kind: 'setup'; setupId: string }
  | PluginApplicationTab;
export type ThreadApplicationTab = Extract<ApplicationTab, { kind: 'thread' }>;
/** Tabs remembered after closing; setup drafts are never restorable. */
export type ClosedApplicationTab = ThreadApplicationTab | PluginApplicationTab;
export interface ApplicationTabsState {
  open: ApplicationTab[];
  closed: ClosedApplicationTab[];
}
/** Why `openTab` declined to add a tab. */
export type ApplicationTabRefusal =
  | 'invalid'
  | 'plugin-cap'
  | 'plugin-total-cap'
  | 'size';
export interface OpenApplicationTabResult {
  state: ApplicationTabsState;
  refusal?: ApplicationTabRefusal;
}
export const applicationTabId = (tab: ApplicationTab) =>
  tab.kind === 'thread'
    ? `thread:${tab.threadId}`
    : tab.kind === 'setup'
      ? `setup:${tab.setupId}`
      : `plugin:${JSON.stringify([tab.projectId, tab.pluginId, tab.pageId, tab.itemKey])}`;
const storageKey = (scope: string | null) =>
  `zcc.application-tabs.v1:${scope ?? 'main'}`;
// Hard bound on what restore will parse: thread rows plus the plugin row budget.
const MAX_SAVED_CHARS = 128_000 + MAX_PLUGIN_ROWS_CHARS;
const MAX_ID_CHARS = 128;
const MAX_PROJECT_ID_CHARS = 512;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const ICON_TOKEN = /^[A-Za-z0-9_-]+$/;

const boundedText = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  !CONTROL_CHARS.test(value);

/** Validates and normalizes untrusted plugin tab input or a persisted row. */
export function parsePluginApplicationTab(
  row: unknown,
  scope: string | null = null
): PluginApplicationTab | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (
    r.kind !== 'plugin' ||
    !boundedText(r.pluginId, MAX_ID_CHARS) ||
    !boundedText(r.pageId, MAX_ID_CHARS) ||
    !boundedText(r.itemKey, MAX_PLUGIN_ITEM_KEY_CHARS) ||
    !boundedText(r.title, MAX_PLUGIN_TITLE_CHARS) ||
    !boundedText(r.projectId, MAX_PROJECT_ID_CHARS) ||
    (scope && r.projectId !== scope)
  )
    return null;
  const tab: PluginApplicationTab = {
    kind: 'plugin',
    pluginId: r.pluginId,
    pageId: r.pageId,
    itemKey: r.itemKey,
    title: r.title,
    projectId: r.projectId
  };
  if (r.icon !== undefined) {
    if (
      !boundedText(r.icon, MAX_PLUGIN_ICON_CHARS) ||
      !ICON_TOKEN.test(r.icon)
    )
      return null;
    tab.icon = r.icon;
  }
  return tab;
}

const serializePlugin = ({
  pluginId,
  pageId,
  itemKey,
  title,
  icon,
  projectId
}: PluginApplicationTab) => ({
  kind: 'plugin',
  pluginId,
  pageId,
  itemKey,
  title,
  ...(icon === undefined ? {} : { icon }),
  projectId
});
const pluginRowsSize = (tabs: ApplicationTab[]) =>
  JSON.stringify(
    tabs
      .filter((tab): tab is PluginApplicationTab => tab.kind === 'plugin')
      .map(serializePlugin)
  ).length;

/**
 * Tolerant combined parser: a row without `kind` is a thread, plugin rows are
 * validated independently, and a bad row never costs a valid row.
 */
function parseRows(
  value: unknown,
  scope: string | null,
  limit: number,
  enforcePluginCaps: boolean
): ClosedApplicationTab[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: ClosedApplicationTab[] = [];
  const perPlugin = new Map<string, number>();
  let plugins = 0;
  let pluginChars = 2;
  for (const row of value) {
    const kind = (row as { kind?: unknown } | null)?.kind;
    let tab: ClosedApplicationTab | null = null;
    if (kind === undefined || kind === 'thread') {
      const thread = parseThreadTab(row, scope);
      if (thread) tab = { kind: 'thread', ...thread };
    } else if (kind === 'plugin') {
      tab = parsePluginApplicationTab(row, scope);
    }
    if (!tab) continue;
    const id = applicationTabId(tab);
    if (seen.has(id)) continue;
    if (tab.kind === 'plugin' && enforcePluginCaps) {
      const chars = JSON.stringify(serializePlugin(tab)).length + 1;
      const count = perPlugin.get(tab.pluginId) ?? 0;
      if (
        plugins >= MAX_PLUGIN_TABS ||
        count >= MAX_PLUGIN_TABS_PER_PLUGIN ||
        pluginChars + chars > MAX_PLUGIN_ROWS_CHARS
      )
        continue;
      plugins++;
      pluginChars += chars;
      perPlugin.set(tab.pluginId, count + 1);
    }
    seen.add(id);
    rows.push(tab);
  }
  if (!enforcePluginCaps) return rows.slice(-limit);
  // Keep the newest threads only; plugin rows have their own budget.
  let threadsToDrop =
    rows.filter((row) => row.kind === 'thread').length - limit;
  return rows.filter((row) => row.kind !== 'thread' || threadsToDrop-- <= 0);
}

/** Conversations and plugin pins can be restored after reload. Setup references require a live draft. */
export function readApplicationTabs(
  storage: Pick<Storage, 'getItem'>,
  scope: string | null
): ApplicationTabsState {
  let saved: string | null = null;
  try {
    saved = storage.getItem(storageKey(scope));
  } catch {
    /* Storage can be disabled. */
  }
  if (saved === null) {
    // Previous thread-only format.
    const history = readThreadTabs(
      { getItem: (key) => storage.getItem(key) },
      scope
    );
    return {
      open: history.open.map((tab) => ({ kind: 'thread', ...tab })),
      closed: history.closed.map((tab) => ({ kind: 'thread', ...tab }))
    };
  }
  try {
    if (saved.length > MAX_SAVED_CHARS) return { open: [], closed: [] };
    const value = JSON.parse(saved);
    if (!value || typeof value !== 'object') return { open: [], closed: [] };
    const open = parseRows(value.open, scope, MAX_THREAD_TABS, true);
    const openIds = new Set(open.map(applicationTabId));
    const closed = parseRows(value.closed, scope, MAX_CLOSED_TABS, false).filter(
      (tab) => !openIds.has(applicationTabId(tab))
    );
    return { open, closed };
  } catch {
    return { open: [], closed: [] };
  }
}
export function saveApplicationTabs(
  storage: Pick<Storage, 'setItem'>,
  scope: string | null,
  state: ApplicationTabsState
) {
  const rows = (tabs: ApplicationTab[]): object[] =>
    tabs.flatMap<object>((tab) =>
      tab.kind === 'thread'
        ? [
            {
              threadId: tab.threadId,
              projectId: tab.projectId,
              projectScoped: tab.projectScoped
            }
          ]
        : tab.kind === 'plugin'
          ? [serializePlugin(tab)]
          : []
    );
  try {
    storage.setItem(
      storageKey(scope),
      JSON.stringify({ open: rows(state.open), closed: rows(state.closed) })
    );
  } catch {
    /* Navigation still works without persistence. */
  }
}

/** Like `openApplicationTab`, but reports why a plugin tab was refused. */
export function tryOpenApplicationTab(
  state: ApplicationTabsState,
  tab: ApplicationTab
): OpenApplicationTabResult {
  const id = applicationTabId(tab);
  const existing = state.open.find((row) => applicationTabId(row) === id);
  if (tab.kind === 'plugin') {
    const valid = parsePluginApplicationTab(tab);
    if (!valid) return { state, refusal: 'invalid' };
    return tryOpenPlugin(state, valid, id, existing);
  }
  return tryOpenOther(state, tab, id, existing);
}
function tryOpenPlugin(
  state: ApplicationTabsState,
  tab: PluginApplicationTab,
  id: string,
  existing: ApplicationTab | undefined
): OpenApplicationTabResult {
  if (existing?.kind === 'plugin') {
    if (existing.title === tab.title && existing.icon === tab.icon)
      return { state };
  } else {
    const plugins = state.open.filter(
      (row): row is PluginApplicationTab => row.kind === 'plugin'
    );
    if (plugins.length >= MAX_PLUGIN_TABS)
      return { state, refusal: 'plugin-total-cap' };
    if (
      plugins.filter((row) => row.pluginId === tab.pluginId).length >=
      MAX_PLUGIN_TABS_PER_PLUGIN
    )
      return { state, refusal: 'plugin-cap' };
  }
  const next = existing
    ? state.open.map((row) => (applicationTabId(row) === id ? tab : row))
    : [...state.open, tab];
  if (pluginRowsSize(next) > MAX_PLUGIN_ROWS_CHARS)
    return { state, refusal: 'size' };
  return {
    state: {
      open: next,
      closed: state.closed.filter((row) => applicationTabId(row) !== id)
    }
  };
}
function tryOpenOther(
  state: ApplicationTabsState,
  tab: Exclude<ApplicationTab, PluginApplicationTab>,
  id: string,
  existing: ApplicationTab | undefined
): OpenApplicationTabResult {
  if (
    existing?.kind === 'setup' ||
    (existing?.kind === 'thread' &&
      tab.kind === 'thread' &&
      existing.projectId === tab.projectId &&
      existing.projectScoped === tab.projectScoped)
  )
    return { state };
  let open = existing
    ? state.open.map((row) => (applicationTabId(row) === id ? tab : row))
    : [...state.open, tab];
  // Visiting more conversations may evict an old shortcut, never a live setup or plugin pin.
  if (open.filter((row) => row.kind === 'thread').length > MAX_THREAD_TABS) {
    const oldest = open.findIndex((row) => row.kind === 'thread');
    open = open.filter((_, index) => index !== oldest);
  }
  return {
    state: {
      open,
      closed: state.closed.filter((row) => applicationTabId(row) !== id)
    }
  };
}
export const openApplicationTab = (
  state: ApplicationTabsState,
  tab: ApplicationTab
): ApplicationTabsState => tryOpenApplicationTab(state, tab).state;
export function closeApplicationTab(
  state: ApplicationTabsState,
  id: string,
  remember = true
): ApplicationTabsState {
  const tab = state.open.find((row) => applicationTabId(row) === id);
  const closed = state.closed.filter((row) => applicationTabId(row) !== id);
  return {
    open: state.open.filter((row) => applicationTabId(row) !== id),
    closed:
      remember && (tab?.kind === 'thread' || tab?.kind === 'plugin')
        ? [...closed, tab].slice(-MAX_CLOSED_TABS)
        : closed
  };
}
export function moveApplicationTab(
  state: ApplicationTabsState,
  id: string,
  targetId: string
): ApplicationTabsState {
  const from = state.open.findIndex((tab) => applicationTabId(tab) === id);
  const to = state.open.findIndex((tab) => applicationTabId(tab) === targetId);
  if (from < 0 || to < 0 || from === to) return state;
  const open = [...state.open];
  const [tab] = open.splice(from, 1);
  open.splice(to, 0, tab!);
  return { ...state, open };
}

/** One ordered registry per window; each tab kind owns its content and close policy. */
export const useApplicationTabs = create<
  ApplicationTabsState & {
    initializedScope: string | null | undefined;
    initialize(storage: Pick<Storage, 'getItem'>, scope: string | null): void;
    /** Returns why a plugin tab was refused, or null when applied. */
    openTab(tab: ApplicationTab): ApplicationTabRefusal | null;
    closeTab(id: string, remember?: boolean): void;
    moveTab(id: string, targetId: string): void;
  }
>((set, get) => ({
  open: [],
  closed: [],
  initializedScope: undefined,
  initialize(storage, scope) {
    if (get().initializedScope === scope) return;
    const restored = readApplicationTabs(storage, scope);
    const current = get().initializedScope === undefined ? get().open : [];
    const merged = current.reduce(openApplicationTab, restored);
    set({ ...merged, initializedScope: scope });
  },
  openTab(tab) {
    const current = get();
    const result = tryOpenApplicationTab(current, tab);
    if (result.state !== current) set(result.state);
    return result.refusal ?? null;
  },
  closeTab: (id, remember) =>
    set((state) => closeApplicationTab(state, id, remember)),
  moveTab: (id, targetId) =>
    set((state) => moveApplicationTab(state, id, targetId))
}));
