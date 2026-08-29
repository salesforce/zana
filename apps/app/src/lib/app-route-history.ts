import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import type { Location } from 'react-router-dom';

export interface AppRouteHistoryEntry {
  key: string;
  url: string;
}

export interface AppRouteHistoryState {
  entries: AppRouteHistoryEntry[];
  index: number;
}

export interface AppRouteHistoryNavigation {
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
}

export type AppRouteNavigationType = 'POP' | 'PUSH' | 'REPLACE';

function getNormalizedUrl(location: Location): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

export function findBackTargetIndex(state: AppRouteHistoryState): number | null {
  const currentUrl = state.entries[state.index]?.url;
  if (currentUrl === undefined) return null;
  for (let candidate = state.index - 1; candidate >= 0; candidate -= 1) {
    if (state.entries[candidate]?.url !== currentUrl) return candidate;
  }
  return null;
}

export function findForwardTargetIndex(state: AppRouteHistoryState): number | null {
  const currentUrl = state.entries[state.index]?.url;
  if (currentUrl === undefined) return null;
  for (let candidate = state.index + 1; candidate < state.entries.length; candidate += 1) {
    if (state.entries[candidate]?.url !== currentUrl) return candidate;
  }
  return null;
}

export function navigateHistoryDelta(
  state: AppRouteHistoryState,
  direction: 'back' | 'forward',
  navigate: (delta: number) => void
): void {
  const target =
    direction === 'back' ? findBackTargetIndex(state) : findForwardTargetIndex(state);
  if (target === null) return;
  navigate(target - state.index);
}

export function reduceHistory(
  state: AppRouteHistoryState,
  navigationType: AppRouteNavigationType,
  entry: AppRouteHistoryEntry
): AppRouteHistoryState {
  switch (navigationType) {
    case 'PUSH': {
      const entries = state.entries.slice(0, state.index + 1);
      entries.push(entry);
      return { entries, index: entries.length - 1 };
    }
    case 'REPLACE': {
      const entries = state.entries.slice();
      entries[state.index] = entry;
      return { entries, index: state.index };
    }
    case 'POP': {
      const matchedIndex = state.entries.findIndex(
        (candidate) => candidate.key === entry.key && candidate.url === entry.url
      );
      if (matchedIndex >= 0) {
        return { entries: state.entries, index: matchedIndex };
      }
      return { entries: [entry], index: 0 };
    }
  }
}

const EMPTY_HISTORY_STATE: AppRouteHistoryState = { entries: [], index: 0 };
let historyState = EMPTY_HISTORY_STATE;
let lastRecordedLocation: Location | null = null;
const historyListeners = new Set<() => void>();

function recordLocation(location: Location, navigationType: AppRouteNavigationType): void {
  if (lastRecordedLocation === location) return;
  lastRecordedLocation = location;
  const entry = { key: location.key, url: getNormalizedUrl(location) };
  historyState =
    historyState.entries.length === 0
      ? { entries: [entry], index: 0 }
      : reduceHistory(historyState, navigationType, entry);
  for (const listener of historyListeners) listener();
}

function subscribeToHistory(listener: () => void): () => void {
  historyListeners.add(listener);
  return () => {
    historyListeners.delete(listener);
  };
}

/** Test-only: forget the module-level stack between cases. */
export function resetAppRouteHistoryForTest(): void {
  historyState = EMPTY_HISTORY_STATE;
  lastRecordedLocation = null;
}

/** Test-only: drive {@link recordLocation} without mounting the history hook. */
export function recordAppRouteHistoryForTest(
  location: Location,
  navigationType: AppRouteNavigationType
): void {
  recordLocation(location, navigationType);
}

/** Test-only: inspect the in-memory stack. */
export function getAppRouteHistoryStateForTest(): AppRouteHistoryState {
  return historyState;
}

export function useRouteStateHistoryNavigation(): AppRouteHistoryNavigation {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();

  useEffect(() => {
    recordLocation(location, navigationType);
  }, [location, navigationType]);

  const state = useSyncExternalStore(subscribeToHistory, () => historyState, () => historyState);

  const goBack = useCallback(() => {
    navigateHistoryDelta(historyState, 'back', (delta) => {
      void navigate(delta);
    });
  }, [navigate]);

  const goForward = useCallback(() => {
    navigateHistoryDelta(historyState, 'forward', (delta) => {
      void navigate(delta);
    });
  }, [navigate]);

  return {
    canGoBack: findBackTargetIndex(state) !== null,
    canGoForward: findForwardTargetIndex(state) !== null,
    goBack,
    goForward
  };
}
