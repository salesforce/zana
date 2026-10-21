import type { HubRow } from './installed-plugins.js';
import { rowEnabled } from './installed-plugins.js';
import { pluginAvailableVersion } from './plugin-row-update.js';

export type InstalledStatusFilter = 'all' | 'enabled' | 'disabled';

export function filterCollectionRows(rows: HubRow[], status: InstalledStatusFilter, updatesOnly: boolean): HubRow[] {
  return rows.filter((row) =>
    (status === 'all' || rowEnabled(row) === (status === 'enabled')) &&
    (!updatesOnly || pluginAvailableVersion(row) !== null)
  );
}

export function groupInstalledRows(rows: HubRow[]): { tools: HubRow[]; agents: HubRow[] } {
  const tools: HubRow[] = [];
  const agents: HubRow[] = [];
  for (const row of rows) {
    (row.plugin?.collection === 'coding-agents' ? agents : tools).push(row);
  }
  return { tools, agents };
}

/** Stable decoration only: no catalogue of concrete plugins in core. */
export function installedIconTone(id: string): string {
  const tones = ['lavender', 'blue', 'sand', 'mint', 'rose', 'slate'];
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return tones[hash % tones.length]!;
}

/** Only same-origin installed assets; asset serving owns realpath confinement. */
export function installedIconUrl(row: HubRow): string | null {
  const icon = row.plugin?.icon;
  if (!icon || !/\.(svg|png|webp|jpe?g|gif)$/i.test(icon)) return null;
  const relative = icon.replace(/^\.\//, '');
  const segments = relative.split('/');
  if (relative.includes('\\') || relative.includes(':') || segments.some((s) => !s || s === '.' || s === '..')) return null;
  return `/plugins/${encodeURIComponent(row.plugin!.id)}/assets/${segments.map(encodeURIComponent).join('/')}`;
}
