import { useEffect, useRef, type RefObject } from 'react';

const claimedEscapes = new WeakSet<Event>();

/** Attribute the composer editor carries to opt in to the Escape rule below. */
export const ESC_CLOSES_DIALOG_ATTR = 'data-esc-closes-dialog';

/** An editor feature (e.g. closing its typeahead menu) consumed this Escape; the dialog must stay open. */
export function claimEscape(event: Event): void {
  claimedEscapes.add(event);
}

/**
 * ProseMirror calls preventDefault on every Escape keydown it receives, so a focused
 * composer editor always arrives defaultPrevented. For editors that opt in with
 * {@link ESC_CLOSES_DIALOG_ATTR} that alone must not block the dialog; only an
 * explicit claim (`claimEscape`) does. Every other default-prevented Escape
 * (nested pickers, plugin editors) still wins over the dialog.
 */
function escapeHandledElsewhere(e: KeyboardEvent): boolean {
  if (!e.defaultPrevented) return false;
  if (claimedEscapes.has(e)) return true;
  const target = e.target;
  return !(target instanceof Element && target.closest(`[${ESC_CLOSES_DIALOG_ATTR}]`));
}

/**
 * Modal-dialog focus affordances shared by the agent launchers:
 *   - Escape calls `onClose`,
 *   - Tab is trapped within `dialogRef` (wraps last→first and first→last),
 *   - focus returns to whatever opened the dialog when it unmounts.
 *
 * `enabled` lets a caller skip the trap (pass `false` and the effect is a no-op).
 *
 * `onClose` is read through a ref so an unstable identity (e.g. an inline
 * `() => setOpen(false)` from a parent that re-renders on a timer) does NOT
 * re-run the effect. Re-running it would re-capture the opener and fire the
 * unmount focus-restore mid-life, yanking focus back to the dialog's first
 * field on every parent render — the bug this guards against.
 */
export function useDialogFocusTrap(
  dialogRef: RefObject<HTMLElement | null>,
  onClose: (() => void) | undefined,
  enabled = true
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!enabled) return;
    const opener = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const originalTabIndex = dialog?.getAttribute('tabindex');
    // Mobile composers deliberately avoid focusing an editor on mount. Give
    // the dialog keyboard focus without opening the software keyboard.
    if (dialog && !dialog.contains(opener)) {
      if (originalTabIndex == null) dialog.tabIndex = -1;
      dialog.focus({ preventScroll: true });
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // A nested portalled dialog or picker handles its own Escape.
        if (escapeHandledElsewhere(e) || !dialogRef.current?.contains(e.target as Node)) return;
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (dialog && originalTabIndex == null) dialog.removeAttribute('tabindex');
      // Restore focus to the opener if it's still in the document.
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [dialogRef, enabled]);
}
