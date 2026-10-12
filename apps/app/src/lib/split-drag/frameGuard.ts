/** Body class that stops iframes/webviews from swallowing drag pointer events. */
export const FRAME_GUARD_CLASS = 'split-frame-guard';

let holders = 0;

/**
 * An embedded frame under the pointer takes `pointermove` away from the
 * window, freezing a drag mid-way. Returns an idempotent release; the class
 * stays while any drag still holds it.
 */
export function guardEmbeddedFrames(): () => void {
  holders += 1;
  document.body.classList.add(FRAME_GUARD_CLASS);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders === 0) document.body.classList.remove(FRAME_GUARD_CLASS);
  };
}
