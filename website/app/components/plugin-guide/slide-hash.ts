import { SURFACE_GROUPS } from '../../../lib/plugin-guide/surfaces';

export function slideIdFromHash(hash: string): string | null {
  const id = hash.replace(/^#/, '');
  return SURFACE_GROUPS.some((group) => group.id === id) ? id : null;
}

/** Path + search + hash. Callers must pass this to replaceState WITH the existing history.state. */
export function hrefForSlide(id: string, currentHref: string): string {
  const url = new URL(currentHref, 'http://localhost');
  url.hash = id;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Preserve Next's history.state — `null` remounts the page. */
export function writeSlideHash(id: string): void {
  if (typeof window === 'undefined') return;
  const next = hrefForSlide(id, window.location.href);
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === next) return;
  window.history.replaceState(window.history.state, '', next);
}
