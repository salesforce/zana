import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'DocPreview.tsx'),
  'utf8'
);

describe('DocPreview path gate', () => {
  it('loads markdown and code through library.read without requiring absPath', () => {
    expect(source).toContain("product.library");
    expect(source).toMatch(/doc\.kind === 'md' \|\| doc\.kind === 'code'/);
    expect(source).toContain('.read(doc.scope ?? \'global\', doc.relPath, doc.projectId)');
    // Binary viewers still need a host absPath; text preview must not share that gate.
    const absPathGate = source.indexOf("setError('No absolute path available')");
    const textBranch = source.indexOf("if (doc.kind === 'md' || doc.kind === 'code')");
    expect(absPathGate).toBeGreaterThan(textBranch);
  });
});

describe('library document scroll pane', () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../styles/global.css'),
    'utf8'
  );

  it('keeps the preview inside a bounded flex pane that owns overflow', () => {
    expect(css).toMatch(/\.library-view\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/);
    expect(css).toMatch(
      /\.library-md-pane\s*>\s*\.explorer-md-preview\s*\{[^}]*flex:\s*1 1 0%;[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/
    );
    expect(css).toMatch(
      /\.library-md-pane\s*>\s*\.library-md-editor\s*,\s*\.library-md-pane\s*>\s*\.explorer-viewer-monaco\s*\{[^}]*flex:\s*1 1 0%;[^}]*min-height:\s*0;/
    );
    expect(css).toMatch(/\.module-panel-host\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/);
  });
});

describe('library markdown edit surfaces', () => {
  it('defaults edit to the WYSIWYG editor and keeps Monaco behind Source', () => {
    expect(source).toContain('LibraryMarkdownEditor');
    expect(source).toContain("editSurface === 'rich'");
    expect(source).toContain("setEditSurface('source')");
    expect(source).toContain('onMount={registerEditor}');
    expect(source).toMatch(/<span>Rich<\/span>/);
    expect(source).toMatch(/<span>Source<\/span>/);
  });
});
