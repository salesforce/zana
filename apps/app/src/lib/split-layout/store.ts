import { create } from 'zustand';
import { findPane, listPanes, removePane } from './ops.js';
import { deserializeSplitLayout, serializeSplitLayout, SPLIT_LAYOUT_STORAGE_KEY } from './persistence.js';
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

function loadLayout(): SplitLayout | null {
  return deserializeSplitLayout(readSession(SPLIT_LAYOUT_STORAGE_KEY));
}

function loadMaximizedPaneId(): string | null {
  const stored = readSession(MAXIMIZED_PANE_STORAGE_KEY);
  return stored && stored.length > 0 ? stored : null;
}

function loadDimInactiveSplits(): boolean {
  const stored = readLocal(DIM_INACTIVE_SPLITS_STORAGE_KEY);
  if (stored === '0' || stored === 'false') return false;
  return true;
}

export interface ClosePanesForThreadsResult {
  removedAny: boolean;
  focusedRouteContent: SplitLayout | null;
}

interface SplitWorkspaceStore {
  layout: SplitLayout | null;
  maximizedPaneId: string | null;
  dimInactiveSplits: boolean;
  setLayout: (layout: SplitLayout | null) => void;
  updateLayout: (recipe: (current: SplitLayout | null) => SplitLayout | null) => SplitLayout | null;
  setMaximizedPaneId: (paneId: string | null) => void;
  setDimInactiveSplits: (value: boolean) => void;
  closePanesForThreads: (threadIds: readonly string[]) => ClosePanesForThreadsResult;
}

export const useSplitWorkspace = create<SplitWorkspaceStore>((set, get) => ({
  layout: loadLayout(),
  maximizedPaneId: loadMaximizedPaneId(),
  dimInactiveSplits: loadDimInactiveSplits(),
  setLayout: (layout) => {
    if (layout === null) {
      writeSession(SPLIT_LAYOUT_STORAGE_KEY, '');
    } else {
      writeSession(SPLIT_LAYOUT_STORAGE_KEY, serializeSplitLayout(layout));
    }
    set({ layout });
  },
  updateLayout: (recipe) => {
    const next = recipe(get().layout);
    if (next === get().layout) return next;
    get().setLayout(next);
    return next;
  },
  setMaximizedPaneId: (paneId) => {
    if (get().maximizedPaneId === paneId) return;
    writeSession(MAXIMIZED_PANE_STORAGE_KEY, paneId ?? '');
    set({ maximizedPaneId: paneId });
  },
  setDimInactiveSplits: (value) => {
    writeLocal(DIM_INACTIVE_SPLITS_STORAGE_KEY, value ? '1' : '0');
    set({ dimInactiveSplits: value });
  },
  closePanesForThreads: (threadIds) => {
    const current = get().layout;
    if (current === null || threadIds.length === 0) {
      return { removedAny: false, focusedRouteContent: null };
    }
    const targets = new Set(threadIds);
    let layout = current;
    let removedAny = false;
    for (;;) {
      const pane = listPanes(layout.root).find(
        (candidate) =>
          candidate.content.kind === 'thread' && targets.has(candidate.content.threadId)
      );
      if (pane === undefined) break;
      const next = removePane(layout, pane.paneId);
      if (next === layout) {
        get().setLayout(null);
        get().setMaximizedPaneId(null);
        return { removedAny: true, focusedRouteContent: null };
      }
      layout = next;
      removedAny = true;
    }
    if (!removedAny) {
      return { removedAny: false, focusedRouteContent: null };
    }
    const maximizedPaneId = get().maximizedPaneId;
    if (
      maximizedPaneId !== null &&
      (listPanes(layout.root).length < 2 || findPane(layout.root, maximizedPaneId) === null)
    ) {
      get().setMaximizedPaneId(null);
    }
    const focused = findPane(layout.root, layout.focusedPaneId);
    const survivorOk =
      focused !== null &&
      focused.content.kind === 'thread' &&
      !targets.has(focused.content.threadId);
    if (!survivorOk) {
      get().setLayout(null);
      get().setMaximizedPaneId(null);
      return { removedAny: true, focusedRouteContent: null };
    }
    get().setLayout(layout);
    return { removedAny: true, focusedRouteContent: layout };
  }
}));
