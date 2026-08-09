import { useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useDialogFocusTrap } from '../util/useDialogFocusTrap';

interface ModalProps {
  /**
   * Accessible dialog title. Rendered as the `<h3>` in the header when
   * `header` is not overridden, and always used as the dialog's `aria-label`.
   */
  title: string;
  /** Close request from Escape, the backdrop, or the header ✕. */
  onClose: () => void;
  /** Dialog body. */
  children: ReactNode;
  /** Footer content (usually the action buttons). Omit for a footer-less modal. */
  footer?: ReactNode;
  /**
   * Extra class(es) appended to the `.modal` shell so a caller keeps its
   * per-modal CSS (e.g. `scheduler-modal`, `prompt-modal`). The shared
   * `.modal` base always applies.
   */
  className?: string;
  /**
   * Replace the default `.modal-header` (title + ✕) entirely — for the few
   * modals that render a custom header. When set, `title` is still used as the
   * `aria-label` but no default header is drawn.
   */
  header?: ReactNode;
  /** Extra class(es) appended to `.modal-body` (e.g. `scheduler-confirm-body`). */
  bodyClassName?: string;
  /** Hide the header ✕ button (e.g. a forced-choice confirm). Default false. */
  hideClose?: boolean;
  /**
   * When false, a backdrop mousedown does NOT close the modal (a destructive
   * confirm that must be answered with a button). Escape still closes unless
   * you also handle that upstream. Default true.
   */
  closeOnBackdrop?: boolean;
  /** Optional id for the shell (rare — e.g. a test hook). */
  id?: string;
}

/**
 * The shared modal-dialog primitive. Consolidates the backdrop + `.modal`
 * shell, Escape/Tab focus-trap (via {@link useDialogFocusTrap}), backdrop
 * click-to-close, and `role="dialog"`/`aria-modal` wiring that was previously
 * hand-rolled in 20+ components (inconsistently — most lacked the focus trap).
 *
 * It reuses the existing `.modal-backdrop`/`.modal`/`.modal-header`/
 * `.modal-body`/`.modal-footer` classes in `global.css`, so migrating an
 * existing modal is markup-only: pass `title`/`onClose`, move the old body into
 * `children` and the old footer buttons into `footer`, and append any bespoke
 * class (`scheduler-modal`, …) via `className`.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  className,
  header,
  bodyClassName,
  hideClose = false,
  closeOnBackdrop = true,
  id
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(dialogRef, onClose);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        id={id}
        className={className ? `modal ${className}` : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {header ?? (
          <div className="modal-header">
            <h3>{title}</h3>
            {!hideClose && (
              <button className="icon-btn" onClick={onClose} aria-label="Close">
                <X size={14} />
              </button>
            )}
          </div>
        )}
        <div className={bodyClassName ? `modal-body ${bodyClassName}` : 'modal-body'}>
          {children}
        </div>
        {footer !== undefined && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
