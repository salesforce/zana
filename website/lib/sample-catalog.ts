import type { CatalogEntry } from './registry';

/**
 * Bundled fallback catalog, drawn from the example extensions shipped in the
 * repo (examples/extensions/*). Shown when NEXT_PUBLIC_REGISTRY_URL is unset or
 * the live feed is unreachable, so the marketplace is never an empty shell.
 */
export const SAMPLE_CATALOG: CatalogEntry[] = [
  {
    id: 'consensus',
    version: '0.1.0',
    title: 'Consensus',
    description: 'A per-project tab for settled council decisions — multi-voice deliberation made durable.',
    author: 'Zana',
    icon: 'Scale',
    permissions: ['inbox:push'],
    versions: ['0.1.0']
  }
];
