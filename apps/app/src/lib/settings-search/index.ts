import { buildCorpus } from './corpus';
import { matchCorpus } from './match';
import type { SearchSettingsOptions, SettingsSearchHit, SettingsValueSnapshot } from './types';

export { registerSettingsSearchProvider, getStaticEntries } from './registry';
export { SETTINGS_SEARCH_MAX_RESULTS } from './match';
export type * from './types';

/** Ranked Settings search over the static index, runtime providers and current values. */
export function searchSettings(
  query: string,
  snapshot: SettingsValueSnapshot,
  options: SearchSettingsOptions = {}
): SettingsSearchHit[] {
  if (!query.trim()) return [];
  const corpus = buildCorpus(snapshot, options.entries, options.providers);
  const hidden = options.hiddenSections;
  const visible = hidden && hidden.size > 0
    ? { ...corpus, entries: corpus.entries.filter((row) => !hidden.has(row.entry.section)) }
    : corpus;
  return matchCorpus(visible, query, options.limit);
}
