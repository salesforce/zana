/**
 * Catch-up summary add-on (EXPERIMENTAL, off by default; spends tokens).
 *
 * When a claude agent settles into idle OR enters a blocked state (keyboard-choice
 * / permission-prompt), this service reads the session transcript digest and runs
 * the `builtin:catch-up-summary` LLM micro-call to generate a tight catch-up: a
 * one-line headline + up to ~4 bullets of "where are we / what changed". When the
 * trigger is 'blocked', the summary SHOULD include a recommended option + why. The
 * result is emitted as a {@link CatchUpSummaryResult} the renderer surfaces under
 * the terminal in the agent modal.
 *
 * Cost discipline (this is the whole reason it's opt-in):
 *  - It fires only after the agent has DWELLED in the trigger state (idle OR
 *    blocked) for `delaySeconds`, so the 1–2s idle flicker between tool calls
 *    never spends a call. Armed on working/blocked → idle OR on entering 'blocked'.
 *  - One-shot per spell: re-armed only when the agent leaves the trigger state, so
 *    a steady idle or blocked agent is summarized exactly once (mirrors idle-triage).
 *  - It bails before spending anything when the add-on is disabled, it is a
 *    background (scheduled/headless) session, transcript text is unavailable, or
 *    no eligible monitor HTTP provider is configured.
 *  - Re-checks isEnabled() AFTER the cheap transcript read and BEFORE the costly
 *    LLM spawn (CLAUDE.md #5) so toggling off mid-read doesn't still spend tokens.
 *  - Bounded concurrency (MAX_CONCURRENT_SUMMARIES) so a burst across many sessions
 *    can't stampede (mirrors close-summary.ts).
 *
 * All collaborators are injected so the service is unit-testable without Electron,
 * the filesystem, or a real provider call (mirrors {@link IdleTriageService}).
 */

import { EventEmitter } from 'node:events';
import type { AgentState, CatchUpSummaryResult, LlmRunResult } from '../shared/types.js';
import type { TranscriptRef } from './idle-triage.js';

/** What the service needs to know about a session to summarize it. */
export interface CatchUpSessionInfo {
  projectId: string;
  profile: string;
  cwd: string;
  claudeSessionId?: string;
  /** OpenCode's already-detected session id (see `TranscriptSessionRef`). */
  openCodeSessionId?: string;
  /** Spawn time (epoch ms) — the floor for detecting a Codex rollout file. */
  createdAt?: number;
  status: 'starting' | 'running' | 'exited';
  /** Background sessions (scheduled runs, team workers) are never summarized —
   *  they must not surface for the user's attention. */
  scheduled?: boolean;
  headless?: boolean;
}

export interface CatchUpSummaryDeps {
  /** Is the add-on enabled? Read live so a config toggle takes effect at once. */
  isEnabled: () => boolean;
  /**
   * Idle/blocked dwell (seconds) to wait on the working/blocked → idle edge (or
   * entering 'blocked') before generating. Read live (same as {@link isEnabled})
   * so a config change takes effect without a restart. Filters the 1–2s idle
   * flicker between tool calls.
   */
  delaySeconds: () => number;
  /** Session metadata, or null if the session is gone. */
  getSession: (sessionId: string) => CatchUpSessionInfo | null;
  /**
   * True when the profile has a readable/summarizable transcript (the
   * `hasTranscript` capability). Catch-up reads the transcript digest, so a
   * profile without a transcript is skipped. Provider-agnostic.
   */
  hasTranscript: (profile: string) => boolean;
  /** Only registrations with verified native monitor facts can use semantic work. */
  hasMonitorCapability: (profile: string) => boolean;
  /**
   * Read the session transcript's digest (a role-tagged summary of the whole
   * session, not just the last turn — we want the arc). Returns '' when unavailable.
   * Takes a session ref (not just cwd/claudeSessionId) so a provider whose
   * transcript is located by other means — Codex resolves its rollout by
   * `id` + `createdAt` — can be dispatched behind this one callback.
   */
  readDigest: (ref: TranscriptRef) => Promise<string>;
  /** Run the catch-up-summary prompt with the given vars; never throws. */
  runSummary: (digest: string, trigger: 'idle' | 'blocked', dedupeKey: string) => Promise<LlmRunResult>;
  /** Current epoch ms. Injected so tests are deterministic. */
  now: () => number;
  /** Arm the dwell timer; returns a handle. Injected so tests can use fake timers. */
  setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
  /** Clear a dwell-timer handle. Injected to pair with {@link setTimer}. */
  clearTimer: (handle: NodeJS.Timeout) => void;
}

/**
 * Cap on concurrent per-session micro-calls. Without a bound, a burst across
 * many sessions would stampede the configured HTTP provider. 5 keeps
 * responsiveness without stampeding (mirrors close-summary.ts).
 */
const MAX_CONCURRENT_SUMMARIES = 5;

