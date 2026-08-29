/**
 * Held-questions service — suppress an agent's inbox question WHILE it's working,
 * flush it the moment the agent stops (idle/blocked) or a safety deadline passes.
 *
 * The problem it solves: an agent that fires `inbox_ask` / `inbox_push{options}`
 * mid-run lands a question in the inbox immediately, even though the user can't
 * usefully act on it until the agent is actually waiting. A busy fleet turns the
 * inbox into a wall of half-relevant questions (many of which the agent resolves
 * itself before it ever stops). This service holds a question-bearing entry while
 * its originating session is `working` and only writes it to the inbox on the
 * working→idle / working→blocked edge — or after {@link HeldQuestionDeps.maxHoldMs}
 * for a BLOCKING question, so a never-idling agent can't bury a real blocker.
 *
 * Design mirrors {@link IdleTriageService}: a per-session edge tracker wired to
 * the same `agentStatus` `status` event, all collaborators injected so the logic
 * is unit-testable without Electron, a real pty, or the inbox store. It spends NO
 * tokens — it's pure gating + a deferred append.
 *
 * Lifecycle contract (matches the other idle-edge services):
 *  - {@link maybeHold} is called by the inbox tools at push time. It returns true
 *    (the tool must NOT append — the question is parked) or false (append now).
 *  - {@link observe} is wired to the status edge; it flushes on entering idle/blocked.
 *  - {@link remove} is wired to pty exit; it DROPS every held question for the
 *    session (an agent that finished and closed without ever idling never wanted
 *    the answer — a deliberate "self-resolve on exit").
 */

import type { AgentState } from '../shared/types.js';
import type { InboxInput } from './inbox-store.js';
import { hasBlockingQuestion } from '../shared/types.js';

/** Default safety deadline: flush a held BLOCKING question after 10 min even if
 *  the agent never stops working (a long poll / tight loop must not bury it). */
export const HELD_QUESTION_MAX_HOLD_MS = 10 * 60 * 1000;

/**
 * The narrow gate the inbox tools depend on — just {@link HeldQuestionService.maybeHold}.
 * Injected into `registerInboxPushTool` / `registerInboxAskTool` so the tools
 * can park a question without importing the whole service (and so tests can pass
 * a stub). Absent ⇒ the feature is off and every question appends immediately.
 */
export interface HeldQuestionGate {
  maybeHold(sessionId: string | undefined, input: InboxInput): boolean;
}

export interface HeldQuestionDeps {
  /**
   * Master switch. Read LIVE so a config toggle takes effect without a restart.
   * When false, {@link maybeHold} always returns false (append immediately) —
   * the feature is a no-op and questions behave exactly as before.
   */
  isEnabled: () => boolean;
  /** Current agent state for a session, or undefined if unknown. */
  getAgentState: (sessionId: string) => AgentState | undefined;
  /** Flush sink — append a held question to the inbox. Never expected to throw
   *  in a way that should crash the caller; failures are logged and swallowed. */
  append: (input: InboxInput) => Promise<unknown>;
  /** Safety deadline (ms) for a held BLOCKING question. Read live. */
  maxHoldMs: () => number;
  /** Current epoch ms. Injected so tests are deterministic. */
  now: () => number;
  /** Arm a timer; returns a handle. Injected so tests can use fake timers. */
  setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
  /** Clear a timer handle. Injected to pair with {@link setTimer}. */
  clearTimer: (handle: NodeJS.Timeout) => void;
  /** Optional error sink for a failed flush (defaults to console.error). */
  onError?: (context: string, err: unknown) => void;
}

/** One parked (blocking) question awaiting its session's idle edge or deadline. */
interface HeldEntry {
  input: InboxInput;
  /** When it was parked (epoch ms) — for the max-hold deadline. */
  heldAt: number;
  /** The armed max-hold safety timer. */
  timer: NodeJS.Timeout | null;
}

interface SessionState {
  /** Last agent state we saw, to detect the edge INTO idle/blocked. */
  lastState: AgentState | 'init';
  /** Questions parked for this session, oldest-first. */
  held: HeldEntry[];
}

/**
 * Holds question-bearing inbox entries while their session is working; flushes
 * them on the idle/blocked edge or after the safety deadline. Wire {@link observe}
 * to the agent-status `status` event and {@link remove} to pty exit (Rule 3).
 */
