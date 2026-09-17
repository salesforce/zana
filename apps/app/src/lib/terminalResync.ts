/**
 * Hard redraw for a live xterm + PTY after layout changes.
 *
 * Cheap `fit()` + `terminals.resize` is enough while a pane is still being
 * dragged. Claude Code (and similar normal-buffer TUIs) only full-redraws on
 * new output or a real SIGWINCH, and node-pty suppresses SIGWINCH when the
 * new cols×rows equal the dims it already holds. xterm can also keep a stale
 * Viewport / cell-geometry cache after a reparent or a degenerate zero-size
 * fit, so rows paint on top of each other until something busts that cache.
 *
 * This helper is the modal-reparent sequence, reused after a resize *settles*:
 * fit, xterm rows±1, PTY rows±1 (two SIGWINCHs), then refresh + optional tail.
 */

export const TERMINAL_RESIZE_SETTLE_MS = 100;

export interface ResyncTerminal {
  cols: number;
  rows: number;
  resize(cols: number, rows: number): void;
  refresh(start: number, end: number): void;
  scrollToBottom(): void;
}

export interface ResyncFit {
  fit(): void;
}

export type ResizePty = (cols: number, rows: number) => void | Promise<void>;

export interface FrameHandle {
  cancel(): void;
}

export interface ResyncXtermAndPtyOptions {
  term: ResyncTerminal;
  fit?: ResyncFit | null;
  resizePty: ResizePty;
  stickToBottom: boolean;
  isDisposed?: () => boolean;
  /** Injected for tests. Defaults to requestAnimationFrame. */
  scheduleFrame?: (cb: () => void) => FrameHandle;
}

function defaultScheduleFrame(cb: () => void): FrameHandle {
  const id = requestAnimationFrame(cb);
  return { cancel: () => cancelAnimationFrame(id) };
}

function swallowPty(resizePty: ResizePty, cols: number, rows: number): void {
  try {
    void Promise.resolve(resizePty(cols, rows)).catch(() => {});
  } catch {
    /* ignore */
  }
}

/**
 * Fit, nudge xterm + PTY by one row and back, then refresh the visible rows.
 * Returns a cancel function for the deferred PTY-restore frame.
 */
export function resyncXtermAndPty(opts: ResyncXtermAndPtyOptions): () => void {
  opts.fit?.fit();
  const cols = opts.term.cols;
  const rows = opts.term.rows;
  const nudgedRows = Math.max(1, rows - 1);

  // Re-sync xterm's NATIVE scrollbar to the rendered viewport. A DOM reparent
  // or a fit() that lands on the same grid leaves Viewport's
  // `_lastRecordedViewportHeight` / `_lastScrollTop` / cell height matching,
  // so `syncScrollArea()` early-returns. A rows-only resize down one row then
  // back changes the canvas height, so the guard fails and Viewport re-runs
  // `_innerRefresh`. Rows-only never triggers a buffer reflow (that's gated on
  // a COLUMN change). `resize()` early-returns on unchanged dims, hence the
  // down-then-up round-trip.
  opts.term.resize(cols, nudgedRows);
  opts.term.resize(cols, rows);

  // Column reflow (a real fit() that changed cols) moves viewportY off the
  // bottom and fires xterm onScroll. Pin immediately so the TUI frame is what
  // the user sees, not the extra wrapped separator lines sitting in scrollback.
  if (opts.stickToBottom) {
    try {
      opts.term.scrollToBottom();
    } catch {
      /* ignore */
    }
  }

  // Claude Code repaints in place on the normal buffer. It only redraws on
  // new output or a real SIGWINCH. node-pty suppresses SIGWINCH when dims are
  // unchanged — exactly the case if fit() lands on the same grid the agent
  // was spawned at. Nudge the PTY to one row short, then back on the next
  // frame, so two genuine SIGWINCHs fire. Harmless for a shell.
  swallowPty(opts.resizePty, cols, nudgedRows);

  let cancelled = false;
  const schedule = opts.scheduleFrame ?? defaultScheduleFrame;
  const frame = schedule(() => {
    if (cancelled || opts.isDisposed?.()) return;
    swallowPty(opts.resizePty, cols, rows);
    try {
      opts.term.refresh(0, opts.term.rows - 1);
      if (opts.stickToBottom) opts.term.scrollToBottom();
    } catch {
      /* ignore */
    }
  });
  return () => {
    cancelled = true;
    frame.cancel();
  };
}

export interface ResizeSettleScheduler {
  ping(): void;
  cancel(): void;
  dispose(): void;
}

/**
 * Coalesce a burst of live fits (divider drag, window resize) into one
 * settled resync after `delayMs` of quiet.
 */
export function createResizeSettleScheduler(
  onSettle: () => void,
  delayMs = TERMINAL_RESIZE_SETTLE_MS
): ResizeSettleScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const cancel = (): void => {
    if (timer == null) return;
    clearTimeout(timer);
    timer = null;
  };

  return {
    ping: () => {
      if (disposed) return;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        if (disposed) return;
        onSettle();
      }, delayMs);
    },
    cancel,
    dispose: () => {
      disposed = true;
      cancel();
    }
  };
}
