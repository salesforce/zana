/** Literal rendered-text search, including matches spanning inline marks. */
export function documentSearchRanges(root: HTMLElement, query: string, cap = 1000): Range[] {
  if (!query || query.length > 500) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: node => node instanceof Element && node.matches('button, script, style, [aria-hidden="true"], [data-document-search-skip]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  let text = '';
  const nodes: { node: Text; start: number }[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      nodes.push({ node: node as Text, start: text.length });
      text += node.textContent;
    } else if (/^(P|H[1-6]|LI|PRE|TR|TD|TH|BLOCKQUOTE|BR|DIV)$/.test((node as Element).tagName) && text && !text.endsWith('\n')) text += '\n';
  }
  // Escape every metacharacter. Regex's original-string offsets also handle
  // Unicode case mappings without applying a length-changing case fold.
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const ranges: Range[] = [];
  let fromNode = 0;
  let match: RegExpExecArray | null;
  while (ranges.length < cap && (match = pattern.exec(text)) !== null) {
    const index = match.index;
    while (fromNode + 1 < nodes.length && nodes[fromNode + 1]!.start <= index) fromNode++;
    let toNode = fromNode;
    const end = index + match[0].length;
    while (toNode + 1 < nodes.length && nodes[toNode + 1]!.start < end) toNode++;
    const from = nodes[fromNode]; const to = nodes[toNode];
    if (!from || !to) break;
    const range = document.createRange();
    range.setStart(from.node, index - from.start);
    range.setEnd(to.node, end - to.start);
    ranges.push(range);
  }
  return ranges;
}
