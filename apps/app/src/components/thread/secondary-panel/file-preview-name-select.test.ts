import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('./file-preview-error.css', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function declarationsFor(selector: string): string[] {
  const blocks = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
  return blocks
    .filter(([, selectors]) => selectors.split(',').some(item => item.trim() === selector))
    .map(([, , body]) => body);
}

describe('file preview name selection', () => {
  it.each(['.thread-file-preview-path', '.thread-file-preview-fallback h2'])(
    'lets the user select the file name shown by %s',
    (selector) => {
      const body = declarationsFor(selector).join(';');
      expect(body).toContain('user-select: text');
      expect(body).toContain('-webkit-user-select: text');
      expect(body).toContain('cursor: text');
    }
  );
});
