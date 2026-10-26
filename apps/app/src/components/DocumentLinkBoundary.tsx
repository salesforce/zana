import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { handleHttpLinkClick } from '../lib/in-app-browser-link-preference.js';
import { resolveDocumentLink, scrollToDocumentFragment, type DocumentLink } from './document-links.js';

/** Own native anchor activation in document previews and contenteditable editors. */
export function DocumentLinkBoundary({
  documentPath, fragment = '', onOpenDocument, children, className
}: {
  documentPath: string;
  fragment?: string;
  onOpenDocument?: (link: DocumentLink) => void;
  children: ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (root.current && fragment) scrollToDocumentFragment(root.current, fragment);
  }, [documentPath, fragment]);

  const openLink = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button > 1 || !(event.target instanceof Element)) return;
    const anchor = event.target.closest('a');
    if (!anchor || !event.currentTarget.contains(anchor)) return;
    event.preventDefault();
    event.stopPropagation();
    const href = anchor.getAttribute('href')?.trim();
    if (!href) return;
    if (handleHttpLinkClick(href, { event })) return;
    if (/^(mailto|tel):/iu.test(href)) {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    const link = resolveDocumentLink(documentPath, href);
    if (!link) return;
    if (link.path === documentPath) scrollToDocumentFragment(event.currentTarget, link.fragment);
    else onOpenDocument?.(link);
  };

  return <div ref={root} className={className} onClickCapture={openLink} onAuxClickCapture={openLink}>{children}</div>;
}
