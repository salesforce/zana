import { createElement, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Settings } from 'lucide-react';
import type { PaletteItem } from '@/components/palette/buildItems';
import { useUi } from '@/store';
import { searchSettings } from './index';
import { openSettingsHit } from './links';
import { getSettingsSearchSourcesVersion, subscribeSettingsSearchSources } from './registry';
import { ensureSettingsSearchProviders } from './runtime';
import { useSettingsSnapshot } from './snapshot';
import type { SettingsSearchHit, SettingsValueSnapshot } from './types';

/** Rows the ⌘P "All" scope shows for Settings; the rest sit behind the overflow link. */
export const PALETTE_SETTINGS_LANDING_CAP = 5;

export { settingsHitPath } from './links';

/** Breadcrumb, plus the current value when the query hit it. */
export function settingsHitHint(hit: SettingsSearchHit): string {
  return hit.matchedValue ? `${hit.breadcrumb} · Current: ${hit.matchedValue}` : hit.breadcrumb;
}

/**
 * Palette rows for a Settings query, in engine rank order. The palette calls
 * the Settings engine directly: help text is never flattened into
 * `PaletteItem.keywords`. Keys are `settings:<entryId>` so recents attach to
 * the entry. An empty query yields no rows.
 */
export function settingsPaletteItems(
  query: string,
  snapshot: SettingsValueSnapshot,
  options: {
    limit: number;
    projectId?: string | null;
    navigate: (path: string) => void;
    /** Store setter for the pending reveal target (same contract as the Settings rail). */
    setAnchor: (anchor: string | null) => void;
  }
): PaletteItem[] {
  if (!query.trim()) return [];
  ensureSettingsSearchProviders();
  return searchSettings(query, snapshot, { limit: options.limit }).map((hit) => ({
    key: `settings:${hit.entry.id}`,
    icon: createElement(Settings, { size: 14 }),
    label: hit.entry.label,
    hint: settingsHitHint(hit),
    category: 'Settings',
    source: 'core',
    run: () => openSettingsHit(hit, { projectId: options.projectId, navigate: options.navigate, setAnchor: options.setAnchor })
  }));
}

/**
 * The palette's Settings rows, with the same corpus as the Settings rail: reads
 * current values only while `active`, fetches plugin-defined settings when a
 * Settings query starts, and re-ranks when a runtime source lands. `navigate`
 * may change identity every render; it is read through a ref.
 */
export function useSettingsPaletteItems({
  query,
  active,
  projectId,
  limit,
  navigate
}: {
  query: string;
  active: boolean;
  projectId: string | null;
  limit: number;
  navigate: (path: string) => void;
}): PaletteItem[] {
  const snapshot = useSettingsSnapshot(projectId, active);
  const setAnchor = useUi((s) => s.setSettingsAnchor);
  const sourcesVersion = useSyncExternalStore(subscribeSettingsSearchSources, getSettingsSearchSourcesVersion);
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);
  useEffect(() => {
    if (active) void ensureSettingsSearchProviders().prefetchPluginSettings();
  }, [active]);
  return useMemo(
    () => (active
      ? settingsPaletteItems(query, snapshot, { limit, projectId, setAnchor, navigate: (path) => navigateRef.current(path) })
      : []),
    // sourcesVersion: plugin settings landing does not change the snapshot, but must re-rank.
    [active, query, snapshot, projectId, limit, setAnchor, sourcesVersion]
  );
}
