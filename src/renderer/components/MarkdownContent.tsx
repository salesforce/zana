import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { MermaidDiagram } from './MermaidDiagram';
import { unwrapBareFence } from '../util/markdown';
import { parseFrontMatter, type ParsedFrontMatter } from '@zana-ai/zcc-extension-sdk/helpers';
import { highlightForPath } from '../util/highlightCode';

/**
 * Shared markdown / doc rendering for the inbox.
 *
 * Extracted so the live detail pane and the PDF export render through the
 * *same* pipeline — react-markdown + remark-gfm + rehype-highlight, with
 * ```mermaid fences promoted to diagrams and recognized source files syntax
 * highlighted. Keeping one renderer is the whole point: a second markdown
 * path would drift from what the user sees on screen.
 */

/**
 * @param mermaidTheme  Forwarded to embedded mermaid diagrams. The PDF export
 *   passes 'default' (light) so diagrams print light regardless of app theme;
 *   the live panel omits it and follows the app theme.
 * @param exportable  Mount the per-diagram export/copy toolbar. The live panel
 *   passes true; the PDF-export path leaves it off so the headless snapshot
 *   (which counts `data-mermaid-state` nodes) is unchanged.
 */
export function DocContent({
  path,
  content,
  mermaidTheme,
  exportable = false
}: {
  path: string;
  content: string;
  mermaidTheme?: 'dark' | 'default';
  exportable?: boolean;
}) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    // Library docs carry a `---`…`---` metadata header. react-markdown has no
    // notion of front-matter and would render it as a mangled bold blob, so
    // peel it off and surface the useful fields as a clean chip header above
    // the body. Non-front-matter docs render exactly as before.
    const parsed = parseFrontMatter(content);
    if (parsed) {
      return (
        <>
          <DocFrontMatter meta={parsed.meta} />
          <MarkdownContent text={parsed.body} mermaidTheme={mermaidTheme} exportable={exportable} />
        </>
      );
    }
    return <MarkdownContent text={content} mermaidTheme={mermaidTheme} exportable={exportable} />;
  }
  // Syntax-highlight recognized source files (.ts/.tsx/.py/…) the same way the
  // markdown path highlights fenced code. Unknown/extensionless files fall back
  // to plain monospace text. The highlighted HTML is escaped by highlight.js.
  const highlighted = highlightForPath(path, content);
  if (highlighted) {
    return (
      <pre className="inbox-doc-pre hljs">
        <code
          className={`hljs language-${highlighted.language}`}
          dangerouslySetInnerHTML={{ __html: highlighted.html }}
        />
      </pre>
    );
  }
  return <pre className="inbox-doc-pre">{content}</pre>;
}

/**
 * Render a library doc's front-matter as a compact metadata header: the
 * summary as a muted deck and the tags as pills, with the created date on the
 * right. `id`/`source` are machine-only and intentionally hidden. `title` is
 * omitted too — these docs open with their own `# H1`, so repeating it here
 * would double the heading. Renders nothing if there's no user-facing field.
 */
function DocFrontMatter({ meta }: { meta: ParsedFrontMatter['meta'] }) {
  const summary = meta.summary?.trim();
  const tags = meta.tags?.filter((t) => t.trim().length > 0) ?? [];
  const created = formatCreatedAt(meta.createdAt);
  if (!summary && tags.length === 0 && !created) return null;
  return (
    <div className="inbox-doc-meta">
      {(summary || created) && (
        <div className="inbox-doc-meta-top">
          {summary && <p className="inbox-doc-meta-summary">{summary}</p>}
          {created && <span className="inbox-doc-meta-date">{created}</span>}
        </div>
      )}
      {tags.length > 0 && (
        <div className="inbox-doc-meta-tags">
          {tags.map((t) => (
            <span key={t} className="inbox-doc-meta-tag">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Epoch-ms → short readable date. Returns '' for missing/invalid input. */
function formatCreatedAt(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function MarkdownContent({
  text,
  mermaidTheme,
  exportable = false
}: {
  text: string;
  mermaidTheme?: 'dark' | 'default';
  exportable?: boolean;
}) {
  const body = unwrapBareFence(text);
  return (
    <div className="inbox-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Syntax-highlight fenced code blocks. `ignoreMissing` keeps unknown
        // languages (incl. ```mermaid, which the pre override intercepts
        // before this matters) from throwing — they just render unhighlighted.
        rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
        components={{
          // Open links in a new window — Electron treats that as the OS
          // default browser. Avoid destructuring `node` (deprecated in
          // react-markdown v10).
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
          // GFM tables get a wrapper so horizontal overflow scrolls within
          // the comments block instead of stretching the whole panel.
          table: (props) => (
            <div className="inbox-md-table-wrap">
              <table {...props} />
            </div>
          ),
          // Intercept ```mermaid fences and render them as diagrams. A
          // non-mermaid fence falls through to the default <pre>. We hook
          // `pre` (not `code`) so the rendered SVG isn't nested inside a
          // monospace code block.
          pre: (props) => {
            const mermaid = extractMermaid(props.children);
            if (mermaid !== null)
              return <MermaidDiagram code={mermaid} theme={mermaidTheme} exportable={exportable} />;
            return <pre {...props} />;
          }
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Given the children of a markdown `<pre>` (which react-markdown renders as a
 * single `<code className="language-…">` element), return the raw source if
 * it's a ```mermaid fence, otherwise null. Returning null lets the caller
 * fall back to the default code-block rendering.
 */
function extractMermaid(children: ReactNode): string | null {
  if (!isValidElement(children)) return null;
  const props = children.props as { className?: string; children?: ReactNode };
  const className = props.className ?? '';
  if (!/(^|\s)language-mermaid(\s|$)/.test(className)) return null;
  const source = props.children;
  return typeof source === 'string' ? source.replace(/\n$/, '') : null;
}
