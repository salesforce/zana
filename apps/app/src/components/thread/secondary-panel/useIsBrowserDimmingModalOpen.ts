import { useEffect, useState } from 'react';

export function useIsBrowserDimmingModalOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const scan = () => {
      setOpen(Boolean(
        document.querySelector('[role="dialog"][aria-modal="true"], .consent-overlay, .modal-backdrop')
      ));
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    return () => observer.disconnect();
  }, []);
  return open;
}