/**
 * Per-session summary gate. `fired` is true once we've claimed the one-shot for
 * the current trigger spell (set when the dwell timer elapses, before any await);
 * it's reset only after the agent leaves the trigger state, so a steady agent
 * summarizes once. `timer` holds the pending dwell timer armed on the edge —
 * non-null only between entering the trigger and either the timer elapsing or
 * being cancelled (any non-trigger transition clears it). `trigger` remembers
 * which condition armed the timer so the LLM prompt knows 'idle' vs 'blocked'.
 */
interface Entry {
  /** Last agent state we saw, to detect edges. */
  lastState: AgentState;
  /** A summary for the CURRENT trigger spell is in flight or already done. */
  fired: boolean;
  /** The armed dwell timer (null when not in trigger / already elapsed / cancelled). */
  timer: NodeJS.Timeout | null;
  /** Which condition armed the timer: 'idle' (long dwell) or 'blocked' (keyboard-choice / permission). */
  trigger: 'idle' | 'blocked' | null;
}

/**
 * Watches agent-state transitions and emits `summary` ({@link CatchUpSummaryResult})
 * once per idle/blocked spell, when enabled. Wire {@link observe} to the agent-status
 * `status` event and {@link remove} to pty exit. Supports an on-demand
 * {@link generateOne} method for renderer-initiated "Refresh summary" gestures.
 */
export class CatchUpSummaryService extends EventEmitter {
  private entries = new Map<string, Entry>();
  /** Pending summary calls, bounded by MAX_CONCURRENT_SUMMARIES. */
  private pending = 0;

  constructor(private readonly deps: CatchUpSummaryDeps) {
    super();
  }

  /**
   * Feed a session's newly-resolved agent state. On the edge into idle OR into
   * 'blocked' it arms a dwell timer of `delaySeconds()`; the summary micro-call
   * fires only when that timer elapses AND the agent is still in the trigger state
   * (so the 1–2s idle flicker between tool calls never summarizes). Any
   * non-trigger transition cancels the pending timer and re-arms the one-shot gate
   * so the NEXT trigger spell summarizes afresh. Cheap and synchronous on the hot
   * path — the LLM call is fired-and-forgotten once the dwell elapses.
   */
  observe(sessionId: string, state: AgentState): void {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      entry = { lastState: 'unknown', fired: false, timer: null, trigger: null };
      this.entries.set(sessionId, entry);
    }
    const wasInTrigger = entry.lastState === 'idle' || entry.lastState === 'blocked';
    const isInTrigger = state === 'idle' || state === 'blocked';
    entry.lastState = state;

    if (!isInTrigger) {
      // Left the trigger (working/done/exited): cancel any pending dwell and
      // re-arm so the NEXT trigger spell summarizes.
      this.disarm(entry);
      entry.fired = false;
      entry.trigger = null;
      return;
    }
    // state is 'idle' or 'blocked' from here.
    // If we're already in the trigger state but the SPECIFIC state changed (e.g.
    // idle→blocked while the timer is armed), update the trigger label so the
    // prompt gets the right context (blocked needs "recommended option + why").
    if (wasInTrigger && entry.trigger !== state) {
      entry.trigger = state;
    }
    // Don't re-arm if we're already in the trigger, already fired, or already waiting.
    if (wasInTrigger || entry.fired || entry.timer) return;

