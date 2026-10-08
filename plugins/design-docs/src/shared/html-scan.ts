/**
 * A small HTML scanner: just enough of the tokenizer to find start tags and
 * their attributes while skipping comments and the contents of raw-text
 * elements (`<script>`, `<style>`, …), so a rewrite never touches text the
 * browser would not parse as markup. Unchanged bytes are kept as they are.
 */

export interface HtmlAttribute {
  /** Lowercased. */
  name: string;
  /** Entity-decoded, or null for a bare attribute (`<script defer>`). */
  value: string | null;
}

export interface HtmlTag {
  /** Lowercased tag name. */
  name: string;
  attributes: HtmlAttribute[];
  /** Ends in `/>`; only meaningful for void and SVG elements. */
  selfClosing: boolean;
  /** Offsets of the start tag, `<` through `>`. */
  start: number;
  end: number;
  /**
   * For raw-text elements (`script`, `style`, `textarea`, …): the content
   * range and the end of the closing tag. A missing closing tag runs to the
   * end of the document, like the browser.
   */
  content?: { start: number; end: number; closeEnd: number };
}

const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);
const TAG_NAME = /[A-Za-z][^\t\n\f\r />]*/y;
const SEPARATORS = /[\t\n\f\r /]*/y;
const SPACES = /[\t\n\f\r ]*/y;
const ATTRIBUTE_NAME = /[^\t\n\f\r />][^\t\n\f\r />=]*/y;
const UNQUOTED_VALUE = /[^\t\n\f\r >]*/y;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  // Common in prose, so a quote of the page's text matches its source.
  mdash: '—',
  ndash: '–',
  hellip: '…',
  middot: '·',
  bull: '•',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  times: '×',
  plusmn: '±',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓'
};

/** Decode the character references that occur in URLs and attribute values. */
export function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));?/g, (whole, decimal, hex, name) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    const code = decimal ? Number(decimal) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

export function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function match(pattern: RegExp, html: string, at: number): string {
  pattern.lastIndex = at;
  return pattern.exec(html)?.[0] ?? '';
}

function parseStartTag(html: string, at: number): Omit<HtmlTag, 'content'> | null {
  const name = match(TAG_NAME, html, at + 1);
  let index = at + 1 + name.length;
  const attributes: HtmlAttribute[] = [];
  while (index < html.length) {
    const separator = match(SEPARATORS, html, index);
    index += separator.length;
    if (index >= html.length) return null;
    if (html[index] === '>') {
      return { name: name.toLowerCase(), attributes, selfClosing: separator.endsWith('/'), start: at, end: index + 1 };
    }
    const attributeName = match(ATTRIBUTE_NAME, html, index) || html[index]!;
    index += attributeName.length;
    index += match(SPACES, html, index).length;
    let value: string | null = null;
    if (html[index] === '=') {
      index += 1;
      index += match(SPACES, html, index).length;
      const quote = html[index];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, index + 1);
        if (close < 0) return null;
        value = html.slice(index + 1, close);
        index = close + 1;
      } else {
        value = match(UNQUOTED_VALUE, html, index);
        index += value.length;
      }
    }
    attributes.push({ name: attributeName.toLowerCase(), value: value === null ? null : decodeEntities(value) });
  }
  return null;
}

/** `<script type>` values the browser runs. */
const JS_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript']);

export function isScriptType(type: string | null | undefined): boolean {
  return JS_TYPES.has((type ?? '').trim().toLowerCase());
}

/** Raw-text elements whose content the reader sees; the rest are code, metadata or fallbacks. */
const SHOWN_RAW_TEXT = new Set(['textarea', 'xmp']);

/**
 * The text a page shows before its scripts run, in document order and without
 * separators, the way the panel's quote search reads rendered text nodes.
 * `scripted`: the page runs scripts, which may show text its source lacks.
 */
