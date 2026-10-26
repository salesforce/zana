import { useLayoutEffect, useState, type RefObject } from 'react';

const OVERLAY_SELECTOR = '[role="dialog"][aria-modal="true"], .consent-overlay, .modal-backdrop, .titlebar-threads-menu[open], .titlebar-thread-context-menu, .instance-menu[open], .thread-tool-drag-shield, .thread-tool-menu, .thread-context-popover';

function isDisplayed(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(element);
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || view.getComputedStyle(node).display === 'none') return false;
  }
  return true;
}

export function useIsBrowserDimmingModalOpen(browserRef: RefObject<HTMLElement | null>): boolean {
  const [open, setOpen] = useState(true);
  useLayoutEffect(() => {
    const browser = browserRef.current;
    if (!browser) return;
    const document = browser.ownerDocument;
    const scan = () => {
      setOpen(Array.from(document.querySelectorAll(OVERLAY_SELECTOR)).some(
        // The inspector containing this browser is its host, not an occluder.
        // Other overlays (including nested/portalled dialogs) still hide it.
        (overlay) => !overlay.contains(browser) && isDisplayed(overlay)
      ));
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'role', 'aria-modal', 'open']
    });
    document.defaultView?.addEventListener('resize', scan);
    return () => {
      observer.disconnect();
      document.defaultView?.removeEventListener('resize', scan);
    };
  }, [browserRef]);
  return open;
}
