/**
 * Auto-close idle agents — close an opted-in fleet's at-rest agents on a timer.
 *
 * The agent-status tracker tells us WHEN an agent goes idle. This service acts
 * on that on a TIMER (same shape as {@link HeartbeatService}): if the master
 * switch is on and a non-background, non-delegating session stays idle for
 * `delayMinutes`, it CLOSES the session — silently (no summary micro-call), but
 * after first turning a parked question into a durable follow-up via the cached
 * idle-triage verdict ({@link AutoCloseIdleDeps.preserveParkedQuestion}) so the
 * user never loses an agent that was waiting on them.
 *
 * Unlike heartbeat, the fire action is DESTRUCTIVE and ONE-SHOT: once a session
 * is closed it's gone, so there is no re-arm loop — `fire()` closes once and
 * forgets the entry. Every eligibility gate is re-checked at fire time because
 * the 15-minute dwell is long enough for config, agent state, sub-agent count,
 * the foreground tab, and human input to all change during the wait.
 *
 * Safety (a wrongful close is unrecoverable, so the gates err toward NOT closing):
 *  - Fires on `idle` ONLY — never `working` (busy) or `blocked` (a permission /
 *    interactive prompt is left alone; the timer never answers a prompt).
 *  - Background agents (scheduled / headless) are never closed.
 *  - A delegating parent (live sub-agents > 0) is never closed — that would
 *    orphan its children mid-orchestration.
 *  - Shell tabs are never closed (no agent to reclaim).
 *  - Two-clock: the session must have been idle for the full dwell AND no HUMAN
 *    keystroke (`lastInputAt`) within the same window — a tab a person was just
 *    typing in is spared even if the agent itself went quiet.
 *  - Foreground spare: the tab the user is currently viewing
 *    ({@link AutoCloseIdleDeps.activeSessionId}) is never closed. Advisory only
 *    (renderer-reported), so it can only ever SPARE, never authorize a close.
 *  - Favorite spare: an agent the user has starred/followed
 *    ({@link AutoCloseIdleDeps.isFavorite}) is never closed by this timer. The
 *    user pinned it deliberately, so "default/basic" idle reclamation leaves it
 *    be — only an explicit close (a person, or the agent-driven
 *    `close_idle_agents` tool) may reclaim it. Advisory only (renderer-reported
 *    star set), so like the foreground spare it can only SPARE, never authorize.
 *  - Own-project only: this is a per-session timer with no cross-project sweep,
 *    so there is no `allProjects` widening — distinct from the deliberate,
 *    agent-driven `close_idle_agents` MCP tool.
 *
 * All collaborators are injected so the trigger/timer logic is unit-testable
 * without Electron or a real pty — same shape as {@link HeartbeatDeps}.
 */

import { EventEmitter } from 'node:events';
import type { AgentState, LaunchProfileId } from '../shared/types.js';
import { providerCapabilities } from '../shared/launch-provider.js';

/** What the service needs to know about a session to decide whether to close it. */
export interface AutoCloseSessionInfo {
  status: 'starting' | 'running' | 'exited';
  projectId: string;
  title: string;
  /**
   * Launch profile. Only an AGENT profile (`providerCapabilities(profile).isAgent`)
   * is auto-closeable; a `shell` tab — or any future non-agent profile — is never
   * auto-closed.
   */
  profile: string;
  /** Background agents (scheduled runs, team workers) are never auto-closed. */
  scheduled?: boolean;
  headless?: boolean;
  /**
   * Live sub-agent (Task spawn) count. An agent that LOOKS idle but has children
   * still running is delegating, not at rest — closing it would orphan them, so
   * a non-zero count makes it ineligible. Absent ⇒ 0.
   */
  liveSubagents?: number;
  /**
   * Wall-clock ms (epoch) of the last HUMAN keystroke into this session. Used by
   * the two-clock guard so a tab a person was just typing in is spared.
   * Absent/0 ⇒ never typed (eligible on that axis).
   */
  lastInputAt?: number;
}