export class HeldQuestionService {
  private sessions = new Map<string, SessionState>();

  constructor(private readonly deps: HeldQuestionDeps) {}

  /**
   * Decide at push time whether to HOLD this question-bearing entry. Returns true
   * when it was parked (the caller must NOT append — it surfaces later, on idle),
   * false when the caller should append immediately.
   *
   * Holds ONLY a BLOCKING question fired while the agent is actively working.
   * Rationale for the two gates:
   *  - Non-blocking (soft) questions are already demoted out of the pinned band
   *    (see `hasBlockingQuestion` + the sidebar), so they read as ordinary
   *    inline reports — suppressing them would needlessly delay report content
   *    (docs/comments ride the same `inbox_push` entry) for no attention win.
   *  - A question fired while the agent is idle/blocked/done/unknown is already
   *    effectively "waiting"; holding it would just hide it.
   *
   * `sessionId` is the host-resolved originating session (project-only pushes
   * have no working state to gate on → never held).
   */
  maybeHold(sessionId: string | undefined, input: InboxInput): boolean {
    if (!this.deps.isEnabled()) return false;
    if (!sessionId) return false; // project-only push has no working state to gate on
    if (!hasBlockingQuestion(input)) return false; // soft/report entries surface now
    if (this.deps.getAgentState(sessionId) !== 'working') return false;

    const state = this.ensure(sessionId);
    const entry: HeldEntry = {
      input,
      heldAt: this.deps.now(),
      timer: null
    };
    // Every held entry is blocking, so it gets a safety deadline: a never-idling
    // agent (long poll / tight loop) must not bury a real blocker forever.
    const ms = Math.max(1000, Math.round(this.deps.maxHoldMs()));
    entry.timer = this.deps.setTimer(() => this.onDeadline(sessionId, entry), ms);
    state.held.push(entry);
    return true;
  }

  /**
   * Feed a session's newly-resolved agent state. On the edge INTO a stopped state
   * (idle, blocked, or `waiting` for non-OSC harnesses — the agent stopped making
   * progress, so the user's input is useful NOW) flush
   * every held question for the session. A working→working or other non-stop
   * transition does nothing. Cheap and synchronous on the hot path (the appends
   * are fired-and-forgotten).
   */
  observe(sessionId: string, state: AgentState): void {
    const s = this.sessions.get(sessionId);
    if (!s) {
      // Track state even before anything is held, so a later hold sees the edge.
      this.ensure(sessionId).lastState = state;
      return;
    }
    const stopped = state === 'idle' || state === 'blocked' || state === 'waiting';
    s.lastState = state;
    if (stopped && s.held.length > 0) this.flushAll(sessionId);
  }

  /**
   * Forget a session (call on pty exit). DROPS every held question — an agent
   * that finished and closed without ever idling never wanted the answer. Clears
   * any armed deadline timers.
   */
  remove(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s) for (const h of s.held) this.disarm(h);
    this.sessions.delete(sessionId);
  }

  /** Held-question count for a session — for tests / diagnostics. */
  heldCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.held.length ?? 0;
  }

  // ----- internals -----------------------------------------------------------

  private ensure(sessionId: string): SessionState {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = { lastState: 'init', held: [] };
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  private disarm(entry: HeldEntry): void {
    if (entry.timer) {
      this.deps.clearTimer(entry.timer);
      entry.timer = null;
    }
  }

  /** Flush all held questions for a session (idle/blocked edge). */
  private flushAll(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    const held = s.held;
    s.held = [];
    for (const h of held) {
      this.disarm(h);
      this.emit(h.input);
    }
  }

  /** The safety deadline elapsed for one blocking held entry — flush just it. */
  private onDeadline(sessionId: string, entry: HeldEntry): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    const idx = s.held.indexOf(entry);
    if (idx === -1) return; // already flushed / dropped
    s.held.splice(idx, 1);
    entry.timer = null;
    this.emit(entry.input);
  }

  /** Append one held input to the inbox; swallow + log failures. */
  private emit(input: InboxInput): void {
    void Promise.resolve(this.deps.append(input)).catch((err) => {
      (this.deps.onError ?? ((ctx, e) => console.error(ctx, e)))(
        '[held-questions] flush append failed:',
        err
      );
    });
  }
}
