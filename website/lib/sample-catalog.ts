import type { CatalogEntry } from './registry';

/**
 * Bundled fallback catalog, drawn from first-party plugins shipped in the
 * repo (bundled-extensions/*). Shown when NEXT_PUBLIC_REGISTRY_URL is unset or
 * the live feed is unreachable, so the marketplace is never an empty shell.
 */
export const SAMPLE_CATALOG: CatalogEntry[] = [
  {
    id: 'zana',
    version: '0.1.0',
    title: 'Zana',
    description: 'Per-project tickets board.',
    author: 'Zana',
    icon: 'Ticket',
    permissions: ['mcp'],
    versions: ['0.1.0']
  }
];
