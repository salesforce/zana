/** How long to intercept the browser's leftover click after a drag ends. */
export const POST_DRAG_CLICK_SUPPRESS_MS = 400;

/**
 * Pointer-drag libraries and HTML5 `draggable` both synthesize a `click`
 * after `pointerup`/`dragend`. For a `<Link>` that click still follows `href`
 * even when React never sees the event (dnd-kit only `stopPropagation`s it).
 * Swallow the next click at capture and cancel its default action.
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
    globalThis.clearTimeout(timer);
  };
  document.addEventListener('click', onClick, true);
  const timer = globalThis.setTimeout(cleanup, durationMs);
  return cleanup;
}
