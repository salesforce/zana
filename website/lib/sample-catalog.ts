import type { CatalogEntry } from './registry';

/**
 * Bundled fallback catalog, drawn from first-party plugins shipped in the
 * repo (`plugins/*`). Shown when NEXT_PUBLIC_REGISTRY_URL is unset or
 * the live feed is unreachable, so the marketplace is never an empty shell.
 */
export const SAMPLE_CATALOG: CatalogEntry[] = [
  {
    id: 'docs',
    version: '0.1.0',
    title: 'Docs',
    description: 'Durable project knowledge: Docs rail, per-project Library, and the library-curator skill',
    author: 'Zana',
    icon: 'Library',
    permissions: [],
    versions: ['0.1.0']
  }
];
