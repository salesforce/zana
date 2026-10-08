import { describe, expect, it } from 'vitest';
import { isPageHello, MAX_PAGE_STORAGE_CHARS, PAGE_HELLO, parseFromPage } from './frame-protocol.js';
import { MAX_QUOTE_LENGTH } from './limits.js';

describe('parseFromPage', () => {
  it('accepts every well-formed message', () => {
    const messages = [
      { type: 'ready' },
      { type: 'fetch', id: 3, path: 'data/runs.json' },
      { type: 'navigate', path: 'runs/a.html', hash: 'top', newTab: false, redirect: true },
      { type: 'navigate', path: 'b.html', hash: null, newTab: true, redirect: false },
      { type: 'open', url: 'https://example.com/' },
      { type: 'problem', problem: { kind: 'error', message: 'boom', source: 'app.js', line: 4 } },
      { type: 'selection', text: 'quoted', rect: { top: 1, left: 2, bottom: 3, right: 4 } },
      { type: 'selection', text: '', rect: null },
      { type: 'anchors', found: ['a'], missing: [] },
      { type: 'focused', quote: 'a', found: true },
      { type: 'scroll', x: 0, y: 120.5 },
      { type: 'hash', hash: 'run=a/b' },
      { type: 'hash', hash: null },
      { type: 'storage', entries: { theme: 'dark' } }
    ];
    for (const message of messages) expect(parseFromPage(message)).toEqual(message);
  });

  it('keeps only the fields it knows', () => {
    expect(parseFromPage({ type: 'ready', extra: 1 })).toEqual({ type: 'ready' });
    expect(parseFromPage({ type: 'navigate', path: 'a.html', hash: null, newTab: false })).toEqual({
      type: 'navigate',
      path: 'a.html',
      hash: null,
      newTab: false,
      redirect: false
    });
    expect(parseFromPage({ type: 'navigate', path: 'a.html', hash: null, newTab: false, redirect: 'yes' })).toMatchObject({ redirect: false });
  });

  it('bounds and tidies problems', () => {
    const parsed = parseFromPage({ type: 'problem', problem: { kind: 'missing', message: 'x'.repeat(900), source: 'y'.repeat(2000), line: 3.7 } });
    expect(parsed).toEqual({ type: 'problem', problem: { kind: 'missing', message: 'x'.repeat(500), source: 'y'.repeat(1000), line: 3 } });
    expect(parseFromPage({ type: 'problem', problem: { kind: 'blocked', message: 'm', source: '', line: 0 } })).toEqual({
      type: 'problem',
      problem: { kind: 'blocked', message: 'm' }
    });
    expect(parseFromPage({ type: 'problem', problem: { kind: 'blocked', message: 'm', line: Infinity } })).toEqual({
      type: 'problem',
      problem: { kind: 'blocked', message: 'm' }
    });
  });

  it('clips long selections', () => {
    expect(parseFromPage({ type: 'selection', text: 's'.repeat(MAX_QUOTE_LENGTH + 10), rect: null })).toEqual({
      type: 'selection',
      text: 's'.repeat(MAX_QUOTE_LENGTH),
      rect: null
    });
  });

  it('rejects anything malformed', () => {
    const quotes = Array.from({ length: 501 }, () => 'q');
    const rejected: unknown[] = [
      null,
      'ready',
      [],
      { type: 'nope' },
      { type: 'fetch', id: -1, path: 'a' },
      { type: 'fetch', id: 1.5, path: 'a' },
      { type: 'fetch', id: 1, path: 'p'.repeat(1001) },
      { type: 'navigate', path: 7, hash: null, newTab: false },
      { type: 'navigate', path: 'a', hash: 3, newTab: false },
      { type: 'navigate', path: 'a', hash: 'h'.repeat(4001), newTab: false },
      { type: 'navigate', path: 'a', hash: null, newTab: 'no' },
      { type: 'open', url: 5 },
      { type: 'open', url: 'u'.repeat(4001) },
      { type: 'problem', problem: null },
      { type: 'problem', problem: { kind: 'warn', message: 'm' } },
      { type: 'problem', problem: { kind: 'error', message: '' } },
      { type: 'selection', text: 3, rect: null },
      { type: 'selection', text: 't', rect: 'box' },
      { type: 'selection', text: 't', rect: { top: 1, left: 2, bottom: 3 } },
      { type: 'selection', text: 't', rect: { top: 1, left: 2, bottom: 3, right: NaN } },
      { type: 'anchors', found: 'a', missing: [] },
      { type: 'anchors', found: [], missing: [1] },
      { type: 'anchors', found: quotes, missing: [] },
      { type: 'anchors', found: ['q'.repeat(MAX_QUOTE_LENGTH + 1)], missing: [] },
      { type: 'focused', quote: 'a', found: 1 },
      { type: 'focused', quote: 1, found: true },
      { type: 'scroll', x: '1', y: 0 },
      { type: 'scroll', x: 0, y: Infinity },
      { type: 'hash', hash: 1 },
      { type: 'hash', hash: 'h'.repeat(4001) },
      { type: 'storage', entries: [] },
      { type: 'storage', entries: { a: 1 } },
      { type: 'storage', entries: { a: 'x'.repeat(MAX_PAGE_STORAGE_CHARS) } }
    ];
    for (const message of rejected) expect(parseFromPage(message), JSON.stringify(message)?.slice(0, 80)).toBeNull();
  });

  it('copies storage entries rather than keeping the page object', () => {
    const entries = { a: 'b' };
    const parsed = parseFromPage({ type: 'storage', entries });
    expect(parsed).toEqual({ type: 'storage', entries });
    expect((parsed as { entries: object }).entries).not.toBe(entries);
  });
});

describe('isPageHello', () => {
  it('recognizes only the runtime hello', () => {
    expect(isPageHello({ dd: PAGE_HELLO })).toBe(true);
    expect(isPageHello({ dd: 'other' })).toBe(false);
    expect(isPageHello(PAGE_HELLO)).toBe(false);
    expect(isPageHello(null)).toBe(false);
  });
});
