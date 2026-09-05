export type SoqlFieldNode =
  | { kind: 'field'; path: string }
  | { kind: 'subquery'; relationshipName: string; fields: string[] };

export interface SoqlAst {
  fields: SoqlFieldNode[];
  sObject?: string;
  tail: string;
}

const SELECT_RE = /^\s*SELECT\s+/i;

export function isQueryValid(soql: string): boolean {
  return Boolean(parseQuery(soql));
}

export function parseQuery(soql: string): SoqlAst | null {
  const trimmed = soql.trim();
  if (!trimmed || !SELECT_RE.test(trimmed)) return null;
  const afterSelect = trimmed.replace(SELECT_RE, '');
  const fromAt = indexOfTopLevel(afterSelect, /\s+FROM\s+/i);
  if (fromAt < 0) return null;
  const selectList = afterSelect.slice(0, fromAt);
  const afterFrom = afterSelect.slice(fromAt).replace(/^\s+FROM\s+/i, '');
  const sObjectMatch = afterFrom.match(/^([A-Za-z][\w]*)\b([\s\S]*)$/);
  if (!sObjectMatch) return null;
  const fields = parseSelectList(selectList);
  if (!fields) return null;
  return {
    fields,
    sObject: sObjectMatch[1],
    tail: (sObjectMatch[2] ?? '').trim()
  };
}

function indexOfTopLevel(text: string, pattern: RegExp): number {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    if (depth !== 0) continue;
    const slice = text.slice(i);
    const match = slice.match(pattern);
    if (match && match.index === 0) return i;
  }
  return -1;
}

export function composeQuery(ast: SoqlAst): string {
  const select = ast.fields.map(composeField).join(', ');
  const from = ast.sObject ? ` FROM ${ast.sObject}` : '';
  const tail = ast.tail ? ` ${ast.tail}` : '';
  return `SELECT ${select}${from}${tail}`.trim();
}

export function formatQuery(soql: string): string {
  const ast = parseQuery(soql);
  if (!ast) return soql;
  const fieldLines = ast.fields.map((field) => `  ${composeField(field)}`).join(',\n');
  const tail = ast.tail ? `\n${wrapTail(ast.tail)}` : '';
  const from = ast.sObject ? `\nFROM ${ast.sObject}` : '';
  return `SELECT\n${fieldLines}${from}${tail}`.trim();
}

export function flattenedFieldPaths(ast: SoqlAst): string[] {
  return ast.fields.flatMap((field) => {
    if (field.kind === 'field') return [field.path];
    return field.fields.map((name) => `${field.relationshipName}.${name}`);
  });
}

function composeField(field: SoqlFieldNode): string {
  if (field.kind === 'field') return field.path;
  const inner = field.fields.length ? field.fields.join(', ') : 'Id';
  return `(SELECT ${inner} FROM ${field.relationshipName})`;
}

function wrapTail(tail: string): string {
  return tail
    .replace(/\s+WHERE\s+/i, '\nWHERE ')
    .replace(/\s+ORDER BY\s+/i, '\nORDER BY ')
    .replace(/\s+GROUP BY\s+/i, '\nGROUP BY ')
    .replace(/\s+LIMIT\s+/i, '\nLIMIT ')
    .replace(/\s+OFFSET\s+/i, '\nOFFSET ')
    .replace(/\s+ALL ROWS\s*$/i, '\nALL ROWS')
    .trim();
}

function parseSelectList(raw: string): SoqlFieldNode[] | null {
  const fields: SoqlFieldNode[] = [];
  let depth = 0;
  let current = '';
  for (const char of raw) {
    if (char === '(') {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ')') {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }
    if (char === ',' && depth === 0) {
      const node = parseField(current);
      if (!node) return null;
      fields.push(node);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    const node = parseField(current);
    if (!node) return null;
    fields.push(node);
  }
  return fields.length > 0 ? fields : null;
}

function parseField(raw: string): SoqlFieldNode | null {
  const text = raw.trim();
  if (!text) return null;
  const sub = text.match(/^\(\s*SELECT\s+([\s\S]+?)\s+FROM\s+([A-Za-z][\w]*)\s*\)$/i);
  if (sub) {
    const inner = (sub[1] ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    return { kind: 'subquery', relationshipName: sub[2] ?? '', fields: inner.length ? inner : ['Id'] };
  }
  if (/^[A-Za-z][\w.]*(?:\s+toLabel\([^)]+\))?$/i.test(text) || /^[A-Za-z][\w.]*$/.test(text)) {
    return { kind: 'field', path: text };
  }
  // Keep functions / aliases as opaque field paths so format doesn't drop them.
  return { kind: 'field', path: text };
}
