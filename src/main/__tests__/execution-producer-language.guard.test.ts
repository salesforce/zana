import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function typescriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return typescriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('execution producer language guard', () => {
  it('keeps core execution and coordinator code producer-agnostic', () => {
    const root = join(process.cwd(), 'src/main');
    const files = [
      join(root, 'index.ts'),
      join(root, 'execution-mcp-tool.ts'),
      ...typescriptFiles(join(root, 'execution')),
      ...typescriptFiles(join(root, 'launch'))
    ];
    const forbiddenProducerTerms = [
      'Doc' + ' Execute',
      'Doc' + 'Execute',
      'doc' + '-execute'
    ];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const term of forbiddenProducerTerms) expect(source, file).not.toContain(term);
      expect(source, file).not.toMatch(/\bPath [AB]\b/);
    }
  });
});
