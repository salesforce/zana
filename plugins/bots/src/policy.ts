/**
 * Bounded, in-memory trust state for agent-to-bot traffic:
 *
 * - grants: a thread has temporary approval to change a particular bot;
 * - reply allowances: a bot may answer a thread only after it messaged that bot;
 * - a sliding-window rate limit on agent-originated deliveries per sender/bot pair.
 *
 * State resets on restart. Human-originated traffic (Bots panel, `zcc bots` CLI) bypasses it.
 */

export const GRANT_TTL_MS = 8 * 60 * 60_000;
export const REPLY_TTL_MS = 24 * 60 * 60_000;
export const REPLIES_PER_MESSAGE = 3;
export const RATE_WINDOW_MS = 60 * 60_000;
export const MAX_DELIVERIES_PER_WINDOW = 20;
const MAX_ENTRIES = 1_000;

function prune<V>(map: Map<string, V>, alive: (value: V) => boolean): void {
  for (const [key, value] of map) if (!alive(value)) map.delete(key);
  // Maps iterate in insertion order, so the oldest entries go first.
  while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value as string);
}

export class TrustLedger {
  private readonly manageGrants = new Map<string, number>();
  private readonly replies = new Map<string, { expiresAt: number; left: number }>();
  private readonly deliveries = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  hasManageGrant(threadId: string, botId: string): boolean {
    const expiresAt = this.manageGrants.get(`${threadId}|${botId}`);
    return expiresAt !== undefined && expiresAt > this.now();
  }

  grantManage(threadId: string, botId: string): void {
    const key = `${threadId}|${botId}`;
    this.manageGrants.delete(key);
    this.manageGrants.set(key, this.now() + GRANT_TTL_MS);
    prune(this.manageGrants, (expiresAt) => expiresAt > this.now());
  }

  /** `threadId` messaged `botId`; the bot may now answer it a few times. */
  allowReply(botId: string, threadId: string): void {
    const key = `${botId}|${threadId}`;
    this.replies.delete(key);
    this.replies.set(key, { expiresAt: this.now() + REPLY_TTL_MS, left: REPLIES_PER_MESSAGE });
    prune(this.replies, (row) => row.expiresAt > this.now() && row.left > 0);
  }

  /** Spend one reply allowance; false when the bot was never asked by that thread. */
  takeReply(botId: string, threadId: string): boolean {
    const key = `${botId}|${threadId}`;
    const row = this.replies.get(key);
    if (!row || row.expiresAt <= this.now() || row.left <= 0) {
      this.replies.delete(key);
      return false;
    }
    row.left -= 1;
    if (row.left === 0) this.replies.delete(key);
    return true;
  }

  /** Count one agent-originated delivery from `from` to `to`; false when over budget. */
  takeDelivery(from: string, to: string): boolean {
    const key = `${from}|${to}`;
    const since = this.now() - RATE_WINDOW_MS;
    const recent = (this.deliveries.get(key) ?? []).filter((at) => at > since);
    if (recent.length >= MAX_DELIVERIES_PER_WINDOW) {
      this.deliveries.set(key, recent);
      return false;
    }
    recent.push(this.now());
    this.deliveries.delete(key);
    this.deliveries.set(key, recent);
    prune(this.deliveries, (times) => times.some((at) => at > since));
    return true;
  }
}
