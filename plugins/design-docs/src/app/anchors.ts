/**
 * Heading anchors for links like `doc://<ref>/<path>#section` or `other.md#section`.
 *
 * The target file may not be on screen yet, so a request waits here until the preview of
 * that file consumes it. Requests are advisory: a heading that does not exist is ignored.
 */

/** A request nobody consumed this soon is stale and must not scroll a later visit. */
const MAX_AGE_MS = 5000;

interface AnchorRequest {
  at: number;
  docId: string;
  path: string;
  anchor: string;
}

let pending: AnchorRequest | null = null;
const listeners = new Set<() => void>();

export function requestAnchor(docId: string, path: string, anchor: string | null | undefined): void {
  if (!anchor) return;
  pending = { at: Date.now(), docId, path, anchor };
  for (const listener of listeners) listener();
}

/** Take the waiting request when it is for this file; otherwise leave it. */
export function takeAnchor(docId: string, path: string): string | null {
  if (!pending || pending.docId !== docId || pending.path !== path || Date.now() - pending.at > MAX_AGE_MS) return null;
  const { anchor } = pending;
  pending = null;
  return anchor;
}

export function onAnchorRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** GitHub-style heading slug: lower case, punctuation dropped, spaces to hyphens. */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** The heading an anchor names, matched by slug (`#Open Questions` and `#open-questions` both work). */
export function findHeading(root: ParentNode, anchor: string): Element | null {
  const wanted = headingSlug(anchor);
  if (!wanted) return null;
  const headings = [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')];
  const seen = new Map<string, number>();
  for (const heading of headings) {
    const base = headingSlug(heading.textContent ?? '');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    // Repeated headings get -1, -2 ... like GitHub, so `#notes-1` reaches the second "Notes".
    if ((count === 0 ? base : `${base}-${count}`) === wanted) return heading;
  }
  return null;
}