export interface AutoCloseIdleDeps {
  /** Is the master switch on? Read live so a config toggle takes effect at once. */
  isEnabled: () => boolean;
  /** Idle minutes before a session is auto-closed. Read live. */
  delayMinutes: () => number;
  /** Session metadata, or null if the session is gone. */
  getSession: (sessionId: string) => AutoCloseSessionInfo | null;
  /** The foreground tab id (advisory; spares only). Null when none/unknown. */
  activeSessionId: () => string | null;
  /**
   * Has the user starred/followed this session (advisory; spares only)? A
   * favorite is pinned deliberately, so the idle timer never reclaims it — only
   * an explicit close (a person, or the `close_idle_agents` tool) may. Backed by
   * the renderer's persisted star set, so like {@link activeSessionId} it can
   * only ever SPARE, never authorize a close (Rule 1).
   */
  isFavorite: (sessionId: string) => boolean;
  /** Current epoch ms. Injected so tests are deterministic. */
  now: () => number;
  /** Close the session (expected close ⇒ exit code 0). Returns false if gone. */
  closeSession: (sessionId: string) => boolean;
  /**
   * Turn a cached `awaiting-reply` idle-triage verdict into a durable follow-up
   * BEFORE closing, so a parked question survives the close. Returns true when a
   * follow-up was created/refreshed, false otherwise. Never throws.
   */
  preserveParkedQuestion: (sessionId: string) => boolean;
  /** Push an inbox breadcrumb so a silent close is never invisible. Never throws. */
  pushInbox: (input: {
    projectId: string;
    subject?: string;
    comments: string;
    dedupeKey?: string;
  }) => void;
  /**
   * Should an auto-close drop an inbox breadcrumb at all? OFF by default: an
   * idle-agent auto-close is routine bookkeeping — folding it into the inbox
   * (even collapsed) is noise most users don't want, and the close is still
   * recorded in the Activity Feed + the Agents tab. Opt in via config to get the
   * breadcrumb back. Read live so a toggle takes effect at once. Absent ⇒ off.
   */
  shouldNotifyInbox?: () => boolean;
  /** Arm a timer; returns a handle. Injected so tests can use fake timers. */
  setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
  /** Clear a timer handle. Injected to pair with {@link setTimer}. */
  clearTimer: (handle: NodeJS.Timeout) => void;
}

/**
 * Per-session close state.
 *  - `lastState` tracks the edge into/out of idle.
 *  - `idleSince` is the epoch ms the current idle spell began (for the two-clock).
 *  - `timer` is the armed close (null when not idle / not eligible).
 *  - `closing` guards the destructive fire against a racing re-entrant call.
 */
interface Entry {
  lastState: AgentState;
  idleSince: number;
  timer: NodeJS.Timeout | null;
  closing: boolean;
}

export class AutoCloseIdleService extends EventEmitter {
  private entries = new Map<string, Entry>();

  constructor(private readonly deps: AutoCloseIdleDeps) {
    super();
  }

  /**
   * Feed a session's newly-resolved agent state. On the edge INTO idle (for an
   * eligible session) it arms the close timer and records `idleSince`; on leaving
   * idle it disarms. Cheap and synchronous on the hot path.
   */
  observe(sessionId: string, state: AgentState): void {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      entry = { lastState: 'unknown', idleSince: 0, timer: null, closing: false };
      this.entries.set(sessionId, entry);
    }
    const prev = entry.lastState;
    entry.lastState = state;
    if (state === prev) return; // not an edge — nothing to do

    if (state !== 'idle') {
      // Left idle — disarm any pending close. The next idle edge re-arms afresh.
      this.disarm(entry);
      entry.idleSince = 0;
      return;
    }

