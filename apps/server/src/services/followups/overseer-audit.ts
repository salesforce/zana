/**
 * Overseer audit ring — the bounded in-memory trail of auto-approval decisions
 * the {@link Overseer} cascade made, plus the per-session rollup the renderer
 * badges. The Overseer doc named this as the next increment once the experiment
 * graduates: "a bounded in-memory ring + a dry-run review pane".
 *
 * Two consumers, one source of truth:
 *  - `recent()` feeds the Settings → Experimental dry-run review pane (the LIMIT
 *    is the ring cap, so the pane is inherently bounded — Rule 5).
 *  - `rollup(sessionId)` derives the small {@link OverseerActivity} the main
 *    process pushes to the renderer for the "auto-approved ×N" card badge.
 *
 * Pure and Electron-free: it just records entries and counts them. Wiring (the
 * `audit` dep on the Overseer, the debounced IPC push) lives in `index.ts`.
 * Retention is a hard cap (default 200) — the ring evicts oldest-first, so a
 * long-running, chatty session can never grow this unbounded.
 */

import type { OverseerActivity, OverseerAuditEntry } from '@zana-ai/zcc-domain/product';

/** Default ring capacity — generous enough for a dry-run review, still bounded. */
export const DEFAULT_AUDIT_CAP = 200;

export class OverseerAuditRing {
  private entries: OverseerAuditEntry[] = [];

  constructor(private readonly cap: number = DEFAULT_AUDIT_CAP) {}

  /**
   * Record one decision. Appends to the tail; when the ring is over capacity it
   * drops from the head (oldest-first), so the trail always holds the most
   * recent `cap` decisions. Never throws — the Overseer calls this best-effort.
   */
  record(entry: OverseerAuditEntry): void {
    this.entries.push(entry);
    const overflow = this.entries.length - this.cap;
    if (overflow > 0) this.entries.splice(0, overflow);
  }

  /**
   * The most-recent decisions, newest-first, capped at `limit` (and never beyond
   * the ring). Feeds the dry-run review pane. Returns copies of the entry refs
   * (entries are immutable value objects, so a shallow slice is safe).
   */
  recent(limit = this.cap): OverseerAuditEntry[] {
    const n = Math.max(0, Math.min(limit, this.entries.length));
    if (n === 0) return [];
    return this.entries.slice(this.entries.length - n).reverse();
  }

  /**
   * Per-session rollup for the card badge, or null if this session has no
   * recorded decisions in the (bounded) ring. Counts what the cascade ACTED on:
   *  - `autoApproved` — verdict `allow` (a real friction removal),
   *  - `wouldApprove` — computed `allow` but verdict `ask` (dryRun only),
   *  - `askedBack`    — verdict `ask` that wasn't a would-approve.
   * `last*` mirror the newest decision for the tooltip.
   */
  rollup(sessionId: string): OverseerActivity | null {
    let autoApproved = 0;
    let wouldApprove = 0;
    let askedBack = 0;
    let last: OverseerAuditEntry | null = null;
    for (const e of this.entries) {
      if (e.sessionId !== sessionId) continue;
      if (e.verdict === 'allow') autoApproved += 1;
      else if (e.computed === 'allow') wouldApprove += 1; // dryRun: would, didn't
      else askedBack += 1;
      last = e; // entries are append-order, so the last match is the newest
    }
    if (!last) return null;
    return {
      sessionId,
      autoApproved,
      wouldApprove,
      askedBack,
      lastTier: last.tier,
      lastReason: last.reason,
      lastAt: last.at
    };
  }

  /** Drop every entry for a session (call on pty exit / session close). */
  clear(sessionId: string): void {
    this.entries = this.entries.filter((e) => e.sessionId !== sessionId);
  }

  /** Total recorded entries currently held (for tests / diagnostics). */
  size(): number {
    return this.entries.length;
  }
}
