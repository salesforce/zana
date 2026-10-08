/** DOM helpers for the site kit. Text always goes in as text, never as markup. */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The page's window, with its constructors (`HTMLTableElement`, `CustomEvent`…) typed. */
export type KitWindow = Window & typeof globalThis;

/** The last index where `test` holds, or -1. */
export function lastIndex<T>(items: readonly T[], test: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) if (test(items[index]!)) return index;
  return -1;
}

type Attributes = Record<string, string | number | boolean | null | undefined>;

function setAttributes(node: Element, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
}

/** An HTML element with attributes and children; strings become text nodes. */
export function html<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attributes: Attributes = {},
  children: Array<Node | string | null | undefined> = []
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  setAttributes(node, attributes);
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
  return node;
}

/** An SVG element; numbers are rounded to two decimals so the markup stays small. */
export function svg(doc: Document, tag: string, attributes: Attributes = {}, text?: string): SVGElement {
  const node = doc.createElementNS(SVG_NS, tag) as SVGElement;
  const rounded: Attributes = {};
  for (const [name, value] of Object.entries(attributes)) rounded[name] = typeof value === 'number' ? round(value) : value;
  setAttributes(node, rounded);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** An element, or the first match of a selector. */
export function resolve(doc: Document, target: Element | string): Element {
  const node = typeof target === 'string' ? doc.querySelector(target) : target;
  if (!node) throw new Error(`Kit: nothing matches ${String(target)}`);
  return node;
}

/** Run `enhance` once per element, however often the page asks. */
export function once(seen: WeakSet<Element>, node: Element, enhance: () => void): void {
  if (seen.has(node)) return;
  seen.add(node);
  enhance();
}

/** Hand an error to the page's error handlers (the panel reports them) without stopping the caller. */
export function reportError(win: KitWindow, error: unknown): void {
  const report = (win as Window & { reportError?: (error: unknown) => void }).reportError;
  if (typeof report === 'function') report.call(win, error);
  else win.console.error(error);
}
