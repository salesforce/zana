import { isValidElement, type ReactNode } from 'react';

/**
 * Given the children of a markdown `<pre>` (react-markdown renders a fenced
 * block as a single `<code className="language-…">`), return the raw source
 * if it's a ```mermaid fence, otherwise null.
 */
export function extractMermaid(children: ReactNode): string | null {
  if (!isValidElement(children)) return null;
  const props = children.props as { className?: string; children?: ReactNode };
  if (!/(^|\s)language-mermaid(\s|$)/.test(props.className ?? '')) return null;
  const source = mermaidFenceText(props.children);
  return source === null ? null : source.replace(/\n$/, '');
}

function mermaidFenceText(node: ReactNode): string | null {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) {
    const parts: string[] = [];
    for (const child of node) {
      const text = mermaidFenceText(child);
      if (text === null) return null;
      parts.push(text);
    }
    return parts.join('');
  }
  return null;
}
