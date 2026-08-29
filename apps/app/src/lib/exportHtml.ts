/**
 * Serialize an already-rendered DOM subtree into a self-contained HTML
 * document for PDF export.
 *
 * The inbox detail is rendered live — mermaid blocks are inline SVG, code
 * blocks carry highlight.js spans. Rather than re-run a markdown pipeline in
 * the main process (and risk drift), we snapshot exactly what's on screen:
 * clone the node, inline every accessible stylesheet, and carry the active
 * theme across so colors match.
 */

/** Pull cssText out of every same-origin stylesheet on the page. */
function collectCss(): string {
  const chunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      for (const rule of Array.from(rules)) chunks.push(rule.cssText);
    } catch {
      // Cross-origin sheet — cssRules access throws. All app CSS is bundled
      // same-origin, so skipping these loses nothing.
    }
  }
  return chunks.join('\n');
}

/**
 * Build a standalone HTML document string from a rendered element.
 *
 * @param el     the subtree to export (cloned, not mutated)
 * @param title  document <title> and heading
 */
export function buildStandaloneHtml(el: HTMLElement, title: string): string {
  const css = collectCss();
  const bodyHtml = el.cloneNode(true) as HTMLElement;

  return [
    '<!doctype html>',
    // Always LIGHT, regardless of the app's current theme: the export is a
    // portable printed document, not a snapshot of the (dark) dashboard. This
    // single attribute flips every `var(--*)` token used by the shared markdown
    // CSS to the light palette already defined at `:root[data-theme='light']`.
    '<html data-theme="light">',
    '<head>',
    '<meta charset="utf-8" />',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${css}</style>`,
    `<style>${DOCUMENT_CSS}</style>`,
    '</head>',
    '<body>',
    `<div class="pdf-export-root">${bodyHtml.outerHTML}</div>`,
    '</body>',
    '</html>'
  ].join('\n');
}

/**
 * Print-document overrides, layered after the inlined app CSS so they win.
 *
 * Forcing `data-theme="light"` (above) already flips prose, headings, tables,
 * and borders to the light palette. This block adds the document frame (white
 * page, centered measure, print margins) and overrides the two things the
 * theme attribute can't fix on its own:
 *   - Code blocks are pinned to a dark `#0d1117` surface with the github-DARK
 *     hljs palette in *both* app themes — a dark slab on a white page. We
 *     repaint the surface light and restate the github-LIGHT syntax token
 *     colors so fenced code and highlighted source docs read like a printed
 *     GitHub README.
 *   - `print-color-adjust: exact` keeps Chromium's printToPDF from dropping our
 *     backgrounds (code blocks, table headers) — without it they print white.
 */
const DOCUMENT_CSS = `
  html, body { height: auto; margin: 0; padding: 0; }
  body {
    background: #ffffff;
    color: #1f2328;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  @page { margin: 18mm 16mm; }
  .pdf-export-root {
    max-width: 760px;
    margin: 0 auto;
    font-size: 11pt;
    line-height: 1.6;
  }

  /* Document masthead. */
  .pdf-report-title {
    font-size: 22pt;
    margin: 0 0 24px;
    padding-bottom: 14px;
    border-bottom: 2px solid #d8dee4;
  }

  /* Flat doc sections — no panel cards. A quiet filename caption separates
     multiple docs; single-doc exports show none (see ReportBody). */
  .pdf-report-doc + .pdf-report-doc {
    margin-top: 28px;
    padding-top: 24px;
    border-top: 1px solid #d8dee4;
  }
  .pdf-report-doc-name {
    font-family: 'JetBrains Mono', 'SF Mono', monospace;
    font-size: 10pt;
    font-weight: 600;
    color: #57606a;
    margin: 0 0 12px;
  }
  .pdf-report-tombstone { font-style: italic; color: #57606a; }

  /* Library front-matter chip header (summary + tags + date). Light palette,
     since the export tokens don't resolve on the standalone doc. */
  .pdf-export-root .inbox-doc-meta {
    padding-bottom: 12px;
    margin-bottom: 14px;
    border-bottom: 1px solid #d8dee4;
  }
  .pdf-export-root .inbox-doc-meta-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .pdf-export-root .inbox-doc-meta-summary {
    margin: 0;
    font-size: 10.5pt;
    line-height: 1.5;
    color: #57606a;
  }
  .pdf-export-root .inbox-doc-meta-date {
    font-size: 9pt;
    color: #6e7781;
    white-space: nowrap;
  }
  .pdf-export-root .inbox-doc-meta-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 8px;
  }
  .pdf-export-root .inbox-doc-meta-tag {
    padding: 2px 8px;
    border: 1px solid #d8dee4;
    border-radius: 999px;
    color: #57606a;
    font-size: 9pt;
  }
  .pdf-report-comments.has-divider {
    margin-top: 28px;
    padding-top: 24px;
    border-top: 1px solid #d8dee4;
  }
  .pdf-report-section-label {
    font-size: 9pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #57606a;
    margin-bottom: 10px;
  }

  /* Links: keep them blue + underlined, and print the target so a URL isn't
     lost on paper. Skip in-page anchors and bare-text links. */
  .pdf-export-root .inbox-md a { color: #0969da; text-decoration: underline; }
  .pdf-export-root .inbox-md a[href^="http"]::after {
    content: " (" attr(href) ")";
    font-size: 9pt;
    color: #57606a;
    word-break: break-all;
  }

  /* Code blocks → light GitHub-README surface (override the pinned-dark rules
     in both the fenced-markdown and source-doc paths). */
  .pdf-export-root .inbox-md pre,
  .pdf-export-root .inbox-doc-pre.hljs {
    background: #f6f8fa;
    border: 1px solid #d8dee4;
  }
  .pdf-export-root .inbox-md pre code,
  .pdf-export-root .inbox-md pre code.hljs,
  .pdf-export-root .inbox-doc-pre.hljs code,
  .pdf-export-root .inbox-doc-pre.hljs code.hljs {
    color: #24292e;
  }
  .pdf-export-root .inbox-md code { background: #eff1f3; color: #1f2328; }

  /* github-light hljs token palette (from highlight.js/styles/github.css),
     scoped to the export so the live app keeps its github-dark theme. */
  .pdf-export-root .hljs { color: #24292e; background: transparent; }
  .pdf-export-root .hljs-doctag,
  .pdf-export-root .hljs-keyword,
  .pdf-export-root .hljs-meta .hljs-keyword,
  .pdf-export-root .hljs-template-tag,
  .pdf-export-root .hljs-template-variable,
  .pdf-export-root .hljs-type,
  .pdf-export-root .hljs-variable.language_ { color: #d73a49; }
  .pdf-export-root .hljs-title,
  .pdf-export-root .hljs-title.class_,
  .pdf-export-root .hljs-title.class_.inherited__,
  .pdf-export-root .hljs-title.function_ { color: #6f42c1; }
  .pdf-export-root .hljs-attr,
  .pdf-export-root .hljs-attribute,
  .pdf-export-root .hljs-literal,
  .pdf-export-root .hljs-meta,
  .pdf-export-root .hljs-number,
  .pdf-export-root .hljs-operator,
  .pdf-export-root .hljs-variable,
  .pdf-export-root .hljs-selector-attr,
  .pdf-export-root .hljs-selector-class,
  .pdf-export-root .hljs-selector-id { color: #005cc5; }
  .pdf-export-root .hljs-regexp,
  .pdf-export-root .hljs-string,
  .pdf-export-root .hljs-meta .hljs-string { color: #032f62; }
  .pdf-export-root .hljs-built_in,
  .pdf-export-root .hljs-symbol { color: #e36209; }
  .pdf-export-root .hljs-comment,
  .pdf-export-root .hljs-code,
  .pdf-export-root .hljs-formula { color: #6a737d; }
  .pdf-export-root .hljs-name,
  .pdf-export-root .hljs-quote,
  .pdf-export-root .hljs-selector-tag,
  .pdf-export-root .hljs-selector-pseudo { color: #22863a; }
  .pdf-export-root .hljs-subst { color: #24292e; }
  .pdf-export-root .hljs-section { color: #005cc5; font-weight: bold; }
  .pdf-export-root .hljs-bullet { color: #735c0f; }
  .pdf-export-root .hljs-emphasis { color: #24292e; font-style: italic; }
  .pdf-export-root .hljs-strong { color: #24292e; font-weight: bold; }
  .pdf-export-root .hljs-addition { color: #22863a; background-color: #f0fff4; }
  .pdf-export-root .hljs-deletion { color: #b31d28; background-color: #ffeef0; }

  /* Mermaid renders its own (light, 'default'-theme) SVG; drop the app's dark
     panel tint so it sits on the white page. */
  .pdf-export-root .inbox-mermaid { background: transparent; padding: 0; }

  /* ---- Page-break hygiene ----
     Chromium's printToPDF honors a subset of CSS fragmentation: break-inside /
     break-after, orphans / widows, and thead repetition. Best-effort, not
     LaTeX — but enough to avoid stranded headings, split rows, and dangling
     lines. */

  /* Headings keep with the content that follows — never stranded at a page
     foot with their section starting on the next page. */
  .pdf-export-root .inbox-md h1,
  .pdf-export-root .inbox-md h2,
  .pdf-export-root .inbox-md h3,
  .pdf-export-root .inbox-md h4,
  .pdf-report-title,
  .pdf-report-doc-name { break-after: avoid; }

  /* No single dangling line of a paragraph orphaned/widowed across a break. */
  .pdf-export-root .inbox-md p,
  .pdf-export-root .inbox-md li { orphans: 3; widows: 3; }

  /* Atomic blocks: keep each one whole across a page break. (Deliberately NOT
     .pdf-report-doc — that can wrap the entire document and must be allowed to
     flow across pages.) A block taller than a page still breaks: Chromium
     ignores 'avoid' when honoring it is impossible. */
  .pdf-export-root .inbox-mermaid,
  .pdf-export-root .inbox-md pre,
  .pdf-export-root .inbox-md blockquote,
  .pdf-export-root .inbox-md li,
  .pdf-export-root .inbox-md img { break-inside: avoid; }
  .pdf-export-root .inbox-md img { max-width: 100%; }

  /* Tables: let a long table fragment by ROW (overflow:auto is meaningless in
     print and would CLIP rows past a page edge — switch to visible so rows
     flow). Keep each row intact, and repeat the header on every page. */
  .pdf-export-root .inbox-md-table-wrap { overflow: visible; }
  .pdf-export-root .inbox-md thead { display: table-header-group; }
  .pdf-export-root .inbox-md tr { break-inside: avoid; }
`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
