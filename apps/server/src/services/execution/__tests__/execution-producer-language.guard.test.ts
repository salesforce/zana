import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const __filename = fileURLToPath(import.meta.url);

function typescriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && entry.name === '__tests__') return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return typescriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('execution producer language guard', () => {
  it('keeps core execution and coordinator code producer-agnostic', () => {
    // Old monolith scanned src/main/index.ts + execution-mcp-tool.ts + the
    // execution/ and launch/ dirs (implementation code only — tests lived in a
    // sibling src/main/__tests__/ dir, never nested inside execution/ or
    // launch/). In the monorepo, execution-mcp-tool.ts moved inside
    // apps/server/src/services/execution/ (covered by that dir's own scan,
    // which now also holds this guard's own __tests__/ dir); its registration
    // call site (the index.ts analog for this guard's purpose) is
    // apps/server/src/services/mcp/mcp-server.ts. typescriptFiles() skips
    // __tests__ subdirectories entirely so this guard keeps scanning only
    // production code, not sibling test fixtures (e.g. the consumer-separation
    // guard's own banned-term string literals).
    const executionRoot = join(__dirname, '..');
    const launchRoot = join(__dirname, '../../launch');
    const mcpServerFile = join(__dirname, '../../mcp/mcp-server.ts');
    const files = [
      mcpServerFile,
      ...typescriptFiles(executionRoot),
      ...typescriptFiles(launchRoot)
    ].filter((path) => path !== __filename);
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
