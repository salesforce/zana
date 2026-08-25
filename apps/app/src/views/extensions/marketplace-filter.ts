import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';

export type MarketplaceTag = 'official' | 'community' | 'update';

export function marketplaceTags(entry: MarketplaceEntry): MarketplaceTag[] {
  const tags = new Set<MarketplaceTag>();
  if (entry.source === 'bundled' || entry.tags?.includes('official')) tags.add('official');
  if (entry.source === 'marketplace' || entry.tags?.includes('community')) tags.add('community');
  if (entry.hasUpdate) tags.add('update');
  return [...tags];
}

export function filterMarketplaceEntries(
  entries: MarketplaceEntry[],
  query: string,
  tag: MarketplaceTag | 'all' = 'all'
): MarketplaceEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (tag !== 'all' && !marketplaceTags(entry).includes(tag)) return false;
    if (!q) return true;
    const hay = [entry.title, entry.id, entry.description, entry.author, ...(entry.tags ?? [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}
