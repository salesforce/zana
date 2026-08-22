import { useEffect, useRef, type RefObject } from 'react';

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'button, textarea, input, select, [href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
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
      // Restore focus to the opener if it's still in the document.
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [dialogRef, enabled]);
}
