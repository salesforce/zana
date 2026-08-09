/**
 * Agent Heartbeat — keep an opted-in agent moving when it settles into idle.
 *
 * The agent-status tracker tells us WHEN an agent goes idle. This service acts
 * on that on a TIMER (unlike {@link IdleTriageService}, which fires on the
 * instant edge): if an enabled, non-background session stays idle for
 * `delaySeconds`, it types a nudge into the session (the configured message,
 * submitted like an inbox reply via `reply` — body + deferred CR) so the agent
 * resumes on its own. While the agent stays idle the timer re-arms, so a
 * stubborn idle agent is nudged again each interval.
 *
 * Safety:
 *  - Fires on `idle` ONLY — never `blocked` (a permission prompt / interactive
 *    question is left alone, so the nudge text can't answer a security prompt).
 *  - Background agents (scheduled / headless) are never nudged; the per-agent
 *    toggle is hidden for them in the UI and `getSession` lets us re-check.
 *  - Runaway guard: after `maxNudges` consecutive nudges with no genuine
 *    activity in between, heartbeat auto-disables for that agent (via
 *    `setHeartbeat(id, false)`) and an inbox notice is pushed. The counter
 *    resets when the agent leaves idle WITHOUT a nudge having just fired; it is
 *    kept across the resume our own nudge triggers (tracked by `pendingResume`).
 *    The attribution is coarse — the FIRST non-idle edge after a nudge is always
 *    treated as "ours", so a human who jumps in right after a nudge fires has
 *    that resume counted toward the streak. This errs toward tripping the cap
 *    sooner (the safe direction): worst case the agent gets paused one nudge
 *    early, never that it nudges unboundedly.
 *
 * Known imprecision: agent state is debounced upstream (~250ms) and only an
 * `idle` reading is observable — a cleanly FINISHED agent shows the same idle
 * glyph as a paused one, so it will be nudged (the default message tells it to
 * say so and stop). The runaway cap bounds the cost. A nudge can also land in
 * the brief debounce gap just as an agent resumes; harmless (it's working, not
 * blocked) and bounded by the same cap.
 *
 * All collaborators are injected so the trigger/timer logic is unit-testable
 * without Electron or a real pty — same shape as {@link IdleTriageDeps}.
 */

import { EventEmitter } from 'node:events';
import type { AgentState } from '../shared/types.js';

/** What the service needs to know about a session to decide whether to nudge. */
export interface HeartbeatSessionInfo {
  /** The per-agent opt-in flag (TerminalSession.heartbeat). */
  heartbeat?: boolean;
  /** Background agents are never nudged. */
  scheduled?: boolean;
  headless?: boolean;
  status: 'starting' | 'running' | 'exited';
  projectId: string;
  title: string;
  /**
   * Live sub-agent (Task spawn) count. An agent that LOOKS idle but has
   * children still running is delegating, not at rest — nudging it would
   * interrupt mid-orchestration, so a non-zero count makes it ineligible.
   * Absent ⇒ 0 (no sub-agent hook / untracked), i.e. nudge as before.
   */
  liveSubagents?: number;
}

export interface HeartbeatDeps {
  /** Is the master switch on? Read live so a config toggle takes effect at once. */
  isEnabled: () => boolean;
  /** Session metadata, or null if the session is gone. */
  getSession: (sessionId: string) => HeartbeatSessionInfo | null;
  /** Idle seconds before a nudge fires (also the repeat interval). */
  delaySeconds: () => number;
  /** Consecutive-nudge cap before auto-disabling heartbeat for the agent. */
  maxNudges: () => number;
  /** The text to type into the agent on each nudge. */
  message: () => string;
  /** Type a line into the session (body + deferred CR). Returns false if gone. */
  reply: (sessionId: string, text: string) => boolean;
  /** Flip the per-agent heartbeat opt-in (used to auto-disable at the cap). */
  setHeartbeat: (sessionId: string, on: boolean) => void;
  /** Push an inbox notice (the runaway-cap notification). Never throws. */
  pushInbox: (input: {
    projectId: string;
    subject?: string;
    comments: string;
    dedupeKey?: string;
  }) => void;
  /** Arm a timer; returns a handle. Injected so tests can use fake timers. */
  setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
  /** Clear a timer handle. Injected to pair with {@link setTimer}. */
  clearTimer: (handle: NodeJS.Timeout) => void;
}

/**
 * Per-session heartbeat state.
 *  - `lastState` tracks the edge into/out of idle.
 *  - `timer` is the armed nudge (null when not idle / not eligible).
 *  - `consecutive` counts back-to-back nudges with no genuine resume between.
 *  - `pendingResume` is true between firing a nudge and the agent leaving idle:
 *    when it leaves, we know that resume was OUR doing, so we KEEP the counter
 *    instead of resetting it.
 */
interface Entry {
  lastState: AgentState;
  timer: NodeJS.Timeout | null;
  consecutive: number;
  pendingResume: boolean;
}

export class HeartbeatService extends EventEmitter {
  private entries = new Map<string, Entry>();

  constructor(private readonly deps: HeartbeatDeps) {
    super();
  }

