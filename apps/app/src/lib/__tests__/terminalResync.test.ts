import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TERMINAL_RESIZE_SETTLE_MS,
  createResizeSettleScheduler,
  resyncXtermAndPty,
  type ResyncTerminal
} from '../terminalResync.js';

function fakeTerm(cols: number, rows: number): {
  term: ResyncTerminal;
  resizes: Array<[number, number]>;
  refreshes: Array<[number, number]>;
  scrolls: number;
} {
  const resizes: Array<[number, number]> = [];
  const refreshes: Array<[number, number]> = [];
  let scrolls = 0;
  let c = cols;
  let r = rows;
  const term: ResyncTerminal = {
    get cols() {
      return c;
    },
    get rows() {
      return r;
    },
    resize(nextCols, nextRows) {
      resizes.push([nextCols, nextRows]);
      c = nextCols;
      r = nextRows;
    },
    refresh(start, end) {
      refreshes.push([start, end]);
    },
    scrollToBottom() {
      scrolls += 1;
    }
  };
  return {
    term,
    resizes,
    refreshes,
    get scrolls() {
      return scrolls;
    }
  };
}

describe('resyncXtermAndPty', () => {
  it('fits, nudges xterm and PTY by one row, then restores and refreshes', () => {
    const fake = fakeTerm(120, 40);
    const pty: Array<[number, number]> = [];
    let frame: (() => void) | null = null;
    const fit = vi.fn();

    const cancel = resyncXtermAndPty({
      term: fake.term,
      fit: { fit },
      resizePty: (cols, rows) => {
        pty.push([cols, rows]);
      },
      stickToBottom: true,
      scheduleFrame: (cb) => {
        frame = cb;
        return { cancel: () => { frame = null; } };
      }
    });

    expect(fit).toHaveBeenCalledTimes(1);
    expect(fake.resizes).toEqual([
      [120, 39],
      [120, 40]
    ]);
    expect(pty).toEqual([[120, 39]]);
    expect(fake.refreshes).toEqual([]);
    expect(fake.scrolls).toBe(1);

    frame?.();
    expect(pty).toEqual([
      [120, 39],
      [120, 40]
    ]);
    expect(fake.refreshes).toEqual([[0, 39]]);
    expect(fake.scrolls).toBe(2);
    cancel();
  });

  it('clamps a 1-row terminal so the nudge never goes to 0', () => {
    const fake = fakeTerm(80, 1);
    const pty: Array<[number, number]> = [];
    let frame: (() => void) | null = null;

    resyncXtermAndPty({
      term: fake.term,
      resizePty: (cols, rows) => {
        pty.push([cols, rows]);
      },
      stickToBottom: false,
      scheduleFrame: (cb) => {
        frame = cb;
        return { cancel: () => { frame = null; } };
      }
    });

    expect(fake.resizes).toEqual([
      [80, 1],
      [80, 1]
    ]);
    expect(pty).toEqual([[80, 1]]);
    frame?.();
    expect(pty).toEqual([
      [80, 1],
      [80, 1]
    ]);
    expect(fake.refreshes).toEqual([[0, 0]]);
    expect(fake.scrolls).toBe(0);
  });

  it('pins the viewport immediately after the xterm nudge, not only on the deferred frame', () => {
    const fake = fakeTerm(80, 24);
    let frame: (() => void) | undefined;

    resyncXtermAndPty({
      term: fake.term,
      resizePty: () => {},
      stickToBottom: true,
      scheduleFrame: (cb) => {
        frame = cb;
        return { cancel: () => {} };
      }
    });

    expect(fake.scrolls).toBe(1);
    frame?.();
    expect(fake.scrolls).toBe(2);
  });

  it('skips the deferred PTY restore when disposed before the frame', () => {
    const fake = fakeTerm(100, 24);
    const pty: Array<[number, number]> = [];
    let frame: (() => void) | null = null;
    let disposed = false;

    resyncXtermAndPty({
      term: fake.term,
      resizePty: (cols, rows) => {
        pty.push([cols, rows]);
      },
      stickToBottom: true,
      isDisposed: () => disposed,
      scheduleFrame: (cb) => {
        frame = cb;
        return { cancel: () => { frame = null; } };
      }
    });

    disposed = true;
    frame?.();
    expect(pty).toEqual([[100, 23]]);
    expect(fake.refreshes).toEqual([]);
    expect(fake.scrolls).toBe(1);
  });

  it('uses requestAnimationFrame when scheduleFrame is omitted', () => {
    const fake = fakeTerm(10, 5);
    const pty: Array<[number, number]> = [];
    let queued: FrameRequestCallback | null = null;
    const cancelAnimationFrame = vi.fn();
    const previousRaf = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
    const previousCaf = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: (cb: FrameRequestCallback) => {
        queued = cb;
        return 7;
      }
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      writable: true,
      value: cancelAnimationFrame
    });

    try {
      const cancel = resyncXtermAndPty({
        term: fake.term,
        resizePty: (cols, rows) => {
          pty.push([cols, rows]);
        },
        stickToBottom: false
      });
      queued?.(0);
      expect(pty).toEqual([
        [10, 4],
        [10, 5]
      ]);
      cancel();
      expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
    } finally {
      if (previousRaf) Object.defineProperty(globalThis, 'requestAnimationFrame', previousRaf);
      else delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
      if (previousCaf) Object.defineProperty(globalThis, 'cancelAnimationFrame', previousCaf);
      else delete (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame;
    }
  });

  it('swallows a throwing resizePty and a throwing refresh', () => {
    const fake = fakeTerm(40, 10);
    fake.term.refresh = () => {
      throw new Error('refresh failed');
    };
    let frame: (() => void) | undefined;

    expect(() =>
      resyncXtermAndPty({
        term: fake.term,
        resizePty: () => {
          throw new Error('pty failed');
        },
        stickToBottom: true,
        scheduleFrame: (cb) => {
          frame = cb;
          return { cancel: () => {} };
        }
      })
    ).not.toThrow();

    expect(() => frame?.()).not.toThrow();
    expect(fake.scrolls).toBe(1);
  });

  it('cancel() prevents the deferred restore without needing isDisposed', () => {
    const fake = fakeTerm(90, 20);
    const pty: Array<[number, number]> = [];
    let frame: (() => void) | undefined;

    const cancel = resyncXtermAndPty({
      term: fake.term,
      resizePty: (cols, rows) => {
        pty.push([cols, rows]);
      },
      stickToBottom: true,
      scheduleFrame: (cb) => {
        frame = cb;
        return { cancel: () => {} };
      }
    });

    cancel();
    frame?.();
    expect(pty).toEqual([[90, 19]]);
    expect(fake.refreshes).toEqual([]);
  });
});

