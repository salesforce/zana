import { useCallback, useEffect, useRef, type MouseEvent, type ReactNode, type RefCallback } from 'react';
import { handleHttpLinkClick } from '../lib/in-app-browser-link-preference.js';
import { resolveDocumentLink, scrollToDocumentFragment, type DocumentLink } from './document-links.js';

/** Own native anchor activation in document previews and contenteditable editors. */
export function DocumentLinkBoundary({
  documentPath, fragment = '', onOpenDocument, children, className, interceptLinks = true, elementRef
}: {
  documentPath: string;
  fragment?: string;
  onOpenDocument?: (link: DocumentLink) => void;
  children: ReactNode;
  className?: string;
  interceptLinks?: boolean;
  elementRef?: RefCallback<HTMLDivElement>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const attach = useCallback((node: HTMLDivElement | null) => { root.current = node; return elementRef?.(node); }, [elementRef]);
  useEffect(() => {
    if (root.current && fragment) scrollToDocumentFragment(root.current, fragment);
  }, [documentPath, fragment]);

  const openLink = (event: MouseEvent<HTMLDivElement>) => {
    if (!interceptLinks) return;
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

  return <div ref={attach} className={className} onClickCapture={openLink} onAuxClickCapture={openLink}>{children}</div>;
}
