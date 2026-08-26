import type { AppModule } from '@zana-ai/zcc-extension-sdk/renderer';
import type { ExtensionEntry, PluginAppEntry } from '@zana-ai/zcc-domain/product';

/** A module paired with its PluginService snapshot and/or disk-extension entry. */
export interface HubRow {
  module: AppModule & { loadError?: string };
  /** The disk-extension record, when this module is a runtime extension. */
  entry: ExtensionEntry | null;
  /** Server-owned PluginService snapshot, when this id is an installed plugin. */
  plugin: PluginAppEntry | null;
}

export type InstalledPublisher = 'official' | 'community' | 'local' | 'user';
export type InstalledPublisherFilter = 'all' | InstalledPublisher;

/**
 * A DISPLAY-ONLY placeholder `AppModule` synthesized from a disk-extension's
 * manifest for a row whose extension is NOT in the loaded module set — an
 * extension awaiting consent (`needsConsent`), disabled, or version-incompatible.
 * `reconcileExtensionModules` deliberately keeps such extensions OUT of the
 * merged module set (consent must precede running any extension code, P3-D), so
 * without this the hub would drop their row entirely and the user could neither
 * see nor manage them (grant consent, re-enable, uninstall) — the reported
 * "extension hidden from the list when the consent prompt opens" bug.
 *
 * It carries NO executable contribution (`panel`/`settingsPanel`/`commands`/
 * `navBadge` all undefined) — the row renders the core-owned About + Permissions
 * cards only, so no unconsented extension code is ever mounted. Surface/status
 * are derived from the entry (see `moduleSurface`/`rowStatus`, which read the
 * manifest when a placeholder has no `panel`).
 */
export function placeholderModule(entry: ExtensionEntry): AppModule & { loadError?: string } {
  return {
    id: entry.id,
    title: entry.manifest?.title ?? entry.id,
    icon: displayIcon(entry.manifest?.icon ?? 'HelpCircle'),
    titleLabel: entry.manifest?.titleLabel,
    projectTab: entry.manifest?.projectTab
  };
}

export function placeholderFromPlugin(
  plugin: PluginAppEntry
): AppModule & { loadError?: string } {
  return {
    id: plugin.id,
    title: plugin.name,
    icon: displayIcon(plugin.icon),
    projectTab: plugin.projectTab
  };
}

/** Lucide names only — path-like branding icons fall back to Puzzle. */
export function displayIcon(name: string): string {
  if (!name || name.includes('/') || name.includes('.') || name.startsWith('./')) {
    return 'Puzzle';
  }
  return name;
}

/**
 * Build the hub's rows from the UNION of loaded `modules`, ALL discovered disk
 * `entries`, and the PluginService snapshot (`plugins`).
 *
 * Loaded modules keep their real (executable) module. Every disk entry or
 * installed plugin whose id is NOT already covered by a loaded module gets a
 * display-only placeholder so an unconsented / disabled / no-UI plugin stays
 * visible and manageable. Exported for unit tests — this join is the fix for
 * the disappearing-row bug and the Installed collection's "list every builtin".
 */
export function buildHubRows(
  modules: (AppModule & { loadError?: string })[],
  entries: ExtensionEntry[],
  plugins: PluginAppEntry[] = []
): HubRow[] {
  const byModule = new Map(modules.map((module) => [module.id, module]));
  const byEntry = new Map(entries.map((entry) => [entry.id, entry]));
  const byPlugin = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  const ids = new Set<string>([...byModule.keys(), ...byEntry.keys(), ...byPlugin.keys()]);
  const rows: HubRow[] = [];
  for (const id of ids) {
    const plugin = byPlugin.get(id) ?? null;
    const entry = byEntry.get(id) ?? null;
    const loaded = byModule.get(id);
    const module =
      loaded ?? (plugin ? placeholderFromPlugin(plugin) : placeholderModule(entry!));
    rows.push({ module, entry, plugin });
  }
  return rows.sort((a, b) => a.module.title.localeCompare(b.module.title));
}

export function rowEnabled(row: HubRow): boolean {
  if (row.plugin) return row.plugin.enabled;
  if (row.entry) return row.entry.enabled;
  return true;
}

export function rowDescription(row: HubRow): string {
  return row.plugin?.description?.trim() ?? '';
}

export function installedPublisher(row: HubRow): InstalledPublisher {
  if (row.entry?.source === 'local') return 'local';
  if (row.plugin?.provenance === 'builtin') return 'official';
  if (row.plugin?.provenance === 'catalog') return 'community';
  if (row.plugin?.provenance === 'direct') return 'user';
  if (row.entry) return 'user';
  return 'official';
}

export function publisherLabel(publisher: InstalledPublisher): string | null {
  switch (publisher) {
    case 'official':
      return 'Official';
    case 'community':
      return 'Community';
    case 'local':
      return 'Local';
    case 'user':
      return null;
  }
}

export function filterInstalledRows(
  rows: HubRow[],
  query: string,
  publisher: InstalledPublisherFilter,
  sortDir: 'asc' | 'desc'
): HubRow[] {
  const q = query.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (publisher !== 'all' && installedPublisher(row) !== publisher) {
      return false;
    }
    if (!q) return true;
    const hay = [row.module.id, row.module.title, rowDescription(row)].join(' ').toLowerCase();
    return hay.includes(q);
  });
  return filtered.sort((left, right) => {
    const enabledCmp = Number(!rowEnabled(left)) - Number(!rowEnabled(right));
    if (enabledCmp !== 0) return enabledCmp;
    const nameCmp =
      left.module.title.localeCompare(right.module.title) ||
      left.module.id.localeCompare(right.module.id);
    return sortDir === 'desc' ? -nameCmp : nameCmp;
  });
}
