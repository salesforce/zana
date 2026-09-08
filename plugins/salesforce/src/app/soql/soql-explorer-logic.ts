import type { PublicOrgView } from '../../../lib/types.js';

export function emptyOrgMessage(): string {
  return 'No target org. Pick a CLI-connected org on the Salesforce tab, or set defaultOrg / SF_TARGET_ORG.';
}

export function productionBanner(org: Pick<PublicOrgView, 'alias' | 'kind'> | null): string | null {
  if (!org) return null;
  if (org.kind === 'production') {
    return `You are querying production org ${org.alias}. Reads run immediately from this panel.`;
  }
  if (org.kind === 'unknown') {
    return `Target org ${org.alias} kind is unknown. Treat results as production-sensitive.`;
  }
  return null;
}

export function orgChip(org: Pick<PublicOrgView, 'alias' | 'kind'> | null, fallbackAlias?: string): string {
  if (org) return `${org.alias} (${org.kind})`;
  return fallbackAlias?.trim() || 'No org configured';
}

export function canRun(soql: string, hasOrg: boolean, busy: boolean): boolean {
  return hasOrg && soql.trim().length > 0 && !busy;
}

export function newRequestId(): string {
  return `soql-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function confirmLoadAll(loaded: number, total: number, cap: number): string {
  return `Fetch remaining records (${loaded} of ${total})? This panel will stop at ${cap} rows.`;
}

export function confirmExport(count: number): string {
  return `Export ${count} record${count === 1 ? '' : 's'} from this result set?`;
}
