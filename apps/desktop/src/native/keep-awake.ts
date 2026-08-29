/**
 * Keep-Awake — stop macOS idle-sleep while agents are actively working.
 *
 * Locking the Mac does NOT kill this app's process; what ends in-flight agents
 * is the system's *idle sleep* (the laptop nodding off after the display
 * blanks). Electron's `powerSaveBlocker` is the programmatic `caffeinate`: a
 * held `prevent-app-suspension` block keeps the SYSTEM awake (the display may
 * still sleep — fine while locked) so a long Claude turn keeps running.
 *
 * This service drives that blocker off the SAME resolved-status edge as
 * {@link HeartbeatService} / the mail-drain (`agentStatus.on('status')`):
 *  - a session entering `working` adds it to the live set and acquires the
 *    blocker if not already held;
 *  - a session leaving `working` removes it; when the set empties we DON'T
 *    release immediately — a brief `idle` gap between sub-agents or autonomous
 *    nudges is normal, and thrashing the blocker every few seconds is pointless.
 *    Instead we arm a grace timer; only if nothing resumes within the window do
 *    we release. Any resume inside the window cancels the pending release.
 *
 * Only `working` keeps the Mac awake (the user's chosen policy): `idle`,
 * `blocked`, `done`, and `unknown` do not. A `blocked` agent is waiting on user
 * input you can't supply while the Mac is locked anyway, so there's no point
 * burning battery for it.
 *
 * Rule 3: the held blocker + grace timer are process-lifetime resources; the
 * owner MUST call {@link shutdown} on app teardown (before-quit) to release them.
 *
 * All collaborators are injected (the blocker start/stop, the clock) so the
 * acquire/release/grace logic is unit-testable without Electron — same shape as
 * {@link HeartbeatDeps}.
 */

import type { AgentState } from '@zana-ai/zcc-domain/product';

/**
 * Grace window before releasing the blocker once every agent has gone quiet.
 * Long enough to ride out the idle gap between sub-agents / an autonomous-run
 * nudge (heartbeat's default delay is 30s; autonomous nudges ~45s), short
 * enough that an actually-finished fleet stops holding the Mac awake promptly.
 */
export const KEEP_AWAKE_DEFAULT_GRACE_MS = 90_000;

export interface KeepAwakeDeps {
  /**
   * Is the feature on? Read live (off the config store) so a Settings toggle
   * takes effect at once — the next status edge re-checks it, and {@link
   * KeepAwakeService.refresh} applies a toggle immediately. Default ON.
   */
  isEnabled: () => boolean;
  /**
   * Acquire a power-save block and return its id. Wraps
   * `powerSaveBlocker.start('prevent-app-suspension')`. May throw if the
   * platform has no power management — the caller treats that as "couldn't keep
   * awake" and carries on.
   */
  startBlocker: () => number;
  /** Release a previously-acquired block. Wraps `powerSaveBlocker.stop(id)`. */
  stopBlocker: (id: number) => void;
  /** Grace ms before release once all sessions go quiet. Read live so a config change applies. */
  graceMs: () => number;
  /** Arm a timer; returns a handle. Injected so tests can use a fake clock. */
  setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
  /** Clear a timer handle. Pairs with {@link setTimer}. */
  clearTimer: (handle: NodeJS.Timeout) => void;
  /**
   * Optional: notified on each ACTUAL acquire/release edge (`true` = the Mac is
   * now pinned awake, `false` = released). Not fired for no-op acquires while
   * already held. Used for a diagnostic log line; never throws into the service.
   */
  onChange?: (active: boolean) => void;
}

export class KeepAwakeService {
  /** Sessions currently in the `working` state. The blocker is held iff non-empty (or grace is pending). */
  private readonly working = new Set<string>();
  /** Active power-save block id, or null when none is held. */
  private blockerId: number | null = null;
  /** Pending grace-release timer (armed when `working` empties), or null. */
  private graceTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: KeepAwakeDeps) {}

  /** True while a power-save block is currently held. */
  isActive(): boolean {
    return this.blockerId !== null;
  }

  /**
   * Feed a session's newly-resolved agent state (called from the same
   * `agentStatus.on('status')` edge as the other add-ons). Adds/removes the
   * session from the working set and acquires/(grace-)releases the blocker.
   * Cheap and synchronous on the hot path.
   */
  observe(sessionId: string, state: AgentState): void {
    if (state === 'working') {
      this.working.add(sessionId);
      this.cancelGrace(); // resumed work voids any pending release
      this.acquire();
    } else {
      this.working.delete(sessionId);
      if (this.working.size === 0) this.scheduleRelease();
    }
  }

  /**
   * Forget a session (call on pty exit). A session that exits while working
   * still counts as "stopped working" — drop it and start the grace release if
   * it was the last one. (We never want a dead session pinning the Mac awake.)
   */
  remove(sessionId: string): void {
    if (!this.working.delete(sessionId)) return;
    if (this.working.size === 0) this.scheduleRelease();
  }

  /**
   * Release the blocker and clear the grace timer immediately (call on app
   * teardown — Rule 3). Safe to call when nothing is held.
   */
  shutdown(): void {
    this.cancelGrace();
    this.release();
    this.working.clear();
  }

  /**
   * Re-evaluate against the current `isEnabled()` reading — call when the
   * Settings toggle flips so the change is INSTANT rather than waiting for the
   * next status edge. Turned off ⇒ drop any held block (and pending grace) right
   * away; turned on with work still in flight ⇒ acquire now.
   */
  refresh(): void {
    if (!this.deps.isEnabled()) {
      this.cancelGrace();
      this.release();
    } else if (this.working.size > 0) {
      this.acquire();
    }
  }

  // ----- internals -----------------------------------------------------------

  private acquire(): void {
    if (this.blockerId !== null) return; // already holding
    if (!this.deps.isEnabled()) return; // feature off — never pin the Mac awake
    try {
      this.blockerId = this.deps.startBlocker();
    } catch {
      // No power management available (or the call failed). Degrade quietly:
      // agents still run, the Mac just isn't pinned awake.
      this.blockerId = null;
      return;
    }
    this.notify(true);
  }

  private release(): void {
    if (this.blockerId === null) return;
    const id = this.blockerId;
    this.blockerId = null;
    try {
      this.deps.stopBlocker(id);
    } catch {
      /* releasing is best-effort — never let it throw on the teardown path */
    }
    this.notify(false);
  }

  /** Fire the optional onChange callback, swallowing any error it throws. */
  private notify(active: boolean): void {
    try {
      this.deps.onChange?.(active);
    } catch {
      /* a diagnostic callback must never break acquire/release */
    }
  }

  /** Arm the grace timer (idempotent — a timer already pending is left alone). */
  private scheduleRelease(): void {
    if (this.blockerId === null) return; // nothing held → nothing to release
    if (this.graceTimer !== null) return; // already counting down
    const ms = Math.max(0, Math.round(this.deps.graceMs()));
    this.graceTimer = this.deps.setTimer(() => {
      this.graceTimer = null;
      // Re-check at fire time: work may have resumed (observe would have
      // cancelled this, but guard against a raced timer).
      if (this.working.size === 0) this.release();
    }, ms);
  }

  private cancelGrace(): void {
    if (this.graceTimer === null) return;
    this.deps.clearTimer(this.graceTimer);
    this.graceTimer = null;
  }
}
