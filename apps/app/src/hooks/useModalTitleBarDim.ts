import { useEffect } from 'react';

/** What the app's modals render: the backdrop classes and any aria-modal dialog. */
export const MODAL_SELECTOR = "[aria-modal='true'], .modal-backdrop, .palette-backdrop";

/**
 * Tell the desktop shell whether a modal backdrop is showing, so the native
 * Windows caption buttons (outside the page, so not covered by the CSS
 * backdrop) dim with the rest of the window. Reports the initial state on
 * mount (a reloaded window starts un-dimmed) and then every change. A no-op
 * outside the desktop app.
 */
export function useModalTitleBarDim(): void {
  useEffect(() => {
    const report = window.cc?.app?.setModalOpen;
    if (!report) return;
    let last: boolean | undefined;
    const sync = () => {
      const open = document.querySelector(MODAL_SELECTOR) !== null;
      if (open === last) return;
      last = open;
      void report(open).catch(() => undefined);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'class'] });
    return () => {
      observer.disconnect();
      if (last) void report(false).catch(() => undefined);
    };
  }, []);
}
