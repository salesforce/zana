/**
 * Shared Settings-area UI primitives — the per-area header (title + one-line
 * subtitle, R-SET-004), a generic modal dialog (reusing the core
 * `modal-backdrop`/`modal` shell like {@link PullPrModal}), a Confirm dialog for
 * destructive actions (Delete org/repo — R-ORG-006 / R-REPO-011), and the
 * connection pill (R-ORG-005) shared by Organizations / Repositories / Author.
 */

import { useEffect, type ReactNode } from 'react';
import { X, CircleCheck, CircleX, Loader2 } from 'lucide-react';
import type { ConnectionState } from '../../../lib/types.js';

/** Per-area header: bold title + a single muted subtitle line (R-SET-004). */
export function AreaHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <header className="prm-area-header">
      <div className="prm-area-heading">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      {actions && <div className="prm-area-actions">{actions}</div>}
    </header>
  );
}

/** Live connection pill (R-ORG-005). `checking` is a transient in-flight state. */
export function ConnectionPill({ state }: { state: ConnectionState }) {
  if (state === 'checking') {
    return (
      <span className="prm-conn-pill prm-conn-pill--checking">
        <Loader2 size={11} className="prm-spin" /> Checking
      </span>
    );
  }
  if (state === 'connected') {
    return (
      <span className="prm-conn-pill prm-conn-pill--connected">
        <CircleCheck size={11} /> Connected
      </span>
    );
  }
  return (
    <span className="prm-conn-pill prm-conn-pill--disconnected">
      <CircleX size={11} /> Disconnected
    </span>
  );
}

/** Generic modal dialog. Escape + backdrop click close (unless `busy`). */
export function Dialog({
  title,
  icon,
  onClose,
  busy,
  footer,
  children,
  wide,
}: {
  title: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  busy?: boolean;
  footer?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div
        className={`modal prm-modal${wide ? ' prm-modal--wide' : ''}`}
        role="dialog"
        aria-modal
        onClick={(e) => e.stopPropagation()}
      >
        <header className="prm-modal-header">
          <h3>
            {icon} {title}
          </h3>
          <button
            type="button"
            className="prm-row-icon-btn"
            onClick={onClose}
            disabled={busy}
            title="Close"
          >
            <X size={14} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** Confirm/cancel dialog for destructive actions. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog title={title} onClose={onCancel} busy={busy}>
      <div className="prm-modal-body">{message}</div>
      <footer className="prm-modal-footer">
        <button type="button" className="prm-btn" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`prm-btn ${danger ? 'prm-btn--danger' : 'prm-btn--primary'}`}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? <Loader2 size={13} className="prm-spin" /> : null}
          <span>{confirmLabel}</span>
        </button>
      </footer>
    </Dialog>
  );
}
