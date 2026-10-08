import { describe, expect, it } from 'vitest';
import { MAX_FILES_PER_DOC } from './limits.js';
import { PAGE_ORIGIN, pageBaseHref, pageTargetOf, pageUrl, renderIsStale, withFetched, type RenderedPage } from './page.js';

describe('page URLs', () => {
  it('names doc files on the reserved origin, encoding each segment', () => {
    expect(pageUrl('runs/run 1/index.html')).toBe(`${PAGE_ORIGIN}/runs/run%201/index.html`);
    expect(pageBaseHref('index.html')).toBe(`${PAGE_ORIGIN}/`);
    expect(pageBaseHref('runs/a/index.html')).toBe(`${PAGE_ORIGIN}/runs/a/`);
  });

  it('maps a page URL back to a doc path and fragment', () => {
    expect(pageTargetOf(`${PAGE_ORIGIN}/runs/run%201/index.html#summary`)).toEqual({ path: 'runs/run 1/index.html', hash: 'summary' });
    expect(pageTargetOf(new URL('data.json?x=1', pageBaseHref('a/b.html')).href)).toEqual({ path: 'a/data.json', hash: null });
  });

  it('treats a folder URL as its index page', () => {
    expect(pageTargetOf(`${PAGE_ORIGIN}/`)).toEqual({ path: 'index.html', hash: null });
    expect(pageTargetOf(`${PAGE_ORIGIN}/runs/#top`)).toEqual({ path: 'runs/index.html', hash: 'top' });
  });

  it('refuses other origins, bad escapes and invalid doc paths', () => {
    expect(pageTargetOf('https://example.com/index.html')).toBeNull();
    expect(pageTargetOf('not a url')).toBeNull();
    expect(pageTargetOf(`${PAGE_ORIGIN}/a%E0%A4%A.html`)).toBeNull();
    expect(pageTargetOf(`${PAGE_ORIGIN}/.git/config`)).toBeNull();
    expect(pageTargetOf(`${PAGE_ORIGIN}/a.html#%E0%A4%A`)).toEqual({ path: 'a.html', hash: '%E0%A4%A' });
  });
});

describe('renderIsStale', () => {
  const page: RenderedPage = {
    docId: 'd',
    path: 'a.html',
    revision: 2,
    html: '',
    deps: [
      { path: 'site.css', revision: 1 },
      { path: 'zcc-kit/site.js', revision: 0 }
    ],
    missing: ['gone.js'],
    warnings: [],
    styled: true
  };
  const meta = (path: string, revision: number) => ({ path, revision });

  it('is fresh while nothing the render read has changed', () => {
    expect(renderIsStale(page, [meta('a.html', 2), meta('site.css', 1), meta('other.md', 9)], false)).toBe(false);
  });

  it('notices a new save, a changed file, a doc file over the kit, and a file that appeared', () => {
    expect(renderIsStale(page, [meta('a.html', 3), meta('site.css', 1)], false)).toBe(true);
    expect(renderIsStale(page, [meta('site.css', 1)], false)).toBe(true);
    expect(renderIsStale(page, [meta('a.html', 2), meta('site.css', 2)], false)).toBe(true);
    expect(renderIsStale(page, [meta('a.html', 2), meta('site.css', 1), meta('zcc-kit/site.js', 1)], false)).toBe(true);
    expect(renderIsStale(page, [meta('a.html', 2), meta('site.css', 1), meta('gone.js', 1)], false)).toBe(true);
  });

  it('ignores the saved page under a draft', () => {
    expect(renderIsStale(page, [meta('a.html', 7), meta('site.css', 1)], true)).toBe(false);
  });
});

describe('withFetched', () => {
  it('adds the files a page fetched after what the render read, once each', () => {
    const deps = [{ path: 'site.css', revision: 1 }];
    expect(withFetched(deps, new Map())).toEqual(deps);
    expect(
      withFetched(
        deps,
        new Map([
          ['data/runs.csv', 3],
          ['site.css', 9],
          ['later.json', 0]
        ])
      )
    ).toEqual([
      { path: 'site.css', revision: 1 },
      { path: 'data/runs.csv', revision: 3 },
      { path: 'later.json', revision: 0 }
    ]);
  });

  it('stops at the number of files a doc can have', () => {
    const deps = Array.from({ length: MAX_FILES_PER_DOC - 1 }, (_, index) => ({ path: `f${index}.css`, revision: 1 }));
    const all = withFetched(deps, new Map([['a.json', 1], ['b.json', 1]]));
    expect(all).toHaveLength(MAX_FILES_PER_DOC);
    expect(all.at(-1)).toEqual({ path: 'a.json', revision: 1 });
  });
});