    // Entered idle — stamp the spell start and arm the close if eligible now.
    entry.idleSince = this.deps.now();
    this.arm(sessionId, entry);
  }

  /** Forget a session (call on pty exit). Clears any pending timer. */
  remove(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry) this.disarm(entry);
    this.entries.delete(sessionId);
  }

  /**
   * Disarm every pending close (call when the master toggle is flipped OFF) so
   * "off" is instant across the whole fleet rather than waiting for each live
   * timer to elapse and self-cancel at its eligibility re-check. Keeps every
   * entry's history so a later re-enable can re-arm the ones still idle.
   */
  cancelAll(): void {
    for (const entry of this.entries.values()) this.disarm(entry);
  }

  /**
   * Arm a close for EVERY session whose last observed state is still idle (call
   * when the master toggle is flipped ON). {@link observe} only arms on the
   * working→idle edge — the common case is enabling auto-close while a fleet is
   * already sitting idle, which would otherwise never fire until each agent
   * cycled through working again. Eligibility is re-checked inside arm.
   */
  armAllIdle(): void {
    for (const [sessionId, entry] of this.entries) {
      if (entry.lastState !== 'idle') continue;
      if (!entry.idleSince) entry.idleSince = this.deps.now();
      this.arm(sessionId, entry);
    }
  }

  /**
   * Cancel any armed close for a session without forgetting its history (call
   * when the master toggle is flipped OFF, so "off" is instant rather than
   * waiting for the live timer to elapse and self-cancel at the eligibility
   * re-check). Keeps the entry so a later re-enable + idle edge re-arms cleanly.
   */
  cancel(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry) this.disarm(entry);
  }

  /**
   * Arm a close for a session that is ALREADY idle (call when the master toggle
   * is flipped ON). {@link observe} only arms on the working→idle EDGE, so the
   * common case — you enable auto-close while agents are already sitting idle —
   * would otherwise never fire until each agent cycled through working again.
   * Safe to call anytime: no-ops unless this session's last observed state is
   * `idle` and it's eligible right now (eligibility is re-checked inside arm).
   */
  armIfIdle(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.lastState !== 'idle') return;
    if (!entry.idleSince) entry.idleSince = this.deps.now();
    this.arm(sessionId, entry);
  }

  // ----- internals -----------------------------------------------------------

  /** Idle dwell in ms (clamped ≥ 1 minute), read live. */
  private delayMs(): number {
    return Math.max(1, Math.round(this.deps.delayMinutes())) * 60_000;
  }

  /**
   * Whether this session may be auto-closed right now (re-checked at every gate).
   * Does NOT include the two-clock human-input check — that's a fire-time check
   * against `idleSince` (see {@link fire}) — nor the still-idle assertion, which
   * the caller (`observe`/`fire`) already holds.
   */
  private eligible(sessionId: string): boolean {
    if (!this.deps.isEnabled()) return false;
    const s = this.deps.getSession(sessionId);
    if (!s) return false;
    if (s.status === 'exited') return false;
    // Only an AGENT is auto-closeable — a plain shell (or any future non-agent
    // profile) is off the Agents board and never reclaimed. Capability-driven,
    // not a `=== 'shell'` literal (Rule 6): an unknown id degrades to the LEAST_CAPABLE
    // floor (`isAgent:false`) and is spared, exactly like shell.
    if (!providerCapabilities(s.profile as LaunchProfileId).isAgent) return false;
    if (s.scheduled || s.headless) return false; // background — never
    if ((s.liveSubagents ?? 0) > 0) return false; // delegating — would orphan children
    if (this.deps.activeSessionId() === sessionId) return false; // foreground spare
    if (this.deps.isFavorite(sessionId)) return false; // starred — user pinned it; only an explicit close may reclaim
    return true;
  }

  private arm(sessionId: string, entry: Entry): void {
    if (entry.timer) return; // already armed
    if (!this.eligible(sessionId)) return;
    entry.timer = this.deps.setTimer(() => this.fire(sessionId), this.delayMs());
  }

  private disarm(entry: Entry): void {
    if (entry.timer) {
      this.deps.clearTimer(entry.timer);
      entry.timer = null;
    }
  }

  /**
   * The idle timer elapsed. Re-check everything (config/state/sub-agents/
   * foreground may have changed during the dwell), apply the two-clock guard,
   * preserve any parked question, then close once.
   */
  private fire(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.timer = null;
    if (entry.closing) return; // a close is already in flight — never double-fire

    // Still idle? observe() would have disarmed on leaving, but guard the race.
    if (entry.lastState !== 'idle') return;
    if (!this.eligible(sessionId)) return;

    // Two-clock: a HUMAN keystroke within the dwell window spares the tab even
    // though the agent itself fell silent. `lastInputAt` is stamped only by real
    // renderer keystrokes (not agent-injected writes), so this is a true
    // "someone was using this" signal.
    const s = this.deps.getSession(sessionId);
    if (!s) return;
    const now = this.deps.now();
    const lastInput = s.lastInputAt ?? 0;
    if (lastInput > 0 && now - lastInput < this.delayMs()) return; // recently typed — spare it

    entry.closing = true; // claim the one-shot before any external call

    // Preserve a parked question first (best-effort, zero tokens — cached verdict).
    let preserved = false;
    try {
      preserved = this.deps.preserveParkedQuestion(sessionId);
    } catch {
      /* never let preservation crash the timer callback */
    }

    const closed = this.deps.closeSession(sessionId);
    if (!closed) {
      // Session vanished between the gate and the close — nothing to do; drop it.
      this.entries.delete(sessionId);
      return;
    }

    // Optional inbox breadcrumb. OFF by default — an idle auto-close is routine
    // and the close is still recorded in the feed + Agents tab, so we don't fold
    // a notice into the inbox unless the user opts in. When a parked question was
    // preserved, always leave the breadcrumb regardless of the toggle: that
    // follow-up is something the user genuinely needs to see.
    const notify = this.deps.shouldNotifyInbox?.() ?? false;
    if (notify || preserved) {
      try {
        this.deps.pushInbox({
          projectId: s.projectId,
          subject: `Auto-closed — ${s.title}`,
          comments:
            `**Auto-closed** idle agent “${s.title}” after ${Math.round(this.deps.delayMinutes())} min idle.` +
            (preserved ? ' A follow-up was created for the question it had parked.' : ''),
          dedupeKey: `auto-close:${sessionId}`
        });
      } catch {
        /* breadcrumb is best-effort */
      }
    }

    this.entries.delete(sessionId);
    this.emit('closed', sessionId, { preserved });
  }
}
