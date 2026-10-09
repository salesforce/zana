import { getSettingsRoutePath, getSettingsTabRoutePath } from '../route-paths.js';
import type { SettingsSearchHit } from './types';

/**
 * Where a result opens. Entries that live outside /settings (plugin settings
 * on the plugin page) carry their own `href`; everything else rides the entry
 * id in the URL hash of its Settings page.
 */
export function settingsHitPath(hit: SettingsSearchHit, projectId?: string | null): string {
  const { entry } = hit;
  if (entry.href) return entry.href;
  const anchor = settingsHitAnchor(hit);
  if (entry.section === 'project') {
    return getSettingsTabRoutePath('project', projectId) + (anchor ? `#${encodeURIComponent(anchor)}` : '');
  }
  return getSettingsRoutePath(entry.section, anchor ?? undefined);
}

/** The pending reveal target for a hit: none for whole pages and off-Settings links. */
export function settingsHitAnchor(hit: SettingsSearchHit): string | null {
  return hit.entry.kind === 'section' || hit.entry.href ? null : hit.entry.id;
}

/**
 * Open a result: the ONE path both the rail and the ⌘P palette use. The target
 * is set in the store as well as the URL hash, so re-opening the result you are
 * already on (same URL, nothing for the router to change) still reveals it.
 * Some routes drop the hash (the project-settings alias), so the store copy is
 * what survives them.
 */
export function openSettingsHit(
  hit: SettingsSearchHit,
  deps: {
    projectId?: string | null;
    navigate: (path: string) => void;
    setAnchor: (anchor: string | null) => void;
  }
): void {
  deps.setAnchor(settingsHitAnchor(hit));
  deps.navigate(settingsHitPath(hit, deps.projectId));
}
