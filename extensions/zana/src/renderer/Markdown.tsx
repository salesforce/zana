/**
 * In-extension markdown renderer for the zana-tickets bundle.
 *
 * The extension renderer is a self-contained blob-imported bundle — it cannot
 * reach into core's `MarkdownContent` (that pulls in mermaid, highlight.js and
 * the core util pipeline, none of which cross the extension boundary). So the
 * modal renders ticket descriptions / result summaries / artifact bodies /
 * comments through this lean local component instead.
 *
 * Styling: the panel mounts into the HOST document, so core's `global.css`
 * cascades in. We reuse the shared `inbox-md` typography (headings, lists,
 * code, links, tables, blockquotes, hr, strong/em) plus the `zana-md`
 * size override and the `zana-md-table-wrap` scroller — the exact classes the
 * pre-extraction renderer used. (An earlier version wrapped output in a bare
 * `.zana-markdown` class that has NO CSS anywhere, so GFM rendered unstyled;
 * see the shared-CSS coupling note in CLAUDE.md — do not delete these defs.)
 *
 * `react-markdown` + `remark-gfm` are BUNDLED into the extension artifact (the
 * host does not inject them). `unwrapBareFence` comes from the extension SDK's
 * dependency-free `helpers` module and bundles too. React itself resolves
 * through the shimmed `react` alias, so there is still exactly one React
 * instance.
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { unwrapBareFence } from '@zana-ai/zcc-extension-sdk/helpers';

export function MarkdownContent({ text }: { text: string }) {
  // Agents sometimes emit an entire message wrapped in a single ``` fence;
  // strip that so the body renders as markdown, not as one giant code block
  // (same rescue the core inbox renderer applies).
  const body = unwrapBareFence(text);
  return (
    <div className="inbox-md zana-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Open links in the OS browser (Electron treats a new-window target
          // as the default browser). Avoid destructuring `node` (deprecated in
          // react-markdown v10).
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
          // GFM tables get a wrapper so horizontal overflow scrolls within the
          // modal instead of stretching it.
          table: (props) => (
            <div className="zana-md-table-wrap">
              <table {...props} />
            </div>
          )
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
