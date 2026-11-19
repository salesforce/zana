/**
 * Find-in-page helpers for rendered content (the markdown preview today; the
 * Design Docs preview and other read-only views later). Matching runs over the
 * text the element renders, joined across text nodes, so a match can span
 * inline markup (`thr<strong>ead</strong>`). The count and the highlights both
 * come from the ranges returned here, so they cannot disagree.
 */
export const FIND_MATCH_HIGHLIGHT = 'find-match';
export const FIND_CURRENT_HIGHLIGHT = 'find-current';

const SKIPPED_PARENTS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

/** Upper bound on matches so a one-letter query in a huge document stays cheap. */
export const FIND_MATCH_LIMIT = 2000;

function textNodesOf(root: Element): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent && !SKIPPED_PARENTS.has(parent.tagName)) nodes.push(node as Text);
  }
  return nodes;
}

function foldCase(text: string): string {
  const lower = text.toLowerCase();
  // Keep offsets aligned with the original text (`İ` lowercases to two units).
  return lower.length === text.length ? lower : text;
}

/** Every case-insensitive occurrence of `needle` in the text under `root`. */
export function findTextRanges(root: Element, needle: string): Range[] {
  if (!needle) return [];
  const nodes = textNodesOf(root);
  const text = nodes.map((node) => foldCase(node.data)).join('');
  const wanted = foldCase(needle);
  const ranges: Range[] = [];
  let nodeIndex = 0;
  let nodeStart = 0;
  const locate = (offset: number, preferNext: boolean): [Text, number] => {
    while (nodeIndex < nodes.length - 1 && (preferNext ? offset >= nodeStart + nodes[nodeIndex]!.data.length : offset > nodeStart + nodes[nodeIndex]!.data.length)) {
      nodeStart += nodes[nodeIndex]!.data.length;
      nodeIndex += 1;
    }
    return [nodes[nodeIndex]!, offset - nodeStart];
  };
  for (let at = text.indexOf(wanted); at >= 0 && ranges.length < FIND_MATCH_LIMIT; at = text.indexOf(wanted, at + wanted.length)) {
    const range = document.createRange();
    const [startNode, startOffset] = locate(at, true);
    range.setStart(startNode, startOffset);
    const [endNode, endOffset] = locate(at + wanted.length, false);
    range.setEnd(endNode, endOffset);
    ranges.push(range);
  }
  return ranges;
}

function highlightRegistry(): Map<string, unknown> | null {
  const registry = (globalThis.CSS as { highlights?: Map<string, unknown> } | undefined)?.highlights;
  return registry ?? null;
}

export function clearFindHighlights(): void {
  const registry = highlightRegistry();
  registry?.delete(FIND_MATCH_HIGHLIGHT);
  registry?.delete(FIND_CURRENT_HIGHLIGHT);
}

/**
 * Paints `ranges` with the CSS Custom Highlight API, so the rendered React
 * tree is never edited. The current match gets its own, stronger highlight.
 */
export function paintFindHighlights(ranges: Range[], current: number): void {
  const registry = highlightRegistry();
  if (!registry) return;
  const HighlightCtor = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!HighlightCtor || ranges.length === 0) {
    clearFindHighlights();
    return;
  }
  registry.set(FIND_MATCH_HIGHLIGHT, new HighlightCtor(...ranges));
  const active = ranges[current];
  if (active) registry.set(FIND_CURRENT_HIGHLIGHT, new HighlightCtor(active));
  else registry.delete(FIND_CURRENT_HIGHLIGHT);
}

/** Scrolls the match into the middle of its scroll container. */
export function scrollRangeIntoView(range: Range): void {
  const target = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  target?.scrollIntoView({ block: 'center', inline: 'nearest' });
}
