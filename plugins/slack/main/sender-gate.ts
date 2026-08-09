/**
 * SLACK LISTENER SINGLE-USER INVARIANT
 *
 * The live bot is owner-scoped: only the configured `authedUserId` can drive
 * it. Every other sender — a teammate in the same channel, anyone else's
 * message — is dropped silently. No reply, no DM-back. From their perspective
 * the bot is not listening at all.
 *
 * This is a security boundary, not a UX preference. Widening it (allowlist,
 * RBAC, multi-tenant) is a deliberate feature, not a refactor: if you are
 * editing this file with multi-user in mind, STOP and write a spec first.
 */

import type { InboundSlackMessage } from '../shared/types.js';

/**
 * Pure predicate: is this message from the authorized Slack user? Exported
 * separately so callers that don't need drop-audit can use it as a fast path.
 */
export function isAuthorizedSender(msg: InboundSlackMessage, authedUserId: string): boolean {
  return !!msg.user && msg.user === authedUserId;
}

export interface SenderGateOptions {
  readonly authedUserId: string;
  /**
   * Called at most once per userId per rate-limit window when a message is
   * dropped. The gate owner emits the audit log / event from here.
   */
  readonly onDrop?: (userId: string, channel: string, messageTs: string) => void;
  /** Clock source for the rate-limit window. Defaults to Date.now. */
  readonly now?: () => number;
  /** How long (ms) to suppress repeated drop callbacks for the same userId. Default 60_000. */
  readonly rateLimitMs?: number;
}

/**
 * Single-chokepoint sender gate. The drop is always silent to the Slack user;
 * the rate limit only controls audit-log verbosity (first drop per (userId,
 * window) fires `onDrop`).
 */
export class SenderGate {
  private readonly lastDropAt = new Map<string, number>();
  private readonly rateLimitMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: SenderGateOptions) {
    this.rateLimitMs = opts.rateLimitMs ?? 60_000;
    this.now = opts.now ?? Date.now.bind(Date);
  }

  /** Returns true if the message is authorized; otherwise drops (rate-limited audit) and returns false. */
  check(msg: InboundSlackMessage, channel: string): boolean {
    if (isAuthorizedSender(msg, this.opts.authedUserId)) return true;
    const userId = msg.user || '(unknown)';
    const nowMs = this.now();
    const last = this.lastDropAt.get(userId);
    // `=== undefined` (not `?? 0`) so the first drop fires even when an
    // injected test clock starts inside [0, rateLimitMs).
    if (last === undefined || nowMs - last >= this.rateLimitMs) {
      this.lastDropAt.set(userId, nowMs);
      this.opts.onDrop?.(userId, channel, msg.ts);
    }
    return false;
  }
}
