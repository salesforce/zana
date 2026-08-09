/**
 * The transport-agnostic Slack client contract the bot depends on.
 *
 * Two implementations sit behind it:
 *   - {@link WebApiSlackClient} (web-api-client.ts) — direct Slack Web API with
 *     a bot token, over the brokered `ctx.fetch`.
 *   - {@link McpSlackClient} (mcp-client.ts) — routes through the local AI
 *     Expert Suite MCP gateway, reusing its existing Slack auth (no token to
 *     paste). Same interface, so the pollers + BotRuntime are unchanged.
 *
 * The error TYPES are shared (not per-impl) because the pollers' circuit
 * breakers key on them: `SlackRateLimited` → cooldown, `SlackLogicalError`
 * (auth codes → stop; channel_not_found/thread_not_found → drop the thread).
 */

import type { InboundSlackMessage } from '../shared/types.js';

/** Slack reported a logical failure (`{ok:false}`, or an MCP error). */
export class SlackLogicalError extends Error {
  readonly name = 'SlackLogicalError';
  constructor(
    readonly code: string,
    readonly method: string
  ) {
    super(`slack ${method}: ${code}`);
  }
}

/** Rate limited — back off for `retryAfterSeconds`. */
export class SlackRateLimited extends Error {
  readonly name = 'SlackRateLimited';
  constructor(readonly retryAfterSeconds: number) {
    super(`slack rate limited; retry after ${retryAfterSeconds}s`);
  }
}

/** Result of a channel/thread read. */
export interface ReadResult {
  messages: InboundSlackMessage[];
}

/** Result of an auth check — resolves the authed user id for the panel. */
export interface AuthTestResult {
  userId: string;
  user: string;
  team: string;
}

/** One reaction on a message: its emoji name + the user ids who added it. */
export interface ReactionSummary {
  name: string;
  users: string[];
}

/**
 * What the poll loop + approval flow call. Both transports implement this; the
 * bot never branches on which one is active.
 */
export interface SlackClient {
  /** Validate auth and return the bot/user identity. */
  authTest(): Promise<AuthTestResult>;
  /** Top-level channel messages newer than `oldestTs` (inclusive — caller drops `<= cursor`). */
  readChannel(channel: string, oldestTs?: string): Promise<ReadResult>;
  /** Thread replies newer than `oldestTs`. Includes the parent message. */
  readThread(channel: string, parentTs: string, oldestTs?: string): Promise<ReadResult>;
  /** Post a reply in a thread. Returns the new message ts (may be '' if the transport can't report it). */
  postThreadReply(channel: string, parentTs: string, text: string): Promise<string>;
  /** Read the reactions on a single message. */
  getReactions(channel: string, ts: string): Promise<ReactionSummary[]>;
}
