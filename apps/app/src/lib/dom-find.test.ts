// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIND_MATCH_LIMIT, createFindHighlighter, findTextRanges, scrollRangeIntoView } from './dom-find.js';

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

  it('matches after a character whose lowercase is longer (İ)', () => {
    expect(texts(findTextRanges(root('<p>İ NEEDLE and İNEEDLE</p>'), 'needle'))).toEqual(['NEEDLE', 'NEEDLE']);
  });

  it('matches the İ itself and maps its range back to the original text', () => {
    const [range] = findTextRanges(root('<p>xİy</p>'), 'i̇y');
    expect(range!.toString()).toBe('İy');
  });

  it('handles astral characters before a match', () => {
    expect(texts(findTextRanges(root('<p>😀 Needle</p>'), 'needle'))).toEqual(['Needle']);
  });

  it('skips text that is not rendered', () => {
    const element = root(
      '<p style="display:none">needle a</p><p hidden>needle b</p><p style="visibility:hidden">needle c</p>' +
      '<span class="sr-only">needle d</span><details><summary>needle e</summary>needle f<p>needle g</p></details>' +
      '<details open><p>needle h</p></details><p>needle i</p>'
    );
    expect(texts(findTextRanges(element, 'needle'))).toHaveLength(3);
    expect(findTextRanges(element, 'needle').map((range) => range.startContainer.textContent)).toEqual(['needle e', 'needle h', 'needle i']);
  });

  it('caps the number of matches', () => {
    expect(findTextRanges(root(`<p>${'a'.repeat(FIND_MATCH_LIMIT + 50)}</p>`), 'a')).toHaveLength(FIND_MATCH_LIMIT);
  });
});

describe('createFindHighlighter', () => {
  let registry: Map<string, unknown>;
  const names = () => [...registry.keys()];
  const painted = (prefix: string) => {
    const key = names().find((name) => name.startsWith(prefix));
    return key ? (registry.get(key) as FakeHighlight).ranges : undefined;
  };
  beforeEach(() => {
    registry = new Map();
    vi.stubGlobal('CSS', { highlights: registry });
    vi.stubGlobal('Highlight', FakeHighlight);
  });
  afterEach(() => { document.head.replaceChildren(); });

  it('paints all matches plus a distinct current match from the same ranges', () => {
    const ranges = findTextRanges(root('<p>ab ab ab</p>'), 'ab');
    createFindHighlighter().paint(ranges, 1);
    expect(painted('find-match-')).toEqual(ranges);
    expect(painted('find-current-')).toEqual([ranges[1]]);
  });

  it('drops the current highlight when no match is current', () => {
    const ranges = findTextRanges(root('<p>ab</p>'), 'ab');
    const highlighter = createFindHighlighter();
    highlighter.paint(ranges, 0);
    highlighter.paint(ranges, -1);
    expect(painted('find-current-')).toBeUndefined();
    expect(painted('find-match-')).toBeDefined();
  });

  it('clears when there are no matches, and on demand', () => {
    const ranges = findTextRanges(root('<p>ab</p>'), 'ab');
    const highlighter = createFindHighlighter();
    highlighter.paint(ranges, 0);
    highlighter.paint([], -1);
    expect(registry.size).toBe(0);
    highlighter.paint(ranges, 0);
    highlighter.clear();
    expect(registry.size).toBe(0);
  });

  it('keeps each instance on its own names, so one never clears another', () => {
    const first = createFindHighlighter();
    const second = createFindHighlighter();
    const ranges = findTextRanges(root('<p>ab ab</p>'), 'ab');
    first.paint(ranges, 0);
    second.paint(ranges.slice(0, 1), 0);
    expect(names()).toHaveLength(4);
    second.paint([], -1);
    second.clear();
    expect(names()).toHaveLength(2);
    second.dispose();
    expect(painted('find-match-')).toEqual(ranges);
    first.dispose();
    expect(registry.size).toBe(0);
  });

  it('injects a ::highlight stylesheet for its own names and removes it on dispose', () => {
    const highlighter = createFindHighlighter();
    expect(document.head.querySelectorAll('style')).toHaveLength(0);
    const ranges = findTextRanges(root('<p>ab</p>'), 'ab');
    highlighter.paint(ranges, 0);
    highlighter.paint(ranges, 0);
    const styles = document.head.querySelectorAll('style');
    expect(styles).toHaveLength(1);
    for (const name of names()) expect(styles[0]!.textContent).toContain(`::highlight(${name})`);
    highlighter.dispose();
    expect(document.head.querySelectorAll('style')).toHaveLength(0);
    expect(() => highlighter.dispose()).not.toThrow();
  });

  it('does nothing without the Highlight API', () => {
    const highlighter = createFindHighlighter();
    vi.stubGlobal('Highlight', undefined);
    highlighter.paint(findTextRanges(root('<p>ab</p>'), 'ab'), 0);
    expect(registry.size).toBe(0);
    vi.stubGlobal('CSS', undefined);
    expect(() => { highlighter.paint([], 0); highlighter.clear(); }).not.toThrow();
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

describe('scrollRangeIntoView with layout', () => {
  function rect(top: number, height: number) {
    return { top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  }

  it('scrolls by the match rectangle when its parent is taller than the viewport', () => {
    const element = root('<div id="scroller" style="overflow-y:auto"><pre>long code needle</pre></div>');
    const scroller = document.getElementById('scroller')!;
    Object.defineProperty(scroller, 'scrollHeight', { value: 5000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true });
    scroller.getBoundingClientRect = () => rect(100, 400);
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true });
    const [range] = findTextRanges(element, 'needle');
    range!.getBoundingClientRect = () => rect(3000, 20);
    try {
      scroller.scrollTop = 0;
      scrollRangeIntoView(range!);
      // Match centre (3010) moves to the container centre (300).
      expect(scroller.scrollTop).toBe(2710);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });

  it('scrolls the window to the match when asked and no ancestor scrolls', () => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const height = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    const [range] = findTextRanges(root('<p>needle</p>'), 'needle');
    range!.getBoundingClientRect = () => rect(1000, 20);
    scrollRangeIntoView(range!, { scrollWindow: true });
    expect(scrollBy).toHaveBeenCalledWith(0, 710);
    scrollBy.mockClear();
    scrollRangeIntoView(range!);
    expect(scrollBy).not.toHaveBeenCalled();
    scrollBy.mockRestore();
    height.mockRestore();
  });

  it('does nothing when no ancestor scrolls', () => {
    const [range] = findTextRanges(root('<p>needle</p>'), 'needle');
    range!.getBoundingClientRect = () => rect(10, 10);
    expect(() => scrollRangeIntoView(range!)).not.toThrow();
  });
});

describe('documents without a browsing context', () => {
  it('finds text in a detached document instead of throwing', () => {
    const detached = document.implementation.createHTMLDocument('x');
    detached.body.innerHTML = '<p>needle <span>hay</span></p>';
    expect(findTextRanges(detached.body, 'needle')).toHaveLength(1);
  });
});
