import { Children, isValidElement, memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'highlight.js/styles/github-dark.css';
import 'katex/dist/katex.min.css';
import { MermaidDiagram } from './MermaidDiagram.js';
import { extractMermaid } from './markdown-mermaid.js';
import { unwrapBareFence } from '../lib/markdown.js';
import { parseFrontMatter, type ParsedFrontMatter } from '@zana-ai/zcc-extension-sdk/helpers';
import { highlightForPath } from '../lib/highlightCode.js';
import { useBooleanPreference } from '../lib/use-boolean-preference.js';
import {
  REWRITE_LOCALHOST_LINKS_DEFAULT,
  REWRITE_LOCALHOST_LINKS_STORAGE_KEY,
  rewriteLocalhostLinkHref
} from '../lib/localhost-link-rewrite-preference.js';
import { handleHttpLinkClick } from '../lib/in-app-browser-link-preference.js';
import { parseLocalFileMarkdownHref, resolveThreadFilePreviewPath } from './markdown-local-file.js';
import { parseThreadMentionHref, remarkThreadMentions } from './markdown-thread-mentions.js';
import { dispatchThreadOpenFile } from './thread/secondary-panel/useThreadOpenFileSignal.js';
import { getThreadRoutePath } from '../lib/route-paths.js';
import { conversationImageSrc } from '../lib/prompt-attachments.js';
import {
  collectMarkdownLightboxItems,
  transformMarkdownMediaUrl
} from './thread/timeline/thread-inline-images.js';
import { ThreadImageLightbox } from './thread/timeline/ThreadImageLightbox.js';
import { mergeLightboxItems } from './thread/timeline/thread-image-lightbox.js';
import {
  highlightMarkdownCode,
  languageFromMarkdownClassName
} from './markdown-code-highlight.js';

/**
 * Shared markdown / doc rendering for the inbox.
 *
 * Extracted so the live detail pane and the PDF export render through the
 * *same* pipeline — react-markdown + remark-gfm + highlight.js (LRU-cached), with
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
  exportable = false,
  threadId,
  projectId
}: {
  path: string;
  content: string;
  mermaidTheme?: 'dark' | 'default';
  exportable?: boolean;
  threadId?: string;
  projectId?: string | null;
}) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.mdx')) {
    // Library docs carry a `---`…`---` metadata header. react-markdown has no
    // notion of front-matter and would render it as a mangled bold blob, so
    // peel it off and surface the useful fields as a clean chip header above
    // the body. Non-front-matter docs render exactly as before.
    const parsed = parseFrontMatter(content);
    const markdown = parsed ? parsed.body : content;
    return (
      <>
        {parsed ? <DocFrontMatter meta={parsed.meta} /> : null}
        <MarkdownContent
          text={markdown}
          mermaidTheme={mermaidTheme}
          exportable={exportable}
          threadId={threadId}
          projectId={projectId}
        />
      </>
    );
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

export const MarkdownContent = memo(function MarkdownContent({
  text,
  mermaidTheme,
  exportable = false,
  breaks = false,
  threadMentions = false,
  threadId,
  projectId,
  filePathHints,
  lightboxItems: providedLightboxItems
}: {
  text: string;
  mermaidTheme?: 'dark' | 'default';
  exportable?: boolean;
  breaks?: boolean;
  threadMentions?: boolean;
  threadId?: string;
  projectId?: string | null;
  filePathHints?: readonly string[];
  lightboxItems?: readonly { src: string; alt: string }[];
}) {
  const body = unwrapBareFence(text);
  const [rewriteLocalhost] = useBooleanPreference(
    REWRITE_LOCALHOST_LINKS_STORAGE_KEY,
    REWRITE_LOCALHOST_LINKS_DEFAULT
  );
  const hostname = typeof window !== 'undefined' ? window.location.hostname : undefined;
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const collectedLightboxItems = useMemo(
    () => collectMarkdownLightboxItems(body, projectId),
    [body, projectId]
  );
  const lightboxItems = providedLightboxItems ?? collectedLightboxItems;
  const remarkPlugins = useMemo(
    () => [
      remarkGfm,
      remarkMath,
      ...(breaks ? [remarkBreaks] : []),
      ...(threadMentions ? [remarkThreadMentions] : [])
    ],
    [breaks, threadMentions]
  );
  // Keep the mermaid `pre` renderer identity stable. An inline `components.pre`
  // is a new component type every pass, which remounts MermaidDiagram and
  // flashes "Rendering diagram…" while mermaid.render is cancelled.
  const renderFencedPre = useCallback(
    (props: { children?: ReactNode }) => {
      const mermaid = extractMermaid(props.children);
      if (mermaid !== null) {
        return <MermaidDiagram code={mermaid} theme={mermaidTheme} exportable={exportable} />;
      }
      const highlighted = highlightFencedPre(props.children);
      if (highlighted) {
        return (
          <pre>
            <code
              className={highlighted.className}
              dangerouslySetInnerHTML={highlighted.html}
            />
          </pre>
        );
      }
      return <pre {...props} />;
    },
    [exportable, mermaidTheme]
  );
  return (
    <>
      <div className="inbox-md">
        <ReactMarkdown
        remarkPlugins={remarkPlugins}
        urlTransform={(url) => transformMarkdownMediaUrl(url, defaultUrlTransform)}
        rehypePlugins={[
          // html-only avoids KaTeX's sibling MathML+HTML trees, which React
          // warns about as an unkeyed list.
          [rehypeKatex, { throwOnError: false, output: 'html' }]
        ]}
        components={{
          // Plain click opens the OS browser. Cmd/Ctrl-click opens the
          // in-app side panel. Avoid destructuring `node` (deprecated in
          // react-markdown v10).
          a: (props) => {
            const mentionId = parseThreadMentionHref(
              typeof props.href === 'string' ? props.href : undefined
            );
            if (mentionId) {
              return (
                <a
                  className="thread-mention-pill"
                  href={getThreadRoutePath(mentionId, projectId ?? undefined)}
                >
                  {props.children}
                </a>
              );
            }
            const localPath = parseLocalFileMarkdownHref(
              typeof props.href === 'string' ? props.href : undefined
            );
            if (localPath) {
              return (
                <a
                  {...props}
                  href={props.href}
                  onClick={(event) => {
                    event.preventDefault();
                    if (threadId) dispatchThreadOpenFile(threadId, localPath);
                  }}
                />
              );
            }
            const href = rewriteLocalhostLinkHref({
              currentHostname: hostname,
              enabled: rewriteLocalhost,
              href: typeof props.href === 'string' ? props.href : undefined
            });
            return (
              <a
                {...props}
                href={href}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => {
                  if (!href || event.shiftKey || event.altKey) return;
                  if (handleHttpLinkClick(href, { event, ownerId: threadId })) {
                    event.preventDefault();
                  }
                }}
              />
            );
          },
          // GFM tables get a wrapper so horizontal overflow scrolls within
          // the comments block instead of stretching the whole panel.
          table: ({ children, ...props }) => (
            <div className="inbox-md-table-wrap">
              <table {...props}>{Children.toArray(children)}</table>
            </div>
          ),
          // Intercept ```mermaid fences and render them as diagrams. A
          // non-mermaid fence falls through to the default <pre>. We hook
          // `pre` (not `code`) so the rendered SVG isn't nested inside a
          // monospace code block.
          pre: renderFencedPre,
          code: (props) => {
            const className = typeof props.className === 'string' ? props.className : '';
            const fenced = /(^|\s)language-/.test(className) || /(^|\s)hljs(\s|$)/.test(className);
            const token = inlineCodeText(props.children);
            const path = !fenced && !exportable && threadId
              ? resolveThreadFilePreviewPath(token, filePathHints)
              : null;
            if (path && threadId) {
              const name = path.split(/[/\\]/u).pop() ?? path;
              return (
                <button
                  type="button"
                  className="inbox-md-file-chip"
                  data-testid="inbox-md-file-chip"
                  aria-label={`Preview ${name}`}
                  title={path}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    dispatchThreadOpenFile(threadId, path);
                  }}
                >
                  {props.children}
                </button>
              );
            }
            return <code className={className || undefined}>{props.children}</code>;
          },
          img: (props) => {
            const raw = typeof props.src === 'string' ? props.src : '';
            const src = conversationImageSrc(projectId, raw) ?? (/^(https?:|data:image\/|blob:)/iu.test(raw) ? raw : null);
            if (!src) return null;
            const alt = typeof props.alt === 'string' && props.alt.length > 0 ? props.alt : 'Image';
            const image = (
              <img
                {...props}
                src={src}
                className="inbox-md-img"
                alt={alt}
                loading="lazy"
                decoding="async"
              />
            );
            if (exportable) return image;
            return (
              <button
                type="button"
                className="inbox-md-img-open"
                aria-label={`View ${alt}`}
                onClick={() => setLightbox({ src, alt })}
              >
                {image}
              </button>
            );
          }
        }}
      >
        {body}
      </ReactMarkdown>
      </div>
      {lightbox ? (
        <ThreadImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          items={mergeLightboxItems(lightboxItems, lightbox)}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </>
  );
});

function inlineCodeText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(inlineCodeText).join('');
  return '';
}

function highlightFencedPre(children: ReactNode): {
  className: string;
  html: { __html: string };
} | null {
  if (!isValidElement(children)) return null;
  const props = children.props as { className?: string; children?: ReactNode };
  const source = typeof props.children === 'string' ? props.children.replace(/\n$/, '') : null;
  if (source === null) return null;
  const language = languageFromMarkdownClassName(props.className);
  const className = ['hljs', props.className].filter(Boolean).join(' ');
  return {
    className,
    html: highlightMarkdownCode({ code: source, language })
  };
}
