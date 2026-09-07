import { composeQuery, parseQuery, type SoqlAst, type SoqlFieldNode } from './soql-ast.js';

function stripManagedNamespace(segment: string): string {
  const first = segment.indexOf('__');
  if (first === -1) return segment;
  const second = segment.indexOf('__', first + 2);
  if (second === -1) return segment;
  return segment.slice(first + 2);
}

export function normalizeApiPath(value: string): string {
  return value
    .split('.')
    .map((segment) => stripManagedNamespace(segment))
    .join('.');
}

export function seedQueryForSObject(sObject: string, existing: string): string {
  const ast = parseQuery(existing);
  if (!existing.trim()) return `SELECT Id FROM ${sObject}`;
  if (!ast) return existing;
  return composeQuery({ ...ast, sObject });
}

export function toggleField(soql: string, fieldPath: string): string {
  const ast = parseQuery(soql) ?? { fields: [{ kind: 'field', path: 'Id' }], tail: '' };
  const needle = normalizeApiPath(fieldPath);
  const nextFields = ast.fields.some(
    (field) => field.kind === 'field' && normalizeApiPath(field.path) === needle
  )
    ? ast.fields.filter((field) => !(field.kind === 'field' && normalizeApiPath(field.path) === needle))
    : [...ast.fields, { kind: 'field' as const, path: fieldPath }];
  return composeQuery({ ...ast, fields: nextFields.length ? nextFields : [{ kind: 'field', path: 'Id' }] });
}

export function toggleChildField(soql: string, relationshipName: string, fieldName: string): string {
  const ast = parseQuery(soql) ?? { fields: [{ kind: 'field', path: 'Id' }], tail: '' };
  const rel = normalizeApiPath(relationshipName);
  const existing = ast.fields.find(
    (field): field is Extract<SoqlFieldNode, { kind: 'subquery' }> =>
      field.kind === 'subquery' && normalizeApiPath(field.relationshipName) === rel
  );
  let fields: SoqlFieldNode[];
  if (!existing) {
    fields = [...ast.fields, { kind: 'subquery', relationshipName, fields: [fieldName] }];
  } else {
    const has = existing.fields.some((name) => normalizeApiPath(name) === normalizeApiPath(fieldName));
    const inner = has
      ? existing.fields.filter((name) => normalizeApiPath(name) !== normalizeApiPath(fieldName))
      : [...existing.fields, fieldName];
    fields = ast.fields
      .map((field) => {
        if (field !== existing) return field;
        if (inner.length === 0) return null;
        return { ...field, fields: inner };
      })
      .filter((field): field is SoqlFieldNode => field !== null);
  }
  return composeQuery({ ...ast, fields });
}

export function selectedFieldSet(ast: SoqlAst | null): Set<string> {
  const out = new Set<string>();
  if (!ast) return out;
  for (const field of ast.fields) {
    if (field.kind === 'field') out.add(normalizeApiPath(field.path));
    else {
      out.add(`sub:${normalizeApiPath(field.relationshipName)}`);
      for (const name of field.fields) {
        out.add(`sub:${normalizeApiPath(field.relationshipName)}.${normalizeApiPath(name)}`);
      }
    }
  }
  return out;
}

export function insertSnippet(soql: string, snippet: string, cursor: number): { soql: string; cursor: number } {
  const before = soql.slice(0, cursor);
  const after = soql.slice(cursor);
  const needsComma = /[A-Za-z0-9_)]$/.test(before.trimEnd()) && !/^\s*,/.test(after);
  const prefix = needsComma ? ', ' : before.endsWith(' ') || before.length === 0 ? '' : ' ';
  const next = `${before}${prefix}${snippet}${after}`;
  return { soql: next, cursor: before.length + prefix.length + snippet.length };
}
