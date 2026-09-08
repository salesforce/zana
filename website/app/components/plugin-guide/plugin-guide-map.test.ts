import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProductMap } from '../../../lib/plugin-guide/product-map.tsx';
import { hrefForSlide, slideIdFromHash } from './slide-hash.ts';

describe('plugin guide slide hash', () => {
  it('resolves known group ids and ignores page anchors', () => {
    expect(slideIdFromHash('#app-shell')).toBe('app-shell');
    expect(slideIdFromHash('#headless')).toBe('headless');
    expect(slideIdFromHash('#permissions')).toBeNull();
    expect(slideIdFromHash('')).toBeNull();
  });

  it('keeps the current path when writing a slide hash', () => {
    expect(hrefForSlide('app-shell', 'http://localhost:4321/extensions/')).toBe(
      '/extensions/#app-shell'
    );
    expect(hrefForSlide('thread', 'http://localhost:4321/extensions/?x=1')).toBe(
      '/extensions/?x=1#thread'
    );
  });
});

describe('Plugin Guide map markup', () => {
  it('renders carousel chrome for App shell and Platform', () => {
    const html = renderToStaticMarkup(createElement(ProductMap));
    expect(html).toContain('aria-label="Plugin surfaces"');
    expect(html).toContain('App shell');
    expect(html).toContain('Platform');
  });
});

describe('website Plugin Guide viewport', () => {
  it('lets the page scroll instead of trapping the map in an inner pane', () => {
    const css = readFileSync(new URL('./plugin-guide-site.css', import.meta.url), 'utf8');
    expect(css).toMatch(/overflow:\s*visible/);
    expect(css).toMatch(/height:\s*auto/);
  });
});
