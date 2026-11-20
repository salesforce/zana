import { useEffect, useMemo, useRef, type RefObject } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DocumentImage } from '../DocumentImage.js';
import { DocumentLinkBoundary } from '../DocumentLinkBoundary.js';
import { CopyableFencedPre } from '../FencedCodeBlock.js';
import { DomFindBar } from '../DomFindBar.js';
import { documentLinkUrlTransform, type DocumentLink } from '../document-links.js';
import { transformMarkdownMediaUrl } from '../thread/timeline/thread-inline-images.js';
import { useDomFind } from '../../lib/use-dom-find.js';

// Module-level so every render passes the same component types: inline arrows
// would remount the table on each find keystroke and detach the highlighted
// ranges.
// Only what the app CSP allows (img-src has https:, data:, blob:). http: and
// protocol-relative //host sources are not loaded: they would show a broken
// image, and //host can resolve to file://host (a UNC/SMB fetch on Windows).
const INLINE_IMAGE_SRC = /^(https:|data:image\/|blob:)/iu;

// Images keep data: sources (the default transform strips them), and relative
// paths stay untouched so the img component can resolve them against the file.
function previewUrlTransform(url: string, key: string): string {
  return key === 'src' ? transformMarkdownMediaUrl(url, defaultUrlTransform) : documentLinkUrlTransform(url, key);
}

function documentImageComponent(documentPath: string, readsLocalFiles: boolean): Components['img'] {
  return ({ src, alt, title }) => {
    const raw = String(src); // react-markdown always passes a string src for an img (empty for `![]()`)
    const label = alt || 'Image';
    // Inline and remote images load as-is (CSP allows them); anything else is a
    // path next to the open file, read through the confined file API.
    if (INLINE_IMAGE_SRC.test(raw)) return <img className="inbox-md-img" src={raw} alt={label} title={title} loading="lazy" decoding="async" />;
    // A remote project's markdown comes from the remote checkout, but the file
    // reader here is the local disk: the same path could show an unrelated local
    // file. There is no remote image reader, so show the alt text instead.
    if (!readsLocalFiles) return <span title={raw}>{label}</span>;
    return <DocumentImage documentPath={documentPath} src={raw} alt={label} title={title} />;
  };
}

const BASE_COMPONENTS: Components = {
  table: ({ node: _node, ...props }) => <div className="inbox-md-table-wrap"><table {...props} /></div>,
  // Same pinned Copy code button as MarkdownContent (#464).
  pre: CopyableFencedPre
};

/**
 * Puts keyboard focus in the preview when it opens from the viewer toolbar (or
 * from nowhere), so Ctrl+F works straight away. Focus the user placed elsewhere,
 * e.g. in the file tree, is left alone.
 */
function useFocusPreviewOnOpen(hostRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const host = hostRef.current;
    const active = document.activeElement;
    const fromViewer = !active || active === document.body || (host && active.closest('.explorer-viewer') !== null && active.closest('.explorer-viewer') === host.closest('.explorer-viewer'));
    if (host && fromViewer) host.focus({ preventScroll: true });
  }, [hostRef]);
}

export default function MarkdownPreview({ content, documentPath, fragment, onOpenDocument, remote = false }: {
  content: string;
  documentPath: string;
  /** The document lives on a remote checkout, so images next to it can't be read from the local disk. */
  remote?: boolean;
  fragment?: string;
  onOpenDocument?: (link: DocumentLink) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useFocusPreviewOnOpen(hostRef);
  // One component per document: a stable identity keeps highlighted ranges attached while finding.
  const components = useMemo<Components>(() => ({ ...BASE_COMPONENTS, img: documentImageComponent(documentPath, !remote) }), [documentPath, remote]);
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
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={previewUrlTransform} components={components}>{content}</ReactMarkdown>
    </div></DocumentLinkBoundary>
  </div>;
}
