import type { MarketplaceEntry as CatalogPlugin } from '@zana-ai/zcc-domain';
import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
import { marketplaceInstallSpec } from './marketplace.js';
import type { MarketplaceCatalogRow } from './marketplace-store.js';

/**
 * Project PluginService marketplace catalogs onto the Browse list.
 *
 * Browse's floor is first-party plugins the app ships (`plugins/`). Catalog
 * indexes (https / git / path) layer on extra community rows; they never
 * replace a shipped id.
 */
export function projectCatalogMarketplaceEntries(
  catalogs: MarketplaceCatalogRow[],
  installedIds: ReadonlySet<string>,
  installedVersions: ReadonlyMap<string, string> = new Map()
): MarketplaceEntry[] {
  const byId = new Map<string, MarketplaceEntry>();
  for (const catalog of catalogs) {
    const plugins = catalog.cachedIndex?.plugins ?? [];
    for (const plugin of plugins) {
      const existing = byId.get(plugin.id);
      const next = toMarketplaceEntry(catalog, plugin, installedIds, installedVersions);
      if (!existing || prefer(next, existing)) byId.set(plugin.id, next);
    }
  }
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** Shipped-with-the-app rows win; catalog rows fill ids the app does not ship. */
export function mergeShippedWithCatalogs(
  shipped: MarketplaceEntry[],
  catalogs: MarketplaceEntry[]
): MarketplaceEntry[] {
  const byId = new Map(shipped.map((entry) => [entry.id, entry]));
  for (const entry of catalogs) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** Resolve an install spec from catalogs main owns. Null when the id is not listed. */
export function resolveCatalogInstallSpec(
  catalogs: MarketplaceCatalogRow[],
  entryId: string
): string | null {
  const id = entryId.trim();
  if (!id) return null;
  for (const catalog of catalogs) {
    const plugin = catalog.cachedIndex?.plugins.find((entry) => entry.id === id);
    if (!plugin) continue;
    try {
      return marketplaceInstallSpec(plugin);
    } catch {
      continue;
    }
  }
  return null;
}

function toMarketplaceEntry(
  catalog: MarketplaceCatalogRow,
  plugin: CatalogPlugin,
  installedIds: ReadonlySet<string>,
  installedVersions: ReadonlyMap<string, string>
): MarketplaceEntry {
  const version =
    plugin.source.npm?.range ?? plugin.source.git?.ref ?? plugin.source.git?.range ?? 'latest';
  return {
    id: plugin.id,
    version,
    title: plugin.displayName,
    description: plugin.description,
    author: plugin.author.name,
    icon: plugin.icon?.lucide,
    installed: installedIds.has(plugin.id),
    installedVersion: installedVersions.get(plugin.id),
    hasUpdate: false,
    compatible: true,
    source: 'marketplace',
    tags: catalog.official ? ['official'] : ['community']
  };
}

function prefer(next: MarketplaceEntry, existing: MarketplaceEntry): boolean {
  const nextOfficial = next.tags?.includes('official') === true;
  const existingOfficial = existing.tags?.includes('official') === true;
  if (nextOfficial !== existingOfficial) return nextOfficial;
  return false;
}
