/**
 * Provider-agnostic output-activity heuristic (B6).
 *
 * Claude Code advertises its agent state through OSC terminal titles (a braille
 * spinner while working, `✳` when idle — see `agent-status.ts` `classifyOscTitle`).
 * Non-Claude agents (codex, cursor) print NO such glyph, so their session would
 * sit at `unknown` forever — and everything that keys off the agent-status stream
 * (the Agents board, auto-close-idle, heartbeat, idle-triage, catch-up) would
 * never fire for them.
 *
 * This monitor fills that gap with the only signal a plain CLI reliably gives:
 * whether it is CURRENTLY PRODUCING OUTPUT. The rule is deliberately simple and
 * robust across providers:
 *  - Any output chunk ⇒ the agent is `working`. We report `working` on the edge
 *    (the first chunk after silence), then re-arm a silence timer on every chunk.
 *  - `idleAfterMs` of no output ⇒ the agent has settled ⇒ report `idle`.
 *
 * It is NOT a spinner detector — it makes no assumptions about the bytes, so it
 * works for any provider whose turn ends with a quiet prompt. It feeds the SAME
 * generic {@link AgentStatusTracker.report} sink the OSC path uses, so the
 * downstream fusion (a sticky `blocked` overlay from a hook still wins), 250 ms
 * emit-debounce, ring buffer and `status` event are all unchanged — this only
 * adds a second SOURCE of the raw working/idle reading.
 *
 * Why a source, not a rewrite of `report`: `report` already debounces and fuses.
 * A naive "emit working on every chunk" would spam it at output frame-rate; the
 * edge-detect here (only report `working` when we WEREN'T already working) keeps
 * the hot path to a single timer reset per chunk with no emit.
 *
 * All collaborators are injected so it's unit-testable without a real pty or wall
 * clock (mirrors {@link IdleTriageService}). Never throws.
 */

import type { AgentState } from '../shared/types.js';

/**
 * Silence, in ms, after which an agent that was producing output is considered
 * to have settled into idle. Long enough to bridge the natural pauses between a
 * CLI's tool calls / streamed tokens (which can gap ~1 s), short enough that a
 * finished turn flips to idle promptly. Tuned to sit just above the OSC path's
 * 250 ms emit-debounce so the two detectors feel consistent.
 */
export const DEFAULT_IDLE_AFTER_MS = 1500;

/** The subset of {@link AgentStatusTracker} this monitor drives. */
export interface OutputActivitySink {
  report(sessionId: string, state: AgentState): void;
}

export interface OutputActivityDeps {
  /** The status sink to report working/idle into (the AgentStatusTracker). */
  sink: OutputActivitySink;
  /** Silence threshold in ms; read live so a config change can take effect. */
  idleAfterMs?: () => number;
  /** Arm a silence timer; returns a handle. Injected so tests use fake timers. */
  setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
  /** Clear a silence-timer handle. Injected to pair with {@link setTimer}. */
  clearTimer: (handle: NodeJS.Timeout) => void;
}

interface Entry {
  /** Are we currently in the `working` phase (saw output, not yet gone quiet)? */
  working: boolean;
  /** The armed silence timer (null when idle / not yet started). */
  timer: NodeJS.Timeout | null;
  /** Has the first output event been seen since the last turn start / user submission? */
  hasFirstEvent: boolean;
  /** Are we currently in the `waiting` state? */
  waiting: boolean;
}

/**
 * Tracks per-session output activity and reports working/idle into a status sink.
 * Wire {@link observe} to the pty `data` event (for sessions WITHOUT
 * `emitsOscStatus`) and {@link remove} to pty exit.
 */
export class OutputActivityMonitor {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly deps: OutputActivityDeps) {}

  /**
   * Signal that a new user turn has started or a session has launched.
   * Resets the first-event tracker and ensures the session reports as 'working'.
   */
  onTurnStart(sessionId: string): void {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      entry = { working: false, timer: null, hasFirstEvent: false, waiting: false };
      this.entries.set(sessionId, entry);
    }
    entry.hasFirstEvent = false;
    entry.waiting = false;
    if (!entry.working) {
      entry.working = true;
      this.deps.sink.report(sessionId, 'working');
    }
    if (entry.timer !== null) this.deps.clearTimer(entry.timer);
    const ms = Math.max(1, Math.round(this.deps.idleAfterMs?.() ?? DEFAULT_IDLE_AFTER_MS));
    entry.timer = this.deps.setTimer(() => this.onSilence(sessionId), ms);
  }

  /**
   * Feed a raw PTY data chunk. On the edge from quiet→output, reports `working`;
   * every chunk re-arms the silence timer, whose elapse reports `idle`. Empty
   * chunks are ignored (a bare flush shouldn't count as activity).
   */
  observe(sessionId: string, chunk: string): void {
    if (!chunk) return;
    let entry = this.entries.get(sessionId);
    if (!entry) {
      entry = { working: false, timer: null, hasFirstEvent: true, waiting: false };
      this.entries.set(sessionId, entry);
    }
    entry.hasFirstEvent = true;
    // Edge into working: report once, not on every subsequent chunk.
    if (!entry.working || entry.waiting) {
      entry.working = true;
      entry.waiting = false;
      this.deps.sink.report(sessionId, 'working');
    }
    // (Re)arm the silence timer on every chunk.
    if (entry.timer !== null) this.deps.clearTimer(entry.timer);
    const ms = Math.max(1, Math.round(this.deps.idleAfterMs?.() ?? DEFAULT_IDLE_AFTER_MS));
    entry.timer = this.deps.setTimer(() => this.onSilence(sessionId), ms);
  }

  /** Forget a session (call on pty exit). Clears any pending silence timer. */
  remove(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry?.timer != null) this.deps.clearTimer(entry.timer);
    this.entries.delete(sessionId);
  }

  /** The silence elapsed with no further output → the agent has settled or is waiting. */
  private onSilence(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.timer = null;
    entry.working = false;
    if (!entry.hasFirstEvent) {
      entry.waiting = true;
      this.deps.sink.report(sessionId, 'waiting');
    } else {
      entry.waiting = false;
      this.deps.sink.report(sessionId, 'idle');
    }
  }
}
