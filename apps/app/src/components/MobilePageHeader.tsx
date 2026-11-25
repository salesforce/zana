import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, X } from 'lucide-react';
import { useMobileThreadControlsTarget, useMobileThreadTitleTarget } from './useMobileThreadTitleTarget.js';
import '../styles/mobile-page-header.css';

/** A page lends its title and two actions to the existing mobile shell row. */
export function MobilePageHeader({ title, primary, children, enabled = true }: {
  title: string;
  primary?: ReactNode;
  children?: ReactNode;
  enabled?: boolean;
}) {
  const titleTarget = useMobileThreadTitleTarget(enabled);
  const controlsTarget = useMobileThreadControlsTarget(enabled);
  return <>
    {titleTarget && createPortal(<h1 className="mobile-page-title" title={title}>{title}</h1>, titleTarget)}
    {controlsTarget && createPortal(<div className="mobile-page-actions">
      {primary}
      {children && <MobileMoreMenu title={title}>{children}</MobileMoreMenu>}
    </div>, controlsTarget)}
  </>;
}

export function MobileMoreMenu({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="icon-btn" aria-label={`${title} actions`}
      aria-haspopup="dialog" aria-expanded={open} onClick={(event) => { event.currentTarget.focus(); setOpen(true); }}>
      <MoreHorizontal size={20} aria-hidden="true" />
    </button>
    {open && <MobileActionSheet title={`${title} actions`} onClose={() => setOpen(false)}>{children}</MobileActionSheet>}
  </>;
}

/** One touch-sized, labeled sheet for secondary page actions. */
export function MobileActionSheet({ title, children, onClose }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    const shell = document.querySelector('.app-shell');
    const wasInert = shell?.hasAttribute('inert');
    shell?.setAttribute('inert', '');
    panel?.focus();
    return () => {
      if (!wasInert) shell?.removeAttribute('inert');
      if (opener?.isConnected && (panel?.contains(document.activeElement) || document.activeElement === document.body)) opener.focus();
    };
  }, []);
  return createPortal(<div className="mobile-action-sheet-backdrop" onClick={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <div ref={ref} className="mobile-action-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
      onKeyDown={(event) => {
        if (!event.currentTarget.contains(event.target as Node) || event.defaultPrevented) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
        if (event.key !== 'Tab') return;
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')]
          .filter((element) => !element.closest('[hidden]') && getComputedStyle(element).display !== 'none');
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <header><h2>{title}</h2><button type="button" className="icon-btn" aria-label="Close actions" onClick={onClose}><X size={20} /></button></header>
      <div className="mobile-action-sheet-body" onClick={(event) => {
        const button = (event.target as HTMLElement).closest('button');
        if (button && event.currentTarget.contains(button) && !button.disabled && !button.closest('[data-keep-sheet-open]')) onClose();
      }}>{children}</div>
    </div>
  </div>, document.body);
}