  /**
   * Feed a session's newly-resolved agent state. On the edge INTO idle (for an
   * eligible session) it arms the nudge timer; on leaving idle it disarms and
   * updates the consecutive counter. Cheap and synchronous on the hot path.
   */
  observe(sessionId: string, state: AgentState): void {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      entry = { lastState: 'unknown', timer: null, consecutive: 0, pendingResume: false };
      this.entries.set(sessionId, entry);
    }
    const prev = entry.lastState;
    entry.lastState = state;
    if (state === prev) return; // not an edge — nothing to do

    if (state !== 'idle') {
      // Left idle. Disarm any pending nudge. If we caused this resume (a nudge
      // fired and the agent picked it up), keep the streak counter so repeated
      // self-nudges still trip the runaway cap. Otherwise the agent moved on
      // its own / by human input → reset the streak.
      this.disarm(entry);
      if (entry.pendingResume) {
        entry.pendingResume = false;
      } else {
        entry.consecutive = 0;
      }
      return;
    }

    // Entered idle. Arm the nudge if this session is eligible right now.
    this.arm(sessionId, entry);
  }

  /** Forget a session (call on pty exit). Clears any pending timer. */
  remove(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry) this.disarm(entry);
    this.entries.delete(sessionId);
  }

  /**
   * Cancel any armed nudge for a session without forgetting its history (call
   * when the per-agent flag is toggled OFF, so "off" is instant rather than
   * waiting for the live timer to elapse and self-cancel at the eligibility
   * re-check). Keeps the entry so a later re-enable + idle edge re-arms cleanly.
   */
  cancel(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry) this.disarm(entry);
  }

  /**
   * Arm a nudge for a session that is ALREADY idle (call when the per-agent flag
   * is toggled ON). {@link observe} only arms on the working→idle EDGE, so the
   * common case — you spot an idle agent and enable Heartbeat on it — would
   * otherwise never nudge, because no fresh idle edge follows the toggle; the
   * agent just keeps sitting in the idle state it was already in. Safe to call
   * anytime: it no-ops unless this session's last observed state is `idle` and
   * it's eligible right now (eligibility is re-checked inside {@link arm}).
   */
  armIfIdle(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.lastState !== 'idle') return;
    this.arm(sessionId, entry);
  }

  // ----- internals -----------------------------------------------------------

  /** Whether this session may be nudged right now (re-checked at every gate). */
  private eligible(sessionId: string): boolean {
    if (!this.deps.isEnabled()) return false;
    const s = this.deps.getSession(sessionId);
    if (!s) return false;
    if (s.status === 'exited') return false;
    if (s.scheduled || s.headless) return false; // background agents are never nudged
    if ((s.liveSubagents ?? 0) > 0) return false; // delegating, not at rest — don't interrupt
    return s.heartbeat === true;
  }

  private arm(sessionId: string, entry: Entry): void {
    if (entry.timer) return; // already armed
    if (!this.eligible(sessionId)) return;
    const ms = Math.max(1, Math.round(this.deps.delaySeconds())) * 1000;
    entry.timer = this.deps.setTimer(() => this.fire(sessionId), ms);
  }

  private disarm(entry: Entry): void {
    if (entry.timer) {
      this.deps.clearTimer(entry.timer);
      entry.timer = null;
    }
  }

  /**
   * The idle timer elapsed. Re-check eligibility (config/state may have changed
   * during the wait), then either nudge + re-arm, or hit the runaway cap and
   * auto-disable + notify.
   */
  private fire(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.timer = null;

    // Still idle? The agent may have moved during the wait; observe() would
    // have disarmed, but guard anyway in case the timer raced.
    if (entry.lastState !== 'idle') return;
    if (!this.eligible(sessionId)) return;

    const max = Math.max(1, Math.round(this.deps.maxNudges()));
    if (entry.consecutive >= max) {
      // Runaway: stop nudging this agent and tell the operator.
      this.disableAndNotify(sessionId, entry, max);
      return;
    }

    const sent = this.deps.reply(sessionId, this.deps.message());
    if (!sent) return; // session went away between gate and write — give up quietly

    entry.consecutive += 1;
    entry.pendingResume = true; // the resume this triggers is ours; keep the streak
    this.emit('nudge', sessionId, entry.consecutive);

    // Re-arm: if the agent ignores the nudge and stays idle, nudge again after
    // another delay. (If it resumes, observe() disarms this timer.)
    entry.timer = this.deps.setTimer(
      () => this.fire(sessionId),
      Math.max(1, Math.round(this.deps.delaySeconds())) * 1000
    );
  }

  private disableAndNotify(sessionId: string, entry: Entry, max: number): void {
    this.disarm(entry);
    this.deps.setHeartbeat(sessionId, false);
    const s = this.deps.getSession(sessionId);
    if (s) {
      try {
        this.deps.pushInbox({
          projectId: s.projectId,
          subject: `Heartbeat paused — ${s.title}`,
          comments:
            `**Heartbeat paused** for “${s.title}” after ${max} consecutive nudges ` +
            `with no progress — the agent is still idle. Re-enable Heartbeat in the ` +
            `agent inspector if you want to keep nudging it.`,
          // One row per session: if the same agent trips the cap again (after a
          // re-enable), refresh the existing notice rather than stacking notices.
          dedupeKey: `heartbeat:${sessionId}`
        });
      } catch {
        /* notifying is best-effort; never let it crash the timer callback */
      }
    }
    entry.consecutive = 0;
    entry.pendingResume = false;
    this.emit('paused', sessionId, max);
  }
}
