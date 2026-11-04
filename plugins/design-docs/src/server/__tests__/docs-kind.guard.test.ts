import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

function violations(text: string): string[] {
  // Parsing separates comments from literals, including nested template expressions.
  const source = parse(text, { sourceType: 'module', plugins: ['typescript'] });
  const failures: string[] = [];
  type Node = { type: string; start?: number | null; end?: number | null; value?: unknown;
    leadingComments?: Array<{ value: string }>; [key: string]: unknown };
  function annotated(nodes: Node[], annotation: RegExp): boolean {
    return nodes.some((node) => node.leadingComments?.some((comment) => annotation.test(comment.value)));
  }
  function visit(node: Node, ancestors: Node[]): void {
    const chain = [...ancestors, node];
    if (node.type === 'StringLiteral' || node.type === 'TemplateLiteral') {
      const sql = node.type === 'TemplateLiteral' ? text.slice(node.start! + 1, node.end! - 1) : String(node.value);
      if (/\b(?:SELECT|UPDATE|DELETE|INSERT|CREATE|ALTER)\b/i.test(sql)
        && !annotated(chain, /docs-kind: allow\s+\S/)) {
        if (/\b(?:FROM|UPDATE|JOIN)\s+docs\b/i.test(sql)
          && !/\bkind\s*(?:=|IN\s*\()|\b(?:DOC_ONLY|TEMPLATE_ONLY)\b/i.test(sql)) {
          failures.push(`line ${text.slice(0, node.start!).split('\n').length}: docs query lacks kind predicate`);
        }
        if (/\bdoc_files\b/i.test(sql)) {
          const method = [...ancestors].reverse().find((parent) => ['ClassMethod', 'FunctionDeclaration'].includes(parent.type));
          if (!method || !annotated([method], /docs-kind: id-checked\b/)
            || !/\b(?:requireRow|requireTemplate)\s*\(/.test(text.slice(method.start!, method.end!))) {
            failures.push(`line ${text.slice(0, node.start!).split('\n').length}: doc_files query lacks checked id`);
          }
        }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key.endsWith('Comments') || key === 'comments' || key === 'tokens') continue;
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === 'object' && typeof child.type === 'string') visit(child as Node, chain);
      }
    }
  }
  visit(source as unknown as Node, []);
  return failures;
}

describe('docs kind query guard', () => {
  it('checks every production server source', () => {
    const directory = fileURLToPath(new URL('../', import.meta.url));
    const failures = readdirSync(directory).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .flatMap((name) => violations(readFileSync(`${directory}/${name}`, 'utf8')).map((failure) => `${name}: ${failure}`));
    expect(failures).toEqual([]);
  });

  it('rejects unfiltered docs and unannotated file queries', () => {
    expect(violations("db.prepare('SELECT * FROM docs')")).toHaveLength(1);
    expect(violations("db.prepare('SELECT * FROM doc_files WHERE doc_id = ?')")).toHaveLength(1);
    expect(violations("db.prepare('UPDATE docs SET title = ? WHERE id = ?')")).toHaveLength(1);
    expect(violations("// kind = 'doc'\ndb.prepare('SELECT * FROM docs')")).toHaveLength(1);
  });

  it('accepts literal and interpolated predicates and bounded explicit exceptions', () => {
    expect(violations("db.prepare(\"SELECT * FROM docs WHERE kind = 'doc'\")")).toEqual([]);
    expect(violations('db.prepare(`SELECT * FROM docs WHERE ${DOC_ONLY}`)')).toEqual([]);
    expect(violations('db.prepare(`SELECT * FROM docs WHERE ${TEMPLATE_ONLY}`)')).toEqual([]);
    expect(violations("// docs-kind: allow Historical migration.\ndb.prepare('SELECT * FROM docs')")).toEqual([]);
    expect(violations("class Store {\n// docs-kind: id-checked\nread(ref: string) { const row = this.requireRow(ref); return db.prepare('SELECT * FROM doc_files WHERE doc_id = ?').get(row.id); }}")).toEqual([]);
    expect(violations("class Store {\n// docs-kind: id-checked\nread(ref: string) { return db.prepare('SELECT * FROM doc_files WHERE doc_id = ?').get(ref); }}")).toHaveLength(1);
  });
});
