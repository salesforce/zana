import { create } from 'zustand';
import { readThreadTabs, type ThreadTab } from './thread-tabs.js';

export type ApplicationTab =
  ({ kind: 'thread' } & ThreadTab) | { kind: 'setup'; setupId: string };
export type ThreadApplicationTab = Extract<ApplicationTab, { kind: 'thread' }>;
export interface ApplicationTabsState {
  open: ApplicationTab[];
  closed: ThreadApplicationTab[];
}
export const applicationTabId = (tab: ApplicationTab) =>
  tab.kind === 'thread' ? `thread:${tab.threadId}` : `setup:${tab.setupId}`;
const storageKey = (scope: string | null) =>
  `zcc.application-tabs.v1:${scope ?? 'main'}`;

/** Only conversations can be restored after reload. Setup references require a live draft. */
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
  // Reuse the bounded validation and scope checks of the previous format.
  const history = readThreadTabs(
    { getItem: (key) => saved ?? storage.getItem(key) },
    scope
  );
  return {
    open: history.open.map((tab) => ({ kind: 'thread', ...tab })),
    closed: history.closed.map((tab) => ({ kind: 'thread', ...tab }))
  };
}
export function saveApplicationTabs(
  storage: Pick<Storage, 'setItem'>,
  scope: string | null,
  state: ApplicationTabsState
) {
  const threads = (tabs: ApplicationTab[]) =>
    tabs
      .filter((tab): tab is ThreadApplicationTab => tab.kind === 'thread')
      .map(({ threadId, projectId, projectScoped }) => ({
        threadId,
        projectId,
        projectScoped
      }));
  try {
    storage.setItem(
      storageKey(scope),
      JSON.stringify({
        open: threads(state.open),
        closed: threads(state.closed)
      })
    );
  } catch {
    /* Navigation still works without persistence. */
  }
}

export function openApplicationTab(
  state: ApplicationTabsState,
  tab: ApplicationTab
): ApplicationTabsState {
  const id = applicationTabId(tab);
  const existing = state.open.find((row) => applicationTabId(row) === id);
  if (
    existing?.kind === 'setup' ||
    (existing?.kind === 'thread' &&
      tab.kind === 'thread' &&
      existing.projectId === tab.projectId &&
      existing.projectScoped === tab.projectScoped)
  )
    return state;
  let open = existing
    ? state.open.map((row) => (applicationTabId(row) === id ? tab : row))
    : [...state.open, tab];
  // Visiting more conversations may evict an old shortcut, never a live setup.
  if (open.filter((row) => row.kind === 'thread').length > 40) {
    const oldest = open.findIndex((row) => row.kind === 'thread');
    open = open.filter((_, index) => index !== oldest);
  }
  return {
    open,
    closed: state.closed.filter((row) => applicationTabId(row) !== id)
  };
}
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
      remember && tab?.kind === 'thread' ? [...closed, tab].slice(-10) : closed
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
    openTab(tab: ApplicationTab): void;
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
  openTab: (tab) => set((state) => openApplicationTab(state, tab)),
  closeTab: (id, remember) =>
    set((state) => closeApplicationTab(state, id, remember)),
  moveTab: (id, targetId) =>
    set((state) => moveApplicationTab(state, id, targetId))
}));