    // Fresh edge into trigger: arm the dwell. Remember which condition triggered.
    entry.trigger = state; // 'idle' or 'blocked'
    const ms = Math.max(1, Math.round(this.deps.delaySeconds())) * 1000;
    entry.timer = this.deps.setTimer(() => this.onDwellElapsed(sessionId), ms);
  }

  /** Forget a session (call on pty exit). Clears any pending dwell timer. */
  remove(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry) this.disarm(entry);
    this.entries.delete(sessionId);
  }

  /**
   * Generate a catch-up summary on demand for a live session (renderer-initiated
   * "Refresh summary" gesture). BYPASSES the dwell timer and one-shot gate — the
   * caller wants the latest state NOW. Re-validates the session, reads the
   * transcript, and runs the summary even if one was already generated for the
   * current spell. Returns the {@link CatchUpSummaryResult} directly; never throws.
   * Respects MAX_CONCURRENT_SUMMARIES to avoid stampeding, but does NOT claim the
   * automatic one-shot gate (so an automatic summary can still fire for this spell).
   */
  async generateOne(sessionId: string): Promise<CatchUpSummaryResult> {
    // Respect the concurrency cap, but wait rather than dropping (the user asked).
    while (this.pending >= MAX_CONCURRENT_SUMMARIES) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.pending++;
    try {
      return await this.summarize(sessionId, true);
    } finally {
      this.pending--;
    }
  }

  // ----- internals -----------------------------------------------------------

  /** Cancel a pending dwell timer (idempotent). */
  private disarm(entry: Entry): void {
    if (entry.timer) {
      this.deps.clearTimer(entry.timer);
      entry.timer = null;
    }
  }

  /**
   * The dwell elapsed. If the agent is still in the trigger state (observe() would
   * have disarmed on leaving, but guard the race), claim the one-shot and fire the
   * summary. The LLM call is fired-and-forgotten; a failure releases the one-shot
   * so a later edge can retry. Respects MAX_CONCURRENT_SUMMARIES to avoid stampeding.
   */
  private onDwellElapsed(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.timer = null;
    const isInTrigger = entry.lastState === 'idle' || entry.lastState === 'blocked';
    if (!isInTrigger || entry.fired) return;
    entry.fired = true; // claim the one-shot before any await

    // Respect concurrency cap: drop this summary if we're at the limit (automatic
    // fire is best-effort; an on-demand generateOne waits instead).
    if (this.pending >= MAX_CONCURRENT_SUMMARIES) {
      // Release the one-shot. A steady-idle agent has no future edge (observe
      // early-returns while wasInTrigger), but a working→idle→working→idle cycle
      // or a concurrency cap lift lets it retry.
      entry.fired = false;
      return;
    }

    this.pending++;
    void this.summarize(sessionId, false)
      .catch(() => {
        // Never let a summary failure crash the timer callback. Release the
        // one-shot so a future edge gets a fresh attempt.
        const e = this.entries.get(sessionId);
        if (e) e.fired = false;
      })
      .finally(() => {
        this.pending--;
      });
  }

  /**
   * Core summary logic: validate the session, read the digest, run the LLM call,
   * and emit or return the result. `onDemand` distinguishes automatic (emit only)
   * from renderer-initiated (return the result). Never throws.
   */
  private async summarize(sessionId: string, onDemand: boolean): Promise<CatchUpSummaryResult> {
    const entry = this.entries.get(sessionId);
    const trigger = entry?.trigger ?? 'idle'; // default to 'idle' if entry is gone

    // Helper to build a failed result.
    const fail = (reason: string): CatchUpSummaryResult => ({
      sessionId,
      projectId: '',
      ok: false,
      text: '',
      error: reason,
      ms: 0,
      generatedAt: this.deps.now(),
      trigger
    });

    if (!this.deps.isEnabled()) return fail('disabled');
    const session = this.deps.getSession(sessionId);
    if (!session || session.status === 'exited') return fail('ineligible');
    // Background agents (scheduled runs, team workers) never request attention.
    if (session.scheduled || session.headless) return fail('background');
    if (!this.deps.hasMonitorCapability(session.profile)) return fail('monitor-unsupported');
    if (!this.deps.hasTranscript(session.profile)) return fail('no-transcript');

    const digest = await this.deps.readDigest({
      id: sessionId,
      profile: session.profile,
      cwd: session.cwd,
      claudeSessionId: session.claudeSessionId,
      openCodeSessionId: session.openCodeSessionId,
      createdAt: session.createdAt
    });
    if (!digest.trim()) {
      const emptyFailure = fail('empty'); // nothing to summarize — don't spend a call
      // Emit 'empty' failure for automatic path too — it's terminal (no transcript
      // to read), so the card can show a graceful "not enough context yet" state.
      if (!onDemand) {
        this.emit('summary', { ...emptyFailure, projectId: session.projectId });
      }
      return { ...emptyFailure, projectId: session.projectId };
    }

    // Re-check enablement after the (cheap) read but before the (costly) call,
    // so toggling the add-on off mid-read doesn't still spend a token.
    if (!this.deps.isEnabled()) return fail('disabled');

    const result = await this.deps.runSummary(digest, trigger, sessionId);

    // The agent may have moved on during the ~10–20s call. Check once for both
    // success and failure paths (mirrors the success-path guard at line 309).
    const currentEntry = this.entries.get(sessionId);
    const stillInTrigger =
      currentEntry?.lastState === 'idle' || currentEntry?.lastState === 'blocked';

    if (!result.ok) {
      const failure: CatchUpSummaryResult = {
        sessionId,
        projectId: session.projectId,
        ok: false,
        text: '',
        error: result.error ?? 'summary-failed',
        model: result.model,
        ms: result.ms,
        generatedAt: this.deps.now(),
        trigger
      };
      // Emit failure for automatic path too, so the renderer can show its error state.
      // Terminal failures (model error, LLM failure) are worth surfacing. Guard with
      // stillInTrigger (like the success path) so a stale error never lands on a
      // now-working agent.
      if (!onDemand && stillInTrigger) {
        this.emit('summary', failure);
      }
      return failure;
    }

    // For automatic summaries (not on-demand), only emit if it's still in a trigger
    // state — a stale summary on a now-working agent would be misleading. For
    // on-demand, always return it (the user explicitly asked).
    if (!onDemand && !stillInTrigger) return fail('state-changed');

    const payload: CatchUpSummaryResult = {
      sessionId,
      projectId: session.projectId,
      ok: true,
      text: result.text.trim(),
      model: result.model,
      ms: result.ms,
      generatedAt: this.deps.now(),
      trigger
    };

    if (!onDemand) {
      // Automatic fire: emit the event (renderer listens via onCatchUpSummary).
      this.emit('summary', payload);
    }
    return payload;
  }
}
