// xterm.js 5.5.0's built-in wheel handler translates a mouse-wheel notch into
// Up/Down arrow keypresses (ESC[A / ESC[B, or ESC OA / ESC OB in application
// cursor-key mode) whenever the terminal is on the *alternate* screen buffer and
// no mouse-tracking protocol is active. A shell or prompt on the alt buffer reads
// those arrows as command-history navigation — so scrolling the wheel cycles
// through past commands instead of paging, the bug teammates reported.
//
// We keep this translation ON by default (less/man/git pagers depend on it to
// scroll via the wheel) but let a user opt out. This is the decision the custom
// wheel handler asks on every notch; kept pure so it's unit-testable in isolation
// from xterm's DOM handler.

export interface WheelArrowContext {
  /** The user's opt-out setting. `true` = keep xterm's arrow translation (default). */
  wheelArrowsEnabled: boolean;
  /** Which xterm screen buffer is active. Arrow translation only fires on 'alternate'. */
  bufferType: 'normal' | 'alternate';
  /** True when a program has requested mouse reporting (e.g. tmux `mouse on`). */
  mouseTrackingActive: boolean;
}

/**
 * Decide whether our custom wheel handler should cancel xterm's built-in
 * wheel→arrow-key translation for this notch (by returning `false` from the
 * attached handler, which stops xterm's default handling).
 *
 * Suppress ONLY the arrow path: opted out, on the alternate buffer, and mouse
 * tracking off. On the normal buffer xterm scrolls its own viewport, and while
 * mouse tracking is active it forwards the wheel as mouse events — cancelling
 * either would break legitimate scrolling.
 */
export function shouldSuppressWheelArrows(ctx: WheelArrowContext): boolean {
  if (ctx.wheelArrowsEnabled) return false;
  if (ctx.bufferType !== 'alternate') return false;
  if (ctx.mouseTrackingActive) return false;
  return true;
}
