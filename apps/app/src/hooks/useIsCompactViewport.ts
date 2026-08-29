import { useSyncExternalStore } from 'react';

const COMPACT_QUERY = '(max-width: 720px)';

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const media = window.matchMedia(COMPACT_QUERY);
  media.addEventListener('change', onStoreChange);
  return () => media.removeEventListener('change', onStoreChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(COMPACT_QUERY).matches;
}

export function useIsCompactViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export function isCompactViewport(): boolean {
  return getSnapshot();
}
