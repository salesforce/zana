import { create } from 'zustand';
import { findPane, listPanes, removePane } from './ops.js';
import {
  deserializeSplitLayoutBag,
  serializeSplitLayoutBag,
  SPLIT_LAYOUT_BAG_VERSION,
  SPLIT_LAYOUT_STORAGE_KEY,
  type SplitLayoutBag,
  type SplitScopeSlot
} from './persistence.js';
import { GLOBAL_SPLIT_SCOPE_KEY } from './scope.js';
import type { SplitLayout } from './types.js';

export const MAXIMIZED_PANE_STORAGE_KEY = 'zcc.splitLayout.maximizedPaneId';
export const DIM_INACTIVE_SPLITS_STORAGE_KEY = 'zcc.splitLayout.dimInactiveSplits';

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Quota or private-mode — layout still lives in memory for this session.
  }
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function loadMaximizedPaneId(): string | null {
  const stored = readSession(MAXIMIZED_PANE_STORAGE_KEY);
  return stored && stored.length > 0 ? stored : null;
}

/** Remembered scopes beyond this are dropped, least recently saved first. */
export const MAX_REMEMBERED_SCOPES = 64;

/**
 * This window's own copy wins, so concurrent windows keep separate layouts. A
 * new window or a relaunch has none and starts from the last saved layouts.
 */
function loadBag(): SplitLayoutBag {
  const windowBag = readSession(SPLIT_LAYOUT_STORAGE_KEY);
  if (windowBag !== null) return deserializeSplitLayoutBag(windowBag, loadMaximizedPaneId());
  return deserializeSplitLayoutBag(readLocal(SPLIT_LAYOUT_STORAGE_KEY));
}

/**
 * Merge only `keys` into the shared copy so one window never overwrites the
 * scopes another window saved since it loaded. Saved keys move to the end,
 * which keeps the insertion order least-recently-saved first for the cap.
 */
function rememberScopes(scopes: Record<string, SplitScopeSlot>, keys: readonly string[]): void {
  const remembered = { ...deserializeSplitLayoutBag(readLocal(SPLIT_LAYOUT_STORAGE_KEY)).scopes };
  for (const key of keys) {
    delete remembered[key];
    const slot = scopes[key];
    if (slot?.layout) remembered[key] = slot;
  }
  const keep = Object.keys(remembered).slice(-MAX_REMEMBERED_SCOPES);
  writeLocal(
    SPLIT_LAYOUT_STORAGE_KEY,
    serializeSplitLayoutBag({
      version: SPLIT_LAYOUT_BAG_VERSION,
      scopes: Object.fromEntries(keep.map((key) => [key, remembered[key]!]))
    })
  );
}

function loadDimInactiveSplits(): boolean {
  const stored = readLocal(DIM_INACTIVE_SPLITS_STORAGE_KEY);
  if (stored === '0' || stored === 'false') return false;
  return true;
}

function snapshotScopes(state: {
  scopeKey: string;
  layout: SplitLayout | null;
  maximizedPaneId: string | null;
  scopes: Record<string, SplitScopeSlot>;
}): Record<string, SplitScopeSlot> {
  return {
    ...state.scopes,
    [state.scopeKey]: { layout: state.layout, maximizedPaneId: state.maximizedPaneId }
  };
}

function persistBag(
  state: {
    scopeKey: string;
    layout: SplitLayout | null;
    maximizedPaneId: string | null;
    scopes: Record<string, SplitScopeSlot>;
  },
  changedKeys: readonly string[] = [state.scopeKey]
): Record<string, SplitScopeSlot> {
  const scopes = snapshotScopes(state);
  writeSession(
    SPLIT_LAYOUT_STORAGE_KEY,
    serializeSplitLayoutBag({ version: SPLIT_LAYOUT_BAG_VERSION, scopes })
  );
  writeSession(MAXIMIZED_PANE_STORAGE_KEY, state.maximizedPaneId ?? '');
  rememberScopes(scopes, changedKeys);
  return scopes;
}

function stripThreadsFromLayout(
  layout: SplitLayout,
  targets: Set<string>
): { layout: SplitLayout | null; removedAny: boolean } {
  let next = layout;
  let removedAny = false;
  for (;;) {
    const pane = listPanes(next.root).find(
      (candidate) =>
        candidate.content.kind === 'thread' && targets.has(candidate.content.threadId)
    );
    if (pane === undefined) break;
    const stripped = removePane(next, pane.paneId);
    if (stripped === next) {
      return { layout: null, removedAny: true };
    }
    next = stripped;
    removedAny = true;
  }
  return { layout: next, removedAny };
}

function maximizedIfPresent(
  layout: SplitLayout | null,
  maximizedPaneId: string | null
): string | null {
  if (layout === null || maximizedPaneId === null) return null;
  if (listPanes(layout.root).length < 2 || findPane(layout.root, maximizedPaneId) === null) {
    return null;
  }
  return maximizedPaneId;
}

const initialBag = loadBag();
const initialSlot = initialBag.scopes[GLOBAL_SPLIT_SCOPE_KEY] ?? {
  layout: null,
  maximizedPaneId: null
};

