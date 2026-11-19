import { useRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DocumentLinkBoundary } from '../DocumentLinkBoundary.js';
import { CopyableFencedPre } from '../FencedCodeBlock.js';
import { DomFindBar } from '../DomFindBar.js';
import { documentLinkUrlTransform, type DocumentLink } from '../document-links.js';
import { useDomFind } from '../../lib/use-dom-find.js';

// Module-level so every render passes the same component types: inline arrows
// would remount the table on each find keystroke and detach the highlighted
// ranges.
const MARKDOWN_COMPONENTS: Components = {
  table: ({ node: _node, ...props }) => <div className="inbox-md-table-wrap"><table {...props} /></div>,
  // Same pinned Copy code button as MarkdownContent (#464).
  pre: CopyableFencedPre
};

export default function MarkdownPreview({ content, documentPath, fragment, onOpenDocument }: {
  content: string;
  documentPath: string;
  fragment?: string;
  onOpenDocument?: (link: DocumentLink) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const find = useDomFind(contentRef, hostRef, `${documentPath}\n${content}`);
  // The host owns Ctrl+F (data-own-find), so thread find stays out of the preview.
  return <div ref={hostRef} className="explorer-md-find-host" {...find.hostProps}>
    {find.open && <DomFindBar
      label="Find in preview"
      value={find.query}
      onChange={find.setQuery}
      onStep={find.step}
      onClose={find.close}
      matchIndex={find.matchIndex}
      matchCount={find.matchCount}
      focusRequest={find.focusRequest}
    />}
    <DocumentLinkBoundary className="explorer-md-preview" documentPath={documentPath} fragment={fragment} onOpenDocument={onOpenDocument}><div className="inbox-md" ref={contentRef}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={documentLinkUrlTransform} components={MARKDOWN_COMPONENTS}>{content}</ReactMarkdown>
    </div></DocumentLinkBoundary>
  </div>;
}
