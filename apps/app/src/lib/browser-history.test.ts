import { describe, expect, it } from 'vitest';
import { parseBrowserHistory, recordBrowserVisit } from './browser-history.js';

describe('recordBrowserVisit', () => {
  it('prepends a visit and dedupes by URL', () => {
    const first = recordBrowserVisit([], { url: 'https://a.test', title: 'A' });
    const second = recordBrowserVisit(first, { url: 'https://b.test', title: 'B' });
    const again = recordBrowserVisit(second, { url: 'https://a.test', title: 'A2' });
    expect(again.map((entry) => entry.url)).toEqual(['https://a.test', 'https://b.test']);
    expect(again[0]?.title).toBe('A2');
  });

  it('ignores empty URLs', () => {
    expect(recordBrowserVisit([], { url: '', title: null })).toEqual([]);
  });
});

describe('parseBrowserHistory', () => {
  it('drops malformed rows', () => {
    expect(parseBrowserHistory([
      { url: 'https://ok.test', title: 'Ok', visitedAt: 1 },
      { url: '', title: 'x', visitedAt: 1 },
      { title: 'no-url', visitedAt: 1 }
    ])).toEqual([{ url: 'https://ok.test', title: 'Ok', visitedAt: 1 }]);
  });
});
