import { useEffect } from 'react';

/**
 * The backdrops the app's modals draw over the page. Only a drawn backdrop
 * darkens the page, so `aria-modal` alone (compact popovers and mobile sheets
 * set it without one) doesn't count.
 */
export const MODAL_SELECTOR = '.modal-backdrop, .palette-backdrop, .consent-overlay, .peers-dialog-backdrop';

/** The backdrop's own alpha (`rgba(0, 0, 0, a)`), so the caption buttons dim as much as the page. */
export function backdropAlpha(el: Element): number | undefined {
  const match = getComputedStyle(el).backgroundColor.match(/^rgba?\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (!match) return undefined;
  if (match[1] === undefined) return 1;
  const alpha = match[1].endsWith('%') ? Number.parseFloat(match[1]) / 100 : Number.parseFloat(match[1]);
  return Number.isFinite(alpha) ? alpha : undefined;
}

function touchesModal(nodes: NodeList): boolean {
  for (const node of Array.from(nodes)) {
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    if (el.matches(MODAL_SELECTOR) || el.querySelector(MODAL_SELECTOR)) return true;
  }
  return false;
}

/**
 * Tell the desktop shell whether a modal backdrop is showing, so the native
 * Windows caption buttons (outside the page, so not covered by the CSS
 * backdrop) dim with the rest of the window. Reports the initial state on
 * mount (a reloaded window starts un-dimmed) and then every change. A no-op
 * outside the desktop app.
 *
 * The observer only watches nodes being added or removed, and only re-checks
 * the page when one of them is, or contains, a backdrop.
 */
export function useModalTitleBarDim(): void {
  useEffect(() => {
    const report = window.cc?.app?.setModalOpen;
    if (!report) return;
    let last: boolean | undefined;
    let lastAlpha: number | undefined;
    const sync = () => {
      const backdrop = document.querySelector(MODAL_SELECTOR);
      const open = backdrop !== null;
      const alpha = backdrop ? backdropAlpha(backdrop) : undefined;
      if (open === last && alpha === lastAlpha) return;
      last = open;
      lastAlpha = alpha;
      void (alpha === undefined ? report(open) : report(open, alpha)).catch(() => undefined);
    };
    sync();
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => touchesModal(m.addedNodes) || touchesModal(m.removedNodes))) sync();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (last) void report(false).catch(() => undefined);
    };
  }, []);
}
