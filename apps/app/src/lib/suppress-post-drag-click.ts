/** How long to intercept the browser's leftover click after a drag ends. */
export const POST_DRAG_CLICK_SUPPRESS_MS = 400;

/**
 * Pointer-drag libraries and HTML5 `draggable` both synthesize a `click`
 * after `pointerup`/`dragend`. For a `<Link>` that click still follows `href`
 * even when React never sees the event (dnd-kit only `stopPropagation`s it).
 * Swallow the leftover click at capture. A fresh pointer/key interaction starts
 * a new gesture, so its click must be allowed even before the timeout expires.
 */
export function suppressPostDragClick(
  durationMs = POST_DRAG_CLICK_SUPPRESS_MS
): () => void {
  if (typeof document === 'undefined') return () => undefined;

  let done = false;
  const onClick = (event: Event) => {
    if (done) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    cleanup();
  };
  const cleanup = () => {
    if (done) return;
    done = true;
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('pointerdown', cleanup, true);
    document.removeEventListener('keydown', cleanup, true);
    globalThis.clearTimeout(timer);
  };
  document.addEventListener('click', onClick, true);
  document.addEventListener('pointerdown', cleanup, true);
  document.addEventListener('keydown', cleanup, true);
  const timer = globalThis.setTimeout(cleanup, durationMs);
  return cleanup;
}
