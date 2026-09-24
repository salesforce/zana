/**
 * Shared Settings-area UI primitives — the per-area header (title + one-line
 * subtitle, R-SET-004), a generic modal dialog (reusing the core
 * `modal-backdrop`/`modal` shell like {@link PullPrModal}), a Confirm dialog for
 * destructive actions (Delete org/repo — R-ORG-006 / R-REPO-011), and the
 * connection pill (R-ORG-005) shared by Organizations / Repositories / Author.
 */

import { type ReactNode } from 'react';
import { CircleCheck, CircleX, Loader2 } from 'lucide-react';
import { Dialog } from '../Dialog.js';
export { Dialog } from '../Dialog.js';
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
