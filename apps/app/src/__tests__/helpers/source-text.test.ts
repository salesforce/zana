import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSourceText } from './source-text.js';

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function write(content: string): string {
  dir = mkdtempSync(join(tmpdir(), 'source-text-'));
  const file = join(dir, 'global.css');
  writeFileSync(file, content, 'utf8');
  return file;
}

describe('readSourceText', () => {
  it('normalises a CRLF checkout so LF literals still match', () => {
    const css = readSourceText(write('\r\n.project-shell {\r\n  grid-column: 2 / -1;\r\n}\r\n'));
    expect(css).toBe('\n.project-shell {\n  grid-column: 2 / -1;\n}\n');
    expect(css).toContain('.project-shell {\n  grid-column: 2 / -1;\n}');
  });

  it('leaves LF files and lone carriage returns unchanged', () => {
    expect(readSourceText(write('a\nb\rc\n'))).toBe('a\nb\rc\n');
  });
});
