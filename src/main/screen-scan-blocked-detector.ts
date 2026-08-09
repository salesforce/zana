/**
 * Screen-scan blocked detector (LAS-07 — the non-Claude "needs-you" slice).
 *
 * Claude signals "waiting on the user" through its Notification hook, which
 * `AgentStatusTracker.markBlocked` keys on. Harnesses that emit no OSC status
 * glyph AND wire no lifecycle hook (`emitsOscStatus:false` + `supportsHooks:false`
 * — OpenCode, cursor, pi) have NEITHER: when they stop at a permission prompt or
 * an interactive question they simply go QUIET. The provider-agnostic
 * {@link OutputActivityMonitor} then reads that silence as plain `idle`, so a
 * blocked agent looks "done" — verified against OpenCode, whose TUI emits the
 * `△ Permission required` prompt in one burst and then sends zero bytes until the
 * user answers.
 *
 * This monitor closes that gap with the only extra signal available: the recent
 * SCREEN TEXT. It accumulates a bounded, ANSI-stripped tail of each session's PTY
 * stream and, when the stream SETTLES (a short silence — the same edge
 * `OutputActivityMonitor` flips to idle on), asks the session's provider whether
 * that settled screen shows a blocking prompt (`LaunchProvider.detectBlockedPrompt`,
 * where the concrete harness-specific pattern lives — Rule 6). If so it calls
 * {@link ScreenScanBlockedSink.markBlocked}, setting the SAME sticky overlay the
 * Claude hook path uses.
 *
 * The design is self-healing and needs NO un-block detection:
 *  - `blocked` is a sticky overlay in `AgentStatusTracker`; while the agent sits
 *    quiet at the prompt, `resolve()` surfaces it over the output-activity `idle`.
 *  - when the user answers, the harness repaints → `OutputActivityMonitor` reports
 *    `working` on the output edge → `report('working')` auto-clears `blocked`.
 *  - the recent-text buffer is CLEARED on that same working edge, so a dismissed
 *    prompt's stale text can never re-match on the next settle.
 *
 * Why scan the raw PTY stream (not the xterm buffer): the pty `data` handler
 * already feeds every byte through the OSC detector + the output-activity monitor,
 * so this rides the same path with no renderer round-trip and no visibility gate —
 * a hidden/unfocused blocked tab is detected exactly like a focused one. The scan
 * is a cheap substring test over a bounded tail (default 8 KiB) run once per
 * settle, never per chunk. Collaborators are injected so it's unit-testable with
 * fake timers and no real pty (mirrors {@link OutputActivityMonitor}). Never throws.
 */

/** The subset of {@link AgentStatusTracker} this monitor drives. */
export interface ScreenScanBlockedSink {
  markBlocked(sessionId: string): void;
}

export interface ScreenScanBlockedDeps {
  /** The status sink to set the blocked overlay on (the AgentStatusTracker). */
  sink: ScreenScanBlockedSink;
  /**
   * Provider dispatch: given a session's settled, ANSI-stripped recent screen
   * text, return true when it shows a blocking prompt. Closes over the session's
   * `LaunchProvider.detectBlockedPrompt` in the caller so the concrete harness
   * pattern stays in the provider layer (Rule 6) and this module names no harness.
   * A session whose provider has no such pattern (Claude, shell, cursor/pi/codex
   * in v1) always returns false → this monitor is a no-op for it.
   */
  detect: (sessionId: string, recentText: string) => boolean;
  /** Settle threshold in ms; read live so a config change can take effect. */
  settleAfterMs?: () => number;
  /** Arm a settle timer; returns a handle. Injected so tests use fake timers. */
  setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
  /** Clear a settle-timer handle. Injected to pair with {@link setTimer}. */
  clearTimer: (handle: NodeJS.Timeout) => void;
}

interface Entry {
  /** Bounded, ANSI-stripped tail of recent output since the last settle/clear. */
  buffer: string;
  /** Are we mid-output (saw a chunk, not yet settled)? Drives the working-edge clear. */
  active: boolean;
  /** The armed settle timer (null when settled / not yet started). */
  timer: NodeJS.Timeout | null;
}

