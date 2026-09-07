import { parseQuery } from './soql-ast.js';
import { clauseAtCursor, tokenBeforeCursor } from './soql-language.js';
import type { SObjectListEntry, SoqlSObjectDescribe } from '../../../lib/soql-describe.js';

export interface SoqlCompletion {
  label: string;
  insertText: string;
  detail: string;
  kind: 'sobject' | 'field' | 'relationship' | 'keyword';
}

export function soqlCompletions(args: {
  soql: string;
  cursor: number;
  catalogs: { standard: SObjectListEntry[]; tooling: SObjectListEntry[] };
  useToolingApi: boolean;
  describe?: SoqlSObjectDescribe | null;
}): SoqlCompletion[] {
  const clause = clauseAtCursor(args.soql, args.cursor);
  const prefix = tokenBeforeCursor(args.soql, args.cursor).toLowerCase();
  const ast = parseQuery(args.soql);
  if (clause === 'from') {
    const list = args.useToolingApi ? args.catalogs.tooling : args.catalogs.standard;
    return list
      .filter((row) => row.queryable && matches(row.name, prefix))
      .slice(0, 40)
      .map((row) => ({
        label: row.name,
        insertText: row.name,
        detail: row.label,
        kind: 'sobject' as const
      }));
  }
  if ((clause === 'select' || clause === 'where' || clause === 'order' || clause === 'group') && args.describe) {
    const fields = args.describe.fields
      .filter((field) => matches(field.name, prefix) || matches(field.relationshipName ?? '', prefix))
      .slice(0, 50)
      .map((field) => ({
        label: field.relationshipName && prefix.endsWith('.') ? field.relationshipName : field.name,
        insertText: field.name,
        detail: `${field.type} · ${field.label}`,
        kind: 'field' as const
      }));
    const children = args.describe.childRelationships
      .filter((rel) => matches(rel.relationshipName, prefix))
      .slice(0, 20)
      .map((rel) => ({
        label: rel.relationshipName,
        insertText: `(SELECT Id FROM ${rel.relationshipName})`,
        detail: rel.childSObject,
        kind: 'relationship' as const
      }));
    return [...fields, ...children];
  }
  if (!ast && prefix) {
    const list = args.useToolingApi ? args.catalogs.tooling : args.catalogs.standard;
    return list
      .filter((row) => matches(row.name, prefix))
      .slice(0, 20)
      .map((row) => ({
        label: row.name,
        insertText: row.name,
        detail: row.label,
        kind: 'sobject' as const
      }));
  }
  return [];
}

function matches(value: string, prefix: string): boolean {
  if (!prefix) return true;
  return value.toLowerCase().startsWith(prefix) || value.toLowerCase().includes(prefix);
}