export function pageText(html: string): { text: string; scripted: boolean } {
  let text = '';
  let scripted = false;
  let cursor = 0;
  const between = (end: number) => {
    const chunk = html
      .slice(cursor, end)
      .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
      .replace(/<[/!?][^>]*>?/g, '');
    text += decodeEntities(chunk);
  };
  for (const tag of scanTags(html)) {
    if (tag.start < cursor) continue; // inside a <template>
    between(tag.start);
    cursor = tag.end;
    if (tag.name === 'script' && isScriptType(attribute(tag, 'type'))) scripted = true;
    if (tag.name === 'template') cursor = templateEnd(html, cursor);
    else if (tag.content) {
      if (SHOWN_RAW_TEXT.has(tag.name)) text += decodeEntities(html.slice(tag.content.start, tag.content.end));
      cursor = tag.content.closeEnd;
    }
  }
  between(html.length);
  return { text, scripted };
}

/** Where the `<template>` whose content starts at `from` closes; its content is never shown as is. */
function templateEnd(html: string, from: number): number {
  const pattern = /<(\/?)template\b[^>]*>/gi;
  pattern.lastIndex = from;
  let depth = 1;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return pattern.lastIndex;
  }
  return html.length;
}

/** Every start tag in document order, as the browser's tokenizer would see them. */
export function* scanTags(html: string): Generator<HtmlTag> {
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf('<', index);
    if (open < 0) return;
    const next = html[open + 1] ?? '';
    if (html.startsWith('<!--', open)) {
      const close = html.indexOf('-->', open + 4);
      index = close < 0 ? html.length : close + 3;
      continue;
    }
    if (next === '!' || next === '?' || (next === '/' && /[A-Za-z]/.test(html[open + 2] ?? ''))) {
      const close = html.indexOf('>', open + 2);
      index = close < 0 ? html.length : close + 1;
      continue;
    }
    if (!/[A-Za-z]/.test(next)) {
      index = open + 1;
      continue;
    }
    const tag = parseStartTag(html, open);
    if (!tag) return;
    index = tag.end;
    // As in the browser, `/>` does not end a raw-text element early.
    if (RAW_TEXT.has(tag.name)) {
      // `</scriptx` does not close a script, hence the lookahead.
      const closer = new RegExp(`</${tag.name}(?=[\\t\\n\\f\\r />])`, 'ig');
      closer.lastIndex = tag.end;
      const found = closer.exec(html);
      const contentEnd = found ? found.index : html.length;
      const closeTagEnd = found ? html.indexOf('>', contentEnd) : -1;
      const closeEnd = closeTagEnd < 0 ? html.length : closeTagEnd + 1;
      yield { ...tag, content: { start: tag.end, end: contentEnd, closeEnd } };
      index = closeEnd;
      continue;
    }
    yield tag;
  }
}

export function attribute(tag: Pick<HtmlTag, 'attributes'>, name: string): string | null | undefined {
  const found = tag.attributes.find((entry) => entry.name === name);
  return found ? found.value : undefined;
}

/** Serialize a start tag; bare attributes stay bare. */
export function startTag(name: string, attributes: readonly HtmlAttribute[], selfClosing = false): string {
  const parts = attributes.map((entry) => (entry.value === null ? ` ${entry.name}` : ` ${entry.name}="${escapeAttribute(entry.value)}"`));
  return `<${name}${parts.join('')}${selfClosing ? ' />' : '>'}`;
}

/** Put `markup` first in the document head, or as early as the markup allows. */
export function prependToHead(html: string, markup: string): string {
  let htmlTagEnd = -1;
  for (const tag of scanTags(html)) {
    if (tag.name === 'head') return html.slice(0, tag.end) + markup + html.slice(tag.end);
    if (tag.name === 'html') {
      htmlTagEnd = tag.end;
      continue;
    }
    break;
  }
  if (htmlTagEnd >= 0) return html.slice(0, htmlTagEnd) + markup + html.slice(htmlTagEnd);
  const doctype = html.match(/^\s*<!doctype[^>]*>/i);
  if (doctype) return doctype[0] + markup + html.slice(doctype[0].length);
  return markup + html;
}
