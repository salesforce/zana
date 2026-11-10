import { isValidElement, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { CodeBlockCopyButton } from './CodeBlockCopyButton.js';
import { extractMermaid } from './markdown-mermaid.js';

/**
 * A rendered fenced block plus its pinned "Copy code" button. `children` is
 * the `<pre>` to show; `code` is the text the button copies. The wrapper is
 * the positioning box, so the button never sits inside the scrolling `<pre>`.
 */
export function CodeBlockWithCopy({ code, children }: { code: string; children: ReactNode }) {
  return (
    <div className="inbox-md-codeblock">
      {children}
      <CodeBlockCopyButton code={code} />
    </div>
  );
}

/**
 * A react-markdown `pre` renderer for the standalone markdown views that
 * don't use `MarkdownContent` (Explorer, Library). Fenced blocks get the same
 * copy button as `MarkdownContent`; a ```mermaid fence renders as a plain
 * `<pre>` with no button, so a caller that draws diagrams intercepts it first.
 */
export function CopyableFencedPre({ node: _node, ...props }: ComponentPropsWithoutRef<'pre'> & { node?: unknown }) {
  if (extractMermaid(props.children) !== null) return <pre {...props} />;
  return (
    <CodeBlockWithCopy code={fencedCodeText(props.children)}>
      <pre {...props} />
    </CodeBlockWithCopy>
  );
}

/**
 * The fence body as written: hast appends a newline before the closing fence,
 * which is not part of the code, so drop exactly one. Any other leading,
 * trailing or inner whitespace (including deliberate blank last lines) stays.
 */
export function fencedCodeText(children: ReactNode): string {
  return nodeText(children).replace(/\n$/, '');
}

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return '';
}
