/**
 * Keep a revealed Settings row in place while the page settles.
 *
 * A jump scrolls once, as soon as the row renders. Content above the row can
 * still be loading then (on the AI Harness page: machine environment,
 * registered harnesses, and the launch defaults and model tiers that appear
 * once harness descriptors arrive). When it grows, it pushes the row out of
 * the viewport. While the watch runs, every shift of the row inside its scroll
 * container re-centres it. The watch ends after SETTLE_MAX_MS, when the row
 * unmounts, on the next reveal, or as soon as the user scrolls, clicks or
 * types, so it never fights the user.
 */

export const SETTLE_MAX_MS = 8_000;
/** Offset changes up to this many px (sub-pixel rounding) are not layout shifts. */
const SHIFT_PX = 2;
const USER_INPUT = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

let cancelActive: (() => void) | null = null;

function scrollContainer(el: HTMLElement): HTMLElement {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = window.getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/**
 * The row's position inside the container's scrollable content. Scrolling
 * (including the smooth scroll in progress) leaves it unchanged; content
 * growing or shrinking above the row changes it.
 */
function contentOffset(el: HTMLElement, container: HTMLElement): number {
  const top = el.getBoundingClientRect().top;
  // The document scroller's own rect scrolls with the page (its top is
  // -scrollTop), so subtracting it would count the scroll twice. Its viewport
  // origin is 0.
  if (container === document.scrollingElement || container === document.documentElement) {
    return top + container.scrollTop;
  }
  return top - container.getBoundingClientRect().top + container.scrollTop;
}

/** Stop the running settle watch, if any. */
export function cancelRevealSettle(): void {
  cancelActive?.();
}

/** Watch `el` each frame and call `recenter` whenever content above it moves it. Returns a stop function. */
export function keepRevealedInPlace(el: HTMLElement, recenter: () => void): () => void {
  cancelRevealSettle();
  const container = scrollContainer(el);
  const started = Date.now();
  let last = contentOffset(el, container);
  let frame = 0;
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    window.cancelAnimationFrame(frame);
    for (const type of USER_INPUT) window.removeEventListener(type, stop, true);
    if (cancelActive === stop) cancelActive = null;
  };
  const tick = () => {
    if (done) return;
    if (!el.isConnected || Date.now() - started >= SETTLE_MAX_MS) return stop();
    const offset = contentOffset(el, container);
    if (Math.abs(offset - last) > SHIFT_PX) {
      last = offset;
      recenter();
    }
    frame = window.requestAnimationFrame(tick);
  };
  for (const type of USER_INPUT) window.addEventListener(type, stop, { capture: true, passive: true });
  cancelActive = stop;
  frame = window.requestAnimationFrame(tick);
  return stop;
}
