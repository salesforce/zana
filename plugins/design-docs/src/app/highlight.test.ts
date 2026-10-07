// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readThemeTokens } from './content.js';
import { COMMENT_HIGHLIGHT, findQuoteRanges, highlightsSupported, normalizeQuote, paintRanges } from './highlight.js';

/** Build fixed test markup without parsing strings into the live DOM. */
function el(tag: string, ...children: Array<Node | string>): HTMLElement {
  const node = document.createElement(tag);
  for (const child of children) node.append(child);
  return node;
}

function mount(...children: Node[]): HTMLElement {
  const root = el('div', ...children);
  document.body.appendChild(root);
  return root;
}

class FakeHighlight {
  ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

afterEach(() => {
  document.body.replaceChildren();
  delete (globalThis as { Highlight?: unknown }).Highlight;
  vi.unstubAllGlobals();
});

describe('normalizeQuote', () => {
  it('strips markdown the renderer removes', () => {
    expect(normalizeQuote('## The **cache** layer')).toBe('The cache layer');
    expect(normalizeQuote('- see [the API](api.md)\n- 2. `retry`  twice')).toBe('see the API 2. retry twice');
    expect(normalizeQuote('> quoted\n1. first')).toBe('quoted first');
  });
});

describe('findQuoteRanges', () => {
  it('finds quotes across element boundaries and whitespace', () => {
    const root = mount(el('h2', 'The ', el('strong', 'cache'), '\n  layer'), el('p', 'Writes go through.'));
    const ranges = findQuoteRanges(root, ['## The **cache** layer', 'go through', 'absent text', 'x']);
    expect([...ranges.keys()]).toEqual(['## The **cache** layer', 'go through']);
    expect(ranges.get('## The **cache** layer')!.toString()).toBe('The cache\n  layer');
    expect(ranges.get('go through')!.toString()).toBe('go through');
  });

  it('returns nothing without quotes or text', () => {
    expect(findQuoteRanges(mount(el('p', 'hi')), []).size).toBe(0);
    expect(findQuoteRanges(mount(), ['hello']).size).toBe(0);
  });
});

describe('paintRanges', () => {
  it('is a no-op without the Highlight API', () => {
    expect(highlightsSupported()).toBe(false);
    expect(() => paintRanges(COMMENT_HIGHLIGHT, {}, [])).not.toThrow();
  });

  it('merges ranges from several owners into one highlight', () => {
    const registry = new Map<string, FakeHighlight>();
    (globalThis as { Highlight?: unknown }).Highlight = FakeHighlight;
    vi.stubGlobal('CSS', {
      highlights: { set: (name: string, value: FakeHighlight) => registry.set(name, value), delete: (name: string) => registry.delete(name) }
    });
    expect(highlightsSupported()).toBe(true);
    const root = mount(el('p', 'alpha beta'));
    const a = findQuoteRanges(root, ['alpha']).get('alpha')!;
    const b = findQuoteRanges(root, ['beta']).get('beta')!;
    const first = {};
    const second = {};
    paintRanges(COMMENT_HIGHLIGHT, first, [a]);
    paintRanges(COMMENT_HIGHLIGHT, second, [b]);
    expect(registry.get(COMMENT_HIGHLIGHT)!.ranges).toEqual([a, b]);
    paintRanges(COMMENT_HIGHLIGHT, first, []);
    expect(registry.get(COMMENT_HIGHLIGHT)!.ranges).toEqual([b]);
    paintRanges(COMMENT_HIGHLIGHT, second, []);
    expect(registry.has(COMMENT_HIGHLIGHT)).toBe(false);
  });
});

describe('readThemeTokens', () => {
  it('reads the host tokens that are set', () => {
    document.documentElement.style.setProperty('--accent', '#ff0066');
    const tokens = readThemeTokens();
    expect(tokens['--accent']).toBe('#ff0066');
    expect(tokens['--danger']).toBeUndefined();
  });
});
