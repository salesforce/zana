import type { SettingsSearchEntry } from '../types';

// Intentionally empty: the page has no settings rows. It is found through its derived
// section entry; squad names and descriptions come from providers/catalogues.ts. The
// completeness guard requires every page to declare its entries, so the file stays.
export const entries: readonly SettingsSearchEntry[] = [];

export default entries;
