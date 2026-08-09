import { describe, it, expect } from 'vitest';
import { shouldSuppressWheelArrows } from '../terminalWheel';

// xterm 5.5.0 converts a mouse-wheel notch into Up/Down arrow keypresses whenever
// the running program is on the *alternate* screen buffer and mouse tracking is
// off (see the built-in wheel handler in @xterm/xterm). A shell/prompt on the alt
// buffer reads those arrows as command-history navigation — the reported bug.
// This decides whether our custom wheel handler should cancel that translation.
describe('shouldSuppressWheelArrows', () => {
  it('keeps arrows (does not suppress) when the setting is enabled — the default', () => {
    // Default behavior: wheel scrolls inside less/man/git pagers, which rely on
    // this exact arrow translation. Never suppress while the user opts in.
    expect(
      shouldSuppressWheelArrows({
        wheelArrowsEnabled: true,
        bufferType: 'alternate',
        mouseTrackingActive: false
      })
    ).toBe(false);
  });

  it('suppresses on the alternate buffer when the user opts out', () => {
    expect(
      shouldSuppressWheelArrows({
        wheelArrowsEnabled: false,
        bufferType: 'alternate',
        mouseTrackingActive: false
      })
    ).toBe(true);
  });

  it('never suppresses on the normal buffer — the viewport scrolls there', () => {
    // On the normal buffer xterm scrolls its own viewport (scrollback), so there
    // is nothing to suppress and cancelling would break page scrolling.
    expect(
      shouldSuppressWheelArrows({
        wheelArrowsEnabled: false,
        bufferType: 'normal',
        mouseTrackingActive: false
      })
    ).toBe(false);
  });

  it('never suppresses while mouse tracking is active (e.g. tmux mouse on)', () => {
    // When a program requests mouse reporting, xterm forwards the wheel as mouse
    // events; cancelling would break tmux-mouse-on / TUI wheel scrolling.
    expect(
      shouldSuppressWheelArrows({
        wheelArrowsEnabled: false,
        bufferType: 'alternate',
        mouseTrackingActive: true
      })
    ).toBe(false);
  });
});
