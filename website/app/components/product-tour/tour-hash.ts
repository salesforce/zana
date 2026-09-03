import { hrefForSlide } from './slides';

/** Preserve Next's history.state — `null` remounts the page and resets the tour. */
export function writeSlideHash(id: string): void {
  if (typeof window === 'undefined') return;
  const next = hrefForSlide(id, window.location.href);
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === next) return;
  window.history.replaceState(window.history.state, '', next);
}