/**
 * Silence, in ms, after which the accumulated screen is scanned for a blocking
 * prompt. Sits at the output-activity idle threshold so the blocked verdict lands
 * in the same window the session would otherwise settle to `idle` — and since
 * `blocked` is a sticky overlay that wins over `idle` in `resolve()`, the exact
 * relative order of the two never matters.
 */
export const DEFAULT_SETTLE_AFTER_MS = 1500;

/**
 * Max ANSI-stripped tail retained per session before a scan (Rule 5 — bound an
 * otherwise unbounded accumulating store). The observed OpenCode permission frame
 * is ~1 KiB; 8 KiB comfortably holds a full repaint plus prior context while
 * staying a cheap substring scan.
 */
export const RECENT_TEXT_CAP = 8 * 1024;

/**
 * Strip ANSI escape sequences and C0 control bytes from a raw PTY chunk, leaving
 * the human-readable screen text a substring pattern can match. Covers OSC
 * (`ESC ] … BEL|ST`), CSI (`ESC [ … final`), and single-char ESC sequences, then
 * drops remaining control chars except tab/newline. Pure; exported for tests.
 */
export function stripAnsi(chunk: string): string {
  return chunk
    // OSC: ESC ] ... (BEL | ST)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // CSI: ESC [ ... final byte
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    // Other 2-char ESC sequences (charset selection, etc.)
    .replace(/\x1b[()][0-9A-Za-z]/g, '')
    .replace(/\x1b[=>]/g, '')
    // Remaining C0 controls except tab (\x09) and newline (\x0a)
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ');
}

/**
 * Tracks per-session recent screen text and reports `blocked` into a status sink
 * when the settled screen matches the provider's blocking-prompt pattern. Wire
 * {@link observe} to the pty `data` event (for sessions WITHOUT `emitsOscStatus`,
 * the same gate as {@link OutputActivityMonitor}) and {@link remove} to pty exit.
 */
export class ScreenScanBlockedDetector {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly deps: ScreenScanBlockedDeps) {}

  /**
   * Feed a raw PTY data chunk. On the edge from quiet→output, drops any stale
   * buffered text (so a previously-dismissed prompt can't re-match); accumulates
   * the ANSI-stripped chunk into a bounded tail; and (re)arms the settle timer,
   * whose elapse scans the tail for a blocking prompt. Empty chunks are ignored.
   */
  observe(sessionId: string, chunk: string): void {
    if (!chunk) return;
    let entry = this.entries.get(sessionId);
    if (!entry) {
      entry = { buffer: '', active: false, timer: null };
      this.entries.set(sessionId, entry);
    }
    // Working edge: new activity means the screen is being repainted (e.g. the
    // user answered and the harness moved on) — discard stale text so a dismissed
    // prompt's leftover "Permission required" can't re-trigger on the next settle.
    if (!entry.active) {
      entry.active = true;
      entry.buffer = '';
    }
    entry.buffer += stripAnsi(chunk);
    if (entry.buffer.length > RECENT_TEXT_CAP) {
      entry.buffer = entry.buffer.slice(entry.buffer.length - RECENT_TEXT_CAP);
    }
    if (entry.timer !== null) this.deps.clearTimer(entry.timer);
    const ms = Math.max(1, Math.round(this.deps.settleAfterMs?.() ?? DEFAULT_SETTLE_AFTER_MS));
    entry.timer = this.deps.setTimer(() => this.onSettle(sessionId), ms);
  }

  /** Forget a session (call on pty exit). Clears any pending settle timer. */
  remove(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry?.timer != null) this.deps.clearTimer(entry.timer);
    this.entries.delete(sessionId);
  }

  /**
   * The stream settled — scan the accumulated screen for a blocking prompt. On a
   * match, set the sticky blocked overlay (it wins over the output-activity `idle`
   * that settles at the same edge). We stay `active:false` afterwards so the next
   * output chunk is treated as a fresh working edge (clearing the buffer). The
   * `detect` callback is defensive against throwing so a bad provider pattern can
   * never wedge the pty data path.
   */
  private onSettle(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.timer = null;
    entry.active = false;
    let blocked = false;
    try {
      blocked = this.deps.detect(sessionId, entry.buffer);
    } catch {
      blocked = false;
    }
    if (blocked) this.deps.sink.markBlocked(sessionId);
  }
}