describe('createResizeSettleScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces many pings into one settle after quiet', () => {
    vi.useFakeTimers();
    const onSettle = vi.fn();
    const scheduler = createResizeSettleScheduler(onSettle, TERMINAL_RESIZE_SETTLE_MS);

    scheduler.ping();
    scheduler.ping();
    scheduler.ping();
    expect(onSettle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(TERMINAL_RESIZE_SETTLE_MS - 1);
    expect(onSettle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onSettle).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it('cancel() drops a pending settle so a later ping can fire again', () => {
    vi.useFakeTimers();
    const onSettle = vi.fn();
    const scheduler = createResizeSettleScheduler(onSettle, 50);

    scheduler.ping();
    scheduler.cancel();
    vi.advanceTimersByTime(50);
    expect(onSettle).not.toHaveBeenCalled();

    scheduler.ping();
    vi.advanceTimersByTime(50);
    expect(onSettle).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it('does not fire after dispose, even if a ping was pending', () => {
    vi.useFakeTimers();
    const onSettle = vi.fn();
    const scheduler = createResizeSettleScheduler(onSettle, 50);

    scheduler.ping();
    scheduler.dispose();
    vi.advanceTimersByTime(50);
    expect(onSettle).not.toHaveBeenCalled();

    scheduler.ping();
    vi.advanceTimersByTime(50);
    expect(onSettle).not.toHaveBeenCalled();
  });
});
