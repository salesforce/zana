export interface SObjectListEntry {
  name: string;
  label: string;
  keyPrefix: string;
  queryable: boolean;
  custom: boolean;
  source: 'standard' | 'tooling';
}

export interface SoqlFieldDescribe {
  name: string;
  label: string;
  type: string;
  relationshipName: string | null;
  referenceTo: string[];
  nillable: boolean;
  updateable: boolean;
  calculated: boolean;
  sortable: boolean;
  filterable: boolean;
  length: number;
}

export interface SoqlChildRelationship {
  relationshipName: string;
  childSObject: string;
  field: string;
  deprecatedAndHidden: boolean;
}

export interface SoqlSObjectDescribe {
  name: string;
  label: string;
  keyPrefix: string;
  queryable: boolean;
  source: 'standard' | 'tooling';
  fields: SoqlFieldDescribe[];
  childRelationships: SoqlChildRelationship[];
}

export interface SoqlDescribeCatalogs {
  standard: SObjectListEntry[];
  tooling: SObjectListEntry[];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBool(value: unknown): boolean {
  return value === true;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function normalizeSObjectList(json: unknown, source: 'standard' | 'tooling'): SObjectListEntry[] {
  const rows = Array.isArray((json as { sobjects?: unknown })?.sobjects)
    ? ((json as { sobjects: unknown[] }).sobjects)
    : [];
  const out: SObjectListEntry[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const name = asString(rec.name);
    if (!name) continue;
    out.push({
      name,
      label: asString(rec.label) || name,
      keyPrefix: asString(rec.keyPrefix),
      queryable: rec.queryable !== false,
      custom: asBool(rec.custom),
      source
    });
  }
  return out;
}

export function normalizeSObjectDescribe(
  json: unknown,
  source: 'standard' | 'tooling'
): SoqlSObjectDescribe {
  const rec = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const name = asString(rec.name) || 'Unknown';
  const fields: SoqlFieldDescribe[] = [];
  const rawFields = Array.isArray(rec.fields) ? rec.fields : [];
  for (const field of rawFields) {
    if (!field || typeof field !== 'object') continue;
    const row = field as Record<string, unknown>;
    const fieldName = asString(row.name);
    if (!fieldName) continue;
    const referenceTo = Array.isArray(row.referenceTo)
      ? row.referenceTo.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [];
    fields.push({
      name: fieldName,
      label: asString(row.label) || fieldName,
      type: asString(row.type) || 'string',
      relationshipName: asString(row.relationshipName) || null,
      referenceTo,
      nillable: asBool(row.nillable),
      updateable: asBool(row.updateable),
      calculated: asBool(row.calculated),
      sortable: row.sortable !== false,
      filterable: row.filterable !== false,
      length: asNumber(row.length)
    });
  }
  const childRelationships: SoqlChildRelationship[] = [];
  const rawChildren = Array.isArray(rec.childRelationships) ? rec.childRelationships : [];
  for (const child of rawChildren) {
    if (!child || typeof child !== 'object') continue;
    const row = child as Record<string, unknown>;
    const relationshipName = asString(row.relationshipName);
    const childSObject = asString(row.childSObject);
    if (!relationshipName || !childSObject) continue;
    childRelationships.push({
      relationshipName,
      childSObject,
      field: asString(row.field),
      deprecatedAndHidden: asBool(row.deprecatedAndHidden)
    });
  }
  return {
    name,
    label: asString(rec.label) || name,
    keyPrefix: asString(rec.keyPrefix),
    queryable: rec.queryable !== false,
    source,
    fields,
    childRelationships
  };
}

export function resolveSObjectEntry(
  name: string,
  useToolingApi: boolean,
  catalogs: SoqlDescribeCatalogs
): SObjectListEntry | undefined {
  const lower = name.trim().toLowerCase();
  if (!lower) return undefined;
  const preferred = useToolingApi ? catalogs.tooling : catalogs.standard;
  const fallback = useToolingApi ? catalogs.standard : catalogs.tooling;
  return preferred.find((row) => row.name.toLowerCase() === lower)
    ?? fallback.find((row) => row.name.toLowerCase() === lower);
}

export function filterSObjectList(entries: SObjectListEntry[], term: string): SObjectListEntry[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((row) =>
    row.name.toLowerCase().includes(needle) || row.label.toLowerCase().includes(needle)
  );
}

export function globalCacheKey(orgId: string, apiVersion: string): string {
  return `soql:describe:${orgId}:${apiVersion}:global`;
}

export function sobjectCacheKey(
  orgId: string,
  apiVersion: string,
  name: string,
  useToolingApi: boolean
): string {
  const catalog = useToolingApi ? 'tooling' : 'standard';
  return `soql:describe:${orgId}:${apiVersion}:${catalog}:${name.toLowerCase()}`;
}
