import type { SettingsSearchEntry } from '../types';

// Intentionally empty: the page is a read-only activity rollup with no settings rows;
// it is found through its derived section entry. The completeness guard requires every
// page to declare its entries, so the file stays.
export const entries: readonly SettingsSearchEntry[] = [];

export default entries;