export interface ClosePanesForThreadsResult {
  removedAny: boolean;
  focusedRouteContent: SplitLayout | null;
}

interface SplitWorkspaceStore {
  layout: SplitLayout | null;
  maximizedPaneId: string | null;
  dimInactiveSplits: boolean;
  scopeKey: string;
  scopes: Record<string, SplitScopeSlot>;
  setLayout: (layout: SplitLayout | null) => void;
  updateLayout: (recipe: (current: SplitLayout | null) => SplitLayout | null) => SplitLayout | null;
  setMaximizedPaneId: (paneId: string | null) => void;
  setDimInactiveSplits: (value: boolean) => void;
  activateScope: (nextKey: string) => void;
  /** Drop a scope's layout from this window and from the remembered copy. */
  forgetScope: (key: string) => void;
  /**
   * Strip panes showing `threadIds` from every scope. `inactiveScopesOnly`
   * leaves the active scope to the mounted split, which owns its route.
   */
  closePanesForThreads: (
    threadIds: readonly string[],
    options?: { inactiveScopesOnly?: boolean }
  ) => ClosePanesForThreadsResult;
}

export const useSplitWorkspace = create<SplitWorkspaceStore>((set, get) => ({
  layout: initialSlot.layout,
  maximizedPaneId: initialSlot.maximizedPaneId,
  dimInactiveSplits: loadDimInactiveSplits(),
  scopeKey: GLOBAL_SPLIT_SCOPE_KEY,
  scopes: initialBag.scopes,
  setLayout: (layout) => {
    const scopes = persistBag({ ...get(), layout });
    set({ layout, scopes });
  },
  updateLayout: (recipe) => {
    const next = recipe(get().layout);
    if (next === get().layout) return next;
    get().setLayout(next);
    return next;
  },
  setMaximizedPaneId: (paneId) => {
    if (get().maximizedPaneId === paneId) return;
    const scopes = persistBag({ ...get(), maximizedPaneId: paneId });
    set({ maximizedPaneId: paneId, scopes });
  },
  setDimInactiveSplits: (value) => {
    writeLocal(DIM_INACTIVE_SPLITS_STORAGE_KEY, value ? '1' : '0');
    set({ dimInactiveSplits: value });
  },
  activateScope: (nextKey) => {
    const key = nextKey || GLOBAL_SPLIT_SCOPE_KEY;
    const current = get();
    if (current.scopeKey === key) return;
    const scopes = snapshotScopes(current);
    const nextSlot = scopes[key] ?? { layout: null, maximizedPaneId: null };
    const next = {
      scopeKey: key,
      scopes,
      layout: nextSlot.layout,
      maximizedPaneId: nextSlot.maximizedPaneId
    };
    persistBag(next, [current.scopeKey, key]);
    set(next);
  },
  forgetScope: (key) => {
    const current = get();
    if (key === current.scopeKey) {
      const scopes = persistBag({ ...current, layout: null, maximizedPaneId: null });
      set({ layout: null, maximizedPaneId: null, scopes });
      return;
    }
    const scopes = { ...current.scopes };
    delete scopes[key];
    persistBag({ ...current, scopes }, [key]);
    set({ scopes });
  },
  closePanesForThreads: (threadIds, options) => {
    if (threadIds.length === 0) {
      return { removedAny: false, focusedRouteContent: null };
    }
    const targets = new Set(threadIds);
    const current = get();
    let removedAny = false;
    const scopes = { ...current.scopes };
    const changedKeys: string[] = [];

    for (const [key, slot] of Object.entries(scopes)) {
      if (key === current.scopeKey || slot.layout === null) continue;
      const stripped = stripThreadsFromLayout(slot.layout, targets);
      if (!stripped.removedAny) continue;
      removedAny = true;
      changedKeys.push(key);
      scopes[key] = {
        layout: stripped.layout,
        maximizedPaneId: maximizedIfPresent(stripped.layout, slot.maximizedPaneId)
      };
    }

    let layout = current.layout;
    let maximizedPaneId = current.maximizedPaneId;
    let focusedRouteContent: SplitLayout | null = null;

    if (layout !== null && options?.inactiveScopesOnly !== true) {
      const stripped = stripThreadsFromLayout(layout, targets);
      if (stripped.removedAny) {
        removedAny = true;
        changedKeys.push(current.scopeKey);
        layout = stripped.layout;
        maximizedPaneId = maximizedIfPresent(layout, maximizedPaneId);
        if (layout !== null) {
          const focused = findPane(layout.root, layout.focusedPaneId);
          const survivorOk =
            focused !== null &&
            focused.content.kind === 'thread' &&
            !targets.has(focused.content.threadId);
          if (!survivorOk) {
            layout = null;
            maximizedPaneId = null;
          } else {
            focusedRouteContent = layout;
          }
        }
      }
    }

    if (!removedAny) {
      return { removedAny: false, focusedRouteContent: null };
    }
    scopes[current.scopeKey] = { layout, maximizedPaneId };
    persistBag({ ...current, layout, maximizedPaneId, scopes }, changedKeys);
    set({ layout, maximizedPaneId, scopes });
    return { removedAny: true, focusedRouteContent };
  }
}));
