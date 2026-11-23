import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../../..');
const rule = (css: string, selector: string) => css.slice(css.indexOf(`${selector} {`)).split('}')[0];

describe('editor find layout assumptions', () => {
  it('keeps the shared find bar absolutely positioned at the right, which the split-mode offset relies on', () => {
    const bar = rule(readFileSync(resolve(ROOT, 'apps/app/src/styles/global.css'), 'utf8'), '.dom-find-bar');
    expect(bar).toMatch(/position:\s*absolute/u);
    expect(bar).toMatch(/right:\s*20px/u);
  });

  it('offsets the bar over the text pane in split mode and anchors it to the editor body', () => {
    const styles = readFileSync(resolve(ROOT, 'plugins/design-docs/src/app/styles.ts'), 'utf8');
    expect(styles).toContain('.dd-editor-split .dd-editor-find .dom-find-bar { right: calc(50% + 20px); }');
    expect(rule(styles, '.dd-editor-body')).toMatch(/position:\s*relative/u);
  });

  it('keeps the split-mode textarea transparent while find is open, so the highlight backdrop shows', () => {
    const styles = readFileSync(resolve(ROOT, 'plugins/design-docs/src/app/styles.ts'), 'utf8');
    const opaque = styles.indexOf('.dd-editor-split .dd-editor-input {');
    const transparent = styles.indexOf('.dd-editor-split .dd-editor-field-find .dd-editor-input { background: transparent; }');
    expect(opaque).toBeGreaterThan(-1);
    expect(transparent).toBeGreaterThan(opaque);
    expect(styles).toContain('.dd-editor-split .dd-editor-backdrop { border-right: 1px solid transparent; }');
  });
});
