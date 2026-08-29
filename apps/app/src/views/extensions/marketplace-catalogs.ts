import type { MarketplaceCatalogRow } from '@zana-ai/zcc-domain';

export function catalogKindLabel(kind: MarketplaceCatalogRow['sourceKind']): string {
  if (kind === 'git') return 'git';
  if (kind === 'path') return 'path';
  return 'https';
}

export function catalogCountLabel(row: MarketplaceCatalogRow): string {
  const n = row.entryCount;
  return n === 1 ? '1 plugin' : `${n} plugins`;
}

export function catalogErrorText(row: MarketplaceCatalogRow): string | null {
  const error = row.lastError?.trim();
  return error ? error : null;
}
