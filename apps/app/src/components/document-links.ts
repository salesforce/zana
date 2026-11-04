import { defaultUrlTransform } from 'react-markdown';
import { resolveDocumentImagePath } from './markdown-document-image.js';

export interface DocumentLink {
  path: string;
  fragment: string;
}

/** Resolve against the document, never against the renderer's URL. Readers still authorize paths. */
export function resolveDocumentLink(documentPath: string, href: string): DocumentLink | null {
  const hash = href.indexOf('#');
  let fragment: string;
  try {
    fragment = hash < 0 ? '' : decodeURIComponent(href.slice(hash + 1));
  } catch {
    return null;
  }
  const path = href.startsWith('#') ? documentPath : resolveDocumentImagePath(documentPath, href);
  return path ? { path, fragment } : null;
}

/** file: links are handled by the document boundary, never by native navigation. */
export function documentLinkUrlTransform(url: string, key: string): string {
  return key === 'href' && /^file:/iu.test(url) ? url : defaultUrlTransform(url);
}

export function scrollToDocumentFragment(root: HTMLElement, fragment: string): void {
  if (!fragment) {
    root.scrollTo?.({ top: 0 });
    return;
  }
  const counts = new Map<string, number>();
  const target = Array.from(root.querySelectorAll<HTMLElement>('[id], h1, h2, h3, h4, h5, h6')).find((element) => {
    if (element.id === fragment) return true;
    if (!/^H[1-6]$/u.test(element.tagName)) return false;
    const slug = (element.textContent ?? '').toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/gu, '-');
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    return (count ? `${slug}-${count}` : slug) === fragment;
  });
  target?.scrollIntoView?.({ block: 'start' });
}
