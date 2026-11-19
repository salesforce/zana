/**
 * Find-in-page helpers for rendered content (the markdown preview today; the
 * Design Docs preview and other read-only views later). Matching runs over the
 * text the element renders, joined across text nodes, so a match can span
 * inline markup (`thr<strong>ead</strong>`). Text that is not on screen
 * (`display: none`, `hidden`, closed `<details>`, screen-reader-only) is
 * skipped. The count and the highlights both come from the ranges returned
 * here, so they cannot disagree.
 */

/** Upper bound on matches so a one-letter query in a huge document stays cheap. */
export const FIND_MATCH_LIMIT = 2000;

const SKIPPED_PARENTS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

/** True when `el` itself is not painted (display, visibility, hidden, sr-only). */
function isElementHidden(el: Element): boolean {
  if (SKIPPED_PARENTS.has(el.tagName) || el.hasAttribute('hidden') || el.classList.contains('sr-only')) return true;
  const style = getComputedStyle(el);
  return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse';
}

/** Text under a closed `<details>` is not shown, except inside its `<summary>`. */
function isInClosedDetails(el: Element, root: Element): boolean {
  let child: Element | null = null;
  for (let node: Element | null = el; node && node !== root.parentElement; child = node, node = node.parentElement) {
    if (node.tagName === 'DETAILS' && !(node as HTMLDetailsElement).open && child?.tagName !== 'SUMMARY') return true;
  }
  return false;
}

function isRendered(parent: Element, root: Element, hiddenCache: Map<Element, boolean>): boolean {
  if (isInClosedDetails(parent, root)) return false;
  for (let el: Element | null = parent; el && el !== root.parentElement; el = el.parentElement) {
    let hidden = hiddenCache.get(el);
    if (hidden === undefined) {
      hidden = isElementHidden(el);
      hiddenCache.set(el, hidden);
    }
    if (hidden) return false;
  }
  return true;
}

function textNodesOf(root: Element): Text[] {
  const nodes: Text[] = [];
  const hiddenCache = new Map<Element, boolean>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent && isRendered(parent, root, hiddenCache)) nodes.push(node as Text);
  }
  return nodes;
}

/**
 * Lowercases per code point and remembers, for every folded UTF-16 unit, the
 * offset of the original code point it came from (`İ` folds to two units).
 */
function foldWithMap(text: string): { folded: string; origin: number[] } {
  let folded = '';
  const origin: number[] = [];
  for (let i = 0; i < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(i)!);
    const lower = char.toLowerCase();
    folded += lower;
    for (let k = 0; k < lower.length; k += 1) origin.push(i);
    i += char.length;
  }
  return { folded, origin };
}

type Located = [Text, number];

/** Maps offsets in the joined original text back to (text node, offset). */
function createLocator(nodes: Text[]): (offset: number, preferNext: boolean) => Located {
  let nodeIndex = 0;
  let nodeStart = 0;
  return (offset, preferNext) => {
    const length = () => nodes[nodeIndex]!.data.length;
    while (nodeIndex < nodes.length - 1 && (preferNext ? offset >= nodeStart + length() : offset > nodeStart + length())) {
      nodeStart += length();
      nodeIndex += 1;
    }
    return [nodes[nodeIndex]!, offset - nodeStart];
  };
}

/** Every case-insensitive occurrence of `needle` in the text under `root`. */
export function findTextRanges(root: Element, needle: string): Range[] {
  if (!needle) return [];
  const nodes = textNodesOf(root);
  if (nodes.length === 0) return [];
  const original = nodes.map((node) => node.data).join('');
  const { folded, origin } = foldWithMap(original);
  const wanted = foldWithMap(needle).folded;
  const locate = createLocator(nodes);
  const ranges: Range[] = [];
  for (let at = folded.indexOf(wanted); at >= 0 && ranges.length < FIND_MATCH_LIMIT; at = folded.indexOf(wanted, at + wanted.length)) {
    const start = origin[at]!;
    const lastChar = origin[at + wanted.length - 1]!;
    const end = lastChar + String.fromCodePoint(original.codePointAt(lastChar)!).length;
    const range = document.createRange();
    range.setStart(...locate(start, true));
    range.setEnd(...locate(end, false));
    ranges.push(range);
  }
  return ranges;
}

type HighlightRegistry = Map<string, unknown>;
type HighlightCtor = new (...ranges: Range[]) => unknown;

function highlightApi(): { registry: HighlightRegistry; Highlight: HighlightCtor } | null {
  const registry = (globalThis.CSS as { highlights?: HighlightRegistry } | undefined)?.highlights;
  const Highlight = (globalThis as { Highlight?: HighlightCtor }).Highlight;
  return registry && Highlight ? { registry, Highlight } : null;
}

export interface FindHighlighter {
  /** Paints `ranges`, with a stronger highlight on `ranges[current]`. */
  paint(ranges: Range[], current: number): void;
  /** Removes this highlighter's highlights (and nobody else's). */
  clear(): void;
  /** Clears and removes the highlighter's stylesheet. Call on unmount. */
  dispose(): void;
}

let highlighterCount = 0;

/**
 * One highlighter per find surface. Each owns uniquely named highlights and a
 * matching `::highlight()` stylesheet, so several surfaces (preview, Design
 * Docs, shortcuts filter) never clear each other's matches.
 */
export function createFindHighlighter(): FindHighlighter {
  highlighterCount += 1;
  const matchName = `find-match-${highlighterCount}`;
  const currentName = `find-current-${highlighterCount}`;
  let style: HTMLStyleElement | null = null;
  const ensureStyle = () => {
    if (style) return;
    style = document.createElement('style');
    style.textContent = `::highlight(${matchName}){background-color:rgba(230,184,0,.35)}::highlight(${currentName}){background-color:#ff9d00;color:#000}`;
    document.head.appendChild(style);
  };
  const clear = () => {
    const api = highlightApi();
    api?.registry.delete(matchName);
    api?.registry.delete(currentName);
  };
  return {
    clear,
    paint(ranges, current) {
      const api = highlightApi();
      if (!api || ranges.length === 0) {
        clear();
        return;
      }
      ensureStyle();
      api.registry.set(matchName, new api.Highlight(...ranges));
      const active = ranges[current];
      if (active) api.registry.set(currentName, new api.Highlight(active));
      else api.registry.delete(currentName);
    },
    dispose() {
      clear();
      style?.remove();
      style = null;
    }
  };
}

function scrollableAncestor(start: Element | null): Element | null {
  for (let el = start; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight) return el;
  }
  return null;
}

/**
 * Scrolls the match itself into the middle of its scroll container. Uses the
 * range's own rectangle, so a match inside an element taller than the viewport
 * (a long code block) is still brought into view.
 */
export function scrollRangeIntoView(range: Range): void {
  const parent = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  if (typeof range.getBoundingClientRect !== 'function') {
    parent?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    return;
  }
  const scroller = scrollableAncestor(parent);
  if (!scroller) return;
  const rect = range.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  scroller.scrollTop += rect.top + rect.height / 2 - (box.top + box.height / 2);
}
