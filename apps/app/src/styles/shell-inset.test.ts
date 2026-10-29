import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('./shell-inset.css', import.meta.url), 'utf8');

it('scopes every inset-workspace rule under the experimental shell class', () => {
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g) ?? [];
  expect(selectors.length).toBeGreaterThan(0);
  for (const group of selectors) {
    for (const selector of group.split(',')) {
      expect(selector.trim(), selector).toMatch(/\.app-shell\.shell-inset/);
    }
  }
});

it('keeps the content sheet inside the grid track', () => {
  expect(css).toMatch(/\.shell-main > \.thread-detail-view/);
  expect(css).toMatch(/height: auto;/);
  expect(css).toMatch(/margin: 0 var\(--inset-gap\) var\(--inset-gap\) 0;/);
});

it('leaves overflow to each panel so scrolling surfaces keep scrolling', () => {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  expect(body).not.toMatch(/overflow\s*:/);
});
