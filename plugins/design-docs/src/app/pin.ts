import { createContext, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';

/** Linked conversations, most recently active first. */
export function sortLinkedThreads<T extends { lastActivityAt: number }>(linked: readonly T[]): T[] {
  return [...linked].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

/** True where a doc can be pinned as a top-bar tab: the global Design Docs page only. */
export const PinnableContext = createContext(false);

/** Whether `docId` is a pinned tab; follows pins and closes made anywhere (including the tab's own ×). */
export function useDocPinned(docId: string): boolean {
  const navigate = useZccNavigate();
  const subscribe = useCallback(
    (onChange: () => void) => navigate.onPinnedChange?.(onChange) ?? (() => undefined),
    [navigate.onPinnedChange]
  );
  return useSyncExternalStore(subscribe, () => navigate.isPinned?.(docId) ?? false);
}

/** Re-renders the caller whenever this plugin's pinned tabs change, for menus that read `isPinned` per doc. */
export function usePinnedChanges(): void {
  const navigate = useZccNavigate();
  const [, setTick] = useState(0);
  useEffect(() => navigate.onPinnedChange?.(() => setTick((tick) => tick + 1)), [navigate.onPinnedChange]);
}
