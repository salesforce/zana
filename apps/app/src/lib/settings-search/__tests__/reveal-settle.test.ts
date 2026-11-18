// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTLE_MAX_MS, cancelRevealSettle, keepRevealedInPlace } from '../reveal-settle';
import { revealElement } from '../reveal';

const FRAME_MS = 16;

/** A scroll container holding a row whose layout top the test moves, as content loading above it would. */
function mountLayout() {
  const container = document.createElement('div');
  container.style.overflowY = 'auto';
  const row = document.createElement('div');
  row.appendChild(document.createElement('textarea'));
  container.appendChild(row);
  document.body.appendChild(container);
  let rowTop = 900;
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect);
  vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => ({ top: rowTop - container.scrollTop }) as DOMRect);
  return {
    row,
    /** Content above the row grows (or shrinks) by `px`. */
    shift: (px: number) => { rowTop += px; },
    /** The viewport scrolls; the row's place in the content stays put. */
    scrollBy: (px: number) => { container.scrollTop += px; }
  };
}

const frames = (n = 1) => vi.advanceTimersByTime(FRAME_MS * n);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => window.setTimeout(cb, FRAME_MS));
  vi.stubGlobal('cancelAnimationFrame', (n: number) => window.clearTimeout(n));
});
afterEach(() => {
  cancelRevealSettle();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('keepRevealedInPlace', () => {
  it('re-centres each time content above the row moves it, and ignores scrolling', () => {
    const { row, shift, scrollBy } = mountLayout();
    const recenter = vi.fn();
    keepRevealedInPlace(row, recenter);
    scrollBy(400); // the smooth scroll in flight
    frames(3);
    expect(recenter).not.toHaveBeenCalled();
    shift(680); // e.g. launch defaults and model tiers render above the row
    frames();
    expect(recenter).toHaveBeenCalledTimes(1);
    frames(5);
    expect(recenter).toHaveBeenCalledTimes(1);
    shift(-120);
    frames();
    expect(recenter).toHaveBeenCalledTimes(2);
  });

  it('treats sub-pixel jitter as no shift', () => {
    const { row, shift } = mountLayout();
    const recenter = vi.fn();
    keepRevealedInPlace(row, recenter);
    shift(1.5);
    frames(3);
    expect(recenter).not.toHaveBeenCalled();
  });

  it.each(['wheel', 'pointerdown', 'keydown', 'touchstart'])('stops as soon as the user acts (%s)', (type) => {
    const { row, shift } = mountLayout();
    const recenter = vi.fn();
    keepRevealedInPlace(row, recenter);
    window.dispatchEvent(new Event(type));
    shift(500);
    frames(3);
    expect(recenter).not.toHaveBeenCalled();
  });

  it('stops after SETTLE_MAX_MS', () => {
    const { row, shift } = mountLayout();
    const recenter = vi.fn();
    keepRevealedInPlace(row, recenter);
    vi.advanceTimersByTime(SETTLE_MAX_MS + FRAME_MS);
    shift(500);
    frames(3);
    expect(recenter).not.toHaveBeenCalled();
  });

  it('stops when the row unmounts', () => {
    const { row, shift } = mountLayout();
    const recenter = vi.fn();
    keepRevealedInPlace(row, recenter);
    row.remove();
    shift(500);
    frames(3);
    expect(recenter).not.toHaveBeenCalled();
  });

  it('a new reveal replaces the previous watch; the returned stop ends it', () => {
    const first = mountLayout();
    const second = mountLayout();
    const recenterFirst = vi.fn();
    const recenterSecond = vi.fn();
    keepRevealedInPlace(first.row, recenterFirst);
    const stop = keepRevealedInPlace(second.row, recenterSecond);
    first.shift(500);
    second.shift(500);
    frames();
    expect(recenterFirst).not.toHaveBeenCalled();
    expect(recenterSecond).toHaveBeenCalledTimes(1);
    stop();
    stop(); // idempotent
    second.shift(500);
    frames(3);
    expect(recenterSecond).toHaveBeenCalledTimes(1);
  });

  it('falls back to the document scroller when no ancestor scrolls', () => {
    const row = document.createElement('div');
    document.body.appendChild(row);
    let top = 900;
    vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => ({ top }) as DOMRect);
    const recenter = vi.fn();
    keepRevealedInPlace(row, recenter);
    top += 300;
    frames();
    expect(recenter).toHaveBeenCalledTimes(1);
  });
});

describe('revealElement keeps the row centred while the page settles', () => {
  it('jumps back to the row when content loading above it pushes it down', () => {
    const { row, shift } = mountLayout();
    const scrolls: unknown[] = [];
    vi.spyOn(row, 'scrollIntoView').mockImplementation((opts) => { scrolls.push(opts); });
    revealElement(row);
    expect(scrolls).toEqual([{ behavior: 'smooth', block: 'center' }]);
    frames(2);
    shift(680);
    frames();
    expect(scrolls).toEqual([{ behavior: 'smooth', block: 'center' }, { behavior: 'auto', block: 'center' }]);
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
  });
});
