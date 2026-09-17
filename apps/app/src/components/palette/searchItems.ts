import { fuzzyScore } from '../../lib/fuzzy.js';
import { recencyBoost, type UsageMap } from '../../lib/paletteRecents.js';
import type { PaletteCategory, PaletteItem } from './buildItems.js';

export const PALETTE_SCOPES = [
  { id: 'all', label: 'All' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'projects', label: 'Projects' },
  { id: 'threads', label: 'Threads' },
  { id: 'tabs', label: 'CLI agents' },
  { id: 'commands', label: 'Commands' }
] as const;
export type PaletteScope = typeof PALETTE_SCOPES[number]['id'];
export type PaletteSection = PaletteCategory | 'Recent';
export interface ScoredRow {
  item: PaletteItem;
  labelMatchIdx?: number[];
  section: PaletteSection;
}

export const CATEGORY_LABELS: Record<PaletteSection, string> = {
  Recent: 'Recently used', Projects: 'Projects', Threads: 'Threads',
  Tabs: 'CLI agents', Actions: 'Commands', Extensions: 'Plugin commands'
};
export const CATEGORY_SCOPE: Record<PaletteCategory, PaletteScope> = {
  Projects: 'projects', Threads: 'threads', Tabs: 'tabs', Actions: 'commands', Extensions: 'commands'
};
const LANDING_CAP: Record<PaletteCategory, number> = {
  Projects: 5, Threads: 5, Tabs: 5, Actions: 6, Extensions: 5
};
export const MAX_PALETTE_RESULTS = 100;

/** Search only available items: stale usage records never resurrect a destination. */
export function searchPaletteItems(
  items: PaletteItem[], query: string, scope: PaletteScope, recents: UsageMap, now = Date.now()
): { rows: ScoredRow[]; total: number; overflow: Partial<Record<PaletteCategory, number>> } {
  const candidates = items.filter((item) => scope === 'all'
    || (scope === 'favorites' ? item.favorite : CATEGORY_SCOPE[item.category] === scope));
  const q = query.trim();
  if (q) {
    const scored = candidates.flatMap((item, idx) => {
      const labelMatch = fuzzyScore(item.label, q);
      let score = labelMatch?.score ?? -Infinity;
      let labelMatchIdx = labelMatch?.matchIdx;
      for (const term of [item.hint, ...(item.keywords ?? [])]) {
        if (!term) continue;
        const match = fuzzyScore(term, q);
        if (match && match.score * 0.5 > score) {
          score = match.score * 0.5;
          labelMatchIdx = undefined;
        }
      }
      return score === -Infinity ? [] : [{ item, idx, score, labelMatchIdx, boost: recencyBoost(item.key, recents, now) }];
    });
    scored.sort((a, b) => b.score - a.score || b.boost - a.boost || a.idx - b.idx);
    return {
      rows: scored.slice(0, MAX_PALETTE_RESULTS).map(({ item, labelMatchIdx }) => ({ item, labelMatchIdx, section: item.category })),
      total: scored.length, overflow: {}
    };
  }

  const recentItems = scope === 'all' ? candidates
    .filter((item) => recencyBoost(item.key, recents, now) > 0)
    .sort((a, b) => recents[b.key].lastUsedAt - recents[a.key].lastUsedAt)
    .slice(0, 4) : [];
  const seen = new Set(recentItems.map((item) => item.key));
  const rows: ScoredRow[] = recentItems.map((item) => ({ item, section: 'Recent' }));
  const groups = new Map<PaletteCategory, PaletteItem[]>();
  for (const item of candidates) {
    if (seen.has(item.key)) continue;
    const group = groups.get(item.category) ?? [];
    group.push(item);
    groups.set(item.category, group);
  }
  const overflow: Partial<Record<PaletteCategory, number>> = {};
  for (const [category, group] of groups) {
    group.sort((a, b) => recencyBoost(b.key, recents, now) - recencyBoost(a.key, recents, now));
    const cap = scope === 'all' ? LANDING_CAP[category] : MAX_PALETTE_RESULTS;
    if (group.length > cap) overflow[category] = group.length - cap;
    rows.push(...group.slice(0, cap).map((item) => ({ item, section: category })));
  }
  return { rows: rows.slice(0, MAX_PALETTE_RESULTS), total: candidates.length, overflow };
}
