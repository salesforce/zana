import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { portal } from './portal.js';

/** One dialog shell for details, imports, and settings, outside the panel's clipping context. */
export function Dialog({
  title, icon, onClose, busy = false, children, footer, wide = false,
  className = '', titleId, closeLabel = 'Close', backdropTestId,
}: {
  title: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
  titleId?: string;
  closeLabel?: string;
  backdropTestId?: string;
}) {
  const generatedId = useId();
  const headingId = titleId ?? generatedId;
  const dialogRef = useRef<HTMLDivElement>(null);
  // Capture before child autoFocus runs during commit, or closing a search
  // dialog would try to restore focus to its own now-removed input.
  const openerRef = useRef(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null);
  const latest = useRef({ onClose, busy });
  latest.current = { onClose, busy };

  useEffect(() => {
    const previousFocus = openerRef.current;
    const dialog = dialogRef.current!;
    dialog.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // A child picker handles Escape first. Only the top dialog owns Tab/Escape.
      const dialogs = document.querySelectorAll('.prm-modal');
      if (dialogs[dialogs.length - 1] !== dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!latest.current.busy) latest.current.onClose();
      } else if (event.key === 'Tab') {
        const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]',
        )).filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') &&
          !el.closest('[hidden], [inert]') && getComputedStyle(el).display !== 'none' &&
          getComputedStyle(el).visibility !== 'hidden');
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) {
          event.preventDefault();
          dialog.focus();
        } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const node = (
    <div className="modal-backdrop prm-modal-backdrop" data-testid={backdropTestId}
      onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={headingId}
        className={`modal prm-modal${wide ? ' prm-modal--wide' : ''} ${className}`}>
        <header className="prm-modal-header">
          <h3 id={headingId}>{icon && <span className="prm-modal-icon" aria-hidden>{icon}</span>}{title}</h3>
          <button type="button" className="prm-row-icon-btn" onClick={onClose}
            disabled={busy} title="Close" aria-label={closeLabel}><X size={16} aria-hidden /></button>
        </header>
        {children}
        {footer}
      </div>
    </div>
  );
  return typeof document === 'undefined' ? node : portal(node, document.body);
}
