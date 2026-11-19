// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIND_CURRENT_HIGHLIGHT,
  FIND_MATCH_HIGHLIGHT,
  FIND_MATCH_LIMIT,
  clearFindHighlights,
  findTextRanges,
  paintFindHighlights,
  scrollRangeIntoView
} from './dom-find.js';

class FakeHighlight {
  readonly ranges: Range[];
  constructor(...ranges: Range[]) { this.ranges = ranges; }
}

function root(html: string) {
  const element = document.createElement('div');
  element.append(...new DOMParser().parseFromString(html, 'text/html').body.childNodes);
  document.body.append(element);
  return element;
}

const texts = (ranges: Range[]) => ranges.map((range) => range.toString());

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('findTextRanges', () => {
  it('finds every match, ignoring case', () => {
    expect(texts(findTextRanges(root('<p>Thread, thread and THREAD</p>'), 'thread'))).toEqual(['Thread', 'thread', 'THREAD']);
  });

  it('matches text that spans inline markup', () => {
    const ranges = findTextRanges(root('<p>a thr<strong>ea<em>d</em></strong> here</p>'), 'thread');
    expect(texts(ranges)).toEqual(['thread']);
    expect(ranges[0]!.startContainer.textContent).toBe('a thr');
  });

  it('finds a match in the next block', () => {
    expect(texts(findTextRanges(root('<p>one</p><p>two</p>'), 'two'))).toEqual(['two']);
  });

  it('counts rendered link text, not the URL', () => {
    const element = root('<p><a href="https://example.com/needle">Docs</a></p>');
    expect(findTextRanges(element, 'needle')).toEqual([]);
    expect(findTextRanges(element, 'docs')).toHaveLength(1);
  });

  it('skips script and style text', () => {
    const element = document.createElement('div');
    for (const tag of ['script', 'style']) {
      const child = document.createElement(tag);
      child.textContent = 'needle';
      element.append(child);
    }
    expect(findTextRanges(element, 'needle')).toEqual([]);
  });

  it('returns nothing for an empty query or a missing word', () => {
    const element = root('<p>hello</p>');
    expect(findTextRanges(element, '')).toEqual([]);
    expect(findTextRanges(element, 'absent')).toEqual([]);
  });

  it('keeps offsets right when lowercasing changes the text length', () => {
    expect(texts(findTextRanges(root('<p>İ needle</p>'), 'needle'))).toEqual(['needle']);
  });

  it('caps the number of matches', () => {
    expect(findTextRanges(root(`<p>${'a'.repeat(FIND_MATCH_LIMIT + 50)}</p>`), 'a')).toHaveLength(FIND_MATCH_LIMIT);
  });
});

describe('highlights', () => {
  let registry: Map<string, unknown>;
  beforeEach(() => {
    registry = new Map();
    vi.stubGlobal('CSS', { highlights: registry });
    vi.stubGlobal('Highlight', FakeHighlight);
  });

  it('paints all matches plus a distinct current match from the same ranges', () => {
    const ranges = findTextRanges(root('<p>ab ab ab</p>'), 'ab');
    paintFindHighlights(ranges, 1);
    expect((registry.get(FIND_MATCH_HIGHLIGHT) as FakeHighlight).ranges).toEqual(ranges);
    expect((registry.get(FIND_CURRENT_HIGHLIGHT) as FakeHighlight).ranges).toEqual([ranges[1]]);
  });

  it('drops the current highlight when no match is current', () => {
    const ranges = findTextRanges(root('<p>ab</p>'), 'ab');
    paintFindHighlights(ranges, 0);
    paintFindHighlights(ranges, -1);
    expect(registry.has(FIND_CURRENT_HIGHLIGHT)).toBe(false);
    expect(registry.has(FIND_MATCH_HIGHLIGHT)).toBe(true);
  });

  it('clears both highlights when there are no matches, and on demand', () => {
    const ranges = findTextRanges(root('<p>ab</p>'), 'ab');
    paintFindHighlights(ranges, 0);
    paintFindHighlights([], -1);
    expect(registry.size).toBe(0);
    paintFindHighlights(ranges, 0);
    clearFindHighlights();
    expect(registry.size).toBe(0);
  });

  it('does nothing without the Highlight API', () => {
    vi.stubGlobal('Highlight', undefined);
    paintFindHighlights(findTextRanges(root('<p>ab</p>'), 'ab'), 0);
    expect(registry.size).toBe(0);
    vi.stubGlobal('CSS', undefined);
    expect(() => { paintFindHighlights([], 0); clearFindHighlights(); }).not.toThrow();
  });
});

describe('scrollRangeIntoView', () => {
  it('centres the element holding the match', () => {
    const scroll = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scroll, configurable: true });
    try {
      const [range] = findTextRanges(root('<p id="hit">find me</p>'), 'find');
      scrollRangeIntoView(range!);
      expect(scroll).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' });
      expect(scroll.mock.contexts[0]).toBe(document.getElementById('hit'));
      const elementRange = document.createRange();
      elementRange.setStart(document.getElementById('hit')!, 0);
      scrollRangeIntoView(elementRange);
      expect(scroll).toHaveBeenCalledTimes(2);
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });
});
