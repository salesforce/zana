import { useSyncExternalStore } from 'react';
import { getAppSurface } from '../lib/app-surface.js';

const query = '(max-width: 1024px)';

function snapshot() {
  return getAppSurface() !== 'desktop' && typeof matchMedia !== 'undefined' && matchMedia(query).matches;
}

function subscribe(update: () => void) {
  if (getAppSurface() === 'desktop' || typeof matchMedia === 'undefined') return () => {};
  const media = matchMedia(query);
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}

export function useCompactLayout() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
