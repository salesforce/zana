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

function loadBag(): SplitLayoutBag {
  return deserializeSplitLayoutBag(readSession(SPLIT_LAYOUT_STORAGE_KEY), loadMaximizedPaneId());
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

function persistBag(state: {
  scopeKey: string;
  layout: SplitLayout | null;
  maximizedPaneId: string | null;
  scopes: Record<string, SplitScopeSlot>;
}): Record<string, SplitScopeSlot> {
  const scopes = snapshotScopes(state);
  writeSession(
    SPLIT_LAYOUT_STORAGE_KEY,
    serializeSplitLayoutBag({ version: SPLIT_LAYOUT_BAG_VERSION, scopes })
  );
  writeSession(MAXIMIZED_PANE_STORAGE_KEY, state.maximizedPaneId ?? '');
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
  closePanesForThreads: (threadIds: readonly string[]) => ClosePanesForThreadsResult;
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
    persistBag(next);
    set(next);
  },
  closePanesForThreads: (threadIds) => {
    if (threadIds.length === 0) {
      return { removedAny: false, focusedRouteContent: null };
    }
    const targets = new Set(threadIds);
    const current = get();
    let removedAny = false;
    const scopes = { ...current.scopes };

    for (const [key, slot] of Object.entries(scopes)) {
      if (key === current.scopeKey || slot.layout === null) continue;
      const stripped = stripThreadsFromLayout(slot.layout, targets);
      if (!stripped.removedAny) continue;
      removedAny = true;
      scopes[key] = {
        layout: stripped.layout,
        maximizedPaneId: maximizedIfPresent(stripped.layout, slot.maximizedPaneId)
      };
    }

    let layout = current.layout;
    let maximizedPaneId = current.maximizedPaneId;
    let focusedRouteContent: SplitLayout | null = null;

    if (layout !== null) {
      const stripped = stripThreadsFromLayout(layout, targets);
      if (stripped.removedAny) {
        removedAny = true;
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
    persistBag({ ...current, layout, maximizedPaneId, scopes });
    set({ layout, maximizedPaneId, scopes });
    return { removedAny: true, focusedRouteContent };
  }
}));
