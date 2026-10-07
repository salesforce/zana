/**
 * Locate a comment's quoted passage inside rendered content and paint it with
 * the CSS Custom Highlight API, which marks ranges without touching the DOM
 * the host markdown renderer owns. Agents quote the markdown source, so the
 * search tolerates markup (`#`, `**`, list bullets) and whitespace differences.
 */

export const COMMENT_HIGHLIGHT = 'dd-comment';
export const FOCUS_HIGHLIGHT = 'dd-comment-focus';

export function normalizeQuote(quote: string): string {
  return quote
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#{1,6}\s+|[-*+>]\s+|\d+\.\s+)/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface TextIndex {
  nodes: Text[];
  starts: number[];
  normalized: string;
  /** normalized index → raw concatenated-text index */
  map: number[];
}

function indexText(root: Node): TextIndex {
  const walker = root.ownerDocument!.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes: Text[] = [];
  const starts: number[] = [];
  let raw = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    starts.push(raw.length);
    nodes.push(node as Text);
    raw += (node as Text).data;
  }
  let normalized = '';
  const map: number[] = [];
  let lastWasSpace = true;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (/\s/.test(char)) {
      if (!lastWasSpace) {
        normalized += ' ';
        map.push(index);
      }
      lastWasSpace = true;
    } else {
      normalized += char;
      map.push(index);
      lastWasSpace = false;
    }
  }
  return { nodes, starts, normalized, map };
}

function locate(index: TextIndex, rawOffset: number): [Text, number] {
  let low = 0;
  let high = index.starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (index.starts[mid]! <= rawOffset) low = mid;
    else high = mid - 1;
  }
  return [index.nodes[low]!, rawOffset - index.starts[low]!];
}

/** Ranges for each quote found under `root` (quotes that are not found are skipped). */
export function findQuoteRanges(root: Node, quotes: readonly string[]): Map<string, Range> {
  const found = new Map<string, Range>();
  if (!quotes.length) return found;
  const index = indexText(root);
  if (!index.nodes.length) return found;
  for (const quote of quotes) {
    const needle = normalizeQuote(quote);
    if (needle.length < 2 || found.has(quote)) continue;
    const at = index.normalized.indexOf(needle);
    if (at < 0) continue;
    const [startNode, startOffset] = locate(index, index.map[at]!);
    const [endNode, endOffset] = locate(index, index.map[at + needle.length - 1]!);
    const range = root.ownerDocument!.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset + 1);
    found.set(quote, range);
  }
  return found;
}

type HighlightCtor = new (...ranges: Range[]) => unknown;
interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

function registry(): { registry: HighlightRegistry; Highlight: HighlightCtor } | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const Highlight = (globalThis as { Highlight?: HighlightCtor }).Highlight;
  return css?.highlights && Highlight ? { registry: css.highlights, Highlight } : null;
}

const owners = new Map<string, Map<object, Range[]>>();

/**
 * Publish `ranges` for `owner` under highlight `name`. Several previews can be
 * open at once (workbench + thread panel), so each owner's ranges are merged.
 */
export function paintRanges(name: string, owner: object, ranges: Range[]): void {
  const api = registry();
  if (!api) return;
  const byOwner = owners.get(name) ?? new Map<object, Range[]>();
  owners.set(name, byOwner);
  if (ranges.length) byOwner.set(owner, ranges);
  else byOwner.delete(owner);
  const all = [...byOwner.values()].flat();
  if (all.length) api.registry.set(name, new api.Highlight(...all));
  else api.registry.delete(name);
}

export function highlightsSupported(): boolean {
  return registry() !== null;
}
