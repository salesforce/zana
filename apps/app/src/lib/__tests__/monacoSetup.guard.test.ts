import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Monaco 0.56 workers have no default export. Vite 8 prebundles
 * `monaco-editor/esm/vs/...` (especially behind a filesystem alias, or when
 * the importer is outside the renderer root) into `.vite/deps` modules with
 * no `default`. Pin package-export `?worker` constructors and a renderer-root
 * Docs module.
 */
describe('monacoSetup worker imports', () => {
  const src = readFileSync(fileURLToPath(new URL('../monacoSetup.ts', import.meta.url)), 'utf8');
  const modulesIndex = readFileSync(
    fileURLToPath(new URL('../../modules/index.ts', import.meta.url)),
    'utf8'
  );

  it('loads monaco workers via package-export ?worker constructors', () => {
    expect(src).toMatch(/monaco-editor\/editor\/editor\.worker\.js\?worker/);
    expect(src).toMatch(/monaco-editor\/language\/css\/css\.worker\.js\?worker/);
    expect(src).not.toMatch(/from ['"]monaco-editor\/esm\/vs/);
    expect(src).not.toMatch(/\?url/);
  });

  it('does not statically import Docs UI from outside the Vite renderer root', () => {
    const imports = [...modulesIndex.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports).toContain('../views/library/module.js');
    expect(imports.some((s) => s.includes('plugins/docs'))).toBe(false);
  });
});
