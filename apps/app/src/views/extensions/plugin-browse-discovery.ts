import {
  PLUGIN_STORE_CATEGORIES,
  resolvePluginStoreCategory,
  type PluginStoreCategoryName
} from '@zana-ai/zcc-domain';
import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';

export const UNCATEGORIZED_PLUGIN_CATEGORY_ID = 'uncategorized';
export const SHELF_ENTRY_LIMIT = 6;

export type PluginBrowseSort = 'name' | null;
export type PluginBrowseSortDirection = 'asc' | 'desc';

export interface PluginBrowseShelf {
  key: string;
  category?: PluginStoreCategoryName;
  label: string;
  description?: string;
  entries: MarketplaceEntry[];
}

export function pluginCategoryFilterId(entry: MarketplaceEntry): string {
  return resolvePluginStoreCategory(entry.category) ?? UNCATEGORIZED_PLUGIN_CATEGORY_ID;
}

export function pluginBrowseShelves(entries: readonly MarketplaceEntry[]): PluginBrowseShelf[] {
  const byCategory = new Map<string, MarketplaceEntry[]>();
  const uncategorized: MarketplaceEntry[] = [];
  for (const entry of entries) {
    const category = resolvePluginStoreCategory(entry.category);
    if (!category) {
      uncategorized.push(entry);
      continue;
    }
    const bucket = byCategory.get(category);
    if (bucket) bucket.push(entry);
    else byCategory.set(category, [entry]);
  }
  const shelves: PluginBrowseShelf[] = [];
  for (const category of PLUGIN_STORE_CATEGORIES) {
    const shelfEntries = byCategory.get(category.name);
    if (!shelfEntries || shelfEntries.length === 0) continue;
    shelves.push({
      key: `category:${category.name}`,
      category: category.name,
      label: category.name,
      description: category.description,
      entries: shelfEntries
    });
  }
  if (uncategorized.length > 0) {
    shelves.push({
      key: `category:${UNCATEGORIZED_PLUGIN_CATEGORY_ID}`,
      label: 'More plugins',
      description: 'Plugins that are not in a curated store category.',
      entries: uncategorized
    });
  }
  return shelves;
}

export function shelfPreviewEntries(
  entries: readonly MarketplaceEntry[],
  expanded: boolean
): MarketplaceEntry[] {
  return expanded ? [...entries] : entries.slice(0, SHELF_ENTRY_LIMIT);
}

export function sortPluginEntries(
  entries: readonly MarketplaceEntry[],
  sort: Exclude<PluginBrowseSort, null>,
  direction: PluginBrowseSortDirection
): MarketplaceEntry[] {
  const copy = [...entries];
  copy.sort((left, right) => {
    const result = (left.title || left.id).localeCompare(right.title || right.id);
    return direction === 'desc' ? -result : result;
  });
  return copy;
}

export function pluginCategoryFilterOptions(
  entries: readonly MarketplaceEntry[],
  selected: readonly string[]
): Array<{ id: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const entry of entries) {
    const id = pluginCategoryFilterId(entry);
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (!labels.has(id)) {
      labels.set(
        id,
        id === UNCATEGORIZED_PLUGIN_CATEGORY_ID
          ? 'More plugins'
          : (resolvePluginStoreCategory(entry.category) ?? id)
      );
    }
  }
  const known = PLUGIN_STORE_CATEGORIES.map((category) => category.name).filter((id) =>
    counts.has(id)
  );
  const extra = [...counts.keys()].filter(
    (id) => id === UNCATEGORIZED_PLUGIN_CATEGORY_ID || !known.includes(id as PluginStoreCategoryName)
  );
  const ordered = [...known, ...extra.filter((id) => !known.includes(id as PluginStoreCategoryName))];
  for (const id of selected) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered.map((id) => ({
    id,
    label: labels.get(id) ?? (id === UNCATEGORIZED_PLUGIN_CATEGORY_ID ? 'More plugins' : id),
    count: counts.get(id) ?? 0
  }));
}

export function authorKey(author: string | undefined): string {
  return (author ?? '').trim().toLowerCase();
}

export function entriesByAuthor(
  entries: readonly MarketplaceEntry[],
  key: string
): MarketplaceEntry[] {
  const wanted = key.trim().toLowerCase();
  if (!wanted) return [];
  return entries.filter((entry) => authorKey(entry.author) === wanted);
}

export function authorDisplayName(entries: readonly MarketplaceEntry[], key: string): string {
  const wanted = key.trim().toLowerCase();
  for (const entry of entries) {
    const name = entry.author?.trim();
    if (name && name.toLowerCase() === wanted) return name;
  }
  return key;
}
