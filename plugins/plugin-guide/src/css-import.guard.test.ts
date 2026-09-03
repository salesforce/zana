import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = join(here, '../plugin-guide.css');
const globalCssPath = join(here, '../../../apps/app/src/styles/global.css');

describe('plugin-guide stylesheet', () => {
  it('is the source of truth for Plugin Guide rules', () => {
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toContain('.plugin-guide-scroll');
    expect(css).toContain('.plugin-guide-copy');
  });

  it('is imported from core global.css so the app and site share one sheet', () => {
    const globalCss = readFileSync(globalCssPath, 'utf8');
    expect(globalCss).toMatch(/@import url\('\.\.\/\.\.\/\.\.\/\.\.\/plugins\/plugin-guide\/plugin-guide\.css'\);/);
    expect(globalCss).not.toContain('.plugin-guide-scroll');
  });
});
